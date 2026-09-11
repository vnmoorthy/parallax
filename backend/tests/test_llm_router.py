"""LLM router + FakeLLM + extract_json tests (no network)."""
from __future__ import annotations

import json

import pytest

import app.llm.router as router_mod
from app.config import settings
from app.llm.base import LLM, LLMError, extract_json
from app.llm.fake_llm import FakeLLM
from app.llm.rocketride_llm import extract_answer, substitute_placeholders
from app.llm.router import RoutedLLM, build_chain, get_llm, llm_status, reset_llm


class StubLLM:
    def __init__(self, name: str, *, healthy: bool = True, fail: bool = False, reply: str = "{}"):
        self.name = name
        self._healthy = healthy
        self._fail = fail
        self._reply = reply
        self.calls = 0

    async def complete(self, system: str, user: str, *, json_mode: bool = True, max_tokens: int = 2000) -> str:
        self.calls += 1
        if self._fail:
            raise LLMError(f"{self.name} is broken")
        return self._reply

    async def healthy(self) -> bool:
        return self._healthy


# ── extract_json ────────────────────────────────────────────────────────────
@pytest.mark.parametrize("text,expected", [
    ('{"a": 1}', {"a": 1}),
    ('```json\n{"a": [1, 2]}\n```', {"a": [1, 2]}),
    ('Sure! Here is the plan:\n{"hypotheses": [{"id": "h1"}]}\nLet me know.', {"hypotheses": [{"id": "h1"}]}),
    ('[{"x": 1}, {"x": 2}]', [{"x": 1}, {"x": 2}]),
    ('prefix text [1, 2, 3] suffix', [1, 2, 3]),
    ('{"s": "brace } inside \\" string", "n": {"k": [1]}}', {"s": 'brace } inside " string', "n": {"k": [1]}}),
    ('```\n{"fenced": true}\n```', {"fenced": True}),
])
def test_extract_json_edge_cases(text, expected):
    assert extract_json(text) == expected


def test_extract_json_failures_and_passthrough():
    assert extract_json({"already": "dict"}) == {"already": "dict"}
    with pytest.raises(ValueError):
        extract_json("no json here at all")
    with pytest.raises(ValueError):
        extract_json(None)  # type: ignore[arg-type]


# ── FakeLLM ─────────────────────────────────────────────────────────────────
async def test_fake_llm_is_an_llm_and_generic_reply():
    fake = FakeLLM()
    assert isinstance(fake, LLM) and await fake.healthy()
    assert json.loads(await fake.complete("no marker", "hi")) == {"ok": True}
    assert await fake.complete("no marker", "hi", json_mode=False) == "ok"


async def test_fake_llm_planner_counts_and_columns():
    fake = FakeLLM()
    user = ("Schema for table data: customer_id INTEGER, company VARCHAR, mrr DOUBLE, feedback VARCHAR\n"
            "text column: feedback\nQuestion: why churn?\nReturn exactly 5 hypotheses.")
    plan = json.loads(await fake.complete("You are the planner [[PLANNER]]", user))
    hyps = plan["hypotheses"]
    assert len(hyps) == 5
    assert [h["approach"] for h in hyps] == ["sql", "bm25", "vector", "mixed", "sql"]
    assert [h["id"] for h in hyps] == ["h1", "h2", "h3", "h4", "h5"]
    assert hyps[1]["target_columns"] == ["feedback"] and hyps[2]["target_columns"] == ["feedback"]
    assert set(hyps[0]["target_columns"]) <= {"customer_id", "company", "mrr", "feedback"}
    assert all(h["title"] and h["rationale"] for h in hyps)
    # default N = 3, JSON-style schema, identical output on repeat (deterministic)
    user2 = 'columns: [{"name": "order_id", "type": "BIGINT"}, {"name": "review_text", "type": "VARCHAR"}]'
    a = await fake.complete("[[PLANNER]]", user2)
    b = await FakeLLM().complete("[[PLANNER]]", user2)
    assert a == b and len(json.loads(a)["hypotheses"]) == 3
    assert "order_id" in json.loads(a)["hypotheses"][0]["target_columns"]


