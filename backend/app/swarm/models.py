"""Pydantic v2 models for swarm runs, events and API requests (docs/SPEC.md §5).

`DB`, `QueryResult`, `MemoryHit` and `LineageNode` from the engine/memory layers are dataclasses; we store them as
plain dicts (their `.to_dict()`) so the run model serialises trivially and never depends on engine internals.
"""
from __future__ import annotations

import math
import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

RunStatus = Literal["queued", "provisioning", "planning", "exploring", "synthesizing", "done", "failed"]
BranchStatus = Literal["forking", "exploring", "done", "failed"]
Approach = Literal["sql", "bm25", "vector", "mixed"]
StepKind = Literal["think", "sql", "bm25", "vector", "observe", "finding"]
ChartType = Literal["bar", "line", "pie", "number"]

APPROACHES: tuple[str, ...] = ("sql", "bm25", "vector", "mixed")
CHART_TYPES: tuple[str, ...] = ("bar", "line", "pie", "number")


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def new_run_id() -> str:
    return uuid.uuid4().hex[:12]


class _Model(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)


# ── plan ─────────────────────────────────────────────────────────────────
class Hypothesis(_Model):
    id: str
    title: str
    rationale: str = ""
    approach: Approach = "sql"
    target_columns: list[str] = Field(default_factory=list)


# ── agent output ─────────────────────────────────────────────────────────
class ChartSpec(_Model):
    type: ChartType = "bar"
    title: str = ""
    x: str | None = None
    y: str | None = None
    data: list[dict[str, Any]] = Field(default_factory=list)


class Finding(_Model):
    claim: str
    evidence: str = ""
    confidence: float = 0.5
    supporting_sql: list[str] = Field(default_factory=list)
    chart: ChartSpec | None = None
    tags: list[str] = Field(default_factory=list)

    @field_validator("confidence", mode="before")
    @classmethod
    def _clamp_confidence(cls, v: Any) -> float:
        try:
            f = float(v)
        except (TypeError, ValueError):
            return 0.5
        if math.isnan(f):
            return 0.5
        if f > 1.0 and f <= 100.0:  # tolerate percentages
            f = f / 100.0
        return max(0.0, min(1.0, f))


class AgentStep(_Model):
    n: int
    kind: StepKind
    text: str = ""
    sql: str | None = None
    result: dict[str, Any] | None = None  # QueryResult.to_dict()
    elapsed_ms: float | None = None
    provider: str | None = None


class Branch(_Model):
    id: str
    hypothesis_id: str
    db: dict[str, Any] | None = None  # DB.to_dict()
    status: BranchStatus = "forking"
    steps: list[AgentStep] = Field(default_factory=list)
    finding: Finding | None = None


# ── report & metrics ─────────────────────────────────────────────────────
class Report(_Model):
    title: str
    executive_summary: str = ""
    markdown: str = ""
    key_findings: list[dict[str, Any]] = Field(default_factory=list)  # {claim, confidence, branch_id}
    next_questions: list[str] = Field(default_factory=list)
    citations: list[dict[str, Any]] = Field(default_factory=list)  # {branch_id, hypothesis}


class Metrics(_Model):
    databases_created: int = 0
    forks: int = 0
    queries: int = 0
    peak_concurrency: int = 0
    p50_ms: float = 0.0
    p95_ms: float = 0.0
    llm_calls: int = 0
    llm_calls_by_provider: dict[str, int] = Field(default_factory=dict)
    started_at: str = Field(default_factory=now_iso)
    finished_at: str | None = None
    elapsed_ms: float | None = None
    time_to_first_finding_ms: float | None = None
    burst: dict[str, Any] | None = None


# ── run ──────────────────────────────────────────────────────────────────
class Run(_Model):
    id: str = Field(default_factory=new_run_id)
    created_at: str = Field(default_factory=now_iso)
    status: RunStatus = "queued"
    dataset_id: str
    dataset_name: str
    question: str
    agents: int
    modes: dict[str, Any] = Field(default_factory=dict)  # {data, llm, memory}
    root_db: dict[str, Any] | None = None  # DB.to_dict()
    branches: list[Branch] = Field(default_factory=list)
    recalled: list[dict[str, Any]] = Field(default_factory=list)  # MemoryHit.to_dict()
    plan: list[Hypothesis] = Field(default_factory=list)
    report: Report | None = None
    metrics: Metrics = Field(default_factory=Metrics)
    error: str | None = None
    # extras (not in the frontend contract, harmless there): what the swarm searched over + the loaded schema
    text_column: str | None = None
    schema_columns: list[dict[str, str]] = Field(default_factory=list)  # [{name, type}]

    def branch(self, branch_id: str) -> Branch | None:
        for b in self.branches:
            if b.id == branch_id:
                return b
        return None

    def hypothesis(self, hypothesis_id: str) -> Hypothesis | None:
        for h in self.plan:
            if h.id == hypothesis_id:
                return h
        return None

    def summary(self) -> RunSummary:
        return RunSummary(
            id=self.id, created_at=self.created_at, status=self.status, dataset_name=self.dataset_name,
            question=self.question, agents=self.agents, elapsed_ms=self.metrics.elapsed_ms,
            p50_ms=self.metrics.p50_ms if self.metrics.queries else None, queries=self.metrics.queries,
            modes=dict(self.modes),
        )


