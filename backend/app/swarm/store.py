"""RunStore: JSON persistence for runs under settings.runs_dir (atomic writes, debounced saves)."""
from __future__ import annotations

import asyncio
import logging
import os
import tempfile
import time
from pathlib import Path

import orjson

from app.swarm.models import Run, RunSummary

log = logging.getLogger("parallax.store")


class RunStore:
    """Persists `Run` objects as `<runs_dir>/<id>.json`.

    * `save(run)` is debounced: at most one disk write per run every `debounce` seconds (the trailing write is
      scheduled on the running event loop, so the final state always lands).
    * `flush(run)` writes immediately (atomic temp + rename).
    * Live runs are also kept in memory so readers always see the freshest state, even between debounced writes.
    """

    def __init__(self, root: Path | str | None = None, *, debounce: float = 0.5) -> None:
        if root is None:
            from app.config import settings  # lazy: keeps tests free of env side effects

            root = settings.runs_dir
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.debounce = debounce
        self._live: dict[str, Run] = {}
        self._last_write: dict[str, float] = {}
        self._pending: dict[str, asyncio.TimerHandle] = {}

    # ── paths ────────────────────────────────────────────────────────────
    def path(self, run_id: str) -> Path:
        safe = "".join(ch for ch in run_id if ch.isalnum() or ch in "-_")
        return self.root / f"{safe}.json"

    # ── writes ───────────────────────────────────────────────────────────
    def put(self, run: Run) -> None:
        """Register a run in memory without touching disk."""
        self._live[run.id] = run

    def flush(self, run: Run) -> None:
        self._live[run.id] = run
        handle = self._pending.pop(run.id, None)
        if handle is not None:
            handle.cancel()
        self._write(run)

    def save(self, run: Run) -> None:
        self._live[run.id] = run
        now = time.monotonic()
        last = self._last_write.get(run.id, 0.0)
        if now - last >= self.debounce:
            self._write(run)
            return
        if run.id in self._pending:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            self._write(run)
            return
        delay = max(0.0, self.debounce - (now - last))
        self._pending[run.id] = loop.call_later(delay, self._flush_pending, run.id)

    def _flush_pending(self, run_id: str) -> None:
        self._pending.pop(run_id, None)
        run = self._live.get(run_id)
        if run is not None:
            self._write(run)

    def _write(self, run: Run) -> None:
        self._last_write[run.id] = time.monotonic()
        data = orjson.dumps(run.model_dump(mode="json"), option=orjson.OPT_NON_STR_KEYS)
        target = self.path(run.id)
        fd, tmp = tempfile.mkstemp(prefix=f".{run.id}.", suffix=".tmp", dir=self.root)
        try:
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)
            os.replace(tmp, target)
        except Exception:
            log.exception("failed to persist run %s", run.id)
            try:
                os.unlink(tmp)
            except OSError:
                pass

    async def flush_all(self) -> None:
        for run_id in list(self._pending):
            handle = self._pending.pop(run_id, None)
            if handle is not None:
                handle.cancel()
            run = self._live.get(run_id)
            if run is not None:
                self._write(run)

    # ── reads ────────────────────────────────────────────────────────────
    def get(self, run_id: str) -> Run | None:
        run = self._live.get(run_id)
        if run is not None:
            return run
        p = self.path(run_id)
        if not p.exists():
            return None
        try:
            run = Run.model_validate(orjson.loads(p.read_bytes()))
        except Exception:
            log.exception("corrupt run file %s", p)
            return None
        return run

    def mark_interrupted(self, reason: str = "Interrupted by a backend restart") -> int:
        """On startup: any persisted run that never reached a terminal state is marked failed. Returns count."""
        n = 0
        for path in self.root.glob("*.json"):
            if path.stem.startswith("."):
                continue
            try:
                run = Run.model_validate(orjson.loads(path.read_bytes()))
            except Exception:
                continue
            if run.status in ("done", "failed"):
                continue
            run.status = "failed"
            run.error = run.error or reason
            for b in run.branches:
                if b.status not in ("done", "failed"):
                    b.status = "failed"
            try:
                if run.metrics.finished_at is None:
                    from datetime import datetime, timezone
                    run.metrics.finished_at = datetime.now(timezone.utc).isoformat()
            except Exception:
                pass
            self._write(run)
            n += 1
        return n

    def list_summaries(self) -> list[RunSummary]:
        seen: dict[str, RunSummary] = {}
        for run in self._live.values():
            seen[run.id] = run.summary()
        for p in self.root.glob("*.json"):
            run_id = p.stem
            if run_id in seen or run_id.startswith("."):
                continue
            try:
                raw = orjson.loads(p.read_bytes())
                seen[run_id] = Run.model_validate(raw).summary()
            except Exception:
                log.warning("skipping unreadable run file %s", p)
        return sorted(seen.values(), key=lambda s: s.created_at, reverse=True)

    def delete(self, run_id: str) -> bool:
        handle = self._pending.pop(run_id, None)
        if handle is not None:
            handle.cancel()
        existed = self._live.pop(run_id, None) is not None
        self._last_write.pop(run_id, None)
        p = self.path(run_id)
        if p.exists():
            try:
                p.unlink()
                existed = True
            except OSError:
                log.exception("failed to delete run file %s", p)
        return existed
