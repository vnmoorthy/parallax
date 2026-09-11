"""HotdataEngine — Hotdata Cloud over plain httpx (docs/SPEC.md §3.1 + research/HOTDATA.md).

Every call carries ``Authorization: Bearer`` + ``X-Workspace-Id``; queries/indexes add ``X-Database-Id``.
Tables are always referenced fully-qualified as ``default.public.<table>``. SQL is read-only on Hotdata,
rows are written through the ``/loads`` endpoint in ≤1.5 MiB CSV chunks (header re-sent on every chunk).
"""
from __future__ import annotations

import asyncio
import csv
import io
import logging
import re
import time
from typing import Any

import httpx

from app.config import settings
from app.data.base import DB, DataEngineError, LineageNode, QueryError, QueryResult, TableInfo
from app.data.local import jsonable, now_iso, prepare_sql

log = logging.getLogger("parallax.data.hotdata")

MAX_CHUNK_BYTES = int(1.5 * 1024 * 1024)
INDEX_POLL_INTERVAL_S = 2.0
INDEX_POLL_TIMEOUT_S = 120.0
RETRY_STATUSES = {429, 500, 502, 503, 504}
_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
_ID_LIKE = re.compile(r"(^id$|_id$|^rowid$|^__rowid$|^row_id$|^uuid$|^key$|^pk$)", re.IGNORECASE)


def _ident(name: str, what: str) -> str:
    if not isinstance(name, str) or not _IDENT_RE.match(name):
        raise DataEngineError(f"invalid {what} {name!r}: use letters, digits and underscores only")
    return name


def _sql_str(s: str) -> str:
    return "'" + str(s).replace("'", "''") + "'"


def chunk_csv(csv_text: str, max_bytes: int = MAX_CHUNK_BYTES) -> list[str]:
    """Split CSV text into chunks ≤ ``max_bytes`` (UTF-8), each starting with the header row.

    Records are parsed with the csv module so quoted fields containing newlines are never split.
    """
    reader = csv.reader(io.StringIO(csv_text))
    try:
        header = next(reader)
    except StopIteration:
        raise DataEngineError("CSV text is empty") from None

    def serialise(rows: list[list[str]]) -> str:
        buf = io.StringIO()
        csv.writer(buf, lineterminator="\n").writerows(rows)
        return buf.getvalue()

    header_text = serialise([header])
    header_len = len(header_text.encode("utf-8"))
    if header_len > max_bytes:
        raise DataEngineError("CSV header alone exceeds the per-request size limit")

    chunks: list[str] = []
    current: list[str] = []
    size = header_len
    for row in reader:
        line = serialise([row])
        n = len(line.encode("utf-8"))
        if header_len + n > max_bytes:
            raise DataEngineError("a single CSV row exceeds the per-request size limit")
        if size + n > max_bytes and current:
            chunks.append(header_text + "".join(current))
            current, size = [], header_len
        current.append(line)
        size += n
    chunks.append(header_text + "".join(current))
    return chunks


