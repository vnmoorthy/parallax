"""CogneeMemory — persistent graph memory on cognee 1.5.x (docs/SPEC.md §3.3, research/COGNEE_SNYK.md).

Design rules:
* cognee reads its configuration from the environment at import time, so we export ``LLM_*`` / ``EMBEDDING_*``
  **before** importing it (import happens lazily inside ``_ensure`` in a worker thread — it is slow).
* ``remember`` = ``cognee.add(text, dataset_name="parallax", node_set=tags)`` then ``cognify`` in a background task
  serialised by a lock, so runs are never blocked by memory writes.
* ``recall`` = ``cognee.search(GRAPH_COMPLETION)`` falling back to ``CHUNKS``; results coerced defensively.
* Every public call is wrapped: failures are logged and yield empty/None — this class never raises.
"""
from __future__ import annotations

import asyncio
import logging
import os
import tempfile
from pathlib import Path
from typing import Any

from app.config import settings
from app.memory.base import MemoryHit

log = logging.getLogger("parallax.memory.cognee")

DATASET = "parallax"
ADD_TIMEOUT_S = 180.0
COGNIFY_TIMEOUT_S = 900.0
SEARCH_TIMEOUT_S = 90.0
GRAPH_TIMEOUT_S = 120.0
HEALTH_TIMEOUT_S = 60.0


def configure_cognee_env() -> dict[str, str]:
    """Export cognee's env config (setdefault — explicit env / .env values always win). Returns what is set."""
    env = os.environ
    env.setdefault("ENABLE_BACKEND_ACCESS_CONTROL", "false")
    env.setdefault("TELEMETRY_DISABLED", "true")
    host = settings.ollama_host.rstrip("/")

    llm_provider = settings.llm_provider or ("anthropic" if settings.anthropic_api_key else "ollama")
    env.setdefault("LLM_PROVIDER", llm_provider)
    if llm_provider == "anthropic":
        env.setdefault("LLM_MODEL", settings.llm_model or "claude-sonnet-4-5-20250929")
        if settings.llm_api_key or settings.anthropic_api_key:
            env.setdefault("LLM_API_KEY", settings.llm_api_key or settings.anthropic_api_key or "")
        if settings.llm_endpoint:
            env.setdefault("LLM_ENDPOINT", settings.llm_endpoint)
    elif llm_provider == "ollama":
        env.setdefault("LLM_MODEL", settings.llm_model or settings.ollama_model)
        env.setdefault("LLM_ENDPOINT", settings.llm_endpoint or host)
        env.setdefault("LLM_API_KEY", settings.llm_api_key or "ollama")
    else:  # user-managed provider (openai, gemini, …): pass through whatever they configured
        if settings.llm_model:
            env.setdefault("LLM_MODEL", settings.llm_model)
        if settings.llm_api_key:
            env.setdefault("LLM_API_KEY", settings.llm_api_key)
        if settings.llm_endpoint:
            env.setdefault("LLM_ENDPOINT", settings.llm_endpoint)

    env.setdefault("EMBEDDING_PROVIDER", settings.embedding_provider or "ollama")
    env.setdefault("EMBEDDING_MODEL", settings.embedding_model or "nomic-embed-text:latest")
    env.setdefault("EMBEDDING_ENDPOINT", settings.embedding_endpoint or f"{host}/api/embed")
    env.setdefault("EMBEDDING_DIMENSIONS", str(settings.embedding_dimensions or 768))
    env.setdefault("HUGGINGFACE_TOKENIZER", "nomic-ai/nomic-embed-text-v1.5")
    keys = ("LLM_PROVIDER", "LLM_MODEL", "LLM_ENDPOINT", "EMBEDDING_PROVIDER", "EMBEDDING_MODEL",
            "EMBEDDING_ENDPOINT", "EMBEDDING_DIMENSIONS")
    return {k: env[k] for k in keys if k in env}