async def test_fake_llm_agent_sequence_per_branch():
    fake = FakeLLM()
    sysm = "[[AGENT]] analyst"
    first = json.loads(await fake.complete(sysm, "branch_id: b1\ntable_ref: default.public.data\nhypothesis: x"))
    assert first["action"] == "sql" and first["sql"] == "SELECT COUNT(*) AS n FROM default.public.data"
    other = json.loads(await fake.complete(sysm, "branch_id: b2\ntable: data"))
    assert other["action"] == "sql" and other["sql"].endswith("FROM data")  # independent counter per branch
    second = json.loads(await fake.complete(sysm, "branch_id: b1\nobservation: n=6000"))
    assert second["action"] == "finish"
    finding = second["finding"]
    assert set(finding) >= {"claim", "evidence", "confidence", "chart"} and 0 < finding["confidence"] <= 1
    third = json.loads(await fake.complete(sysm, "branch_id: b1"))
    assert third["action"] == "finish"
    no_branch = json.loads(await fake.complete(sysm, "no branch marker"))
    assert no_branch["action"] == "sql" and no_branch["sql"].endswith("FROM data")


async def test_fake_llm_synth_cites_every_branch():
    fake = FakeLLM()
    user = "Findings:\n- branch_id: b1 claim A\n- branch_id: b2 claim B\nAlready cited [branch:b3]"
    report = json.loads(await fake.complete("[[SYNTH]] writer", user))
    for bid in ("b1", "b2", "b3"):
        assert f"[branch:{bid}]" in report["markdown"]
    assert {k["branch_id"] for k in report["key_findings"]} == {"b1", "b2", "b3"}
    assert report["title"] and report["executive_summary"] and report["next_questions"]


# ── RoutedLLM ───────────────────────────────────────────────────────────────
async def test_router_falls_back_in_order_and_records_provider():
    broken, good, spare = StubLLM("broken", fail=True), StubLLM("good", reply='{"ok": 1}'), StubLLM("spare")
    routed = RoutedLLM([broken, good, spare], mode="auto")
    assert await routed.complete("s", "u") == '{"ok": 1}'
    assert routed.last_provider == "good"
    assert routed.calls_by_provider == {"good": 1} and routed.errors_by_provider == {"broken": 1}
    assert (broken.calls, good.calls, spare.calls) == (1, 1, 0)
    # the failed provider is on cooldown: the next call goes straight to `good`
    await routed.complete("s", "u")
    assert (broken.calls, good.calls) == (1, 2) and routed.calls_by_provider == {"good": 2}
    status = await routed.status()
    assert status["chain"] == ["broken", "good", "spare"] and status["active"] == "broken"
    assert status["calls_by_provider"] == {"good": 2} and status["last_provider"] == "good"
    assert await routed.complete_json("s", "u") == {"ok": 1}


async def test_router_skips_unhealthy_providers():
    down, up = StubLLM("down", healthy=False, reply="down"), StubLLM("up", reply="up")
    routed = RoutedLLM([down, up], mode="auto")
    assert await routed.complete("s", "u") == "up"
    assert down.calls == 0 and (await routed.status())["active"] == "up"
    assert await routed.healthy()


async def test_router_raises_when_everything_fails_and_retries_after_cooldown():
    a, b = StubLLM("a", fail=True), StubLLM("b", fail=True)
    routed = RoutedLLM([a, b], mode="auto", cooldown_s=0.0)
    with pytest.raises(LLMError) as exc:
        await routed.complete("s", "u")
    assert "a: a is broken" in str(exc.value) and "b: b is broken" in str(exc.value)
    assert routed.last_provider is None and routed.calls_by_provider == {}
    b._fail = False
    assert await routed.complete("s", "u") == "{}" and routed.last_provider == "b"
    assert a.calls == 2  # zero cooldown → retried first again


async def test_router_with_nothing_healthy_still_tries_everything():
    only = StubLLM("only", healthy=False, reply="served")
    routed = RoutedLLM([only], mode="ollama")
    assert await routed.complete("s", "u") == "served"
    assert not await routed.healthy() and (await routed.status())["active"] is None


