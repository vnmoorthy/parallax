"""EventBus: per-run replay buffer + asyncio.Queue fan-out for SSE subscribers (docs/SPEC.md §4, §5)."""
from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator

from app.swarm.models import Event

log = logging.getLogger("parallax.events")

FINISHED = "run.finished"


class EventBus:
    """Publish/subscribe for run events.

    * `publish(event)` appends to the run's replay buffer and fans out to every live subscriber queue.
    * `subscribe(run_id)` yields buffered events first (so late joiners see the full history) and then live events;
      the generator returns after the `run.finished` event. With `heartbeat=<seconds>` it yields `None` whenever no
      event arrived within that window so the caller can send an SSE comment ping.
    * `mark_finished(run_id)` wakes subscribers of a run that ended without a `run.finished` event.
    """

    def __init__(self, max_buffer: int = 20_000) -> None:
        self._buffers: dict[str, list[Event]] = {}
        self._subscribers: dict[str, set[asyncio.Queue[Event | None]]] = {}
        self._finished: set[str] = set()
        self._max_buffer = max_buffer

    # ── publishing ───────────────────────────────────────────────────────
    def publish(self, event: Event) -> None:
        buf = self._buffers.setdefault(event.run_id, [])
        buf.append(event)
        if len(buf) > self._max_buffer:
            del buf[: len(buf) - self._max_buffer]
        for q in list(self._subscribers.get(event.run_id, ())):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:  # pragma: no cover - unbounded queues
                log.warning("dropping event for slow subscriber of run %s", event.run_id)
        if event.type == FINISHED:
            self.mark_finished(event.run_id)

    def mark_finished(self, run_id: str) -> None:
        self._finished.add(run_id)
        for q in list(self._subscribers.get(run_id, ())):
            q.put_nowait(None)

    def is_finished(self, run_id: str) -> bool:
        return run_id in self._finished

    def history(self, run_id: str) -> list[Event]:
        return list(self._buffers.get(run_id, ()))

    def has_run(self, run_id: str) -> bool:
        return run_id in self._buffers or run_id in self._finished

    def clear(self, run_id: str) -> None:
        self._buffers.pop(run_id, None)
        self._finished.discard(run_id)
        for q in list(self._subscribers.pop(run_id, set())):
            q.put_nowait(None)

    # ── subscribing ──────────────────────────────────────────────────────
    async def subscribe(self, run_id: str, *, heartbeat: float | None = None) -> AsyncIterator[Event | None]:
        q: asyncio.Queue[Event | None] = asyncio.Queue()
        self._subscribers.setdefault(run_id, set()).add(q)
        try:
            # Register first, then snapshot: nothing published between the two can be lost (it lands in q as well,
            # so we de-duplicate by identity below).
            replay = list(self._buffers.get(run_id, ()))
            seen: set[int] = set()
            for ev in replay:
                seen.add(id(ev))
                yield ev
                if ev.type == FINISHED:
                    return
            if run_id in self._finished:
                return
            while True:
                try:
                    if heartbeat:
                        item = await asyncio.wait_for(q.get(), timeout=heartbeat)
                    else:
                        item = await q.get()
                except TimeoutError:
                    yield None
                    continue
                if item is None:
                    return
                if id(item) in seen:
                    continue
                yield item
                if item.type == FINISHED:
                    return
        finally:
            subs = self._subscribers.get(run_id)
            if subs is not None:
                subs.discard(q)
                if not subs:
                    self._subscribers.pop(run_id, None)
