"""Memory factory (SPEC §2/§3.3).

``auto`` → Cognee when it is importable **and** an LLM is available for it (Anthropic key or ollama reachable);
otherwise local. Because Cognee initialisation and cognify are slow, the Cognee path is wrapped in a
``CompositeMemory`` that writes to BOTH local and cognee and always has the fast local JSONL read path.
"""
from __future__ import annotations

import asyncio
import importlib.util
import logging
from typing import Any

from app.config import settings
from app.llm.ollama_llm import model_available, ollama_tags
from app.memory.base import Memory, MemoryHit
from app.memory.cognee_memory import CogneeMemory
from app.memory.local_memory import LocalMemory

log = logging.getLogger("parallax.memory.factory")

COGNEE_RECALL_TIMEOUT_S = 25.0


def cognee_importable() -> bool:
    try:
        return importlib.util.find_spec("cognee") is not None
    except (ImportError, ValueError):
        return False


class CompositeMemory:
    """Local JSONL (fast, always works) + Cognee (graph memory, background) behind one Memory interface."""

    def __init__(self, local: LocalMemory, cognee: CogneeMemory):
        self.local = local
        self.cognee = cognee
        self._bg: set[asyncio.Task] = set()

    @property
    def kind(self) -> str:
        return "local" if self.cognee.init_error else "cognee"

    def _spawn(self, coro) -> None:
        task = asyncio.create_task(coro)
        self._bg.add(task)
        task.add_done_callback(self._bg.discard)

    async def remember(self, text: str, *, tags: list[str]) -> None:
        await self.local.remember(text, tags=tags)
        self._spawn(self.cognee.remember(text, tags=tags))  # never block a run on cognee

    async def recall(self, query: str, *, tags: list[str] | None = None, k: int = 8) -> list[MemoryHit]:
        local_task = asyncio.create_task(self.local.recall(query, tags=tags, k=k))
        cognee_hits: list[MemoryHit] = []
        try:
            cognee_hits = await asyncio.wait_for(self.cognee.recall(query, tags=tags, k=k), timeout=COGNEE_RECALL_TIMEOUT_S)
        except asyncio.TimeoutError:
            log.info("cognee recall timed out after %.0fs; using local memory", COGNEE_RECALL_TIMEOUT_S)
        except Exception as exc:  # noqa: BLE001
            log.info("cognee recall failed: %s", exc)
        local_hits = await local_task
        merged: list[MemoryHit] = []
        seen: set[str] = set()
        for hit in cognee_hits + local_hits:
            key = " ".join(hit.text.split()).lower()[:400]
            if key in seen:
                continue
            seen.add(key)
            merged.append(hit)
        return merged[: max(1, int(k))]

    async def recent(self, n: int = 10) -> list[MemoryHit]:
        return await self.local.recent(n)

    async def wait_for_background(self, timeout: float = 60.0) -> None:
        if self._bg:
            await asyncio.wait(list(self._bg), timeout=timeout)
        await self.cognee.wait_for_cognify(timeout)

    async def stats(self) -> dict[str, Any]:
        local = await self.local.stats()
        try:
            cog = await asyncio.wait_for(self.cognee.stats(), timeout=30)
        except Exception as exc:  # noqa: BLE001
            cog = {"error": str(exc)}
        return {**local, "kind": self.kind, "cognee": cog}

    async def graph_html(self) -> str | None:
        return await self.cognee.graph_html()

    async def healthy(self) -> bool:
        return await self.local.healthy()


_memory: Memory | None = None
_detail: str = "not initialised"


async def _llm_available_for_cognee() -> tuple[bool, str]:
    if settings.anthropic_api_key:
        return True, "anthropic"
    if settings.llm_provider and settings.llm_provider not in ("anthropic", "ollama"):
        return True, settings.llm_provider
    tags = await ollama_tags(settings.ollama_host)
    if tags is None:
        return False, "no ANTHROPIC_API_KEY and ollama unreachable"
    model = settings.llm_model or settings.ollama_model
    if not model_available(tags, model):
        return False, f"ollama reachable but model {model!r} not pulled"
    if not model_available(tags, "nomic-embed-text"):
        return False, "ollama reachable but nomic-embed-text (cognee embeddings) not pulled"
    return True, f"ollama:{model}"


async def get_memory() -> Memory:
    """Cached singleton. ``PARALLAX_MEMORY_MODE``: auto | cognee | local."""
    global _memory, _detail
    if _memory is not None:
        return _memory
    mode = (settings.parallax_memory_mode or "auto").strip().lower()
    if mode == "local":
        _memory = LocalMemory()
        _detail = f"local JSONL memory at {settings.memory_dir / 'memories.jsonl'}"
    elif mode in ("cognee", "auto"):
        if not cognee_importable():
            _memory = LocalMemory()
            _detail = "cognee is not installed — using local memory"
        else:
            ok, why = await _llm_available_for_cognee()
            if ok or mode == "cognee":
                _memory = CompositeMemory(LocalMemory(), CogneeMemory())
                _detail = f"cognee graph memory (LLM via {why}) + local JSONL cache" if ok else \
                    f"cognee forced by PARALLAX_MEMORY_MODE ({why}) + local JSONL cache"
            else:
                _memory = LocalMemory()
                _detail = f"cognee needs an LLM: {why} — using local memory"
    else:
        _memory = LocalMemory()
        _detail = f"unknown PARALLAX_MEMORY_MODE {mode!r} — using local memory"
    log.info("memory: %s (%s)", _memory.kind, _detail)
    return _memory


async def memory_status() -> dict[str, Any]:
    """Payload for GET /api/health → ``memory``: ``{"kind": "cognee"|"local", "detail": str}``."""
    mem = await get_memory()
    detail = _detail
    if isinstance(mem, CompositeMemory) and mem.cognee.init_error:
        detail = f"{_detail}; cognee init failed: {mem.cognee.init_error}"
    return {"kind": mem.kind, "detail": detail, "mode": settings.parallax_memory_mode}


def reset_memory() -> None:
    global _memory, _detail
    _memory = None
    _detail = "not initialised"
