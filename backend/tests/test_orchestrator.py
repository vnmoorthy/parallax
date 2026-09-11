"""Orchestrator end-to-end with fakes, plus unit tests for the pure helpers."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from app.data.base import QueryError, QueryResult
from app.datasets import DatasetRegistry
from app.swarm.burst import run_burst
from app.swarm.events import EventBus
from app.swarm.models import CreateRunRequest, new_run
from app.swarm.orchestrator import Orchestrator, derive_chart, guard_sql, percentile
from app.swarm.store import RunStore
from tests.fakes import FakeEngine, FakeLLM, FakeMemory


@pytest.fixture
def registry(tmp_path: Path) -> DatasetRegistry:
    return DatasetRegistry(tmp_path / "datasets", tmp_path / "uploads")


def _make(tmp_path: Path, registry: DatasetRegistry, *, agents: int = 3, llm: FakeLLM | None = None,
          search_column: str | None = None, engine: FakeEngine | None = None):
    engine, llm, memory = engine or FakeEngine(), llm or FakeLLM(), FakeMemory()
    store, bus = RunStore(tmp_path / "runs"), EventBus()
    orch = Orchestrator(engine, llm, memory, store, bus)
    dataset = registry.list()[0]
    req = CreateRunRequest(dataset_id=dataset.id, question="Which products drive long resolution times?",
                           agents=agents, search_column=search_column)
    run = new_run(req, dataset_id=dataset.id, dataset_name=dataset.name,
                  modes={"data": engine.kind, "llm": llm.name, "memory": memory.kind},
                  text_column=search_column or (dataset.text_columns[0] if dataset.text_columns else None),
                  schema_columns=dataset.columns)
    return orch, run, dataset, engine, llm, memory, store, bus


async def test_full_run_three_agents(tmp_path: Path, registry: DatasetRegistry) -> None:
    orch, run, dataset, engine, llm, memory, store, bus = _make(tmp_path, registry, agents=3)
    collected = []

    async def _collect():
        async for ev in bus.subscribe(run.id):
            collected.append(ev)

    sub = asyncio.create_task(_collect())
    result = await asyncio.wait_for(orch.run(run, dataset), timeout=30)
    await asyncio.wait_for(sub, timeout=5)

    assert result.status == "done", result.error
    assert result.error is None
    assert result.root_db and result.root_db["id"]
    assert result.text_column == "subject"
    assert len(result.plan) == 3 and len(result.branches) == 3
    approaches = {h.approach for h in result.plan}
    assert "bm25" in approaches and "vector" in approaches
    for b in result.branches:
        assert b.status == "done"
        assert b.db and b.db["parent_id"] == result.root_db["id"]
        assert b.finding is not None and b.finding.claim
        assert 0 <= b.finding.confidence <= 1
        kinds = [s.kind for s in b.steps]
        assert kinds[-1] == "finding"
        assert any(k in ("sql", "bm25", "vector") for k in kinds)
        tool_steps = [s for s in b.steps if s.kind in ("sql", "bm25", "vector")]
        assert tool_steps and tool_steps[0].result and tool_steps[0].result["columns"]
        assert b.finding.chart is not None  # derived from the last result when the LLM omits it
    # findings persisted on each branch db + NOTES context
    for b in result.branches:
        res = await engine.query(b.db["id"], "SELECT id, claim, confidence FROM findings")
        assert res.row_count == 1 and res.rows[0][0] == b.id
        ctx = await engine.get_context(b.db["id"])
        assert "NOTES" in ctx and b.id in ctx["NOTES"]
    # root has data + data_vec + indexes (local engine → created on root)
    root_tables = {t.name for t in await engine.tables(result.root_db["id"])}
    assert {"data", "data_vec"} <= root_tables
    assert {("data", "subject", "bm25"), ("data_vec", "subject", "vector")} <= engine.indexes[result.root_db["id"]]
    # report with citations
    assert result.report is not None
    assert "[branch:" in result.report.markdown
    cited = {c["branch_id"] for c in result.report.citations}
    assert cited == {b.id for b in result.branches}
    assert result.report.key_findings and result.report.next_questions
    # metrics
    m = result.metrics
    assert m.databases_created == 1 and m.forks == 3
    assert m.queries > 0 and m.peak_concurrency >= 1
    assert m.p50_ms >= 0 and m.p95_ms >= m.p50_ms
    assert m.llm_calls == llm.calls and m.llm_calls_by_provider == {"fake": llm.calls}
    assert m.elapsed_ms and m.finished_at and m.time_to_first_finding_ms
    # memory
    assert memory.remember_calls == 1 and run.dataset_id in memory.items[0].tags
    # events in a sane order
    types = [e.type for e in collected]
    assert types[-1] == "run.finished"
    for needed in ("run.status", "run.recalled", "db.created", "run.plan", "db.forked", "branch.status", "agent.step",
                   "agent.finding", "metrics.update", "report.ready", "memory.remembered", "run.finished"):
        assert needed in types, needed
    order = [types.index(t) for t in ("db.created", "run.plan", "db.forked", "agent.step", "agent.finding",
                                      "report.ready", "memory.remembered", "run.finished")]
    assert order == sorted(order)
    assert types.count("run.finished") == 1
    statuses = [e.payload["status"] for e in collected if e.type == "run.status"]
    assert statuses == ["provisioning", "planning", "exploring", "synthesizing", "done"]
    forked = [e for e in collected if e.type == "db.forked"]
    assert all(e.branch_id and e.payload["branch_id"] == e.branch_id and e.payload["db"]["id"] for e in forked)
    steps = [e for e in collected if e.type == "agent.step"]
    assert all(e.branch_id and "step" in e.payload and "n" in e.payload["step"] for e in steps)
    plan_ev = next(e for e in collected if e.type == "run.plan")
    assert len(plan_ev.payload["hypotheses"]) == 3 and len(plan_ev.payload["branches"]) == 3
    # persisted
    path = store.path(run.id)
    assert path.exists()
    on_disk = json.loads(path.read_text())
    assert on_disk["status"] == "done" and len(on_disk["branches"]) == 3
    assert store.list_summaries()[0].id == run.id
    # late subscriber gets a full replay ending in run.finished
    replay = [ev async for ev in bus.subscribe(run.id)]
    assert replay and replay[-1].type == "run.finished" and len(replay) == len(collected)


async def test_run_survives_junk_llm_and_bad_sql(tmp_path: Path, registry: DatasetRegistry) -> None:
    # planner cycles sql/bm25/vector → b_1 is the SQL branch (bad SQL first), b_3 is vector (junk reply first)
    llm = FakeLLM(junk_branches={"b_3"}, bad_sql_branches={"b_1"})
    orch, run, dataset, engine, llm, memory, store, bus = _make(tmp_path, registry, agents=3, llm=llm)
    await asyncio.wait_for(orch.run(run, dataset), timeout=30)
    assert run.status == "done"
    b1, b3 = run.branch("b_1"), run.branch("b_3")
    assert b3 and b3.status == "done" and b3.finding is not None  # nudged once, then answered
    assert b1 and b1.status == "done" and b1.finding is not None
    kinds = [s.kind for s in b1.steps]
    assert "observe" in kinds  # SQL error fed back as an observation
    assert any(s.kind == "sql" and s.result for s in b1.steps)  # then the corrected query succeeded
    assert any("nope_column" in (s.sql or "") for s in b1.steps if s.kind == "observe")
    nudges = [u for _, u in llm.prompts if "reply with JSON only" in u.lower() or "JSON object only" in u]
    assert nudges


async def test_synth_fallback_and_helpers(tmp_path: Path, registry: DatasetRegistry) -> None:
    orch, run, dataset, engine, llm, memory, store, bus = _make(tmp_path, registry, agents=2, llm=FakeLLM(fail_synth=True))
    await asyncio.wait_for(orch.run(run, dataset), timeout=30)
    assert run.status == "done" and run.report is not None
    assert "[branch:" in run.report.markdown and run.report.citations
    # ad-hoc helpers
    res = await orch.query_branch(run, "root", "SELECT COUNT(*) AS n FROM data")
    assert res.rows[0][0] == 300
    res = await orch.query_branch(run, "b_1", "SELECT COUNT(*) FROM findings")
    assert res.rows[0][0] == 1
    with pytest.raises(QueryError):
        await orch.query_branch(run, "root", "DROP TABLE data")
    hits = await orch.search_branch(run, "b_2", "bm25", "crash android", 5)
    assert "score" in hits.columns and hits.row_count <= 5
    hits = await orch.search_branch(run, "root", "vector", "billing invoice", 3)
    assert "_distance" in hits.columns and hits.row_count == 3
    with pytest.raises(LookupError):
        orch.resolve_db_id(run, "nope")
    # burst
    payload = await run_burst(engine, run, 20, bus, concurrency=8)
    assert payload["count"] == 20 and len(payload["per_query"]) == 20 and payload["errors"] == 0
    assert payload["p95_ms"] >= payload["p50_ms"] and payload["max_ms"] >= payload["p95_ms"]
    assert run.metrics.burst == payload
    assert bus.history(run.id)[-2].type == "metrics.burst"
    # delete
    n = await orch.delete_run_dbs(run)
    assert n == 3 and len(engine.deleted) == 3


def test_guard_sql() -> None:
    assert guard_sql("SELECT a FROM t")[0] == "SELECT a FROM t LIMIT 50"
    assert guard_sql("select a from t limit 500;")[0] == "select a from t LIMIT 50"
    assert guard_sql("WITH x AS (SELECT 1) SELECT * FROM x LIMIT 5")[0].endswith("LIMIT 5")
    assert guard_sql("SELECT * FROM t WHERE c = 'update; drop' LIMIT 500;")[0] == "SELECT * FROM t WHERE c = 'update; drop' LIMIT 50"
    for bad in ("DROP TABLE t", "DELETE FROM t", "SELECT 1; DROP TABLE t", "", "INSERT INTO t VALUES (1)",
                "CREATE TABLE x AS SELECT 1", "-- comment only"):
        assert guard_sql(bad)[0] is None
    assert guard_sql("SELECT created_at FROM t")[1] is None  # 'created' is not CREATE
    assert guard_sql("SELECT a FROM t LIMIT 1000", max_limit=None)[0] == "SELECT a FROM t LIMIT 1000"


def test_derive_chart_and_percentile() -> None:
    r = QueryResult(columns=["region", "n"], rows=[["EU", 3], ["US", 5]], row_count=2, elapsed_ms=1)
    c = derive_chart(r, "t")
    assert c and c.type == "bar" and c.x == "region" and c.y == "n" and c.data[1]["n"] == 5
    r = QueryResult(columns=["n"], rows=[[42]], row_count=1, elapsed_ms=1)
    c = derive_chart(r, "t")
    assert c and c.type == "number" and c.data == [{"n": 42}]
    assert derive_chart(QueryResult(columns=["a"], rows=[], row_count=0, elapsed_ms=0), "t") is None
    assert derive_chart(QueryResult(columns=["a", "b"], rows=[["x", "y"]], row_count=1, elapsed_ms=0), "t") is None
    assert percentile([], 50) == 0.0 and percentile([5, 1, 3], 50) == 3 and percentile([1, 2, 3, 4], 95) == 4


async def test_sql_branches_do_not_wait_for_slow_vector_index(tmp_path: Path, registry: DatasetRegistry) -> None:
    """LocalEngine embeds every row for the vector index (slow); only vector/mixed branches should wait for it."""
    slow = 1.2
    engine = FakeEngine(slow_vector_index_s=slow)
    orch, run, dataset, engine, llm, memory, store, bus = _make(tmp_path, registry, agents=4, engine=engine)
    t0 = asyncio.get_running_loop().time()
    await asyncio.wait_for(orch.run(run, dataset), timeout=30)
    total_s = asyncio.get_running_loop().time() - t0
    assert run.status == "done"
    assert total_s >= slow  # the vector branch really waited for the root index
    assert run.metrics.time_to_first_finding_ms < slow * 1000  # ...but SQL/BM25 branches did not
    by_approach = {run.hypothesis(b.hypothesis_id).approach: b for b in run.branches}
    assert by_approach["vector"].status == "done" and by_approach["sql"].status == "done"
    vec_db = by_approach["vector"].db["id"]
    root_id = run.root_db["id"]
    # the vector index was built exactly once, on the root, and the vector fork is marked as inheriting it
    assert engine.calls["create_index"] == 2
    assert {("data", "subject", "bm25"), ("data_vec", "subject", "vector")} <= engine.indexes[root_id]
    assert (vec_db, "vector") in orch._indexed and (vec_db, "bm25") in orch._indexed
    events = bus.history(run.id)
    first_finding = next(i for i, e in enumerate(events) if e.type == "agent.finding")
    assert events[first_finding].branch_id != by_approach["vector"].id
