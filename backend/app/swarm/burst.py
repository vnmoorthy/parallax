"""Burst mode: fire N concurrent cheap read queries across the root + branch databases (docs/SPEC.md §4 /burst)."""
from __future__ import annotations

import asyncio
import inspect
import logging
import time
from typing import Any

from app.swarm.events import EventBus
from app.swarm.models import Event, Run, now_iso

log = logging.getLogger("parallax.burst")

DEFAULT_CONCURRENCY = 50
_ID_LIKE = ("id", "uuid", "key", "name", "email", "date", "time", "text", "description", "review", "feedback",
            "comment", "notes", "subject", "title", "url")
_STRING_HINTS = ("VARCHAR", "TEXT", "STRING", "CHAR", "OBJECT")


def _quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _pick_columns(run: Run) -> tuple[str | None, str | None]:
    """(distinct_col, group_col): the first column, and the first string-ish non-id, non-text column."""
    cols = run.schema_columns
    if not cols:
        return None, None
    distinct_col = cols[0]["name"]
    group_col: str | None = None
    for c in cols:
        name, typ = c["name"], str(c.get("type", "")).upper()
        if name == run.text_column:
            continue
        lname = name.lower()
        if any(h in typ for h in _STRING_HINTS) and not any(t in lname for t in _ID_LIKE):
            group_col = name
            break
    if group_col is None:
        for c in cols:
            if c["name"] != run.text_column and not any(t in c["name"].lower() for t in _ID_LIKE):
                group_col = c["name"]
                break
    return distinct_col, group_col


def _percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    k = max(0, min(len(ordered) - 1, int(round((p / 100.0) * (len(ordered) - 1)))))
    return round(ordered[k], 2)


async def run_burst(engine: Any, run: Run, n: int, bus: EventBus, *, concurrency: int = DEFAULT_CONCURRENCY,
                    store: Any = None) -> dict[str, Any]:
    """Run `n` cheap read queries round-robin over root + branch DBs with at most `concurrency` in flight.

    Returns {count, p50_ms, p95_ms, max_ms, total_ms, per_query, concurrency, ...}, stores it on
    `run.metrics.burst` and emits a `metrics.burst` event carrying the same payload.
    """
    n = max(1, int(n))
    db_ids: list[str] = []
    if run.root_db and run.root_db.get("id"):
        db_ids.append(str(run.root_db["id"]))
    db_ids += [str(b.db["id"]) for b in run.branches if b.db and b.db.get("id")]
    if not db_ids:
        raise LookupError("run has no databases to query yet")

    distinct_col, group_col = _pick_columns(run)
    templates: list[str] = ["SELECT COUNT(*) AS n FROM {ref}"]
    if distinct_col:
        templates.append(f"SELECT COUNT(DISTINCT {_quote(distinct_col)}) AS n FROM {{ref}}")
    if group_col:
        templates.append(
            f"SELECT {_quote(group_col)} AS k, COUNT(*) AS n FROM {{ref}} GROUP BY 1 ORDER BY n DESC LIMIT 5")

    sem = asyncio.Semaphore(max(1, concurrency))
    in_flight = 0
    peak = 0
    errors = 0

    async def one(i: int) -> dict[str, Any]:
        nonlocal in_flight, peak, errors
        db_id = db_ids[i % len(db_ids)]
        sql = templates[i % len(templates)].format(ref=engine.table_ref(db_id, "data"))
        async with sem:
            in_flight += 1
            peak = max(peak, in_flight)
            t0 = time.perf_counter()
            ok = True
            err: str | None = None
            try:
                res = engine.query(db_id, sql, limit=5)
                if inspect.isawaitable(res):
                    await res
            except asyncio.CancelledError:
                raise
            except Exception as e:  # counted, never fatal — burst is a stress test
                ok = False
                err = str(e)[:200]
                errors += 1
            finally:
                in_flight -= 1
            ms = round((time.perf_counter() - t0) * 1000.0, 2)
        entry: dict[str, Any] = {"i": i, "db_id": db_id, "ms": ms, "ok": ok}
        if err:
            entry["error"] = err
        return entry

    started = time.perf_counter()
    results = await asyncio.gather(*(one(i) for i in range(n)))
    total_ms = round((time.perf_counter() - started) * 1000.0, 2)
    per_query = [r["ms"] for r in results]
    payload: dict[str, Any] = {
        "count": n,
        "p50_ms": _percentile(per_query, 50),
        "p95_ms": _percentile(per_query, 95),
        "max_ms": round(max(per_query), 2) if per_query else 0.0,
        "total_ms": total_ms,
        "per_query": per_query,
        "concurrency": concurrency,
        "peak_concurrency": peak,
        "databases": len(db_ids),
        "errors": errors,
        "qps": round(n / (total_ms / 1000.0), 1) if total_ms > 0 else None,
        "at": now_iso(),
        "details": [r for r in results if not r["ok"]][:10],
    }
    m = run.metrics
    m.burst = payload
    m.queries += n
    m.peak_concurrency = max(m.peak_concurrency, peak)
    bus.publish(Event(type="metrics.burst", run_id=run.id, payload=payload))
    bus.publish(Event(type="metrics.update", run_id=run.id, payload={"metrics": m.model_dump(mode="json")}))
    if store is not None:
        try:
            store.save(run)
        except Exception:
            log.exception("could not persist burst result for run %s", run.id)
    return payload
