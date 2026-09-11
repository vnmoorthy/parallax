"""LocalEngine — one DuckDB file per database (docs/SPEC.md §3.1, "Local engine").

Also hosts two helpers shared by the rest of the core because they have no better home inside the
ownership boundaries: ``prepare_sql`` (read-only SQL guardrails, used by both engines) and ``Embedder``
(ollama ``nomic-embed-text`` with a deterministic hashed fallback, used by vector search and LocalMemory).

Concurrency model
-----------------
* One long-lived ``duckdb`` connection per database file, cached; every operation runs on
  ``connection.cursor()`` (a thread-safe duplicate connection) inside ``asyncio.to_thread``.
* Reads never take a lock (DuckDB MVCC). Writes, index builds and forks take a per-DB ``threading.RLock``.
* ``manifest.json`` (lineage + contexts + index metadata) is guarded by an ``asyncio.Lock`` and written
  atomically (tmp file + ``os.replace``).
"""
from __future__ import annotations

import asyncio
import datetime as dt
import decimal
import hashlib
import io
import json
import logging
import math
import os
import re
import secrets
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Any

import duckdb
import httpx
import numpy as np
import pandas as pd
import pyarrow as pa

from app.config import settings
from app.data.base import DB, DataEngineError, LineageNode, QueryError, QueryResult, TableInfo

log = logging.getLogger("parallax.data.local")

EMBED_DIM = 768
ROWID = "__rowid"
EMB_SUFFIX = "__emb"

_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
_DB_ID_RE = re.compile(r"^loc_[0-9a-f]{12}$")
_SELECT_RE = re.compile(r"^\s*(select|with|from)\b", re.IGNORECASE)
_LIMIT_RE = re.compile(r"\blimit\s+\d+", re.IGNORECASE)
_DURATION_RE = re.compile(r"^\s*(\d+)\s*([smhd])\s*$", re.IGNORECASE)


# ─────────────────────────────────────────────────────────────────────────────
# Shared helpers
# ─────────────────────────────────────────────────────────────────────────────
def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def parse_duration(spec: str | None, default_hours: int = 24) -> dt.timedelta:
    """'24h' | '7d' | '30m' | '90s' → timedelta (falls back to ``default_hours``)."""
    m = _DURATION_RE.match(spec or "")
    if not m:
        return dt.timedelta(hours=default_hours)
    n, unit = int(m.group(1)), m.group(2).lower()
    return {"s": dt.timedelta(seconds=n), "m": dt.timedelta(minutes=n),
            "h": dt.timedelta(hours=n), "d": dt.timedelta(days=n)}[unit]


def _strip_sql_comments(sql: str) -> str:
    out: list[str] = []
    i, n = 0, len(sql)
    in_str: str | None = None
    while i < n:
        ch = sql[i]
        if in_str:
            out.append(ch)
            if ch == in_str:
                in_str = None
            i += 1
            continue
        if ch in ("'", '"'):
            in_str = ch
            out.append(ch)
            i += 1
        elif sql.startswith("--", i):
            j = sql.find("\n", i)
            i = n if j == -1 else j
        elif sql.startswith("/*", i):
            j = sql.find("*/", i + 2)
            i = n if j == -1 else j + 2
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def _has_statement_separator(sql: str) -> bool:
    in_str: str | None = None
    for ch in sql:
        if in_str:
            if ch == in_str:
                in_str = None
        elif ch in ("'", '"'):
            in_str = ch
        elif ch == ";":
            return True
    return False


def prepare_sql(sql: str, limit: int) -> str:
    """Read-only guardrails shared by both engines.

    * strips comments and trailing semicolons
    * rejects anything that is not a single SELECT / WITH statement
    * appends ``LIMIT <limit>`` when the statement carries no LIMIT
    """
    s = _strip_sql_comments(sql or "").strip()
    while s.endswith(";"):
        s = s[:-1].rstrip()
    if not s:
        raise QueryError("empty SQL statement")
    if _has_statement_separator(s):
        raise QueryError("only a single statement is allowed (remove the ';')")
    if not _SELECT_RE.match(s):
        raise QueryError("only read-only SELECT / WITH statements are allowed")
    if not _LIMIT_RE.search(s):
        s = f"{s}\nLIMIT {max(1, int(limit))}"
    return s