def test_build_chain_modes(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "anthropic_api_key", None)
    monkeypatch.setattr(settings, "rocketride_uri", None)
    monkeypatch.setattr(settings, "rocketride_apikey", None)
    assert [p.name for p in build_chain("auto")] == ["ollama", "fake"]
    assert [p.name for p in build_chain("fake")] == ["fake"]
    assert [p.name for p in build_chain("ollama")] == ["ollama"]
    with pytest.raises(LLMError):
        build_chain("anthropic")
    with pytest.raises(LLMError):
        build_chain("rocketride")
    with pytest.raises(LLMError):
        build_chain("gpt")
    monkeypatch.setattr(settings, "anthropic_api_key", "sk-ant-test")
    monkeypatch.setattr(settings, "rocketride_uri", "http://localhost:5565")
    monkeypatch.setattr(settings, "rocketride_apikey", "MYAPIKEY")
    assert [p.name for p in build_chain("auto")] == ["rocketride", "anthropic", "ollama", "fake"]
    assert [p.name for p in build_chain("anthropic")] == ["anthropic"]
    assert [p.name for p in build_chain("rocketride")] == ["rocketride"]


async def test_get_llm_singleton_and_status(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "parallax_llm_mode", "fake")
    reset_llm()
    try:
        llm = get_llm()
        assert llm is get_llm() and llm.chain == ["fake"] and llm.mode == "fake"
        status = await llm_status()
        assert status["active"] == "fake" and status["chain"] == ["fake"]
        plan = extract_json(await llm.complete("[[PLANNER]]", "exactly 2 hypotheses"))
        assert len(plan["hypotheses"]) == 2 and llm.calls_by_provider == {"fake": 1}
    finally:
        reset_llm()
    assert router_mod._llm is None


# ── RocketRide helpers (pure functions; the SDK itself is exercised only when an engine is configured) ──
def test_rocketride_placeholder_substitution_and_answer_parsing():
    pipe = {"components": [{"config": {"apikey": "${ROCKETRIDE_ANTHROPIC_KEY}", "other": "${ROCKETRIDE_MISSING}"}}]}
    out = substitute_placeholders(pipe, {"ROCKETRIDE_ANTHROPIC_KEY": "sk-1"})
    assert out["components"][0]["config"] == {"apikey": "sk-1", "other": "${ROCKETRIDE_MISSING}"}
    assert pipe["components"][0]["config"]["apikey"] == "${ROCKETRIDE_ANTHROPIC_KEY}"  # input untouched
    assert extract_answer({"data": {"answer": '{"a":1}'}}) == '{"a":1}'
    assert extract_answer({"answers": [{"a": 1}]}) == {"a": 1}
    assert extract_answer({"answers": ["text"]}) == "text"
    assert extract_answer({"answers": [{"answer": {"b": 2}, "expectJson": True}]}) == {"b": 2}
    assert extract_answer({"result_types": {}}) is None


async def test_rocketride_unconfigured_never_hangs(monkeypatch: pytest.MonkeyPatch):
    from app.llm.rocketride_llm import RocketRideLLM

    llm = RocketRideLLM(uri=None, apikey=None)
    assert await llm.healthy() is False
    with pytest.raises(LLMError):
        await llm.complete("s", "u")


async def test_rocketride_unresolved_placeholders_disable_provider(tmp_path, monkeypatch: pytest.MonkeyPatch):
    from app.llm.rocketride_llm import RocketRideLLM

    pipe = tmp_path / "x.pipe"
    pipe.write_text(json.dumps({"components": [{"id": "llm_1", "provider": "llm_anthropic",
                                                "config": {"apikey": "${ROCKETRIDE_ANTHROPIC_KEY}"}}],
                                "project_id": "00000000-0000-4000-8000-000000000000", "version": 1}))
    monkeypatch.delenv("ROCKETRIDE_ANTHROPIC_KEY", raising=False)
    monkeypatch.setattr(settings, "rocketride_anthropic_key", None)
    monkeypatch.setattr(settings, "anthropic_api_key", None)
    llm = RocketRideLLM(uri="http://127.0.0.1:9", apikey="k", pipe_path=pipe)
    assert llm.missing_placeholders() == ["ROCKETRIDE_ANTHROPIC_KEY"]
    assert await llm.healthy() is False  # no network call is made
    with pytest.raises(LLMError) as exc:
        await llm.complete("s", "u")
    assert "ROCKETRIDE_ANTHROPIC_KEY" in str(exc.value)
    monkeypatch.setenv("ROCKETRIDE_ANTHROPIC_KEY", "sk-ant-x")
    assert llm.missing_placeholders() == []
    missing = RocketRideLLM(uri="http://127.0.0.1:9", apikey="k", pipe_path=tmp_path / "nope.pipe")
    assert await missing.healthy() is False