class RunSummary(_Model):
    id: str
    created_at: str
    status: RunStatus
    dataset_name: str
    question: str
    agents: int
    elapsed_ms: float | None = None
    p50_ms: float | None = None
    queries: int = 0
    modes: dict[str, Any] = Field(default_factory=dict)


class Event(_Model):
    ts: str = Field(default_factory=now_iso)
    type: str
    run_id: str
    branch_id: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


# ── request bodies (docs/SPEC.md §4) ─────────────────────────────────────
class CreateRunRequest(_Model):
    dataset_id: str = Field(min_length=1)
    question: str = Field(min_length=1, max_length=4000)
    agents: int = Field(default=6, ge=2, le=16)
    search_column: str | None = None

    @field_validator("question")
    @classmethod
    def _strip_question(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("question must not be blank")
        return v


class QueryRequest(_Model):
    branch_id: str = Field(default="root", min_length=1)
    sql: str = Field(min_length=1, max_length=20000)


class SearchRequest(_Model):
    branch_id: str = Field(default="root", min_length=1)
    kind: Literal["bm25", "vector"] = "bm25"
    q: str = Field(min_length=1, max_length=2000)
    k: int = Field(default=10, ge=1, le=100)


class BurstRequest(_Model):
    queries: int = Field(default=100, ge=10, le=200)


class RecallRequest(_Model):
    q: str = Field(default="", max_length=4000)
    tags: list[str] | None = None
    k: int = Field(default=8, ge=1, le=50)


def new_run(req: CreateRunRequest, *, dataset_id: str, dataset_name: str, modes: dict[str, Any],
            text_column: str | None = None, schema_columns: list[dict[str, str]] | None = None) -> Run:
    """Build a queued Run from a validated request (metrics initialised, nothing provisioned yet)."""
    return Run(
        dataset_id=dataset_id, dataset_name=dataset_name, question=req.question, agents=req.agents,
        modes=dict(modes), text_column=text_column, schema_columns=list(schema_columns or []),
        metrics=Metrics(started_at=now_iso()),
    )


# ── JSON safety for engine values (Decimal, datetime, numpy scalars, NaN, bytes) ─────────────────
def jsonable(v: Any) -> Any:
    """Coerce an engine/pandas value into something orjson and pydantic can serialise."""
    import base64
    import math
    from datetime import date, time, timedelta
    from decimal import Decimal

    if v is None or isinstance(v, (bool, str)):
        return v
    if isinstance(v, int):  # includes numpy integer subclasses of int
        return int(v)
    if isinstance(v, float):  # numpy.float64 subclasses float — normalise to a plain float
        f = float(v)
        return f if math.isfinite(f) else None
    if isinstance(v, Decimal):
        try:
            f = float(v)
        except (ValueError, OverflowError):
            return str(v)
        return f if math.isfinite(f) else None
    if isinstance(v, (datetime, date, time)):
        return v.isoformat()
    if isinstance(v, timedelta):
        return v.total_seconds()
    if isinstance(v, (bytes, bytearray)):
        try:
            return bytes(v).decode("utf-8")
        except UnicodeDecodeError:
            return base64.b64encode(bytes(v)).decode("ascii")
    if isinstance(v, dict):
        return {str(k): jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple, set, frozenset)):
        return [jsonable(x) for x in v]
    item = getattr(v, "item", None)  # numpy scalars
    if callable(item):
        try:
            return jsonable(item())
        except Exception:
            pass
    to_dict = getattr(v, "to_dict", None)
    if callable(to_dict):
        try:
            return jsonable(to_dict())
        except Exception:
            pass
    return str(v)


def result_to_dict(result: Any) -> dict[str, Any]:
    """QueryResult (dataclass or dict) → JSON-safe dict matching the frontend `QueryResult` type."""
    d = dict(result) if isinstance(result, dict) else dict(result.to_dict())
    d["columns"] = [str(c) for c in (d.get("columns") or [])]
    d["rows"] = [jsonable(list(r) if not isinstance(r, dict) else list(r.values())) for r in (d.get("rows") or [])]
    d["row_count"] = int(d.get("row_count") or len(d["rows"]))
    d["elapsed_ms"] = float(d.get("elapsed_ms") or 0.0)
    d["truncated"] = bool(d.get("truncated", False))
    d["sql"] = str(d.get("sql") or "")
    return d