def jsonable(v: Any) -> Any:
    """Convert DuckDB / numpy / pandas scalars into JSON-safe python values."""
    if v is None or isinstance(v, (bool, int, str)):
        return v
    if isinstance(v, float):
        return v if math.isfinite(v) else None
    if isinstance(v, decimal.Decimal):
        f = float(v)
        return f if math.isfinite(f) else None
    if isinstance(v, (dt.datetime, dt.date, dt.time)):
        return v.isoformat()
    if isinstance(v, dt.timedelta):
        return v.total_seconds()
    if isinstance(v, np.generic):
        return jsonable(v.item())
    if isinstance(v, np.ndarray):
        return [jsonable(x) for x in v.tolist()]
    if isinstance(v, (list, tuple)):
        return [jsonable(x) for x in v]
    if isinstance(v, dict):
        return {str(k): jsonable(x) for k, x in v.items()}
    if isinstance(v, (bytes, bytearray)):
        return v.decode("utf-8", "replace")
    if isinstance(v, uuid.UUID):
        return str(v)
    if v is pd.NaT or v is pd.NA:
        return None
    return str(v)


def _ident(name: str, what: str = "identifier") -> str:
    if not isinstance(name, str) or not _IDENT_RE.match(name):
        raise DataEngineError(f"invalid {what} {name!r}: use letters, digits and underscores only")
    return name


def _q(name: str) -> str:
    """Quote an arbitrary column name for DuckDB."""
    if '"' in name:
        raise DataEngineError(f"column name {name!r} may not contain double quotes")
    return f'"{name}"'


_TOKEN_RE = re.compile(r"[a-z0-9]+")


def hashed_embedding(text: str, dim: int = EMBED_DIM) -> list[float]:
    """Deterministic hashed bag-of-words (unigrams + bigrams), L2-normalised. Works fully offline."""
    vec = np.zeros(dim, dtype=np.float32)
    toks = _TOKEN_RE.findall((text or "").lower())
    grams = [(t, 1.0) for t in toks] + [(f"{a} {b}", 0.5) for a, b in zip(toks, toks[1:])]
    for gram, w in grams:
        h = hashlib.blake2b(gram.encode("utf-8"), digest_size=8).digest()
        idx = int.from_bytes(h[:4], "little") % dim
        sign = 1.0 if h[4] & 1 else -1.0
        vec[idx] += sign * w
    norm = float(np.linalg.norm(vec))
    if norm > 0:
        vec /= norm
    return vec.astype(np.float32).tolist()