class HotdataEngine:
    kind = "hotdata"

    def __init__(self, *, api_url: str | None = None, api_key: str | None = None, workspace_id: str | None = None,
                 transport: httpx.AsyncBaseTransport | None = None, timeout: float = 60.0, max_retries: int = 3):
        self._api_url = (api_url or settings.hotdata_api_url).rstrip("/")
        self._api_key = api_key or settings.hotdata_api_key
        self._workspace_id = workspace_id or settings.hotdata_workspace_id
        if not (self._api_key and self._workspace_id):
            raise DataEngineError("Hotdata is not configured: set HOTDATA_API_KEY and HOTDATA_WORKSPACE_ID")
        self._max_retries = max(1, max_retries)
        self._client = httpx.AsyncClient(
            base_url=self._api_url,
            headers={"Authorization": f"Bearer {self._api_key}", "X-Workspace-Id": self._workspace_id,
                     "Accept": "application/json", "User-Agent": "parallax/0.1"},
            timeout=timeout, transport=transport)
        self._conn_ids: dict[str, str] = {}
        self._names: dict[str, str] = {}
        self._created: dict[str, str] = {}
        self._parents: dict[str, str | None] = {}
        self._column_cache: dict[tuple[str, str], list[str]] = {}

    async def aclose(self) -> None:
        await self._client.aclose()

    # ── HTTP plumbing ───────────────────────────────────────────────────────
    @staticmethod
    def _error_message(resp: httpx.Response) -> str:
        try:
            body = resp.json()
        except ValueError:
            return (resp.text or resp.reason_phrase or "").strip()[:400]
        if isinstance(body, dict):
            err = body.get("error")
            if isinstance(err, dict):
                code, msg = err.get("code"), err.get("message") or err.get("detail")
                return f"{code}: {msg}" if code and msg else str(msg or code or err)
            if isinstance(err, str):
                return err
            for key in ("message", "detail", "error_description"):
                if body.get(key):
                    return str(body[key])
        return str(body)[:400]

    async def _request(self, method: str, path: str, *, json: Any = None, headers: dict[str, str] | None = None,
                       params: dict[str, Any] | None = None, ok: set[int] | None = None,
                       error_cls: type[DataEngineError] = DataEngineError, retries: int | None = None) -> httpx.Response:
        attempts = retries if retries is not None else self._max_retries
        last_exc: Exception | None = None
        resp: httpx.Response | None = None
        for attempt in range(attempts):
            try:
                resp = await self._client.request(method, path, json=json, headers=headers, params=params)
            except httpx.HTTPError as exc:
                last_exc = exc
                log.warning("hotdata %s %s transport error (attempt %d/%d): %s", method, path, attempt + 1, attempts, exc)
                if attempt + 1 < attempts:
                    await asyncio.sleep(0.5 * (2 ** attempt))
                continue
            if resp.status_code in RETRY_STATUSES and attempt + 1 < attempts:
                delay = 0.5 * (2 ** attempt)
                ra = resp.headers.get("Retry-After")
                if ra and ra.isdigit():
                    delay = min(float(ra), 10.0)
                log.warning("hotdata %s %s → %d, retrying in %.1fs", method, path, resp.status_code, delay)
                await asyncio.sleep(delay)
                continue
            break
        if resp is None:
            raise DataEngineError(f"Hotdata unreachable ({method} {path}): {last_exc}") from last_exc
        allowed = ok if ok is not None else set(range(200, 300))
        if resp.status_code not in allowed:
            msg = self._error_message(resp)
            raise error_cls(f"Hotdata {method} {path} failed ({resp.status_code}): {msg}")
        return resp

    @staticmethod
    def _json(resp: httpx.Response) -> Any:
        if not resp.content:
            return {}
        try:
            return resp.json()
        except ValueError as exc:
            raise DataEngineError(f"Hotdata returned non-JSON body: {resp.text[:200]}") from exc

    def _remember(self, db_id: str, body: dict[str, Any], *, name: str, parent_id: str | None) -> None:
        conn = body.get("default_connection_id") or body.get("connection_id")
        if conn:
            self._conn_ids[db_id] = str(conn)
        self._names[db_id] = body.get("name") or name
        self._created[db_id] = str(body.get("created_at") or now_iso())
        self._parents[db_id] = parent_id

    async def _connection_id(self, db_id: str) -> str:
        conn = self._conn_ids.get(db_id)
        if conn:
            return conn
        body = self._json(await self._request("GET", f"/databases/{db_id}"))
        conn = body.get("default_connection_id") or body.get("connection_id")
        if not conn:
            raise DataEngineError(f"database {db_id} has no default_connection_id (cannot manage indexes)")
        self._conn_ids[db_id] = str(conn)
        self._names.setdefault(db_id, body.get("name") or db_id)
        return str(conn)

    # ── DataEngine API ──────────────────────────────────────────────────────
    async def create_database(self, name: str, *, expires: str = "24h") -> DB:
        body = {"name": name, "expires_at": expires,
                "schemas": [{"name": "public", "tables": [{"name": "data"}]}]}
        data = self._json(await self._request("POST", "/databases", json=body))
        db_id = data.get("id")
        if not db_id:
            raise DataEngineError(f"Hotdata create_database returned no id: {data}")
        self._remember(db_id, data, name=name, parent_id=None)
        return DB(id=db_id, name=self._names[db_id], parent_id=None, created_at=self._created[db_id],
                  expires_at=data.get("expires_at"), connection_id=self._conn_ids.get(db_id))

    async def fork(self, db_id: str, name: str) -> DB:
        data = self._json(await self._request("POST", f"/databases/{db_id}/fork", json={"name": name, "expires_at": "24h"}))
        new_id = data.get("id")
        if not new_id:
            raise DataEngineError(f"Hotdata fork returned no id: {data}")
        self._remember(new_id, data, name=name, parent_id=db_id)
        forked_from = data.get("forked_from") or {}
        created = forked_from.get("forked_at") or self._created[new_id]
        self._created[new_id] = str(created)
        return DB(id=new_id, name=self._names[new_id], parent_id=db_id, created_at=str(created),
                  expires_at=data.get("expires_at"), connection_id=self._conn_ids.get(new_id))

    async def load_csv(self, db_id: str, table: str, csv_text: str, *, mode: str = "replace",
                       columns: dict[str, str] | None = None) -> int:
        _ident(table, "table name")
        mode = (mode or "replace").lower()
        if mode not in ("replace", "append", "upsert"):
            raise DataEngineError(f"unsupported load mode {mode!r}")
        chunks = await asyncio.to_thread(chunk_csv, csv_text)
        total = 0
        path = f"/databases/{db_id}/schemas/public/tables/{table}/loads"
        for i, chunk in enumerate(chunks):
            body: dict[str, Any] = {"mode": mode if i == 0 else "append", "data": chunk}
            if columns:
                body["columns"] = columns
            data = self._json(await self._request("POST", path, json=body))
            total += int(data.get("row_count") or 0)
            conn = data.get("connection_id")
            if conn and db_id not in self._conn_ids:
                self._conn_ids[db_id] = str(conn)
        self._column_cache.pop((db_id, table), None)
        return total

    async def query(self, db_id: str, sql: str, *, limit: int = 200) -> QueryResult:
        prepared = prepare_sql(sql, limit)
        t0 = time.perf_counter()
        resp = await self._request("POST", "/query", json={"sql": prepared}, headers={"X-Database-Id": db_id},
                                   error_cls=QueryError)
        wall_ms = (time.perf_counter() - t0) * 1000.0
        data = self._json(resp)
        raw_cols = data.get("columns") or []
        columns = [str(c.get("name", "")) if isinstance(c, dict) else str(c) for c in raw_cols]
        rows = data.get("rows") or []
        if rows and isinstance(rows[0], dict):
            if not columns:
                columns = list(rows[0].keys())
            rows = [[r.get(c) for c in columns] for r in rows]
        rows = [[jsonable(v) for v in (r if isinstance(r, (list, tuple)) else [r])] for r in rows]
        total = data.get("total_row_count")
        row_count = int(total) if isinstance(total, (int, float)) else len(rows)
        truncated = bool(data.get("truncated")) or len(rows) > limit
        elapsed = data.get("execution_time_ms")
        elapsed_ms = float(elapsed) if isinstance(elapsed, (int, float)) else wall_ms
        return QueryResult(columns=columns, rows=rows[:limit], row_count=row_count, elapsed_ms=round(elapsed_ms, 3),
                           truncated=truncated, sql=prepared)

    async def tables(self, db_id: str) -> list[TableInfo]:
        res = await self.query(
            db_id,
            "SELECT table_name, column_name, data_type FROM information_schema.columns "
            "WHERE table_schema = 'public' ORDER BY table_name, ordinal_position",
            limit=10000)
        grouped: dict[str, list[tuple[str, str]]] = {}
        for t, c, ty in res.rows:
            grouped.setdefault(str(t), []).append((str(c), str(ty)))
        out: list[TableInfo] = []
        for t, cols in grouped.items():
            self._column_cache[(db_id, t)] = [c for c, _ in cols]
            count: int | None = None
            try:
                cnt = await self.query(db_id, f"SELECT COUNT(*) AS n FROM {self.table_ref(db_id, t)}", limit=1)
                if cnt.rows and cnt.rows[0]:
                    count = int(cnt.rows[0][0])
            except DataEngineError as exc:
                log.warning("row count for %s failed: %s", t, exc)
            out.append(TableInfo(name=t, columns=cols, row_count=count))
        return out

    async def create_index(self, db_id: str, table: str, column: str, kind: str) -> str:
        _ident(table, "table name")
        kind = (kind or "").lower()
        if kind not in ("bm25", "vector"):
            raise DataEngineError(f"unsupported index kind {kind!r} (use bm25|vector)")
        conn = await self._connection_id(db_id)
        index_name = f"{table}_{re.sub(r'[^A-Za-z0-9_]', '_', column)}_{kind}"
        body: dict[str, Any] = {"index_name": index_name, "columns": [column], "index_type": kind}
        if kind == "vector":
            body["metric"] = "cosine"
        path = f"/connections/{conn}/tables/public/{table}/indexes"
        headers = {"X-Database-Id": db_id}
        resp = await self._request("POST", path, json=body, headers=headers, ok={200, 201, 202, 409})
        if resp.status_code == 409:
            log.info("index %s already exists on %s — waiting until ready", index_name, table)
        elif resp.status_code in (200, 201):
            status = str((self._json(resp) or {}).get("status") or "ready").lower()
            if status == "ready":
                return index_name
        deadline = time.monotonic() + INDEX_POLL_TIMEOUT_S
        while True:
            listing = self._json(await self._request("GET", path, headers=headers))
            items = listing if isinstance(listing, list) else (listing.get("items") or listing.get("indexes") or [])
            status: str | None = None
            for item in items:
                if isinstance(item, dict) and (item.get("index_name") or item.get("name")) == index_name:
                    status = str(item.get("status") or "").lower()
                    if status in ("failed", "error"):
                        raise DataEngineError(f"index {index_name} failed: {item.get('error') or item.get('message') or 'unknown error'}")
                    break
            if status == "ready":
                return index_name
            if time.monotonic() >= deadline:
                raise DataEngineError(f"index {index_name} not ready after {int(INDEX_POLL_TIMEOUT_S)}s (status={status})")
            await asyncio.sleep(INDEX_POLL_INTERVAL_S)

    async def _search_columns(self, db_id: str, table: str, column: str) -> list[str]:
        cols = self._column_cache.get((db_id, table))
        if cols is None:
            res = await self.query(
                db_id,
                "SELECT column_name FROM information_schema.columns "
                f"WHERE table_schema = 'public' AND table_name = {_sql_str(table)} ORDER BY ordinal_position",
                limit=10000)
            cols = [str(r[0]) for r in res.rows]
            if cols:
                self._column_cache[(db_id, table)] = cols
        ids = [c for c in cols if _ID_LIKE.search(c) and c != column]
        if not ids and cols and cols[0] != column:
            ids = [cols[0]]
        out: list[str] = []
        for c in ids + [column]:
            if c not in out:
                out.append(c)
        return out

    async def bm25_search(self, db_id: str, table: str, column: str, q: str, k: int = 10) -> QueryResult:
        _ident(table, "table name")
        k = max(1, int(k))
        cols = await self._search_columns(db_id, table, column)
        select = ", ".join(f'"{c}"' for c in cols)
        sql = (f"SELECT {select}, score FROM bm25_search({_sql_str(self.table_ref(db_id, table))}, "
               f"{_sql_str(column)}, {_sql_str(q)}, {k}) ORDER BY score DESC")
        return await self.query(db_id, sql, limit=k)

    async def vector_search(self, db_id: str, table: str, column: str, q: str, k: int = 10) -> QueryResult:
        _ident(table, "table name")
        k = max(1, int(k))
        cols = await self._search_columns(db_id, table, column)
        select = ", ".join(f'"{c}"' for c in cols)
        sql = (f"SELECT {select}, _distance FROM vector_search({_sql_str(self.table_ref(db_id, table))}, "
               f"{_sql_str(column)}, {_sql_str(q)}, {k}) ORDER BY _distance ASC")
        return await self.query(db_id, sql, limit=k)

    async def lineage(self, db_id: str) -> list[LineageNode]:
        mine = self._json(await self._request("GET", f"/databases/{db_id}/lineage", params={"forks_limit": 100}))
        root_id = str(mine.get("root_id") or db_id)
        root_view = mine if root_id == db_id else self._json(
            await self._request("GET", f"/databases/{root_id}/lineage", params={"forks_limit": 100}))

        nodes: dict[str, LineageNode] = {}

        def put(nid: str, parent: str | None, created: str | None, exists: bool = True) -> None:
            nid = str(nid)
            existing = nodes.get(nid)
            if existing is None:
                nodes[nid] = LineageNode(id=nid, name=self._names.get(nid, nid), parent_id=parent,
                                         created_at=str(created or self._created.get(nid) or ""), exists=exists)
            else:
                if existing.parent_id is None and parent:
                    existing.parent_id = parent
                if not existing.created_at and created:
                    existing.created_at = str(created)
                existing.exists = existing.exists and exists

        def entry_id(e: Any) -> str | None:
            if isinstance(e, str):
                return e
            if isinstance(e, dict):
                return e.get("database_id") or e.get("id")
            return None

        put(root_id, None, None)
        # ancestors: nearest first → chain requested db → … → root
        chain = [db_id] + [i for i in (entry_id(a) for a in (mine.get("ancestors") or [])) if i]
        for i, nid in enumerate(chain):
            parent = chain[i + 1] if i + 1 < len(chain) else (None if nid == root_id else root_id)
            src = (mine.get("ancestors") or [])[i - 1] if i > 0 else None
            exists = bool(src.get("exists", True)) if isinstance(src, dict) else True
            put(nid, parent if parent != nid else None, None, exists)
        # direct forks of the root and of the requested database
        for owner, view in ((root_id, root_view), (db_id, mine)):
            for f in view.get("forks") or []:
                fid = entry_id(f)
                if not fid:
                    continue
                created = f.get("forked_at") if isinstance(f, dict) else None
                exists = bool(f.get("exists", True)) if isinstance(f, dict) else True
                put(fid, owner, created, exists)
        # locally-known children (this process forked them) that the API sample may have omitted
        for child, parent in self._parents.items():
            if parent and parent in nodes and child not in nodes:
                put(child, parent, self._created.get(child))
        ordered = sorted(nodes.values(), key=lambda n: (n.id != root_id, n.created_at, n.id))
        return ordered

    async def set_context(self, db_id: str, name: str, content: str) -> None:
        await self._request("POST", f"/databases/{db_id}/context", json={"name": name, "content": content})

    async def get_context(self, db_id: str) -> dict[str, str]:
        data = self._json(await self._request("GET", f"/databases/{db_id}/context"))
        items = data if isinstance(data, list) else (data.get("contexts") or data.get("items") or [])
        out: dict[str, str] = {}
        for item in items:
            if isinstance(item, dict) and item.get("name"):
                out[str(item["name"])] = str(item.get("content") or "")
        return out

    async def delete(self, db_id: str) -> None:
        await self._request("DELETE", f"/databases/{db_id}", ok={200, 202, 204, 404})
        self._conn_ids.pop(db_id, None)

    async def healthy(self) -> bool:
        try:
            resp = await self._client.get("/databases", timeout=10.0)
            return 200 <= resp.status_code < 300
        except Exception as exc:  # noqa: BLE001 — health must never raise
            log.info("hotdata health check failed: %s", exc)
            return False

    def table_ref(self, db_id: str, table: str) -> str:
        return f"default.public.{table}"
