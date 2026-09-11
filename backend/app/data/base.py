"""DataEngine protocol — the single abstraction over Hotdata Cloud and the local DuckDB engine (docs/SPEC.md §3.1)."""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Protocol, runtime_checkable


@dataclass
class DB:
    id: str
    name: str
    parent_id: str | None = None
    created_at: str = ""
    expires_at: str | None = None
    connection_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class QueryResult:
    columns: list[str]
    rows: list[list[Any]]
    row_count: int
    elapsed_ms: float
    truncated: bool = False
    sql: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def head(self, n: int = 15) -> "QueryResult":
        return QueryResult(self.columns, self.rows[:n], self.row_count, self.elapsed_ms, self.truncated or len(self.rows) > n, self.sql)


@dataclass
class TableInfo:
    name: str
    columns: list[tuple[str, str]]
    row_count: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {"name": self.name, "columns": [{"name": c, "type": t} for c, t in self.columns], "row_count": self.row_count}


@dataclass
class LineageNode:
    id: str
    name: str
    parent_id: str | None
    created_at: str
    exists: bool = True

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class DataEngineError(Exception):
    """Raised for any engine failure; message is safe to surface to the UI."""


class QueryError(DataEngineError):
    """SQL failed. `message` contains the engine's error text so the agent can self-correct."""


@runtime_checkable
class DataEngine(Protocol):
    kind: str  # "hotdata" | "local"

    async def create_database(self, name: str, *, expires: str = "24h") -> DB: ...
    async def fork(self, db_id: str, name: str) -> DB: ...
    async def load_csv(self, db_id: str, table: str, csv_text: str, *, mode: str = "replace",
                       columns: dict[str, str] | None = None) -> int: ...
    async def query(self, db_id: str, sql: str, *, limit: int = 200) -> QueryResult: ...
    async def tables(self, db_id: str) -> list[TableInfo]: ...
    async def create_index(self, db_id: str, table: str, column: str, kind: str) -> str: ...
    async def bm25_search(self, db_id: str, table: str, column: str, q: str, k: int = 10) -> QueryResult: ...
    async def vector_search(self, db_id: str, table: str, column: str, q: str, k: int = 10) -> QueryResult: ...
    async def lineage(self, db_id: str) -> list[LineageNode]: ...
    async def set_context(self, db_id: str, name: str, content: str) -> None: ...
    async def get_context(self, db_id: str) -> dict[str, str]: ...
    async def delete(self, db_id: str) -> None: ...
    async def healthy(self) -> bool: ...
    def table_ref(self, db_id: str, table: str) -> str: ...
