"""Memory tests — LocalMemory roundtrip (hashed embeddings, no network) + composite/factory behaviour."""
from __future__ import annotations

from pathlib import Path

import pytest

from app.config import settings
from app.data.local import Embedder
from app.memory.base import Memory, MemoryHit
from app.memory.factory import CompositeMemory, get_memory, memory_status, reset_memory
from app.memory.local_memory import LocalMemory


@pytest.fixture
def memory(tmp_path: Path) -> LocalMemory:
    return LocalMemory(tmp_path / "memories.jsonl", embedder=Embedder(offline=True))


async def test_local_memory_roundtrip_with_tags(memory: LocalMemory, tmp_path: Path):
    assert isinstance(memory, Memory) and memory.kind == "local" and await memory.healthy()
    assert await memory.recall("anything") == []
    await memory.remember("Dataset saas: Q: why churn? Findings: refunds are slow and support is unhelpful",
                          tags=["ds:saas", "run:1"])
    await memory.remember("Dataset ecommerce: Q: returns? Findings: shipping delays drive returns",
                          tags=["ds:ecommerce", "run:2"])
    await memory.remember("Dataset saas: Q: expansion? Findings: enterprise seats grow fastest",
                          tags=["ds:saas", "run:3"])
    await memory.remember("   ", tags=["ignored"])  # blank → ignored

    hits = await memory.recall("slow refunds and unhelpful support", k=2)
    assert len(hits) == 2 and isinstance(hits[0], MemoryHit)
    assert "refunds are slow" in hits[0].text and hits[0].tags == ["ds:saas", "run:1"]
    assert hits[0].score >= hits[1].score > -1.0 and hits[0].created_at

    only_saas = await memory.recall("shipping delays", tags=["ds:saas"])
    assert {t for h in only_saas for t in h.tags} <= {"ds:saas", "run:1", "run:3"} and len(only_saas) == 2
    any_overlap = await memory.recall("shipping delays", tags=["run:2", "nope"])
    assert len(any_overlap) == 1 and "shipping" in any_overlap[0].text
    assert await memory.recall("x", tags=["missing"]) == []

    stats = await memory.stats()
    assert stats["count"] == 3 and stats["tags"]["ds:saas"] == 2 and stats["embedding"] == "hashed"
    assert await memory.graph_html() is None
    recent = await memory.recent(2)
    assert [h.text.split(":")[0] for h in recent] == ["Dataset saas", "Dataset ecommerce"]

    # persisted as JSONL and reloaded by a fresh instance
    lines = (tmp_path / "memories.jsonl").read_text().strip().splitlines()
    assert len(lines) == 3
    reopened = LocalMemory(tmp_path / "memories.jsonl", embedder=Embedder(offline=True))
    assert (await reopened.stats())["count"] == 3
    assert "enterprise seats" in (await reopened.recall("enterprise expansion seats", k=1))[0].text


async def test_local_memory_skips_corrupt_lines(tmp_path: Path):
    path = tmp_path / "m.jsonl"
    path.write_text('{"text": "ok", "tags": [], "embedding": [], "method": "hashed"}\nnot json\n\n')
    mem = LocalMemory(path, embedder=Embedder(offline=True))
    assert (await mem.stats())["count"] == 1
    assert await mem.recall("ok") == []  # empty embedding is ignored gracefully, no exception


class StubCognee:
    kind = "cognee"

    def __init__(self, hits: list[MemoryHit] | None = None, init_error: str | None = None):
        self.hits = hits or []
        self.init_error = init_error
        self.remembered: list[tuple[str, list[str]]] = []

    async def remember(self, text: str, *, tags: list[str]) -> None:
        self.remembered.append((text, tags))

    async def recall(self, query: str, *, tags=None, k: int = 8) -> list[MemoryHit]:
        return list(self.hits)

    async def stats(self):
        return {"count": len(self.remembered)}

    async def graph_html(self):
        return "<html>graph</html>"

    async def healthy(self):
        return True

    async def wait_for_cognify(self, timeout: float = 0) -> None:
        return None


async def test_composite_memory_writes_both_and_prefers_cognee_hits(memory: LocalMemory):
    cognee = StubCognee(hits=[MemoryHit(text="graph says: churn is driven by refunds", score=0.9, tags=["ds:saas"])])
    comp = CompositeMemory(memory, cognee)  # type: ignore[arg-type]
    assert comp.kind == "cognee"
    await comp.remember("refunds are slow", tags=["ds:saas"])
    await comp.wait_for_background()
    assert cognee.remembered == [("refunds are slow", ["ds:saas"])]
    hits = await comp.recall("slow refunds", k=5)
    assert hits[0].text.startswith("graph says") and any("refunds are slow" in h.text for h in hits)
    assert await comp.graph_html() == "<html>graph</html>"
    stats = await comp.stats()
    assert stats["count"] == 1 and stats["cognee"] == {"count": 1} and stats["kind"] == "cognee"


async def test_composite_memory_falls_back_to_local_when_cognee_is_empty_or_broken(memory: LocalMemory):
    comp = CompositeMemory(memory, StubCognee())  # type: ignore[arg-type]
    await comp.remember("shipping delays drive returns", tags=["ds:ecommerce"])
    hits = await comp.recall("returns shipping", k=3)
    assert len(hits) == 1 and "shipping" in hits[0].text
    broken = CompositeMemory(memory, StubCognee(init_error="ImportError: no cognee"))  # type: ignore[arg-type]
    assert broken.kind == "local"


async def test_factory_local_mode_and_status(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "parallax_memory_mode", "local")
    reset_memory()
    try:
        mem = await get_memory()
        assert isinstance(mem, LocalMemory) and mem is await get_memory()
        status = await memory_status()
        assert status["kind"] == "local" and "local" in status["detail"]
    finally:
        reset_memory()


async def test_factory_auto_without_llm_uses_local(monkeypatch: pytest.MonkeyPatch):
    import app.memory.factory as factory_mod

    async def no_ollama(host=None, timeout=2.0):
        return None

    monkeypatch.setattr(settings, "parallax_memory_mode", "auto")
    monkeypatch.setattr(settings, "anthropic_api_key", None)
    monkeypatch.setattr(settings, "llm_provider", None)
    monkeypatch.setattr(factory_mod, "ollama_tags", no_ollama)
    reset_memory()
    try:
        mem = await get_memory()
        assert mem.kind == "local"
        assert "ollama unreachable" in (await memory_status())["detail"]
    finally:
        reset_memory()