class Embedder:
    """Text → 768-dim vectors.

    Uses ollama (``/api/embed`` batch endpoint, falling back to the legacy ``/api/embeddings``) when the host
    is reachable and the model is present; otherwise a deterministic hashed embedding so vector search still
    works offline. The method actually used is returned so callers can persist it and embed queries the same way.
    """

    HASHED = "hashed"

    def __init__(self, ollama_host: str | None = None, model: str | None = None, *,
                 concurrency: int = 2, max_chars: int = 1000, batch_size: int = 256, timeout: float = 180.0,
                 offline: bool = False):
        """``offline=True`` never touches the network (hashed embeddings only) — used by tests and CI.

        Defaults were benchmarked against ollama 0.18 / nomic-embed-text on an M-series Mac: large batches win
        (≈13 ms/text at batch 256 vs ≈17 ms/text at batch 32 × 4 workers) because ollama serialises requests.
        """
        host = None if offline else (ollama_host or settings.ollama_host)
        self._host = host.rstrip("/") if host else None
        self._model = model or settings.ollama_embed_model
        self._concurrency = max(1, concurrency)
        self._max_chars = max_chars
        self._batch_size = max(1, batch_size)
        self._timeout = timeout
        self._ollama_ok: bool | None = None if self._host else False
        self._probe_lock: asyncio.Lock | None = None
        self._probe_loop: asyncio.AbstractEventLoop | None = None

    @property
    def ollama_method(self) -> str:
        return f"ollama:{self._model}"

    def _lock(self) -> asyncio.Lock:
        loop = asyncio.get_running_loop()
        if self._probe_lock is None or self._probe_loop is not loop:
            self._probe_lock, self._probe_loop = asyncio.Lock(), loop
        return self._probe_lock

    async def available(self) -> bool:
        """True when ollama is reachable and the embedding model is present (cached)."""
        if self._ollama_ok is not None:
            return self._ollama_ok
        async with self._lock():
            if self._ollama_ok is not None:
                return self._ollama_ok
            ok = False
            try:
                async with httpx.AsyncClient(timeout=3.0) as client:
                    r = await client.get(f"{self._host}/api/tags")
                if r.status_code == 200:
                    names = [m.get("name") or m.get("model") or "" for m in r.json().get("models", [])]
                    ok = any(n == self._model or n.startswith(self._model + ":") for n in names)
                    if not ok:
                        log.warning("ollama reachable but embedding model %r missing → hashed embeddings", self._model)
            except Exception as exc:  # noqa: BLE001 — offline is a supported mode
                log.info("ollama not reachable at %s (%s) → hashed embeddings", self._host, exc)
            self._ollama_ok = ok
            return ok

    async def embed_many(self, texts: list[str], *, method: str | None = None) -> tuple[list[list[float]], str]:
        """Embed ``texts``. Returns ``(vectors, method)``.

        ``method`` forces a specific method (``"hashed"`` or ``"ollama:<model>"``) so query vectors match the
        index they are compared against.
        """
        clipped = [(t if isinstance(t, str) else ("" if t is None else str(t)))[: self._max_chars] for t in texts]
        if method is None:
            use_ollama = await self.available()
        else:
            use_ollama = method.startswith("ollama")
            if use_ollama and not await self.available():
                raise DataEngineError(
                    f"this vector index was built with {method} embeddings but ollama is not reachable at {self._host}")
        if use_ollama:
            try:
                return await self._ollama_many(clipped), self.ollama_method
            except DataEngineError:
                raise
            except Exception as exc:  # noqa: BLE001
                if method is not None:
                    raise DataEngineError(f"ollama embedding failed: {exc}") from exc
                log.warning("ollama embedding failed (%s) → hashed embeddings", exc)
                self._ollama_ok = False
        return [hashed_embedding(t) for t in clipped], self.HASHED

    async def embed(self, text: str, *, method: str | None = None) -> tuple[list[float], str]:
        vecs, m = await self.embed_many([text], method=method)
        return vecs[0], m

    async def _ollama_many(self, texts: list[str]) -> list[list[float]]:
        out: list[list[float] | None] = [None] * len(texts)
        todo = [i for i, t in enumerate(texts) if t.strip()]
        for i in range(len(texts)):
            if i not in todo:
                out[i] = [0.0] * EMBED_DIM
        batches = [todo[i:i + self._batch_size] for i in range(0, len(todo), self._batch_size)]
        sem = asyncio.Semaphore(self._concurrency)
        legacy = {"on": False}

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            async def run(batch: list[int]) -> None:
                async with sem:
                    vecs = await self._embed_batch(client, [texts[i] for i in batch], legacy)
                    for i, v in zip(batch, vecs):
                        out[i] = v

            await asyncio.gather(*(run(b) for b in batches))
        return [v if v is not None else [0.0] * EMBED_DIM for v in out]

    async def _embed_batch(self, client: httpx.AsyncClient, batch: list[str], legacy: dict[str, bool]) -> list[list[float]]:
        if not legacy["on"]:
            r = await client.post(f"{self._host}/api/embed", json={"model": self._model, "input": batch})
            if r.status_code == 200:
                vecs = r.json().get("embeddings") or []
                if len(vecs) == len(batch):
                    return [self._check_dim(v) for v in vecs]
            elif r.status_code != 404:
                raise DataEngineError(f"ollama /api/embed {r.status_code}: {r.text[:200]}")
            legacy["on"] = True
        vecs: list[list[float]] = []
        for text in batch:  # legacy endpoint: one prompt per call
            r = await client.post(f"{self._host}/api/embeddings", json={"model": self._model, "prompt": text})
            if r.status_code != 200:
                raise DataEngineError(f"ollama /api/embeddings {r.status_code}: {r.text[:200]}")
            vecs.append(self._check_dim(r.json().get("embedding") or []))
        return vecs

    @staticmethod
    def _check_dim(v: list[float]) -> list[float]:
        if len(v) != EMBED_DIM:
            raise DataEngineError(f"embedding model returned {len(v)} dims, expected {EMBED_DIM} (use nomic-embed-text)")
        return [float(x) for x in v]