class CogneeMemory:
    kind = "cognee"

    def __init__(self, *, dataset: str = DATASET, root_dir: Path | None = None):
        self._dataset = dataset
        self._root = Path(root_dir) if root_dir else settings.memory_dir
        self._cognee: Any = None
        self._ready = False
        self._init_error: str | None = None
        self._remember_count = 0
        self._pending_cognify = False
        self._cognify_task: asyncio.Task | None = None
        self._healthy_cache: bool | None = None
        self._locks: dict[str, asyncio.Lock] = {}
        self._locks_loop: asyncio.AbstractEventLoop | None = None
        self.env = configure_cognee_env()

    # ── plumbing ────────────────────────────────────────────────────────────
    def _lock(self, name: str) -> asyncio.Lock:
        loop = asyncio.get_running_loop()
        if self._locks_loop is not loop:
            self._locks, self._locks_loop = {}, loop
        return self._locks.setdefault(name, asyncio.Lock())

    @property
    def ready(self) -> bool:
        return self._ready

    @property
    def init_error(self) -> str | None:
        return self._init_error

    def _import_and_configure(self) -> Any:
        import cognee  # slow import; env must already be exported (done in __init__)

        cognee.config.system_root_directory(str(self._root / "cognee_system"))
        cognee.config.data_root_directory(str(self._root / "cognee_data"))
        return cognee

    async def _init_databases(self) -> None:
        """Create Cognee's relational tables + default user so search() works before the first add()."""
        try:
            from cognee.infrastructure.databases.relational import create_db_and_tables

            await create_db_and_tables()
        except Exception as exc:  # noqa: BLE001
            log.debug("cognee create_db_and_tables: %s", exc)
        try:
            from cognee.modules.users.methods import get_default_user

            await get_default_user()
        except Exception as exc:  # noqa: BLE001
            log.debug("cognee default user: %s", exc)

    async def _ensure(self) -> bool:
        if self._ready:
            return True
        if self._init_error:
            return False
        async with self._lock("init"):
            if self._ready or self._init_error:
                return self._ready
            try:
                self._cognee = await asyncio.wait_for(asyncio.to_thread(self._import_and_configure), timeout=120)
                await asyncio.wait_for(self._init_databases(), timeout=120)
                self._ready = True
                log.info("cognee ready (LLM=%s, embeddings=%s)", self.env.get("LLM_PROVIDER"), self.env.get("EMBEDDING_MODEL"))
            except Exception as exc:  # noqa: BLE001
                self._init_error = f"{type(exc).__name__}: {exc}"
                log.warning("cognee unavailable → local memory only: %s", self._init_error)
        return self._ready

    # ── Memory protocol ─────────────────────────────────────────────────────
    async def remember(self, text: str, *, tags: list[str]) -> None:
        text = (text or "").strip()
        if not text or not await self._ensure():
            return
        try:
            await asyncio.wait_for(
                self._cognee.add(text, dataset_name=self._dataset, node_set=[str(t) for t in tags] or None),
                timeout=ADD_TIMEOUT_S)
            self._remember_count += 1
            self._schedule_cognify()
        except Exception as exc:  # noqa: BLE001
            log.warning("cognee.add failed: %s", exc)

    def _schedule_cognify(self) -> None:
        self._pending_cognify = True
        if self._cognify_task is None or self._cognify_task.done():
            self._cognify_task = asyncio.create_task(self._cognify_loop(), name="cognee-cognify")

    async def _cognify_loop(self) -> None:
        while self._pending_cognify:
            self._pending_cognify = False
            async with self._lock("cognify"):
                try:
                    await asyncio.wait_for(self._cognee.cognify(datasets=[self._dataset]), timeout=COGNIFY_TIMEOUT_S)
                    log.info("cognee.cognify(%s) done", self._dataset)
                except Exception as exc:  # noqa: BLE001
                    log.warning("cognee.cognify failed: %s", exc)

    async def wait_for_cognify(self, timeout: float = COGNIFY_TIMEOUT_S) -> None:
        """Test/debug helper: block until the background cognify (if any) finishes."""
        task = self._cognify_task
        if task is not None and not task.done():
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=timeout)
            except Exception:  # noqa: BLE001
                pass

    async def recall(self, query: str, *, tags: list[str] | None = None, k: int = 8) -> list[MemoryHit]:
        if not (query or "").strip() or not await self._ensure():
            return []
        st = self._cognee.SearchType
        for query_type in (st.GRAPH_COMPLETION, st.CHUNKS):
            kwargs: dict[str, Any] = {"query_type": query_type, "datasets": [self._dataset], "top_k": max(1, int(k))}
            if tags:
                kwargs["node_name"] = [str(t) for t in tags]
            try:
                results = await asyncio.wait_for(self._cognee.search(query, **kwargs), timeout=SEARCH_TIMEOUT_S)
            except Exception as exc:  # noqa: BLE001
                lvl = log.debug if "SearchPrecondition" in type(exc).__name__ or "no data" in str(exc).lower() else log.warning
                lvl("cognee.search(%s) unavailable: %s", getattr(query_type, "name", query_type), str(exc).splitlines()[0][:200])
                continue
            hits = self._coerce(results, tags or [])
            if hits:
                return hits[: max(1, int(k))]
        return []

    @staticmethod
    def _coerce(results: Any, tags: list[str]) -> list[MemoryHit]:
        items = results if isinstance(results, list) else ([results] if results else [])
        hits: list[MemoryHit] = []
        for i, r in enumerate(items):
            text: str | None = None
            score: float | None = None
            created: str | None = None
            if isinstance(r, str):
                text = r
            elif isinstance(r, dict):
                for key in ("text", "search_result", "content", "answer", "summary", "name", "description"):
                    val = r.get(key)
                    if isinstance(val, str) and val.strip():
                        text = val
                        break
                if text is None:
                    text = str(r)
                sc = r.get("score")
                score = float(sc) if isinstance(sc, (int, float)) else None
                created = str(r.get("created_at")) if r.get("created_at") else None
            else:
                for attr in ("text", "search_result", "content", "answer", "payload"):
                    val = getattr(r, attr, None)
                    if isinstance(val, str) and val.strip():
                        text = val
                        break
                    if isinstance(val, dict):
                        for key in ("text", "content"):
                            if isinstance(val.get(key), str):
                                text = val[key]
                                break
                    if text:
                        break
                if text is None:
                    text = str(r)
                sc = getattr(r, "score", None)
                score = float(sc) if isinstance(sc, (int, float)) else None
            text = (text or "").strip()
            if not text or text in ("None", "[]", "{}"):
                continue
            hits.append(MemoryHit(text=text, score=round(score if score is not None else max(0.0, 1.0 - i * 0.05), 4),
                                  tags=list(tags), created_at=created))
        return hits

    async def stats(self) -> dict[str, Any]:
        out: dict[str, Any] = {"count": self._remember_count, "ready": self._ready, "dataset": self._dataset,
                               "error": self._init_error, "llm_provider": self.env.get("LLM_PROVIDER"),
                               "embedding_model": self.env.get("EMBEDDING_MODEL")}
        if not await self._ensure():
            return out
        try:
            datasets = await asyncio.wait_for(self._cognee.datasets.list_datasets(), timeout=HEALTH_TIMEOUT_S)
            names = []
            for d in datasets or []:
                names.append(str(getattr(d, "name", None) or (d.get("name") if isinstance(d, dict) else d)))
            out["datasets"] = names
        except Exception as exc:  # noqa: BLE001
            log.info("cognee.datasets.list_datasets failed: %s", exc)
        return out

    async def graph_html(self) -> str | None:
        if not await self._ensure():
            return None
        try:
            tmp_dir = Path(tempfile.mkdtemp(prefix="parallax-cognee-"))
            path = tmp_dir / "graph.html"
            await asyncio.wait_for(self._cognee.visualize_graph(str(path)), timeout=GRAPH_TIMEOUT_S)
            if path.exists():
                return await asyncio.to_thread(path.read_text, "utf-8")
            log.info("cognee.visualize_graph produced no file at %s", path)
            return None
        except Exception as exc:  # noqa: BLE001
            log.warning("cognee.visualize_graph failed: %s", exc)
            return None

    async def healthy(self) -> bool:
        """One-time lightweight self-test (import + relational metadata access); cached."""
        if self._healthy_cache is not None:
            return self._healthy_cache
        ok = False
        if await self._ensure():
            try:
                await asyncio.wait_for(self._cognee.datasets.list_datasets(), timeout=HEALTH_TIMEOUT_S)
                ok = True
            except Exception as exc:  # noqa: BLE001
                log.warning("cognee self-test failed: %s", exc)
        self._healthy_cache = ok
        return ok
