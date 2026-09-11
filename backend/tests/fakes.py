"""Deterministic fakes for the orchestrator/API tests: FakeEngine (DuckDB in-memory per DB), FakeLLM, FakeMemory."""
from __future__ import annotations

import asyncio
import io
import re
import time
from collections import Counter
from datetime import UTC, datetime
from typing import Any

import duckdb
import pandas as pd

from app.data.base import DB, DataEngineError, LineageNode, QueryError, QueryResult, TableInfo
from app.memory.base import MemoryHit


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _q(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


class FakeEngine:
    """Minimal DataEngine: one in-memory DuckDB connection per database id; fork copies every table."""

    kind = "local"

    def __init__(self, *, io_delay: float = 0.002, slow_vector_index_s: float = 0.0) -> None:
        self._conns: dict[str, duckdb.DuckDBPyConnection] = {}
        self._dbs: dict[str, DB] = {}
        self._contexts: dict[str, dict[str, str]] = {}
        self.indexes: dict[str, set[tuple[str, str, str]]] = {}
        self.calls: Counter[str] = Counter()
        self.deleted: list[str] = []
        self.io_delay = io_delay
        self.slow_vector_index_s = slow_vector_index_s  # simulates embedding every row (LocalEngine + ollama)
        self._n = 0
        self._lock = asyncio.Lock()

    # ── helpers ──────────────────────────────────────────────────────────
    def _conn(self, db_id: str) -> duckdb.DuckDBPyConnection:
        conn = self._conns.get(db_id)
        if conn is None:
            raise DataEngineError(f"unknown database {db_id}")
        return conn

    async def _tick(self) -> None:
        if self.io_delay:
            await asyncio.sleep(self.io_delay)

    def _table_names(self, conn: duckdb.DuckDBPyConnection) -> list[str]:
        rows = conn.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='main' ORDER BY 1").fetchall()
        return [r[0] for r in rows]

    # ── protocol ─────────────────────────────────────────────────────────
    async def create_database(self, name: str, *, expires: str = "24h") -> DB:
        self.calls["create_database"] += 1
        await self._tick()
        self._n += 1
        db_id = f"db_{self._n:03d}"
        self._conns[db_id] = duckdb.connect(":memory:")
        db = DB(id=db_id, name=name, parent_id=None, created_at=_now(), expires_at=None, connection_id="fake")
        self._dbs[db_id] = db
        self._contexts[db_id] = {}
        return db

    async def fork(self, db_id: str, name: str) -> DB:
        self.calls["fork"] += 1
        parent = self._conn(db_id)
        await self._tick()
        self._n += 1
        new_id = f"db_{self._n:03d}"
        child = duckdb.connect(":memory:")
        for table in self._table_names(parent):
            tbl = parent.execute(f"SELECT * FROM {_q(table)}").arrow()
            child.register("__src", tbl)
            child.execute(f"CREATE TABLE {_q(table)} AS SELECT * FROM __src")
            child.unregister("__src")
        self._conns[new_id] = child
        db = DB(id=new_id, name=name, parent_id=db_id, created_at=_now(), expires_at=None, connection_id="fake")
        self._dbs[new_id] = db
        self._contexts[new_id] = {}
        return db

    async def load_csv(self, db_id: str, table: str, csv_text: str, *, mode: str = "replace",
                       columns: dict[str, str] | None = None) -> int:
        self.calls["load_csv"] += 1
        conn = self._conn(db_id)
        await self._tick()
        df = pd.read_csv(io.StringIO(csv_text))
        conn.register("__load", df)
        try:
            exists = table in self._table_names(conn)
            if mode == "replace" or not exists:
                conn.execute(f"CREATE OR REPLACE TABLE {_q(table)} AS SELECT * FROM __load")
            else:
                conn.execute(f"INSERT INTO {_q(table)} BY NAME SELECT * FROM __load")
        finally:
            conn.unregister("__load")
        return len(df)

    async def query(self, db_id: str, sql: str, *, limit: int = 200) -> QueryResult:
        self.calls["query"] += 1
        conn = self._conn(db_id)
        await self._tick()
        t0 = time.perf_counter()
        try:
            cur = conn.execute(sql)
            columns = [d[0] for d in (cur.description or [])]
            rows = cur.fetchmany(limit + 1)
        except duckdb.Error as e:
            raise QueryError(str(e).splitlines()[0]) from e
        elapsed = (time.perf_counter() - t0) * 1000.0
        truncated = len(rows) > limit
        rows = [list(r) for r in rows[:limit]]
        return QueryResult(columns=columns, rows=rows, row_count=len(rows), elapsed_ms=round(elapsed, 3),
                           truncated=truncated, sql=sql)

    async def tables(self, db_id: str) -> list[TableInfo]:
        self.calls["tables"] += 1
        conn = self._conn(db_id)
        out = []
        for t in self._table_names(conn):
            cols = [(r[0], r[1]) for r in conn.execute(f"DESCRIBE {_q(t)}").fetchall()]
            n = conn.execute(f"SELECT COUNT(*) FROM {_q(t)}").fetchone()[0]
            out.append(TableInfo(name=t, columns=cols, row_count=int(n)))
        return out

    async def create_index(self, db_id: str, table: str, column: str, kind: str) -> str:
        self.calls["create_index"] += 1
        self._conn(db_id)
        await self._tick()
        if kind == "vector" and self.slow_vector_index_s:
            await asyncio.sleep(self.slow_vector_index_s)
        self.indexes.setdefault(db_id, set()).add((table, column, kind))
        return f"{kind}_{table}_{column}"

    def _tokens(self, q: str) -> list[str]:
        return [t for t in re.findall(r"[a-z0-9]+", q.lower()) if len(t) > 2][:12]

    async def bm25_search(self, db_id: str, table: str, column: str, q: str, k: int = 10) -> QueryResult:
        self.calls["bm25_search"] += 1
        toks = self._tokens(q) or ["_"]
        score = " + ".join(f"(CASE WHEN lower({_q(column)}) LIKE '%{t}%' THEN 1 ELSE 0 END)" for t in toks)
        sql = (f"SELECT * FROM (SELECT *, ({score}) AS score FROM {_q(table)}) WHERE score > 0 "
               f"ORDER BY score DESC LIMIT {int(k)}")
        return await self.query(db_id, sql, limit=k)

    async def vector_search(self, db_id: str, table: str, column: str, q: str, k: int = 10) -> QueryResult:
        self.calls["vector_search"] += 1
        toks = self._tokens(q) or ["_"]
        score = " + ".join(f"(CASE WHEN lower({_q(column)}) LIKE '%{t}%' THEN 1 ELSE 0 END)" for t in toks)
        sql = (f"SELECT * FROM (SELECT *, 1.0 - ({score}) / {len(toks)}.0 AS _distance FROM {_q(table)}) "
               f"ORDER BY _distance ASC LIMIT {int(k)}")
        return await self.query(db_id, sql, limit=k)

    async def lineage(self, db_id: str) -> list[LineageNode]:
        self.calls["lineage"] += 1
        root = db_id
        while self._dbs.get(root) and self._dbs[root].parent_id:
            root = self._dbs[root].parent_id  # type: ignore[assignment]
        family: list[LineageNode] = []
        frontier = [root]
        while frontier:
            cur = frontier.pop(0)
            meta = self._dbs.get(cur)
            if meta is None:
                continue
            family.append(LineageNode(id=meta.id, name=meta.name, parent_id=meta.parent_id, created_at=meta.created_at,
                                      exists=cur in self._conns))
            frontier += [d.id for d in self._dbs.values() if d.parent_id == cur]
        return family

    async def set_context(self, db_id: str, name: str, content: str) -> None:
        self.calls["set_context"] += 1
        self._conn(db_id)
        self._contexts.setdefault(db_id, {})[name] = content

    async def get_context(self, db_id: str) -> dict[str, str]:
        return dict(self._contexts.get(db_id, {}))

    async def delete(self, db_id: str) -> None:
        self.calls["delete"] += 1
        conn = self._conns.pop(db_id, None)
        if conn is None:
            raise DataEngineError(f"unknown database {db_id}")
        conn.close()
        self.deleted.append(db_id)

    async def healthy(self) -> bool:
        return True

    def table_ref(self, db_id: str, table: str) -> str:
        return table


# ── LLM ──────────────────────────────────────────────────────────────────
_EXACT_N = re.compile(r"exactly (\d+) hypotheses")
_SCHEMA_LINE = re.compile(r"^- ([^:\n]+): (\S+)", re.MULTILINE)
_KV = re.compile(r"^([a-z_]+): (.+)$", re.MULTILINE)


class FakeLLM:
    """Canned JSON keyed on the system-prompt markers.

    planner → exactly N hypotheses (≥1 bm25 and ≥1 vector when a text column exists);
    agent   → one tool call matching the hypothesis approach, then finish (chart omitted so it gets derived);
    synth   → report citing every branch. `junk_branches` makes the first agent reply of those branches non-JSON.
    """

    name = "fake"

    def __init__(self, *, junk_branches: set[str] | None = None, fail_synth: bool = False,
                 bad_sql_branches: set[str] | None = None) -> None:
        self.calls = 0
        self.calls_by_provider: dict[str, int] = {"fake": 0}
        self.last_provider = "fake"
        self.prompts: list[tuple[str, str]] = []
        self.junk_branches = set(junk_branches or ())
        self.bad_sql_branches = set(bad_sql_branches or ())
        self.fail_synth = fail_synth
        self._junked: set[str] = set()

    async def healthy(self) -> bool:
        return True

    async def complete(self, system: str, user: str, *, json_mode: bool = True, max_tokens: int = 2000) -> str:
        import json

        self.calls += 1
        self.calls_by_provider["fake"] += 1
        self.prompts.append((system, user))
        await asyncio.sleep(0)
        if system.startswith("[[PLANNER]]"):
            return json.dumps(self._plan(user))
        if system.startswith("[[AGENT]]"):
            return self._agent(user)
        if system.startswith("[[SYNTH]]"):
            if self.fail_synth:
                return "I cannot produce JSON right now."
            return json.dumps(self._synth(user))
        return "{}"

    @staticmethod
    def _schema(user: str) -> list[tuple[str, str]]:
        block = user.split("Schema:", 1)[1] if "Schema:" in user else ""
        block = block.split("\n\n", 1)[0]
        return [(m.group(1).strip(), m.group(2).strip()) for m in _SCHEMA_LINE.finditer(block)]

    @staticmethod
    def _kv(user: str) -> dict[str, str]:
        return {m.group(1): m.group(2).strip() for m in _KV.finditer(user)}

    def _plan(self, user: str) -> dict[str, Any]:
        n = int(_EXACT_N.search(user).group(1)) if _EXACT_N.search(user) else 3
        m = re.search(r"^Text column: (.+)$", user, re.MULTILINE)
        text_col = m.group(1).strip() if m and m.group(1).strip() != "none" else None
        schema = self._schema(user)
        cols = [c for c, _ in schema if c != text_col] or ["*"]
        approaches = ["sql", "bm25", "vector", "mixed"] if text_col else ["sql"]
        hyps = []
        for i in range(n):
            approach = approaches[i % len(approaches)]
            col = cols[i % len(cols)]
            targets = [text_col] if approach in ("bm25", "vector") and text_col else [col]
            hyps.append({"title": f"Hypothesis {i + 1}: {col} drives the outcome ({approach})",
                         "rationale": f"Auto hypothesis {i + 1}", "approach": approach, "target_columns": targets})
        return {"hypotheses": hyps}

    def _agent(self, user: str) -> str:
        import json

        kv = self._kv(user)
        branch = kv.get("branch_id", "b_?")
        ref = kv.get("table_ref", "data")
        approach = kv.get("approach", "sql")
        text_col = kv.get("text_column") if kv.get("text_column") != "none" else None
        no_steps = "(no steps yet)" in user
        if no_steps and branch in self.junk_branches and branch not in self._junked:
            self._junked.add(branch)
            return "Sure! Let me think about this out loud instead of answering in JSON."
        if no_steps:
            if approach in ("bm25", "vector") and text_col:
                return json.dumps({"thought": f"Search the {text_col} column for the theme.", "action": approach,
                                   "query": "crash late wrong missing"})
            schema = self._schema(user)
            col = next((c for c, _ in schema if c != text_col), None)
            if branch in self.bad_sql_branches and "Observation: error" not in user:
                return json.dumps({"thought": "Try a broken query first.", "action": "sql",
                                   "sql": f"SELECT nope_column FROM {ref} GROUP BY 1"})
            sql = (f"SELECT {col}, COUNT(*) AS n FROM {ref} GROUP BY 1 ORDER BY n DESC LIMIT 10" if col
                   else f"SELECT COUNT(*) AS n FROM {ref}")
            return json.dumps({"thought": f"Aggregate by {col or 'count'} to test the hypothesis.", "action": "sql",
                               "sql": sql})
        if "Observation: error" in user and user.count("Step ") == 1 and branch in self.bad_sql_branches:
            schema = self._schema(user)
            col = next((c for c, _ in schema if c != text_col), "1")
            return json.dumps({"thought": "Fix the column name.", "action": "sql",
                               "sql": f"SELECT {col}, COUNT(*) AS n FROM {ref} GROUP BY 1 ORDER BY n DESC LIMIT 5"})
        # second turn: finish with a finding derived from the observation
        m = re.search(r"rows: (\d+)", user)
        rows = m.group(1) if m else "some"
        return json.dumps({
            "thought": "Enough evidence; finishing.",
            "action": "finish",
            "finding": {"claim": f"Branch {branch}: the top group accounts for the largest share ({rows} groups observed).",
                        "evidence": f"Observed {rows} rows via {approach}.", "confidence": 0.8},
        })

    def _synth(self, user: str) -> dict[str, Any]:
        ids = re.findall(r"branch_id: (b_\d+)", user)
        md = "## Answer\n" + " ".join(f"Finding from [branch:{b}] supports the answer." for b in ids) or "No findings."
        md += "\n\n## Evidence\n" + "\n".join(f"- [branch:{b}] contributes evidence." for b in ids)
        return {
            "title": "Fake synthesis report",
            "executive_summary": f"{len(ids)} branches agree on the main driver.",
            "markdown": md,
            "key_findings": [{"claim": f"Key finding from {b}", "confidence": 0.8, "branch_id": b} for b in ids[:3]],
            "next_questions": ["What changed over time?", "Does the pattern hold per segment?"],
        }


# ── memory ───────────────────────────────────────────────────────────────
class FakeMemory:
    kind = "local"

    def __init__(self) -> None:
        self.items: list[MemoryHit] = []
        self.remember_calls = 0

    async def remember(self, text: str, *, tags: list[str]) -> None:
        self.remember_calls += 1
        await asyncio.sleep(0)
        self.items.append(MemoryHit(text=text, score=1.0, tags=list(tags), created_at=_now()))

    async def recall(self, query: str, *, tags: list[str] | None = None, k: int = 8) -> list[MemoryHit]:
        q = set(re.findall(r"[a-z0-9]+", (query or "").lower()))
        out = []
        for it in self.items:
            if tags and not (set(tags) & set(it.tags)):
                continue
            words = set(re.findall(r"[a-z0-9]+", it.text.lower()))
            score = len(q & words) / (len(q) or 1)
            out.append(MemoryHit(text=it.text, score=round(score, 3), tags=it.tags, created_at=it.created_at))
        out.sort(key=lambda h: -h.score)
        return out[:k]

    async def stats(self) -> dict[str, Any]:
        return {"items": len(self.items), "kind": self.kind}

    async def graph_html(self) -> str | None:
        return None

    async def healthy(self) -> bool:
        return True
