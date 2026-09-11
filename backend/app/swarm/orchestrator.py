"""The Parallax run engine (docs/SPEC.md §5).

provisioning → planning → exploring (one forked database per hypothesis, agents run concurrently) → synthesizing →
remember → done. Every state change is published on the EventBus and the run is persisted after every event.
"""
from __future__ import annotations

import asyncio
import csv
import inspect
import io
import logging
import re
import time
from collections.abc import Awaitable
from dataclasses import dataclass, field
from typing import Any

from app.data.base import DB, DataEngineError, QueryError, QueryResult
from app.llm.base import extract_json
from app.swarm.events import EventBus
from app.swarm.models import (
    APPROACHES,
    AgentStep,
    Branch,
    ChartSpec,
    Event,
    Finding,
    Hypothesis,
    Report,
    Run,
    jsonable,
    now_iso,
    result_to_dict,
)
from app.swarm.prompts import JSON_ONLY_NUDGE, agent_prompts, format_observation, planner_prompts, synth_prompts
from app.swarm.store import RunStore

log = logging.getLogger("parallax.orchestrator")

MAX_TOOL_STEPS = 4
AGENT_ROW_LIMIT = 50
OBSERVATION_ROWS = 15
SEARCH_K = 10
NUMERIC_TYPE_HINTS = ("INT", "DOUBLE", "FLOAT", "DECIMAL", "NUMERIC", "REAL", "NUMBER", "BIGINT", "HUGEINT")

_CITATION_RE = re.compile(r"\[branch:([A-Za-z0-9_\-]+)\]")
_LIMIT_RE = re.compile(r"\bLIMIT\s+(\d+)", re.IGNORECASE)
_STRING_LITERAL_RE = re.compile(r"'(?:[^']|'')*'")
_LINE_COMMENT_RE = re.compile(r"--[^\n]*")
_BLOCK_COMMENT_RE = re.compile(r"/\*.*?\*/", re.DOTALL)
_FORBIDDEN_RE = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|ATTACH|DETACH|COPY|PRAGMA|INSTALL|LOAD|EXPORT|IMPORT|"
    r"GRANT|REVOKE|MERGE|VACUUM|CALL|EXEC|EXECUTE|REPLACE|UPSERT)\b",
    re.IGNORECASE,
)


# ── pure helpers (unit-tested) ───────────────────────────────────────────
def guard_sql(sql: str, *, max_limit: int | None = AGENT_ROW_LIMIT) -> tuple[str | None, str | None]:
    """Return (safe_sql, None) or (None, error). Read-only SELECT/WITH only, single statement, LIMIT enforced."""
    if not isinstance(sql, str) or not sql.strip():
        return None, "empty SQL"
    s = _BLOCK_COMMENT_RE.sub(" ", sql)
    s = _LINE_COMMENT_RE.sub(" ", s).strip()
    while s.endswith(";"):
        s = s[:-1].rstrip()
    if not s:
        return None, "empty SQL"
    stripped = _STRING_LITERAL_RE.sub(lambda m: "'" + "x" * (len(m.group(0)) - 2) + "'", s)  # same length
    if ";" in stripped:
        return None, "only a single statement is allowed"
    first = stripped.lstrip("( \n\t").split(None, 1)[0].upper() if stripped.strip() else ""
    if first not in ("SELECT", "WITH"):
        return None, "only read-only SELECT / WITH queries are allowed"
    bad = _FORBIDDEN_RE.search(stripped)
    if bad:
        return None, f"forbidden keyword {bad.group(1).upper()} — queries must be read-only"
    if max_limit is not None:
        m = _LIMIT_RE.search(stripped)
        if m is None:
            s = f"{s} LIMIT {max_limit}"
        elif int(m.group(1)) > max_limit:
            # replace the (last) LIMIT n with the cap; position from the literal-stripped string is identical
            matches = list(_LIMIT_RE.finditer(stripped))
            last = matches[-1]
            s = s[: last.start()] + f"LIMIT {max_limit}" + s[last.end():]
    return s, None


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    k = max(0, min(len(ordered) - 1, int(round((p / 100.0) * (len(ordered) - 1)))))
    return round(float(ordered[k]), 2)


def slugify(text: str, max_len: int = 24) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return (s[:max_len].rstrip("-")) or "hyp"

_SQLISH = re.compile(r"\b(select|from|where|like|ilike|and|or|not|in|is|null|order|by|limit|group)\b", re.I)


def clean_search_query(q: str, text_column: str | None = None) -> str:
    """Turn an LLM 'query' into plain keywords: strips SQL noise (LIKE/%/quotes/column names) if present."""
    q = (q or "").strip()
    if not q:
        return q
    looks_sql = bool(_SQLISH.search(q)) or "%" in q or q.count("'") >= 2
    if not looks_sql:
        return q[:200]
    tokens = re.findall(r"[A-Za-z][A-Za-z0-9_\-]{1,}", q)
    stop = {"select", "from", "where", "like", "ilike", "and", "or", "not", "in", "is", "null", "order", "by", "limit",
            "group", "the", "a", "an", "of", "to", "with", "text", "column"}
    if text_column:
        stop.add(text_column.lower())
    words = [t for t in tokens if t.lower() not in stop]
    seen: set[str] = set()
    out: list[str] = []
    for w in words:
        lw = w.lower()
        if lw not in seen:
            seen.add(lw)
            out.append(w)
    return " ".join(out[:8]) or q[:200]


