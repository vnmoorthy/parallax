"""All HTTP + SSE endpoints (docs/SPEC.md §4). Prefix `/api`; errors are `{"error":{"code","message"}}`."""
from __future__ import annotations

import asyncio
import inspect
import logging
import time
from typing import Any

import httpx
import orjson
from fastapi import APIRouter, File, Query, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from sse_starlette.sse import EventSourceResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import Settings
from app.config import settings as default_settings
from app.data.base import DataEngineError, QueryError
from app.datasets import DatasetError, DatasetRegistry
from app.swarm.burst import run_burst
from app.swarm.events import EventBus
from app.swarm.models import (
    BurstRequest,
    CreateRunRequest,
    Event,
    QueryRequest,
    RecallRequest,
    Run,
    SearchRequest,
    jsonable,
    new_run,
    now_iso,
    result_to_dict,
)
from app.swarm.orchestrator import Orchestrator, maybe_await
from app.swarm.store import RunStore

log = logging.getLogger("parallax.api")

router = APIRouter(prefix="/api")

SSE_HEARTBEAT_S = 15.0
ROCKETRIDE_PING_TTL_S = 30.0


# ── errors ───────────────────────────────────────────────────────────────
class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def error_response(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


_STATUS_CODES = {400: "bad_request", 401: "unauthorized", 403: "forbidden", 404: "not_found",
                 405: "method_not_allowed", 409: "conflict", 413: "payload_too_large", 415: "unsupported_media_type",
                 422: "validation_error", 429: "too_many_requests", 500: "internal_error", 503: "unavailable"}


def install_exception_handlers(app: Any) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return error_response(exc.status, exc.code, exc.message)

    @app.exception_handler(DatasetError)
    async def _dataset_error(_: Request, exc: DatasetError) -> JSONResponse:
        return error_response(exc.status, exc.code, str(exc))

    @app.exception_handler(QueryError)
    async def _query_error(_: Request, exc: QueryError) -> JSONResponse:
        return error_response(400, "query_error", str(exc))

    @app.exception_handler(DataEngineError)
    async def _engine_error(_: Request, exc: DataEngineError) -> JSONResponse:
        return error_response(502, "engine_error", str(exc))

    @app.exception_handler(LookupError)
    async def _lookup_error(_: Request, exc: LookupError) -> JSONResponse:
        return error_response(404, "not_found", str(exc))

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = exc.errors()
        parts = []
        for e in errors[:5]:
            loc = ".".join(str(x) for x in e.get("loc", ()) if x != "body")
            parts.append(f"{loc}: {e.get('msg')}" if loc else str(e.get("msg")))
        return error_response(422, "validation_error", "; ".join(parts) or "invalid request")

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        detail = exc.detail
        if isinstance(detail, dict) and "error" in detail:
            return JSONResponse(status_code=exc.status_code, content=detail)
        code = _STATUS_CODES.get(exc.status_code, "http_error")
        return error_response(exc.status_code, code, str(detail) if detail else code)

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled error")
        return error_response(500, "internal_error", f"{type(exc).__name__}: {exc}")


# ── dependency container ─────────────────────────────────────────────────
class AppContainer:
    """Lazily wires engine / llm / memory through their factories (or the overrides given to create_app)."""

    def __init__(self, *, engine: Any = None, llm: Any = None, memory: Any = None, store: RunStore | None = None,
                 bus: EventBus | None = None, registry: DatasetRegistry | None = None,
                 settings: Settings | None = None) -> None:
        self.settings = settings or default_settings
        self._engine = engine
        self._llm = llm
        self._memory = memory
        self._injected = {"engine": engine is not None, "llm": llm is not None, "memory": memory is not None}
        self.store = store or RunStore(self.settings.runs_dir)
        self.bus = bus or EventBus()
        self.registry = registry or DatasetRegistry(self.settings.datasets_dir, self.settings.uploads_dir)
        self.tasks: dict[str, asyncio.Task[Any]] = {}
        self._orchestrator: Orchestrator | None = None
        self._lock = asyncio.Lock()
        self._rocketride_cache: tuple[float, bool] | None = None

    async def engine(self) -> Any:
        if self._engine is None:
            async with self._lock:
                if self._engine is None:
                    try:
                        from app.data.factory import get_engine
                    except Exception as e:  # factory not present yet / broken import
                        raise ApiError(503, "engine_unavailable", f"data engine factory unavailable: {e}") from e
                    self._engine = await maybe_await(get_engine())
        return self._engine

    async def llm(self) -> Any:
        if self._llm is None:
            async with self._lock:
                if self._llm is None:
                    try:
                        from app.llm.router import get_llm
                    except Exception as e:
                        raise ApiError(503, "llm_unavailable", f"LLM router unavailable: {e}") from e
                    self._llm = await maybe_await(get_llm())
        return self._llm

    async def memory(self) -> Any:
        if self._memory is None:
            async with self._lock:
                if self._memory is None:
                    try:
                        from app.memory.factory import get_memory
                    except Exception as e:
                        raise ApiError(503, "memory_unavailable", f"memory factory unavailable: {e}") from e
                    self._memory = await maybe_await(get_memory())
        return self._memory

    async def orchestrator(self) -> Orchestrator:
        if self._orchestrator is None:
            engine, llm, memory = await self.engine(), await self.llm(), await self.memory()
            self._orchestrator = Orchestrator(engine, llm, memory, self.store, self.bus, self.settings)
        return self._orchestrator

    # ── health helpers ───────────────────────────────────────────────────
    async def llm_label(self, llm: Any) -> str:
        """Best human label for the LLM in use: the active provider of a routed chain, else its name."""
        status_fn = getattr(llm, "status", None)
        if callable(status_fn):
            try:
                st = await maybe_await(status_fn())
                if isinstance(st, dict):
                    active = st.get("active")
                    chain = st.get("chain") or []
                    if active:
                        return str(active)
                    if chain:
                        return str(chain[0])
            except Exception as e:
                log.debug("llm.status() failed: %s", e)
        return str(getattr(llm, "last_provider", None) or getattr(llm, "name", None) or "llm")

    async def subsystem_status(self, name: str, fallback: dict[str, Any]) -> dict[str, Any]:
        """Status for engine/llm/memory: from the injected object when overridden, else from its factory."""
        obj = {"engine": self._engine, "llm": self._llm, "memory": self._memory}[name]
        if self._injected.get(name) and obj is not None:
            status_fn = getattr(obj, "status", None)
            if callable(status_fn):
                try:
                    st = await maybe_await(status_fn())
                    if isinstance(st, dict):
                        return {**fallback, **st}
                except Exception as e:
                    log.debug("%s.status() failed: %s", name, e)
            if name == "llm":
                label = str(getattr(obj, "name", "llm"))
                return {**fallback, "chain": [label], "active": label, "detail": "injected"}
            return {**fallback, "kind": getattr(obj, "kind", fallback.get("kind")), "detail": "injected"}
        module, func = {"engine": ("app.data.factory", "engine_status"), "llm": ("app.llm.router", "llm_status"),
                        "memory": ("app.memory.factory", "memory_status")}[name]
        return await self._status(module, func, fallback)

    async def _status(self, module: str, func: str, fallback: dict[str, Any]) -> dict[str, Any]:
        try:
            mod = __import__(module, fromlist=[func])
            fn = getattr(mod, func)
            data = await maybe_await(fn())
            if isinstance(data, dict):
                return data
            return {**fallback, "detail": str(data)}
        except Exception as e:
            out = dict(fallback)
            out.setdefault("detail", f"{type(e).__name__}: {e}")
            return out

    async def rocketride_reachable(self) -> bool:
        s = self.settings
        if not s.rocketride_configured or not s.rocketride_uri:
            return False
        now = time.monotonic()
        if self._rocketride_cache and now - self._rocketride_cache[0] < ROCKETRIDE_PING_TTL_S:
            return self._rocketride_cache[1]
        reachable = False
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                r = await client.get(f"{s.rocketride_uri.rstrip('/')}/ping",
                                     headers={"Authorization": f"Bearer {s.rocketride_apikey}"})
                reachable = r.status_code < 500
        except Exception as e:
            log.debug("rocketride ping failed: %s", e)
        self._rocketride_cache = (now, reachable)
        return reachable

    async def shutdown(self) -> None:
        for task in list(self.tasks.values()):
            if not task.done():
                task.cancel()
        if self.tasks:
            await asyncio.gather(*self.tasks.values(), return_exceptions=True)
        await self.store.flush_all()
        orch = self._orchestrator
        if orch is not None and orch.background_tasks:
            await asyncio.gather(*orch.background_tasks, return_exceptions=True)


def container(request: Request) -> AppContainer:
    c = getattr(request.app.state, "container", None)
    if c is None:
        c = AppContainer()
        request.app.state.container = c
    return c


def _get_run(c: AppContainer, run_id: str) -> Run:
    run = c.store.get(run_id)
    if run is None:
        raise ApiError(404, "run_not_found", f"unknown run {run_id!r}")
    return run


def _json(content: Any, status: int = 200) -> Response:
    return Response(content=orjson.dumps(jsonable(content)), status_code=status, media_type="application/json")


# ── health ───────────────────────────────────────────────────────────────
@router.get("/health")
async def health(request: Request) -> Response:
    c = container(request)
    s = c.settings
    engine_fallback: dict[str, Any] = {"mode": s.parallax_data_mode,
                                       "kind": getattr(c._engine, "kind", None) or ("hotdata" if s.hotdata_configured and s.parallax_data_mode != "local" else "local"),
                                       "detail": ""}
    llm_fallback: dict[str, Any] = {"chain": [], "active": getattr(c._llm, "name", None), "detail": ""}
    memory_fallback: dict[str, Any] = {"kind": getattr(c._memory, "kind", None) or "local", "detail": ""}
    data_st, llm_st, mem_st, rr = await asyncio.gather(
        c.subsystem_status("engine", engine_fallback),
        c.subsystem_status("llm", llm_fallback),
        c.subsystem_status("memory", memory_fallback),
        c.rocketride_reachable(),
    )
    data = {**engine_fallback, **data_st}
    data.setdefault("mode", s.parallax_data_mode)
    data["kind"] = data.get("kind") or engine_fallback["kind"]
    llm = {**llm_fallback, **llm_st}
    if not isinstance(llm.get("chain"), list):
        llm["chain"] = [llm["chain"]] if llm.get("chain") else []
    memory = {**memory_fallback, **mem_st}
    memory["kind"] = memory.get("kind") or "local"
    body = {
        "ok": True,
        "version": s.parallax_version,
        "data": data,
        "llm": llm,
        "memory": memory,
        "rocketride": {"configured": s.rocketride_configured, "reachable": rr, "uri": s.rocketride_uri,
                       "cloud": s.rocketride_is_cloud},
        "hotdata": {"configured": s.hotdata_configured,
                    "reachable": bool((data.get("hotdata") or {}).get("reachable", data.get("kind") == "hotdata"))},
        "cognee": {"configured": memory.get("kind") == "cognee" or bool(memory.get("configured")),
                   "active": memory.get("kind") == "cognee"},
        "time": now_iso(),
    }
    return _json(body)


# ── datasets ─────────────────────────────────────────────────────────────
@router.get("/datasets")
async def list_datasets(request: Request) -> Response:
    c = container(request)
    items = await asyncio.to_thread(lambda: [d.to_dict() for d in c.registry.list()])
    return _json(items)


@router.post("/datasets/upload", status_code=201)
async def upload_dataset(request: Request, file: UploadFile = File(...)) -> Response:
    c = container(request)
    name = file.filename or "upload.csv"
    if not name.lower().endswith((".csv", ".txt")) and (file.content_type or "").lower() not in ("text/csv", "application/csv", "text/plain"):
        raise ApiError(415, "unsupported_media_type", "only CSV files are accepted")
    data = await file.read()
    ds = await asyncio.to_thread(c.registry.save_upload, name, data)
    return _json(ds.to_dict(), 201)


@router.get("/datasets/{dataset_id}/preview")
async def dataset_preview(request: Request, dataset_id: str, limit: int = Query(20, ge=1, le=200)) -> Response:
    c = container(request)
    return _json(await asyncio.to_thread(c.registry.preview, dataset_id, limit))


# ── runs ─────────────────────────────────────────────────────────────────
@router.post("/runs", status_code=201)
async def create_run(request: Request, body: CreateRunRequest) -> Response:
    c = container(request)
    max_agents = int(c.settings.parallax_max_agents)
    if body.agents < 2 or body.agents > max_agents:
        raise ApiError(422, "invalid_agents", f"agents must be between 2 and {max_agents}")
    dataset = await asyncio.to_thread(c.registry.get, body.dataset_id)
    columns = await asyncio.to_thread(lambda: dataset.columns)
    names = {col["name"] for col in columns}
    if body.search_column and body.search_column not in names:
        raise ApiError(422, "invalid_search_column",
                       f"search_column {body.search_column!r} is not a column of dataset {dataset.id}")
    orch = await c.orchestrator()
    modes = {
        "data": getattr(orch.engine, "kind", "local"),
        "llm": await c.llm_label(orch.llm),
        "memory": getattr(orch.memory, "kind", "local"),
    }
    run = new_run(body, dataset_id=dataset.id, dataset_name=dataset.name, modes=modes,
                  text_column=body.search_column or (dataset.text_columns[0] if dataset.text_columns else None),
                  schema_columns=columns)
    c.store.flush(run)

    async def _go() -> None:
        try:
            await orch.run(run, dataset)
        except asyncio.CancelledError:
            pass
        except Exception:
            log.exception("run task %s crashed", run.id)
        finally:
            c.tasks.pop(run.id, None)

    c.tasks[run.id] = asyncio.create_task(_go(), name=f"run-{run.id}")
    return _json({"run_id": run.id}, 201)


@router.get("/runs")
async def list_runs(request: Request) -> Response:
    c = container(request)
    return _json([s.model_dump(mode="json") for s in c.store.list_summaries()])


@router.get("/runs/{run_id}")
async def get_run(request: Request, run_id: str) -> Response:
    c = container(request)
    return _json(_get_run(c, run_id).model_dump(mode="json"))


@router.get("/runs/{run_id}/events")
async def run_events(request: Request, run_id: str) -> EventSourceResponse:
    c = container(request)
    run = _get_run(c, run_id)

    async def gen():
        if not c.bus.has_run(run_id) and run.status in ("done", "failed"):
            # run finished in a previous process: synthesise the terminal events from the persisted state
            status_ev = Event(type="run.status", run_id=run_id, payload={"status": run.status, "error": run.error})
            yield {"data": status_ev.model_dump_json()}
            if run.report is not None:
                yield {"data": Event(type="report.ready", run_id=run_id,
                                     payload={"report": run.report.model_dump(mode="json")}).model_dump_json()}
            yield {"data": Event(type="run.finished", run_id=run_id, payload={}).model_dump_json()}
            return
        async for ev in c.bus.subscribe(run_id, heartbeat=SSE_HEARTBEAT_S):
            if await request.is_disconnected():
                return
            if ev is None:
                yield {"comment": "ping"}
                continue
            yield {"data": ev.model_dump_json()}

    return EventSourceResponse(gen(), ping=SSE_HEARTBEAT_S,
                               headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/runs/{run_id}/query")
async def run_query(request: Request, run_id: str, body: QueryRequest) -> Response:
    c = container(request)
    run = _get_run(c, run_id)
    orch = await c.orchestrator()
    result = await orch.query_branch(run, body.branch_id, body.sql)
    return _json(result_to_dict(result))


@router.post("/runs/{run_id}/search")
async def run_search(request: Request, run_id: str, body: SearchRequest) -> Response:
    c = container(request)
    run = _get_run(c, run_id)
    orch = await c.orchestrator()
    result = await orch.search_branch(run, body.branch_id, body.kind, body.q, body.k)
    return _json(result_to_dict(result))


@router.get("/runs/{run_id}/lineage")
async def run_lineage(request: Request, run_id: str) -> Response:
    c = container(request)
    run = _get_run(c, run_id)
    if not run.root_db:
        return _json([])
    engine = await c.engine()
    try:
        nodes = await maybe_await(engine.lineage(run.root_db["id"]))
    except DataEngineError as e:
        log.warning("lineage failed for %s: %s", run_id, e)
        nodes = []
    out = [n.to_dict() if hasattr(n, "to_dict") else dict(n) for n in nodes or []]
    if not out:  # derive from the run itself so the tree never renders empty
        out.append({"id": run.root_db["id"], "name": run.root_db.get("name", "root"), "parent_id": None,
                    "created_at": run.root_db.get("created_at", run.created_at), "exists": True})
        for b in run.branches:
            if b.db:
                out.append({"id": b.db["id"], "name": b.db.get("name", b.id), "parent_id": run.root_db["id"],
                            "created_at": b.db.get("created_at", run.created_at), "exists": True})
    return _json(out)


@router.get("/runs/{run_id}/report.md")
async def run_report_md(request: Request, run_id: str) -> Response:
    c = container(request)
    run = _get_run(c, run_id)
    if run.report is None:
        raise ApiError(404, "no_report", "this run has no report yet")
    r = run.report
    md = r.markdown if r.markdown.lstrip().startswith("#") else f"# {r.title}\n\n{r.markdown}"
    if r.next_questions and "next question" not in md.lower():
        md += "\n\n## Next questions\n" + "\n".join(f"- {q}" for q in r.next_questions)
    md += f"\n\n---\n_Parallax run `{run.id}` · dataset {run.dataset_name} · {run.agents} agents · " \
          f"{run.metrics.queries} queries · generated {run.metrics.finished_at or now_iso()}_\n"
    filename = f"parallax-report-{run.id}.md"
    return PlainTextResponse(md, media_type="text/markdown; charset=utf-8",
                             headers={"Content-Disposition": f'inline; filename="{filename}"'})


@router.post("/runs/{run_id}/burst")
async def run_burst_endpoint(request: Request, run_id: str, body: BurstRequest) -> Response:
    c = container(request)
    run = _get_run(c, run_id)
    engine = await c.engine()
    payload = await run_burst(engine, run, body.queries, c.bus, store=c.store)
    return _json(payload)


@router.delete("/runs/{run_id}")
async def delete_run(request: Request, run_id: str) -> Response:
    c = container(request)
    run = _get_run(c, run_id)
    task = c.tasks.pop(run_id, None)
    if task is not None and not task.done():
        task.cancel()
        try:
            await asyncio.wait_for(task, timeout=5.0)
        except (TimeoutError, asyncio.CancelledError, Exception):
            pass
    deleted_dbs = 0
    try:
        orch = await c.orchestrator()
        deleted_dbs = await orch.delete_run_dbs(run)
    except ApiError as e:  # factories unavailable → we still remove the run record
        log.warning("could not delete databases for %s: %s", run_id, e.message)
    c.store.delete(run_id)
    c.bus.clear(run_id)
    return _json({"ok": True, "deleted_databases": deleted_dbs})


# ── memory ───────────────────────────────────────────────────────────────
async def _hits(items: Any) -> list[dict[str, Any]]:
    out = []
    for h in items or []:
        out.append(jsonable(h.to_dict() if hasattr(h, "to_dict") else h))
    return out


@router.get("/memory")
async def memory_overview(request: Request) -> Response:
    c = container(request)
    memory = await c.memory()
    stats: dict[str, Any] = {}
    try:
        stats = jsonable(await maybe_await(memory.stats())) or {}
    except Exception as e:
        stats = {"error": str(e)}
    recent: list[dict[str, Any]] = []
    try:
        recent_fn = getattr(memory, "recent", None)
        if callable(recent_fn):
            sig = inspect.signature(recent_fn)
            raw = await maybe_await(recent_fn(k=10) if "k" in sig.parameters else recent_fn())
        else:
            raw = await maybe_await(memory.recall("findings", tags=None, k=10))
        recent = await _hits(raw)
    except Exception as e:
        log.debug("memory recent failed: %s", e)
    return _json({"kind": getattr(memory, "kind", "local"), "stats": stats, "recent": recent})


@router.post("/memory/recall")
async def memory_recall(request: Request, body: RecallRequest) -> Response:
    c = container(request)
    memory = await c.memory()
    hits = await maybe_await(memory.recall(body.q, tags=body.tags or None, k=body.k))
    return _json(await _hits(hits))


@router.get("/memory/graph")
async def memory_graph(request: Request) -> Response:
    c = container(request)
    memory = await c.memory()
    html: str | None = None
    try:
        html = await maybe_await(memory.graph_html())
    except Exception as e:
        log.warning("graph_html failed: %s", e)
    if not html:
        return error_response(404, "no_graph", "no memory graph available — enable Cognee to get a knowledge graph")
    return Response(content=html, media_type="text/html; charset=utf-8")
