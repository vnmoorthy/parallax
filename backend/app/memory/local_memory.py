"""LocalMemory — JSONL + embeddings (ollama nomic-embed-text or hashed fallback). Always works (SPEC §3.3)."""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np

from app.config import settings
from app.data.local import Embedder, now_iso
from app.memory.base import MemoryHit

log = logging.getLogger("parallax.memory.local")


class LocalMemory:
    kind = "local"

    def __init__(self, path: Path | str | None = None, *, embedder: Embedder | None = None):
        self._path = Path(path) if path else settings.memory_dir / "memories.jsonl"
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._embedder = embedder or Embedder()
        self._items: list[dict[str, Any]] | None = None
        self._lock: asyncio.Lock | None = None
        self._lock_loop: asyncio.AbstractEventLoop | None = None

    @property
    def path(self) -> Path:
        return self._path

    def _alock(self) -> asyncio.Lock:
        loop = asyncio.get_running_loop()
        if self._lock is None or self._lock_loop is not loop:
            self._lock, self._lock_loop = asyncio.Lock(), loop
        return self._lock

    def _read_file(self) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        if not self._path.exists():
            return items
        with self._path.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    log.warning("skipping corrupt memory line in %s", self._path)
                    continue
                if isinstance(rec, dict) and rec.get("text"):
                    items.append(rec)
        return items

    async def _load(self) -> list[dict[str, Any]]:
        if self._items is None:
            async with self._alock():
                if self._items is None:
                    self._items = await asyncio.to_thread(self._read_file)
        return self._items

    # ── Memory protocol ─────────────────────────────────────────────────────
    async def remember(self, text: str, *, tags: list[str]) -> None:
        text = (text or "").strip()
        if not text:
            return
        items = await self._load()
        vec, method = await self._embedder.embed_many([text])
        rec = {"id": uuid.uuid4().hex, "text": text, "tags": [str(t) for t in (tags or [])],
               "created_at": now_iso(), "embedding": vec[0], "method": method}
        line = json.dumps(rec, ensure_ascii=False) + "\n"
        async with self._alock():
            items.append(rec)
            await asyncio.to_thread(self._append, line)

    def _append(self, line: str) -> None:
        with self._path.open("a", encoding="utf-8") as fh:
            fh.write(line)

    async def recall(self, query: str, *, tags: list[str] | None = None, k: int = 8) -> list[MemoryHit]:
        items = await self._load()
        if not items or not (query or "").strip():
            return []
        wanted = {str(t) for t in tags} if tags else None
        candidates = [r for r in items if not wanted or wanted.intersection(r.get("tags") or [])]
        if not candidates:
            return []
        scored: list[tuple[float, dict[str, Any]]] = []
        for method in {r.get("method") or Embedder.HASHED for r in candidates}:
            try:
                qvec, _ = await self._embedder.embed(query, method=method)
            except Exception as exc:  # noqa: BLE001 — e.g. ollama gone since the memory was written
                log.warning("cannot embed query with %s (%s); skipping those memories", method, exc)
                continue
            q = np.asarray(qvec, dtype=np.float32)
            qn = float(np.linalg.norm(q)) or 1.0
            for r in candidates:
                if (r.get("method") or Embedder.HASHED) != method:
                    continue
                v = np.asarray(r.get("embedding") or [], dtype=np.float32)
                if v.size != q.size:
                    continue
                vn = float(np.linalg.norm(v)) or 1.0
                scored.append((float(np.dot(q, v) / (qn * vn)), r))
        scored.sort(key=lambda s: s[0], reverse=True)
        return [MemoryHit(text=r["text"], score=round(score, 4), tags=list(r.get("tags") or []),
                          created_at=r.get("created_at")) for score, r in scored[: max(1, int(k))]]

    async def recent(self, n: int = 10) -> list[MemoryHit]:
        items = await self._load()
        return [MemoryHit(text=r["text"], score=1.0, tags=list(r.get("tags") or []), created_at=r.get("created_at"))
                for r in items[-max(0, int(n)):][::-1]]

    async def stats(self) -> dict[str, Any]:
        items = await self._load()
        tags = Counter(t for r in items for t in (r.get("tags") or []))
        return {"count": len(items), "tags": dict(tags.most_common()), "path": str(self._path),
                "embedding": (items[-1].get("method") if items else None) or "n/a"}

    async def graph_html(self) -> str | None:
        return None

    async def healthy(self) -> bool:
        return True