def sample_csv(csv_text: str, cap: int) -> tuple[str, int | None]:
    """Return (csv, rows_kept). Keeps the header and a stride sample of at most `cap` rows (all rows if fewer)."""
    import csv
    import io

    rows = list(csv.reader(io.StringIO(csv_text)))
    if not rows:
        return csv_text, None
    header, body = rows[0], rows[1:]
    if len(body) <= cap:
        return csv_text, None
    stride = max(1, len(body) // cap)
    kept = body[::stride][:cap]
    out = io.StringIO()
    w = csv.writer(out, lineterminator="\n")
    w.writerow(header)
    w.writerows(kept)
    return out.getvalue(), len(kept)



def _is_num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def derive_chart(result: QueryResult | dict[str, Any], title: str) -> ChartSpec | None:
    """Build a ChartSpec from a query result: ≤12 rows, first string column as x, first numeric as y (bar);
    a single numeric cell becomes a `number` chart."""
    d = result_to_dict(result)
    cols, rows = d["columns"], [r for r in d["rows"] if r]
    if not cols or not rows:
        return None
    if len(cols) == 1 and len(rows) == 1 and _is_num(rows[0][0]):
        return ChartSpec(type="number", title=title, x=None, y=cols[0], data=[{cols[0]: rows[0][0]}])
    sample = rows[:12]
    num_idx: int | None = None
    str_idx: int | None = None
    for i, _c in enumerate(cols):
        vals = [r[i] for r in sample if i < len(r) and r[i] is not None]
        if not vals:
            continue
        if num_idx is None and all(_is_num(v) for v in vals):
            num_idx = i
            continue
        if str_idx is None and all(isinstance(v, str) for v in vals):
            str_idx = i
    if num_idx is None:
        return None
    if str_idx is None:
        others = [i for i in range(len(cols)) if i != num_idx]
        str_idx = others[0] if others else None
    x_name = cols[str_idx] if str_idx is not None else "row"
    y_name = cols[num_idx]
    if x_name == y_name:
        x_name = f"{x_name}_label"
    data = []
    for k, r in enumerate(sample, start=1):
        x_val = str(r[str_idx]) if str_idx is not None and str_idx < len(r) and r[str_idx] is not None else str(k)
        data.append({x_name: x_val, y_name: r[num_idx] if num_idx < len(r) else None})
    return ChartSpec(type="bar", title=title, x=x_name, y=y_name, data=data)


async def maybe_await(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


# ── per-run context ──────────────────────────────────────────────────────
@dataclass
class _Ctx:
    run: Run
    root: DB | None = None
    text_column: str | None = None
    schema: list[tuple[str, str]] = field(default_factory=list)
    latencies: list[float] = field(default_factory=list)
    in_flight: int = 0
    t0: float = field(default_factory=time.perf_counter)
    provider_tally: dict[str, int] = field(default_factory=dict)
    provider_snapshot: dict[str, int] | None = None
    vector_task: asyncio.Task[Any] | None = None  # root vector index being built in the background (local engine)
    vector_rows: int | None = None


class Orchestrator:
    """Runs swarm investigations. One instance serves the whole app; per-run state lives in `_Ctx`."""

    def __init__(self, engine: Any, llm: Any, memory: Any, store: RunStore, bus: EventBus, settings: Any = None, *,
                 max_steps: int = MAX_TOOL_STEPS, memory_wait_s: float = 1.5) -> None:
        self.engine = engine
        self.llm = llm
        self.memory = memory
        self.store = store
        self.bus = bus
        self.settings = settings
        self.max_steps = max_steps
        self.memory_wait_s = memory_wait_s
        self.background_tasks: set[asyncio.Task[Any]] = set()
        self._contexts: dict[str, _Ctx] = {}
        self._indexed: set[tuple[str, str]] = set()
        self._index_locks: dict[tuple[str, str], asyncio.Lock] = {}

    # ── plumbing ─────────────────────────────────────────────────────────
    def _emit(self, ctx: _Ctx, type_: str, payload: dict[str, Any] | None = None, *,
              branch_id: str | None = None) -> None:
        ev = Event(type=type_, run_id=ctx.run.id, branch_id=branch_id, payload=payload or {})
        try:
            self.bus.publish(ev)
        except Exception:  # never let a subscriber problem kill a run
            log.exception("event publish failed (%s)", type_)
        self.store.save(ctx.run)

    def _emit_metrics(self, ctx: _Ctx) -> None:
        self._emit(ctx, "metrics.update", {"metrics": ctx.run.metrics.model_dump(mode="json")})

    def _set_status(self, ctx: _Ctx, status: str, *, error: str | None = None) -> None:
        ctx.run.status = status  # type: ignore[assignment]
        payload: dict[str, Any] = {"status": status}
        if error:
            payload["error"] = error
        self._emit(ctx, "run.status", payload)

    def _ctx_for(self, run: Run) -> _Ctx:
        ctx = self._contexts.get(run.id)
        if ctx is None:
            ctx = _Ctx(run=run, text_column=run.text_column,
                       schema=[(c["name"], c.get("type", "")) for c in run.schema_columns if "name" in c])
            if run.root_db:
                ctx.root = DB(**{k: run.root_db.get(k) for k in DB.__dataclass_fields__})  # type: ignore[arg-type]
            self._contexts[run.id] = ctx
        return ctx

    def _provider(self) -> str:
        return str(getattr(self.llm, "last_provider", None) or getattr(self.llm, "name", None) or "llm")

    async def _complete(self, ctx: _Ctx, system: str, user: str, *, max_tokens: int) -> str:
        raw = await maybe_await(self.llm.complete(system, user, json_mode=True, max_tokens=max_tokens))
        provider = self._provider()
        ctx.run.metrics.llm_calls += 1
        ctx.provider_tally[provider] = ctx.provider_tally.get(provider, 0) + 1
        ctx.run.metrics.llm_calls_by_provider = dict(ctx.provider_tally)
        self._emit_metrics(ctx)
        if isinstance(raw, (dict, list)):
            import json

            return json.dumps(raw)
        return "" if raw is None else str(raw)

    async def _llm_json(self, ctx: _Ctx, system: str, user: str, *, max_tokens: int) -> Any:
        """One LLM call + tolerant JSON parse; on junk (or an LLM error) retry once with a JSON-only nudge."""
        last_error: Exception | None = None
        for attempt in range(2):
            prompt = user if attempt == 0 else f"{user}\n\n{JSON_ONLY_NUDGE}"
            try:
                raw = await self._complete(ctx, system, prompt, max_tokens=max_tokens)
                return extract_json(raw)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # LLMError, ValueError from extract_json, transport errors
                last_error = e
                log.warning("LLM call/parse failed (attempt %d): %s", attempt + 1, e)
        log.error("LLM returned no usable JSON after retry: %s", last_error)
        return None

    async def _timed_query(self, ctx: _Ctx, awaitable: Awaitable[QueryResult]) -> QueryResult:
        m = ctx.run.metrics
        ctx.in_flight += 1
        m.peak_concurrency = max(m.peak_concurrency, ctx.in_flight)
        t0 = time.perf_counter()
        result: QueryResult | None = None
        try:
            result = await awaitable
            return result
        finally:
            ctx.in_flight -= 1
            wall = (time.perf_counter() - t0) * 1000.0
            elapsed = float(getattr(result, "elapsed_ms", 0.0) or 0.0) if result is not None else 0.0
            if elapsed <= 0:
                elapsed = wall
            ctx.latencies.append(elapsed)
            m.queries += 1
            m.p50_ms = percentile(ctx.latencies, 50)
            m.p95_ms = percentile(ctx.latencies, 95)
            self._emit_metrics(ctx)

    async def _ensure_index(self, ctx: _Ctx, db_id: str, kind: str) -> None:
        """bm25 → index on data.<text>; vector → index on data_vec.<text>. Indexes are cached per (db, kind);
        a local fork made after the root index exists is marked as inheriting it at fork time (see _explore_branch),
        Hotdata forks drop indexes so they are created lazily per branch."""
        if not ctx.text_column:
            raise DataEngineError("this run has no text column; search is unavailable")
        key = (db_id, kind)
        if key in self._indexed:
            return
        lock = self._index_locks.setdefault(key, asyncio.Lock())
        async with lock:
            if key in self._indexed:
                return
            table = "data" if kind == "bm25" else "data_vec"
            await maybe_await(self.engine.create_index(db_id, table, ctx.text_column, kind))
            self._indexed.add(key)

    # ── the run ──────────────────────────────────────────────────────────
    async def run(self, run: Run, dataset: Any) -> Run:
        ctx = _Ctx(run=run, text_column=run.text_column)
        self._contexts[run.id] = ctx
        calls_by_provider = getattr(self.llm, "calls_by_provider", None)
        if isinstance(calls_by_provider, dict):
            ctx.provider_snapshot = {str(k): int(v) for k, v in calls_by_provider.items()}
        run.metrics.started_at = now_iso()
        self.store.put(run)
        failed_message: str | None = None
        try:
            await self._provision(ctx, dataset)
            await self._plan(ctx, dataset)
            await self._explore(ctx)
            await self._synthesize(ctx)
            await self._remember(ctx)
        except asyncio.CancelledError:
            failed_message = "run cancelled"
            raise
        except Exception as e:
            failed_message = f"{type(e).__name__}: {e}"
            log.exception("run %s failed", run.id)
        finally:
            self._finish(ctx, failed_message)
        return run

    def _finish(self, ctx: _Ctx, failed_message: str | None) -> None:
        run = ctx.run
        m = run.metrics
        m.finished_at = now_iso()
        m.elapsed_ms = round((time.perf_counter() - ctx.t0) * 1000.0, 1)
        calls_by_provider = getattr(self.llm, "calls_by_provider", None)
        if isinstance(calls_by_provider, dict) and ctx.provider_snapshot is not None:
            diff = {str(k): int(v) - ctx.provider_snapshot.get(str(k), 0) for k, v in calls_by_provider.items()}
            diff = {k: v for k, v in diff.items() if v > 0}
            if diff and sum(diff.values()) >= sum(ctx.provider_tally.values()):
                m.llm_calls_by_provider = diff
        for b in run.branches:
            if b.status in ("forking", "exploring"):
                b.status = "failed"
        if failed_message:
            run.error = failed_message
            self._set_status(ctx, "failed", error=failed_message)
            self._emit(ctx, "run.error", {"message": failed_message})
        else:
            self._set_status(ctx, "done")
        self._emit_metrics(ctx)
        self._emit(ctx, "run.finished", {})
        self.store.flush(run)
        self.bus.mark_finished(run.id)

    # ── 1. provisioning ──────────────────────────────────────────────────
    async def _provision(self, ctx: _Ctx, dataset: Any) -> None:
        run = ctx.run
        self._set_status(ctx, "provisioning")
        root = await maybe_await(self.engine.create_database(f"parallax-{run.id[:8]}"))
        ctx.root = root
        run.root_db = jsonable(root.to_dict())
        run.metrics.databases_created += 1
        self._emit_metrics(ctx)

        csv_text = await maybe_await(dataset.csv_text()) if callable(getattr(dataset, "csv_text", None)) else None
        if not csv_text:
            raise DataEngineError(f"dataset {getattr(dataset, 'id', '?')} has no CSV content")
        await maybe_await(self.engine.load_csv(root.id, "data", csv_text, mode="replace"))

        # schema via tables(); fall back to the dataset's own column list
        schema: list[tuple[str, str]] = []
        try:
            infos = await maybe_await(self.engine.tables(root.id))
            for t in infos or []:
                if str(getattr(t, "name", "")).lower() == "data":
                    schema = [(str(c), str(ty)) for c, ty in getattr(t, "columns", [])]
                    break
        except Exception as e:
            log.warning("tables() failed on root %s: %s", root.id, e)
        if not schema:
            for c in getattr(dataset, "columns", []) or []:
                if isinstance(c, dict) and "name" in c:
                    schema.append((str(c["name"]), str(c.get("type", ""))))
        ctx.schema = schema
        run.schema_columns = [{"name": n, "type": t} for n, t in schema]

        # text column: explicit request wins, then the dataset's first text column; must exist in the schema
        names = [n for n, _ in schema]
        lower = {n.lower(): n for n in names}
        candidates = [run.text_column] if run.text_column else []
        candidates += list(getattr(dataset, "text_columns", []) or [])
        text_column: str | None = None
        for c in candidates:
            if not c:
                continue
            if c in names:
                text_column = c
                break
            if c.lower() in lower:
                text_column = lower[c.lower()]
                break
        if candidates and text_column is None:
            log.warning("requested text column %s not found in schema %s", candidates, names)
        ctx.text_column = text_column
        run.text_column = text_column

        if text_column:
            vec_csv = csv_text
            ctx.vector_rows = None
            if getattr(self.engine, "kind", "local") == "local":
                cap = int(getattr(self.settings, "parallax_local_vector_rows", 0) or 0)
                if cap > 0:
                    vec_csv, ctx.vector_rows = await asyncio.to_thread(sample_csv, csv_text, cap)
            await maybe_await(self.engine.load_csv(root.id, "data_vec", vec_csv, mode="replace"))
            if getattr(self.engine, "kind", "local") == "local":
                # Local forks are file copies, so indexes built on the root are inherited. BM25 (FTS) is quick and
                # built now; the vector index embeds every row (slow without a GPU), so it runs in the background:
                # planning proceeds meanwhile, SQL/BM25 branches fork immediately, vector/mixed branches wait for it.
                try:
                    await self._ensure_index(ctx, root.id, "bm25")
                except Exception as e:  # search degrades gracefully; agents still have SQL
                    log.warning("bm25 index on root failed (will retry lazily per branch): %s", e)
                ctx.vector_task = asyncio.create_task(self._ensure_index(ctx, root.id, "vector"),
                                                      name=f"vector-index-{run.id}")
                self.background_tasks.add(ctx.vector_task)
                ctx.vector_task.add_done_callback(self.background_tasks.discard)
        self._emit(ctx, "db.created", {"db": run.root_db})

    async def _await_root_vector_index(self, ctx: _Ctx) -> bool:
        """Wait for the background root vector index; False if it failed (the branch then builds lazily)."""
        task = ctx.vector_task
        if task is None:
            return ctx.root is not None and (ctx.root.id, "vector") in self._indexed
        try:
            await asyncio.shield(task)
            return True
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.warning("root vector index failed (%s); vector search will build per branch", e)
            return False

    async def _profile(self, ctx: _Ctx, dataset: Any) -> tuple[dict[str, dict[str, Any]], list[str], list[list[Any]]]:
        """Single wide aggregate over the root table + 5 sample rows. Never fatal."""
        assert ctx.root is not None
        ref = self.engine.table_ref(ctx.root.id, "data")
        sample_cols: list[str] = []
        sample_rows: list[list[Any]] = []
        try:
            res = await self._timed_query(ctx, maybe_await(self.engine.query(ctx.root.id, f"SELECT * FROM {ref} LIMIT 5", limit=5)))
            d = result_to_dict(res)
            sample_cols, sample_rows = d["columns"], d["rows"]
        except Exception as e:
            log.warning("sample query failed: %s", e)

        profile: dict[str, dict[str, Any]] = {}
        cols = ctx.schema[:40]
        if cols:
            parts = ['COUNT(*) AS "__n"']
            for name, typ in cols:
                q = '"' + name.replace('"', '""') + '"'
                parts.append(f'COUNT(DISTINCT {q}) AS "{name}__distinct"')
                parts.append(f'COUNT({q}) AS "{name}__nonnull"')
                if any(h in typ.upper() for h in NUMERIC_TYPE_HINTS):
                    parts.append(f'MIN({q}) AS "{name}__min"')
                    parts.append(f'MAX({q}) AS "{name}__max"')
            sql = "SELECT " + ", ".join(parts) + f" FROM {ref}"
            try:
                res = await self._timed_query(ctx, maybe_await(self.engine.query(ctx.root.id, sql, limit=1)))
                d = result_to_dict(res)
                if d["rows"]:
                    row = dict(zip(d["columns"], d["rows"][0]))
                    total = int(row.get("__n") or 0)
                    for name, typ in cols:
                        nonnull = row.get(f"{name}__nonnull")
                        profile[name] = {
                            "type": typ,
                            "distinct": row.get(f"{name}__distinct"),
                            "nulls": (total - int(nonnull)) if nonnull is not None else None,
                            "min": row.get(f"{name}__min"),
                            "max": row.get(f"{name}__max"),
                        }
            except Exception as e:
                log.warning("profile query failed: %s", e)
        # top values from the dataset's pandas profile when available (cheap, in-process)
        prof_fn = getattr(dataset, "profile", None)
        if callable(prof_fn):
            try:
                pandas_profile = await maybe_await(prof_fn())
                for name, p in (pandas_profile or {}).items():
                    if not isinstance(p, dict):
                        continue
                    entry = profile.setdefault(name, {"type": p.get("type")})
                    if p.get("top"):
                        entry["top"] = p["top"][:5]
                    for k in ("distinct", "nulls", "min", "max"):
                        if entry.get(k) is None and p.get(k) is not None:
                            entry[k] = p[k]
            except Exception as e:
                log.debug("dataset.profile() failed: %s", e)
        return profile, sample_cols, sample_rows

    # ── 2. planning ──────────────────────────────────────────────────────
    async def _plan(self, ctx: _Ctx, dataset: Any) -> None:
        run = ctx.run
        self._set_status(ctx, "planning")
        hits: list[dict[str, Any]] = []
        try:
            raw_hits = await maybe_await(self.memory.recall(run.question, tags=[run.dataset_id]))
            for h in raw_hits or []:
                hits.append(jsonable(h.to_dict() if hasattr(h, "to_dict") else h))
        except Exception as e:
            log.warning("memory.recall failed: %s", e)
        run.recalled = hits
        self._emit(ctx, "run.recalled", {"hits": hits})

        profile, sample_cols, sample_rows = await self._profile(ctx, dataset)
        system, user = planner_prompts(
            dataset_name=run.dataset_name, schema=ctx.schema, profile=profile, sample_columns=sample_cols,
            sample_rows=sample_rows, question=run.question, recalled=hits, n=run.agents, text_column=ctx.text_column,
        )
        data = await self._llm_json(ctx, system, user, max_tokens=2500)
        hypotheses = self._normalize_hypotheses(data, run.agents, ctx.schema, ctx.text_column)
        run.plan = hypotheses
        run.branches = [Branch(id=f"b_{i + 1}", hypothesis_id=h.id, status="forking") for i, h in enumerate(hypotheses)]
        self._emit(ctx, "run.plan", {
            "hypotheses": [h.model_dump(mode="json") for h in hypotheses],
            "branches": [b.model_dump(mode="json") for b in run.branches],
        })

    @staticmethod
    def _normalize_hypotheses(data: Any, n: int, schema: list[tuple[str, str]],
                              text_column: str | None) -> list[Hypothesis]:
        items: list[Any] = []
        if isinstance(data, dict):
            raw = data.get("hypotheses")
            items = raw if isinstance(raw, list) else []
        elif isinstance(data, list):
            items = data
        colset = {name for name, _ in schema}
        out: list[Hypothesis] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or "").strip()
            if not title:
                continue
            approach = str(item.get("approach") or "sql").strip().lower()
            if approach not in APPROACHES:
                approach = "sql"
            if approach != "sql" and not text_column:
                approach = "sql"
            targets = [str(c) for c in (item.get("target_columns") or []) if isinstance(c, str) and c in colset][:6]
            if approach in ("bm25", "vector") and text_column and text_column not in targets:
                targets.insert(0, text_column)
            out.append(Hypothesis(id=f"h_{len(out) + 1}", title=title[:200],
                                  rationale=str(item.get("rationale") or "").strip()[:1000],
                                  approach=approach, target_columns=targets))  # type: ignore[arg-type]
            if len(out) >= n:
                break
        # pad to exactly n with schema-driven SQL hypotheses
        pad_cols = [name for name, _ in schema if name != text_column] or [name for name, _ in schema] or ["*"]
        k = 0
        while len(out) < n:
            col = pad_cols[k % len(pad_cols)]
            k += 1
            out.append(Hypothesis(
                id=f"h_{len(out) + 1}", title=f"How does {col} relate to the question?",
                rationale="Auto-generated to reach the requested number of independent hypotheses.",
                approach="sql", target_columns=[col] if col != "*" else [],
            ))
        # ≥1 bm25 and ≥1 vector when a text column exists
        if text_column and n >= 2:
            approaches = [h.approach for h in out]
            if "bm25" not in approaches:
                idx = next((i for i in range(n - 1, -1, -1) if out[i].approach == "sql"), n - 1)
                out[idx].approach = "bm25"
                if text_column not in out[idx].target_columns:
                    out[idx].target_columns.insert(0, text_column)
            approaches = [h.approach for h in out]
            if "vector" not in approaches:
                idx = next((i for i in range(n - 1, -1, -1) if out[i].approach == "sql"), None)
                if idx is None:
                    idx = next((i for i in range(n - 1, -1, -1) if out[i].approach == "mixed"), None)
                if idx is None:
                    idx = next((i for i in range(n - 1, -1, -1) if out[i].approach == "bm25"), n - 1)
                    # keep at least one bm25 if we're stealing the only one
                    if approaches.count("bm25") <= 1 and n >= 2:
                        idx = 0 if idx != 0 else 1
                out[idx].approach = "vector"
                if text_column not in out[idx].target_columns:
                    out[idx].target_columns.insert(0, text_column)
        for i, h in enumerate(out):
            h.id = f"h_{i + 1}"
        return out

    # ── 3. exploring ─────────────────────────────────────────────────────
    async def _explore(self, ctx: _Ctx) -> None:
        run = ctx.run
        self._set_status(ctx, "exploring")
        sem = asyncio.Semaphore(max(1, run.agents))
        tasks = []
        for i, branch in enumerate(run.branches):
            hyp = run.hypothesis(branch.hypothesis_id)
            if hyp is None:
                continue
            tasks.append(self._explore_branch(ctx, i + 1, branch, hyp, sem))
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for r in results:
            if isinstance(r, asyncio.CancelledError):
                raise r
            if isinstance(r, BaseException) and not isinstance(r, Exception):
                raise r
        if ctx.vector_task is not None and not ctx.vector_task.done():
            log.info("root vector index for run %s still building in the background", run.id)

    async def _explore_branch(self, ctx: _Ctx, idx: int, branch: Branch, hyp: Hypothesis,
                              sem: asyncio.Semaphore) -> None:
        run = ctx.run
        assert ctx.root is not None
        async with sem:
            try:
                if hyp.approach in ("vector", "mixed") and ctx.text_column:
                    if ctx.vector_task is not None and not ctx.vector_task.done():
                        scope = (f"embedding a {ctx.vector_rows:,}-row semantic sample" if ctx.vector_rows
                                 else "embedding every row")
                        self._add_step(ctx, branch, "think",
                                       f"Waiting for the root vector index on {ctx.text_column} ({scope}) "
                                       "before forking, so this branch inherits it.")
                    await self._await_root_vector_index(ctx)
                db = await maybe_await(self.engine.fork(ctx.root.id, f"hyp-{idx}-{slugify(hyp.title)}"))
                for kind in ("bm25", "vector"):  # a copy of an indexed root carries the index along
                    if (ctx.root.id, kind) in self._indexed:
                        self._indexed.add((db.id, kind))
                branch.db = jsonable(db.to_dict())
                branch.status = "exploring"
                run.metrics.forks += 1
                self._emit(ctx, "db.forked", {"db": branch.db, "parent_id": ctx.root.id, "branch_id": branch.id,
                                              "hypothesis_id": hyp.id}, branch_id=branch.id)
                self._emit(ctx, "branch.status", {"status": "exploring"}, branch_id=branch.id)
                self._emit_metrics(ctx)

                finding = await self._agent_loop(ctx, branch, hyp, db)
                branch.finding = finding
                self._add_step(ctx, branch, "finding", finding.claim, provider=self._provider())
                await self._persist_finding(ctx, branch, hyp, db, finding)
                branch.status = "done"
                if run.metrics.time_to_first_finding_ms is None:
                    run.metrics.time_to_first_finding_ms = round((time.perf_counter() - ctx.t0) * 1000.0, 1)
                self._emit(ctx, "agent.finding", {"finding": finding.model_dump(mode="json")}, branch_id=branch.id)
                self._emit(ctx, "branch.status", {"status": "done"}, branch_id=branch.id)
            except asyncio.CancelledError:
                branch.status = "failed"
                raise
            except Exception as e:
                log.exception("branch %s failed", branch.id)
                branch.status = "failed"
                self._add_step(ctx, branch, "observe", f"error: {type(e).__name__}: {e}")
                self._emit(ctx, "branch.status", {"status": "failed", "error": str(e)}, branch_id=branch.id)
            finally:
                self._emit_metrics(ctx)

    def _add_step(self, ctx: _Ctx, branch: Branch, kind: str, text: str, *, sql: str | None = None,
                  result: QueryResult | None = None, elapsed_ms: float | None = None,
                  provider: str | None = None) -> AgentStep:
        step = AgentStep(
            n=len(branch.steps) + 1, kind=kind, text=text, sql=sql,  # type: ignore[arg-type]
            result=result_to_dict(result.head(OBSERVATION_ROWS)) if result is not None else None,
            elapsed_ms=round(elapsed_ms, 2) if elapsed_ms is not None else None, provider=provider,
        )
        branch.steps.append(step)
        self._emit(ctx, "agent.step", {"step": step.model_dump(mode="json")}, branch_id=branch.id)
        return step

    async def _agent_loop(self, ctx: _Ctx, branch: Branch, hyp: Hypothesis, db: DB) -> Finding:
        run = ctx.run
        table_ref = self.engine.table_ref(db.id, "data")
        vec_ref = self.engine.table_ref(db.id, "data_vec") if ctx.text_column else None
        transcript: list[str] = []
        supporting_sql: list[str] = []
        seen_steps: set[tuple[str, str]] = set()
        last_result: QueryResult | None = None
        steps_used = 0
        while True:
            remaining = self.max_steps - steps_used
            system, user = agent_prompts(
                branch_id=branch.id, table_ref=table_ref, vector_table_ref=vec_ref, text_column=ctx.text_column,
                question=run.question, hypothesis=hyp, schema=ctx.schema, transcript=transcript,
                remaining=remaining, max_steps=self.max_steps,
            )
            data = await self._llm_json(ctx, system, user, max_tokens=1500)
            provider = self._provider()
            if not isinstance(data, dict):
                self._add_step(ctx, branch, "think",
                               "Model reply was not valid JSON twice; finishing with a low-confidence finding.",
                               provider=provider)
                return self._build_finding(None, last_result, supporting_sql, hyp, low=True)

            thought = str(data.get("thought") or "").strip()
            action = str(data.get("action") or "").strip().lower()
            if thought:
                self._add_step(ctx, branch, "think", thought, provider=provider)

            raw_finding = data.get("finding") if isinstance(data.get("finding"), dict) else None
            if action == "finish" or remaining <= 0 or (raw_finding is not None and action not in ("sql", "bm25", "vector")):
                return self._build_finding(raw_finding, last_result, supporting_sql, hyp)

            payload_key: tuple[str, str] | None = None
            if action == "sql":
                payload_key = ("sql", " ".join(str(data.get("sql") or "").lower().split()))
            elif action in ("bm25", "vector"):
                _q0 = str(data.get("query") or data.get("q") or data.get("text") or "")
                payload_key = (action, " ".join(clean_search_query(_q0, ctx.text_column).lower().split()))
            if payload_key is not None and payload_key[1] and payload_key in seen_steps:
                steps_used += 1
                observation = ("error: you already ran this exact step; the observation would be identical. "
                               "Take a different angle (another column, a GROUP BY, a different phrase) or finish now.")
                self._add_step(ctx, branch, "observe", observation, provider=provider)
                transcript.append(f"Step {steps_used} [{action}] (duplicate)\nObservation: {observation}")
                continue
            if payload_key is not None and payload_key[1]:
                seen_steps.add(payload_key)
            steps_used += 1
            if action == "sql":
                sql_raw = str(data.get("sql") or "").strip()
                safe, err = guard_sql(sql_raw, max_limit=AGENT_ROW_LIMIT)
                if err or safe is None:
                    observation = f"error: {err}"
                    self._add_step(ctx, branch, "observe", observation, sql=sql_raw or None, provider=provider)
                else:
                    try:
                        result = await self._timed_query(
                            ctx, maybe_await(self.engine.query(db.id, safe, limit=AGENT_ROW_LIMIT)))
                    except asyncio.CancelledError:
                        raise
                    except Exception as e:
                        observation = f"error: {e}"
                        self._add_step(ctx, branch, "observe", observation, sql=safe, provider=provider)
                    else:
                        last_result = result
                        supporting_sql.append(safe)
                        observation = format_observation(result.columns, [jsonable(list(r)) for r in result.rows],
                                                         result.row_count, OBSERVATION_ROWS, result.elapsed_ms)
                        self._add_step(ctx, branch, "sql", safe, sql=safe, result=result,
                                       elapsed_ms=result.elapsed_ms, provider=provider)
                transcript.append(f"Step {steps_used} [sql]: {sql_raw or '(empty)'}\nObservation: {observation}")
            elif action in ("bm25", "vector"):
                q = clean_search_query(str(data.get("query") or data.get("q") or data.get("text") or ""), ctx.text_column)
                if not q:
                    observation = "error: missing \"query\" for search"
                    self._add_step(ctx, branch, "observe", observation, provider=provider)
                else:
                    try:
                        result = await self._search(ctx, db.id, action, q, SEARCH_K)
                    except asyncio.CancelledError:
                        raise
                    except Exception as e:
                        observation = f"error: {e}"
                        self._add_step(ctx, branch, "observe", observation, provider=provider)
                    else:
                        last_result = result
                        table = "data" if action == "bm25" else "data_vec"
                        supporting_sql.append(
                            f"{action}_search('{table}', '{ctx.text_column}', '{q.replace(chr(39), chr(39) * 2)}', {SEARCH_K})")
                        observation = format_observation(result.columns, [jsonable(list(r)) for r in result.rows],
                                                         result.row_count, OBSERVATION_ROWS, result.elapsed_ms)
                        self._add_step(ctx, branch, action, q, result=result, elapsed_ms=result.elapsed_ms,
                                       provider=provider)
                transcript.append(f"Step {steps_used} [{action}]: {q or '(empty)'}\nObservation: {observation}")
            else:
                observation = f"error: unknown action {action!r}; use sql, bm25, vector or finish"
                self._add_step(ctx, branch, "observe", observation, provider=provider)
                transcript.append(f"Step {steps_used} [{action or 'none'}]\nObservation: {observation}")

    async def _search(self, ctx: _Ctx, db_id: str, kind: str, q: str, k: int) -> QueryResult:
        await self._ensure_index(ctx, db_id, kind)
        col = ctx.text_column
        if kind == "bm25":
            coro = maybe_await(self.engine.bm25_search(db_id, "data", col, q, k=k))
        else:
            coro = maybe_await(self.engine.vector_search(db_id, "data_vec", col, q, k=k))
        return await self._timed_query(ctx, coro)

    def _build_finding(self, raw: dict[str, Any] | None, last_result: QueryResult | None,
                       supporting_sql: list[str], hyp: Hypothesis, *, low: bool = False) -> Finding:
        raw = raw or {}
        claim = str(raw.get("claim") or "").strip()
        if not claim:
            low = True
            claim = f"Inconclusive: no clear evidence found for \"{hyp.title}\"."
        evidence = str(raw.get("evidence") or "").strip()
        if not evidence:
            if last_result is not None:
                d = result_to_dict(last_result)
                head = "; ".join(" | ".join(str(v) for v in r) for r in d["rows"][:3])
                evidence = f"Last query returned {d['row_count']} rows ({', '.join(d['columns'])}): {head}"
            else:
                evidence = "No successful query produced evidence."
        confidence = raw.get("confidence", 0.25 if low else 0.5)
        chart: ChartSpec | None = None
        c = raw.get("chart")
        if isinstance(c, dict):
            try:
                typ = str(c.get("type") or "bar").lower()
                chart = ChartSpec(type=typ if typ in ("bar", "line", "pie", "number") else "bar",  # type: ignore[arg-type]
                                  title=str(c.get("title") or hyp.title), x=c.get("x"), y=c.get("y"),
                                  data=[jsonable(d) for d in (c.get("data") or []) if isinstance(d, dict)][:12])
                if not chart.data:
                    chart = None
            except Exception:
                chart = None
        if chart is None and last_result is not None:
            chart = derive_chart(last_result, hyp.title)
        tags: list[str] = []
        for t in [hyp.approach, *hyp.target_columns[:3]]:
            if t and t not in tags:
                tags.append(t)
        finding = Finding(claim=claim[:2000], evidence=evidence[:4000], confidence=confidence,
                          supporting_sql=list(supporting_sql), chart=chart, tags=tags)
        if low:
            finding.confidence = min(finding.confidence, 0.3)
        return finding

    async def _persist_finding(self, ctx: _Ctx, branch: Branch, hyp: Hypothesis, db: DB, finding: Finding) -> None:
        """Write the finding into the branch's own database (table `findings` + NOTES context). Never fatal."""
        buf = io.StringIO()
        w = csv.writer(buf, lineterminator="\n")
        w.writerow(["id", "claim", "confidence", "evidence"])
        w.writerow([branch.id, finding.claim, f"{finding.confidence:.2f}", finding.evidence])
        try:
            await maybe_await(self.engine.load_csv(db.id, "findings", buf.getvalue(), mode="append"))
        except Exception as e:
            log.warning("could not persist finding row on %s: %s", db.id, e)
        lines = [f"# Branch {branch.id} — {hyp.title}", "", f"**Approach:** {hyp.approach}",
                 f"**Question:** {ctx.run.question}", "", "## Steps"]
        for s in branch.steps:
            detail = s.sql or s.text
            lines.append(f"{s.n}. [{s.kind}] {detail}")
        lines += ["", "## Finding", f"**Claim:** {finding.claim}", f"**Evidence:** {finding.evidence}",
                  f"**Confidence:** {finding.confidence:.2f}"]
        try:
            await maybe_await(self.engine.set_context(db.id, "NOTES", "\n".join(lines)))
        except Exception as e:
            log.warning("could not set NOTES context on %s: %s", db.id, e)

    # ── 4. synthesizing ──────────────────────────────────────────────────
    def _collected_findings(self, run: Run) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for b in run.branches:
            h = run.hypothesis(b.hypothesis_id)
            if b.finding is None:
                continue
            out.append({
                "branch_id": b.id, "hypothesis": h.title if h else b.hypothesis_id,
                "approach": h.approach if h else "sql", "claim": b.finding.claim, "evidence": b.finding.evidence,
                "confidence": b.finding.confidence, "status": b.status,
            })
        return out

    async def _synthesize(self, ctx: _Ctx) -> None:
        run = ctx.run
        self._set_status(ctx, "synthesizing")
        findings = self._collected_findings(run)
        system, user = synth_prompts(question=run.question, dataset_name=run.dataset_name, findings=findings,
                                     metrics=run.metrics)
        data = await self._llm_json(ctx, system, user, max_tokens=3500)
        run.report = self._build_report(data, run, findings)
        self._emit(ctx, "report.ready", {"report": run.report.model_dump(mode="json")})

    def _build_report(self, data: Any, run: Run, findings: list[dict[str, Any]]) -> Report:
        valid_ids = [b.id for b in run.branches]
        titles = {f["branch_id"]: f["hypothesis"] for f in findings}
        if isinstance(data, dict) and (data.get("markdown") or data.get("executive_summary")):
            title = str(data.get("title") or f"Parallax report: {run.question[:80]}").strip()
            summary = str(data.get("executive_summary") or "").strip()
            markdown = str(data.get("markdown") or summary).strip()
            key_findings: list[dict[str, Any]] = []
            for kf in data.get("key_findings") or []:
                if isinstance(kf, dict) and kf.get("claim"):
                    try:
                        conf = float(kf.get("confidence", 0.5))
                    except (TypeError, ValueError):
                        conf = 0.5
                    key_findings.append({"claim": str(kf["claim"]), "confidence": max(0.0, min(1.0, conf)),
                                         "branch_id": str(kf.get("branch_id") or "")})
            next_questions = [str(x).strip() for x in (data.get("next_questions") or []) if str(x).strip()][:8]
        else:
            title, summary, markdown, key_findings, next_questions = self._fallback_report(run, findings)
        if not summary:
            summary = markdown.split("\n\n", 1)[0][:600]
        cited = [c for c in dict.fromkeys(_CITATION_RE.findall(markdown)) if c in valid_ids]
        for kf in key_findings:
            if kf["branch_id"] in valid_ids and kf["branch_id"] not in cited:
                cited.append(kf["branch_id"])
        if not cited and findings:
            markdown += "\n\n## Sources\n" + "\n".join(
                f"- [branch:{f['branch_id']}] {f['hypothesis']} — {f['claim']} (confidence {float(f['confidence']):.2f})"
                for f in findings)
            cited = [f["branch_id"] for f in findings]
        if not key_findings:
            key_findings = [{"claim": f["claim"], "confidence": float(f["confidence"]), "branch_id": f["branch_id"]}
                            for f in sorted(findings, key=lambda f: -float(f["confidence"]))[:5]]
        citations = [{"branch_id": bid, "hypothesis": titles.get(bid, bid)} for bid in cited]
        return Report(title=title[:200], executive_summary=summary, markdown=markdown, key_findings=key_findings,
                      next_questions=next_questions, citations=citations)

    @staticmethod
    def _fallback_report(run: Run, findings: list[dict[str, Any]]) -> tuple[str, str, str, list[dict[str, Any]], list[str]]:
        ranked = sorted(findings, key=lambda f: -float(f["confidence"]))
        title = f"Parallax report: {run.question[:80]}"
        if ranked:
            summary = " ".join(f"{f['claim']} [branch:{f['branch_id']}]" for f in ranked[:3])
        else:
            summary = "No branch produced a finding; see caveats."
        lines = [f"# {title}", "", "## Answer", summary, "", "## Evidence"]
        for f in ranked:
            lines.append(f"- **{f['hypothesis']}** ({f['approach']}, confidence {float(f['confidence']):.2f}): "
                         f"{f['claim']} — {f['evidence']} [branch:{f['branch_id']}]")
        if not ranked:
            lines.append("- (none)")
        lines += ["", "## Caveats",
                  "- This report was assembled deterministically because the synthesis model returned no usable JSON.",
                  "", "## Recommended next steps", "- Re-run with more agents or a different search column.",
                  "- Drill into the highest-confidence branch with the SQL console."]
        key_findings = [{"claim": f["claim"], "confidence": float(f["confidence"]), "branch_id": f["branch_id"]}
                        for f in ranked[:5]]
        next_questions = [f"What explains the pattern behind: {f['hypothesis']}?" for f in ranked[:3]]
        return title, summary, "\n".join(lines), key_findings, next_questions

    # ── 5. remember ──────────────────────────────────────────────────────
    async def _remember(self, ctx: _Ctx) -> None:
        run = ctx.run
        findings = self._collected_findings(run)
        parts = [f"Dataset {run.dataset_name}: Q: {run.question}. Findings:"]
        for f in findings:
            parts.append(f"[{f['branch_id']}] {f['claim']} (confidence {float(f['confidence']):.2f}).")
        if run.report and run.report.executive_summary:
            parts.append(f"Summary: {run.report.executive_summary[:600]}")
        text = " ".join(parts)
        tags = [run.dataset_id, f"run:{run.id}"]

        async def _do() -> None:
            await maybe_await(self.memory.remember(text, tags=tags))

        task = asyncio.create_task(_do(), name=f"remember-{run.id}")
        self.background_tasks.add(task)

        def _done(t: asyncio.Task[Any]) -> None:
            self.background_tasks.discard(t)
            if not t.cancelled() and t.exception() is not None:
                log.warning("memory.remember failed for run %s: %s", run.id, t.exception())

        task.add_done_callback(_done)
        done, _pending = await asyncio.wait({task}, timeout=self.memory_wait_s)
        payload: dict[str, Any]
        if done:
            exc = task.exception()
            payload = {"n": 0 if exc else 1, "tags": tags}
            if exc:
                payload["error"] = str(exc)
        else:
            payload = {"n": 1, "tags": tags, "pending": True}
        self._emit(ctx, "memory.remembered", payload)

    # ── ad-hoc helpers used by the API ───────────────────────────────────
    def resolve_db_id(self, run: Run, branch_id: str | None) -> str:
        root_id = (run.root_db or {}).get("id")
        if branch_id in (None, "", "root"):
            if not root_id:
                raise LookupError("run has no root database yet")
            return str(root_id)
        if root_id and branch_id == root_id:
            return str(root_id)
        b = run.branch(branch_id)  # type: ignore[arg-type]
        if b is not None:
            if not b.db:
                raise LookupError(f"branch {branch_id} has no database (not forked yet)")
            return str(b.db["id"])
        for b in run.branches:
            if b.db and b.db.get("id") == branch_id:
                return str(branch_id)
        raise LookupError(f"unknown branch {branch_id!r}")

    async def query_branch(self, run: Run, branch_id: str | None, sql: str, *, limit: int = 200) -> QueryResult:
        db_id = self.resolve_db_id(run, branch_id)
        safe, err = guard_sql(sql, max_limit=None)
        if err or safe is None:
            raise QueryError(err or "invalid SQL")
        ctx = self._ctx_for(run)
        result = await self._timed_query(ctx, maybe_await(self.engine.query(db_id, safe, limit=limit)))
        self.store.save(run)
        return result

    async def search_branch(self, run: Run, branch_id: str | None, kind: str, q: str, k: int = 10) -> QueryResult:
        if kind not in ("bm25", "vector"):
            raise QueryError("kind must be bm25 or vector")
        db_id = self.resolve_db_id(run, branch_id)
        ctx = self._ctx_for(run)
        if not ctx.text_column:
            raise QueryError("this run has no text column; bm25/vector search is unavailable")
        result = await self._search(ctx, db_id, kind, q, k)
        self.store.save(run)
        return result

    async def delete_run_dbs(self, run: Run) -> int:
        deleted = 0
        ids = [b.db["id"] for b in run.branches if b.db and b.db.get("id")]
        if run.root_db and run.root_db.get("id"):
            ids.append(run.root_db["id"])
        for db_id in ids:
            try:
                await maybe_await(self.engine.delete(db_id))
                deleted += 1
            except Exception as e:
                log.warning("could not delete database %s: %s", db_id, e)
        self._contexts.pop(run.id, None)
        return deleted