# ─────────────────────────────────────────────────────────────────────────────
# LocalEngine
# ─────────────────────────────────────────────────────────────────────────────
class LocalEngine:
    kind = "local"

    def __init__(self, dbs_dir: Path | str | None = None, *, embedder: Embedder | None = None):
        self._dir = Path(dbs_dir) if dbs_dir else settings.dbs_dir
        self._dir.mkdir(parents=True, exist_ok=True)
        self._manifest_path = self._dir / "manifest.json"
        self._embedder = embedder or Embedder()
        self._cons: dict[str, duckdb.DuckDBPyConnection] = {}
        self._wlocks: dict[str, threading.RLock] = {}
        self._cons_guard = threading.Lock()
        self._mlock: asyncio.Lock | None = None
        self._mlock_loop: asyncio.AbstractEventLoop | None = None

    # ── manifest ────────────────────────────────────────────────────────────
    def _manifest_lock(self) -> asyncio.Lock:
        loop = asyncio.get_running_loop()
        if self._mlock is None or self._mlock_loop is not loop:
            self._mlock, self._mlock_loop = asyncio.Lock(), loop
        return self._mlock

    def _read_manifest(self) -> dict[str, Any]:
        if not self._manifest_path.exists():
            return {"dbs": {}}
        try:
            data = json.loads(self._manifest_path.read_text("utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            log.error("manifest.json unreadable (%s) — starting empty", exc)
            return {"dbs": {}}
        data.setdefault("dbs", {})
        return data

    def _write_manifest(self, data: dict[str, Any]) -> None:
        tmp = self._manifest_path.with_suffix(f".json.{os.getpid()}.{secrets.token_hex(4)}.tmp")
        tmp.write_text(json.dumps(data, indent=2, sort_keys=True), "utf-8")
        os.replace(tmp, self._manifest_path)

    async def _with_manifest(self, fn):  # fn(manifest) -> result; persists when fn returns (result, True)
        async with self._manifest_lock():
            data = self._read_manifest()
            result, dirty = fn(data)
            if dirty:
                self._write_manifest(data)
            return result

    def _entry(self, manifest: dict[str, Any], db_id: str) -> dict[str, Any]:
        entry = manifest["dbs"].get(db_id)
        if entry is None:
            raise DataEngineError(f"database {db_id!r} not found")
        return entry

    async def _get_entry(self, db_id: str) -> dict[str, Any]:
        return await self._with_manifest(lambda m: (dict(self._entry(m, db_id)), False))

    @staticmethod
    def _to_db(entry: dict[str, Any]) -> DB:
        return DB(id=entry["id"], name=entry["name"], parent_id=entry.get("parent_id"),
                  created_at=entry.get("created_at", ""), expires_at=entry.get("expires_at"), connection_id=None)

    # ── connections ─────────────────────────────────────────────────────────
    def _path(self, db_id: str) -> Path:
        if not _DB_ID_RE.match(db_id or ""):
            raise DataEngineError(f"invalid local database id {db_id!r}")
        return self._dir / f"{db_id}.duckdb"

    def _con(self, db_id: str) -> duckdb.DuckDBPyConnection:
        path = self._path(db_id)
        with self._cons_guard:
            con = self._cons.get(db_id)
            if con is None:
                if not path.exists():
                    raise DataEngineError(f"database {db_id!r} not found")
                con = duckdb.connect(str(path))
                self._cons[db_id] = con
                self._wlocks.setdefault(db_id, threading.RLock())
            return con

    def _wlock(self, db_id: str) -> threading.RLock:
        with self._cons_guard:
            return self._wlocks.setdefault(db_id, threading.RLock())

    def _close(self, db_id: str) -> None:
        with self._cons_guard:
            con = self._cons.pop(db_id, None)
        if con is not None:
            try:
                con.close()
            except Exception:  # noqa: BLE001
                pass

    # ── low-level sync workers (run via asyncio.to_thread) ──────────────────
    def _read(self, db_id: str, sql: str, params: list[Any] | None = None) -> tuple[list[str], list[tuple], float]:
        con = self._con(db_id)
        cur = con.cursor()
        try:
            t0 = time.perf_counter()
            res = cur.execute(sql, params or [])
            rows = res.fetchall()
            cols = [d[0] for d in (res.description or [])]
            return cols, rows, (time.perf_counter() - t0) * 1000.0
        finally:
            cur.close()

    def _columns(self, cur: duckdb.DuckDBPyConnection, table: str) -> list[tuple[str, str]]:
        return cur.execute(
            "SELECT column_name, data_type FROM information_schema.columns "
            "WHERE table_schema = 'main' AND table_name = ? ORDER BY ordinal_position", [table]).fetchall()

    def _table_exists(self, cur: duckdb.DuckDBPyConnection, table: str) -> bool:
        return cur.execute(
            "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'main' AND table_name = ?",
            [table]).fetchone()[0] > 0

    def _fts_exists(self, cur: duckdb.DuckDBPyConnection, table: str) -> bool:
        return cur.execute("SELECT count(*) FROM information_schema.schemata WHERE schema_name = ?",
                           [f"fts_main_{table}"]).fetchone()[0] > 0

    def _fts_field(self, cur: duckdb.DuckDBPyConnection, table: str) -> str | None:
        try:
            row = cur.execute(f'SELECT field FROM "fts_main_{table}".fields ORDER BY fieldid LIMIT 1').fetchone()
            return row[0] if row else None
        except duckdb.Error:
            return None

    @staticmethod
    def _load_fts(cur: duckdb.DuckDBPyConnection) -> None:
        try:
            cur.execute("LOAD fts")
        except duckdb.Error:
            cur.execute("INSTALL fts")
            cur.execute("LOAD fts")

    def _build_fts(self, cur: duckdb.DuckDBPyConnection, table: str, column: str) -> None:
        self._load_fts(cur)
        col = column.replace("'", "''")
        cur.execute(f"PRAGMA create_fts_index('{table}', '{ROWID}', '{col}', overwrite=1)")

    # ── DataEngine API ──────────────────────────────────────────────────────
    async def create_database(self, name: str, *, expires: str = "24h") -> DB:
        db_id = f"loc_{secrets.token_hex(6)}"
        path = self._path(db_id)
        created = now_iso()
        expires_at = (dt.datetime.now(dt.timezone.utc) + parse_duration(expires)).replace(microsecond=0).isoformat()

        def _create() -> None:
            duckdb.connect(str(path)).close()

        await asyncio.to_thread(_create)
        entry = {"id": db_id, "name": name, "parent_id": None, "created_at": created, "expires_at": expires_at,
                 "contexts": {}, "vector_methods": {}}

        def _add(m: dict[str, Any]):
            m["dbs"][db_id] = entry
            return self._to_db(entry), True

        return await self._with_manifest(_add)

    async def fork(self, db_id: str, name: str) -> DB:
        parent = await self._get_entry(db_id)
        src, new_id = self._path(db_id), f"loc_{secrets.token_hex(6)}"
        dst = self._path(new_id)

        def _copy() -> None:
            con = self._con(db_id)
            with self._wlock(db_id):
                cur = con.cursor()
                try:
                    last: Exception | None = None
                    for _ in range(5):  # CHECKPOINT can transiently fail while another writer commits
                        try:
                            cur.execute("CHECKPOINT")
                            last = None
                            break
                        except duckdb.Error as exc:
                            last = exc
                            time.sleep(0.05)
                    if last is not None:
                        raise DataEngineError(f"checkpoint before fork failed: {last}") from last
                finally:
                    cur.close()
                shutil.copy2(src, dst)
                wal = Path(str(src) + ".wal")
                if wal.exists() and wal.stat().st_size > 0:  # belt and braces: WAL should be empty post-checkpoint
                    shutil.copy2(wal, str(dst) + ".wal")

        await asyncio.to_thread(_copy)
        entry = {"id": new_id, "name": name, "parent_id": db_id, "created_at": now_iso(),
                 "expires_at": parent.get("expires_at"), "contexts": {},
                 "vector_methods": dict(parent.get("vector_methods") or {})}

        def _add(m: dict[str, Any]):
            m["dbs"][new_id] = entry
            return self._to_db(entry), True

        return await self._with_manifest(_add)

    async def load_csv(self, db_id: str, table: str, csv_text: str, *, mode: str = "replace",
                       columns: dict[str, str] | None = None) -> int:
        _ident(table, "table name")
        mode = (mode or "replace").lower()
        if mode not in ("replace", "append"):
            raise DataEngineError(f"unsupported load mode {mode!r} (use replace|append)")
        await self._get_entry(db_id)
        df = await asyncio.to_thread(self._parse_csv, csv_text)
        n = await asyncio.to_thread(self._load_df, db_id, table, df, mode, columns or {})
        if mode == "replace":  # replacing a table invalidates any embedding metadata recorded for it
            def _forget(m: dict[str, Any]):
                vm = self._entry(m, db_id).setdefault("vector_methods", {})
                keys = [key for key in vm if key.split(".", 1)[0] == table]
                for key in keys:
                    vm.pop(key, None)
                return None, bool(keys)

            await self._with_manifest(_forget)
        return n

    @staticmethod
    def _parse_csv(csv_text: str) -> pd.DataFrame:
        if not csv_text or not csv_text.strip():
            raise DataEngineError("CSV text is empty")
        try:
            df = pd.read_csv(io.StringIO(csv_text), skip_blank_lines=True)
        except Exception as exc:  # noqa: BLE001 — pandas raises many parser error types
            raise DataEngineError(f"could not parse CSV: {exc}") from exc
        df.columns = [str(c).strip() for c in df.columns]
        if any(c == "" for c in df.columns):
            raise DataEngineError("CSV header contains an empty column name")
        return df

    def _load_df(self, db_id: str, table: str, df: pd.DataFrame, mode: str, columns: dict[str, str]) -> int:
        con = self._con(db_id)
        with self._wlock(db_id):
            cur = con.cursor()
            try:
                exists = self._table_exists(cur, table)
                start = 1
                if mode == "append" and exists and ROWID in {c for c, _ in self._columns(cur, table)}:
                    start = int(cur.execute(f'SELECT COALESCE(MAX({_q(ROWID)}), 0) FROM {_q(table)}').fetchone()[0]) + 1
                if ROWID not in df.columns:
                    df = df.copy()
                    df[ROWID] = np.arange(start, start + len(df), dtype=np.int64)
                view = f"__parallax_load_{secrets.token_hex(4)}"
                cur.register(view, df)
                try:
                    select = ", ".join(
                        f"CAST({_q(c)} AS {columns[c]}) AS {_q(c)}" if c in columns and _IDENT_RE.match(columns[c].split('(')[0].strip())
                        else _q(c)
                        for c in df.columns)
                    if mode == "replace" or not exists:
                        if exists and self._fts_exists(cur, table):
                            self._load_fts(cur)
                            cur.execute(f"PRAGMA drop_fts_index('{table}')")
                        cur.execute(f"CREATE OR REPLACE TABLE {_q(table)} AS SELECT {select} FROM {view}")
                    else:
                        cur.execute(f"INSERT INTO {_q(table)} BY NAME SELECT {select} FROM {view}")
                        if self._fts_exists(cur, table):  # keep BM25 fresh after appends
                            field = self._fts_field(cur, table)
                            if field:
                                self._build_fts(cur, table, field)
                finally:
                    cur.unregister(view)
            except duckdb.Error as exc:
                raise DataEngineError(f"load into {table!r} failed: {exc}") from exc
            finally:
                cur.close()
        return int(len(df))

    async def query(self, db_id: str, sql: str, *, limit: int = 200) -> QueryResult:
        prepared = prepare_sql(sql, limit)
        await self._get_entry(db_id)
        try:
            cols, rows, elapsed = await asyncio.to_thread(self._read, db_id, prepared)
        except DataEngineError:
            raise
        except duckdb.Error as exc:
            raise QueryError(str(exc).strip()) from exc
        except Exception as exc:  # noqa: BLE001
            raise QueryError(f"{type(exc).__name__}: {exc}") from exc
        return self._to_result(cols, rows, elapsed, limit, prepared)

    @staticmethod
    def _to_result(cols: list[str], rows: list[tuple], elapsed: float, limit: int, sql: str) -> QueryResult:
        keep = [i for i, c in enumerate(cols) if not c.endswith(EMB_SUFFIX)]
        total = len(rows)
        truncated = total > limit
        out_rows = [[jsonable(r[i]) for i in keep] for r in rows[:limit]]
        return QueryResult(columns=[cols[i] for i in keep], rows=out_rows, row_count=total,
                           elapsed_ms=round(elapsed, 3), truncated=truncated, sql=sql)

    async def tables(self, db_id: str) -> list[TableInfo]:
        await self._get_entry(db_id)

        def _do() -> list[TableInfo]:
            con = self._con(db_id)
            cur = con.cursor()
            try:
                names = [r[0] for r in cur.execute(
                    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' "
                    "AND table_type = 'BASE TABLE' ORDER BY table_name").fetchall()]
                out: list[TableInfo] = []
                for t in names:
                    cols = [(c, ty) for c, ty in self._columns(cur, t) if not c.endswith(EMB_SUFFIX)]
                    n = cur.execute(f"SELECT count(*) FROM {_q(t)}").fetchone()[0]
                    out.append(TableInfo(name=t, columns=cols, row_count=int(n)))
                return out
            finally:
                cur.close()

        try:
            return await asyncio.to_thread(_do)
        except duckdb.Error as exc:
            raise DataEngineError(f"could not list tables: {exc}") from exc

    async def create_index(self, db_id: str, table: str, column: str, kind: str) -> str:
        _ident(table, "table name")
        _q(column)
        kind = (kind or "").lower()
        if kind not in ("bm25", "vector"):
            raise DataEngineError(f"unsupported index kind {kind!r} (use bm25|vector)")
        await self._get_entry(db_id)
        if kind == "bm25":
            def _bm25() -> None:
                con = self._con(db_id)
                with self._wlock(db_id):
                    cur = con.cursor()
                    try:
                        self._require_rowid(cur, table)
                        self._build_fts(cur, table, column)
                    finally:
                        cur.close()

            try:
                await asyncio.to_thread(_bm25)
            except duckdb.Error as exc:
                raise DataEngineError(f"bm25 index on {table}.{column} failed: {exc}") from exc
            return f"{table}_{column}_bm25"

        # vector: embed the column, write <column>__emb FLOAT[768]
        try:
            _, rows, _ = await asyncio.to_thread(
                self._read, db_id,
                f"SELECT {_q(ROWID)}, CAST({_q(column)} AS VARCHAR) FROM {_q(table)} ORDER BY {_q(ROWID)}")
        except duckdb.Error as exc:
            raise DataEngineError(f"cannot read {table}.{column} for embedding: {exc}") from exc
        ids = [int(r[0]) for r in rows]
        texts = [r[1] or "" for r in rows]
        t0 = time.perf_counter()
        vectors, method = await self._embedder.embed_many(texts)
        log.info("embedded %d rows of %s.%s via %s in %.0f ms", len(texts), table, column, method,
                 (time.perf_counter() - t0) * 1000)
        try:
            await asyncio.to_thread(self._write_embeddings, db_id, table, column, ids, vectors)
        except duckdb.Error as exc:
            raise DataEngineError(f"vector index on {table}.{column} failed: {exc}") from exc

        def _record(m: dict[str, Any]):
            entry = self._entry(m, db_id)
            entry.setdefault("vector_methods", {})[f"{table}.{column}"] = method
            return None, True

        await self._with_manifest(_record)
        return f"{table}_{column}_vector"

    def _require_rowid(self, cur: duckdb.DuckDBPyConnection, table: str) -> None:
        if not self._table_exists(cur, table):
            raise DataEngineError(f"table {table!r} does not exist")
        if ROWID not in {c for c, _ in self._columns(cur, table)}:
            raise DataEngineError(f"table {table!r} has no {ROWID} column; load it through load_csv first")

    def _write_embeddings(self, db_id: str, table: str, column: str, ids: list[int], vectors: list[list[float]]) -> None:
        emb_col = f"{column}{EMB_SUFFIX}"
        con = self._con(db_id)
        with self._wlock(db_id):
            cur = con.cursor()
            try:
                self._require_rowid(cur, table)
                cur.execute(f"ALTER TABLE {_q(table)} ADD COLUMN IF NOT EXISTS {_q(emb_col)} FLOAT[{EMBED_DIM}]")
                if not ids:
                    return
                flat = pa.array(np.asarray(vectors, dtype=np.float32).reshape(-1), type=pa.float32())
                arrow = pa.table({
                    "rid": pa.array(ids, type=pa.int64()),
                    "emb": pa.FixedSizeListArray.from_arrays(flat, EMBED_DIM),
                })
                view = f"__parallax_emb_{secrets.token_hex(4)}"
                cur.register(view, arrow)
                try:
                    cur.execute(
                        f"UPDATE {_q(table)} SET {_q(emb_col)} = e.emb FROM {view} e WHERE {_q(table)}.{_q(ROWID)} = e.rid")
                finally:
                    cur.unregister(view)
            finally:
                cur.close()

    async def _search_columns(self, db_id: str, table: str) -> list[str]:
        def _do() -> list[str]:
            cur = self._con(db_id).cursor()
            try:
                return [c for c, _ in self._columns(cur, table) if not c.endswith(EMB_SUFFIX)]
            finally:
                cur.close()

        cols = await asyncio.to_thread(_do)
        if not cols:
            raise DataEngineError(f"table {table!r} does not exist")
        return cols

    async def bm25_search(self, db_id: str, table: str, column: str, q: str, k: int = 10) -> QueryResult:
        _ident(table, "table name")
        _q(column)
        await self._get_entry(db_id)
        k = max(1, int(k))
        cols = await self._search_columns(db_id, table)

        def _ensure_index() -> None:
            con = self._con(db_id)
            cur = con.cursor()
            try:
                self._load_fts(cur)
                if not self._fts_exists(cur, table):
                    with self._wlock(db_id):
                        if not self._fts_exists(cur, table):
                            self._require_rowid(cur, table)
                            self._build_fts(cur, table, column)
            finally:
                cur.close()

        try:
            await asyncio.to_thread(_ensure_index)
        except duckdb.Error as exc:
            raise DataEngineError(f"bm25 index on {table}.{column} unavailable: {exc}") from exc

        select = ", ".join(_q(c) for c in cols)
        sql = (f"SELECT {select}, fts_main_{table}.match_bm25({_q(ROWID)}, ?) AS score FROM {_q(table)} "
               f"WHERE score IS NOT NULL ORDER BY score DESC LIMIT {k}")
        try:
            out_cols, rows, elapsed = await asyncio.to_thread(self._read, db_id, sql, [q])
        except duckdb.Error as exc:
            raise QueryError(f"bm25 search failed: {exc}") from exc
        shown = sql.replace("?", "'" + q.replace("'", "''") + "'", 1)
        return self._to_result(out_cols, rows, elapsed, k, shown)

    async def vector_search(self, db_id: str, table: str, column: str, q: str, k: int = 10) -> QueryResult:
        _ident(table, "table name")
        _q(column)
        entry = await self._get_entry(db_id)
        k = max(1, int(k))
        key = f"{table}.{column}"
        method = (entry.get("vector_methods") or {}).get(key)
        if method is None:  # build lazily so a fork without an index still works
            await self.create_index(db_id, table, column, "vector")
            method = ((await self._get_entry(db_id)).get("vector_methods") or {}).get(key)
        qvec, _ = await self._embedder.embed(q, method=method)
        cols = await self._search_columns(db_id, table)
        emb_col = _q(f"{column}{EMB_SUFFIX}")
        select = ", ".join(_q(c) for c in cols)
        sql = (f"SELECT {select}, 1 - array_cosine_similarity({emb_col}, ?::FLOAT[{EMBED_DIM}]) AS _distance "
               f"FROM {_q(table)} WHERE {emb_col} IS NOT NULL ORDER BY _distance ASC LIMIT {k}")
        try:
            out_cols, rows, elapsed = await asyncio.to_thread(self._read, db_id, sql, [qvec])
        except duckdb.Error as exc:
            raise QueryError(f"vector search failed: {exc}") from exc
        shown = sql.replace("?", f"<embedding({method})>", 1)
        return self._to_result(out_cols, rows, elapsed, k, shown)

    async def lineage(self, db_id: str) -> list[LineageNode]:
        def _do(m: dict[str, Any]):
            dbs = m["dbs"]
            self._entry(m, db_id)
            root = db_id
            seen = {root}
            while dbs[root].get("parent_id") in dbs and dbs[root]["parent_id"] not in seen:
                root = dbs[root]["parent_id"]
                seen.add(root)
            family: list[dict[str, Any]] = []
            frontier = [root]
            visited: set[str] = set()
            while frontier:
                cur = frontier.pop(0)
                if cur in visited:
                    continue
                visited.add(cur)
                family.append(dbs[cur])
                kids = sorted((e for e in dbs.values() if e.get("parent_id") == cur), key=lambda e: e.get("created_at", ""))
                frontier.extend(e["id"] for e in kids)
            nodes = [LineageNode(id=e["id"], name=e["name"], parent_id=e.get("parent_id"),
                                 created_at=e.get("created_at", ""), exists=self._path(e["id"]).exists())
                     for e in family]
            return nodes, False

        return await self._with_manifest(_do)

    async def set_context(self, db_id: str, name: str, content: str) -> None:
        def _do(m: dict[str, Any]):
            entry = self._entry(m, db_id)
            entry.setdefault("contexts", {})[str(name)] = str(content)
            entry["contexts_updated_at"] = now_iso()
            return None, True

        await self._with_manifest(_do)

    async def get_context(self, db_id: str) -> dict[str, str]:
        return await self._with_manifest(lambda m: (dict(self._entry(m, db_id).get("contexts") or {}), False))

    async def delete(self, db_id: str) -> None:
        path = self._path(db_id)

        def _remove() -> None:
            self._close(db_id)
            for p in (path, Path(str(path) + ".wal")):
                try:
                    p.unlink()
                except FileNotFoundError:
                    pass

        await asyncio.to_thread(_remove)

        def _drop(m: dict[str, Any]):
            existed = m["dbs"].pop(db_id, None) is not None
            return None, existed

        await self._with_manifest(_drop)

    async def healthy(self) -> bool:
        return True

    def table_ref(self, db_id: str, table: str) -> str:
        return table

    async def aclose(self) -> None:
        with self._cons_guard:
            ids = list(self._cons)
        for db_id in ids:
            self._close(db_id)
