"""HotdataEngine tests against an in-process fake of the Hotdata REST API (httpx.MockTransport)."""
from __future__ import annotations

import asyncio
import json
import types
from typing import Any

import httpx
import pytest

import app.data.hotdata as hotdata_mod
from app.data.base import DataEngineError, QueryError
from app.data.hotdata import MAX_CHUNK_BYTES, HotdataEngine, chunk_csv

API = "https://api.hotdata.dev/v1"
KEY, WS = "hd_test_key", "ws_test"


class FakeHotdata:
    """Minimal stateful Hotdata: records every request and serves canned responses."""

    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self.fail_next: list[int] = []  # status codes to return before succeeding
        self.index_polls_until_ready = 2
        self._polls = 0
        self.query_response: dict[str, Any] = {
            "columns": [{"name": "customer_id", "type": "Int64"}, {"name": "feedback", "type": "Utf8"}],
            "rows": [[1, "slow refund"], [2, "great"]],
            "execution_time_ms": 12.5, "total_row_count": 2, "truncated": False,
        }
        self.columns_of_data = ["customer_id", "company", "feedback"]

    def handler(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else None
        rec = {"method": request.method, "path": request.url.path, "query": dict(request.url.params),
               "headers": dict(request.headers), "json": body}
        self.requests.append(rec)
        if self.fail_next:
            status = self.fail_next.pop(0)
            return httpx.Response(status, json={"error": {"code": "busy", "message": "try later"}},
                                  headers={"Retry-After": "0"})
        return self.route(request.method, request.url.path, body, rec)

    def route(self, method: str, path: str, body: Any, rec: dict[str, Any]) -> httpx.Response:
        if method == "GET" and path == "/v1/databases":
            return httpx.Response(200, json={"databases": []})
        if method == "POST" and path == "/v1/databases":
            return httpx.Response(201, json={"id": "dbid_root", "name": body["name"], "default_connection_id": "conn_root",
                                             "default_catalog": "default", "default_schema": "public",
                                             "created_at": "2026-09-11T10:00:00Z", "expires_at": "2026-09-12T10:00:00Z"})
        if method == "POST" and path.endswith("/fork"):
            src = path.split("/")[3]
            return httpx.Response(201, json={"id": f"dbid_fork_of_{src}", "default_connection_id": "conn_fork",
                                             "forked_from": {"database_id": src, "forked_at": "2026-09-11T10:05:00Z",
                                                             "snapshot_id": "snap1"}})
        if method == "GET" and path == "/v1/databases/dbid_orphan":
            return httpx.Response(200, json={"id": "dbid_orphan", "default_connection_id": "conn_orphan"})
        if method == "POST" and "/tables/" in path and path.endswith("/loads"):
            rows = body["data"].count("\n") - 1
            return httpx.Response(200, json={"row_count": rows, "table_name": path.split("/")[-2],
                                             "schema_name": "public", "connection_id": "conn_root"})
        if method == "POST" and path == "/v1/query":
            sql = body["sql"]
            if "information_schema.columns" in sql:
                if "table_name" in sql and "AND" in sql:
                    return httpx.Response(200, json={"columns": ["column_name"],
                                                     "rows": [[c] for c in self.columns_of_data]})
                return httpx.Response(200, json={
                    "columns": ["table_name", "column_name", "data_type"],
                    "rows": [["data", c, "Utf8"] for c in self.columns_of_data]})
            if "COUNT(*)" in sql:
                return httpx.Response(200, json={"columns": [{"name": "n"}], "rows": [[42]]})
            if "boom" in sql:
                return httpx.Response(400, json={"error": {"code": "invalid_sql", "message": "column boom not found"}})
            return httpx.Response(200, json=self.query_response)
        if method == "POST" and path.endswith("/indexes"):
            self._polls = 0
            return httpx.Response(202, json={"job_id": "job1", "index_name": body["index_name"], "status": "building"})
        if method == "GET" and path.endswith("/indexes"):
            self._polls += 1
            status = "ready" if self._polls >= self.index_polls_until_ready else "building"
            return httpx.Response(200, json={"items": [{"index_name": "data_feedback_bm25", "status": status},
                                                       {"index_name": "data_vec_feedback_vector", "status": status}]})
        if method == "GET" and path.endswith("/lineage"):
            db = path.split("/")[3]
            if db == "dbid_root":
                return httpx.Response(200, json={"root_id": "dbid_root", "ancestors": [], "fork_count": 2, "forks": [
                    {"database_id": "dbid_child_b", "exists": False, "forked_at": "2026-09-11T10:07:00Z", "snapshot_id": "s2"},
                    {"database_id": "dbid_child_a", "exists": True, "forked_at": "2026-09-11T10:06:00Z", "snapshot_id": "s1"},
                ]})
            return httpx.Response(200, json={"root_id": "dbid_root", "fork_count": 0, "forks": [],
                                             "ancestors": [{"database_id": "dbid_root", "exists": True,
                                                            "forked_at": "2026-09-11T10:06:00Z", "snapshot_id": "s1"}]})
        if method == "POST" and path.endswith("/context"):
            return httpx.Response(201, json={"name": body["name"], "content": body["content"]})
        if method == "GET" and path.endswith("/context"):
            return httpx.Response(200, json={"contexts": [{"name": "NOTES", "content": "hello", "updated_at": "x"},
                                                          {"name": "PLAN", "content": "world", "updated_at": "y"}]})
        if method == "DELETE" and path.startswith("/v1/databases/"):
            return httpx.Response(204)
        return httpx.Response(404, json={"error": {"code": "not_found", "message": f"no route {method} {path}"}})


@pytest.fixture
def fake() -> FakeHotdata:
    return FakeHotdata()


@pytest.fixture
def engine(fake: FakeHotdata, monkeypatch: pytest.MonkeyPatch) -> HotdataEngine:
    async def no_sleep(_: float) -> None:
        return None

    monkeypatch.setattr(hotdata_mod, "asyncio", types.SimpleNamespace(sleep=no_sleep, to_thread=asyncio.to_thread))
    return HotdataEngine(api_url=API, api_key=KEY, workspace_id=WS, transport=httpx.MockTransport(fake.handler))


def test_requires_credentials(monkeypatch: pytest.MonkeyPatch):
    from app.config import settings

    monkeypatch.setattr(settings, "hotdata_api_key", None)
    monkeypatch.setattr(settings, "hotdata_workspace_id", None)
    with pytest.raises(DataEngineError):
        HotdataEngine()


def test_chunk_csv_respects_size_and_quoted_newlines():
    header = "id,body\n"
    rows = [f'{i},"line one\nline two {i} ' + "x" * 200 + '"\n' for i in range(3000)]
    text = header + "".join(rows)
    chunks = chunk_csv(text, max_bytes=64 * 1024)
    assert len(chunks) > 1
    total = 0
    for c in chunks:
        assert len(c.encode()) <= 64 * 1024
        assert c.startswith("id,body\n")
        total += c.count("\n") - 1 - c.count("line one\n")  # records, not raw lines
    assert total == 3000
    assert chunk_csv("a,b\n1,2\n") == ["a,b\n1,2\n"]
    with pytest.raises(DataEngineError):
        chunk_csv("")


async def test_create_database_sends_schema_and_headers(engine: HotdataEngine, fake: FakeHotdata):
    db = await engine.create_database("parallax-run1")
    assert db.id == "dbid_root" and db.connection_id == "conn_root" and db.parent_id is None
    assert db.created_at == "2026-09-11T10:00:00Z" and db.expires_at == "2026-09-12T10:00:00Z"
    req = fake.requests[-1]
    assert (req["method"], req["path"]) == ("POST", "/v1/databases")
    assert req["headers"]["authorization"] == f"Bearer {KEY}" and req["headers"]["x-workspace-id"] == WS
    assert req["json"] == {"name": "parallax-run1", "expires_at": "24h",
                           "schemas": [{"name": "public", "tables": [{"name": "data"}]}]}
    assert engine.table_ref(db.id, "data") == "default.public.data"


async def test_load_csv_chunks_into_multiple_calls(engine: HotdataEngine, fake: FakeHotdata):
    header = "id,text\n"
    line = "{:07d}," + "lorem ipsum dolor sit amet " * 3 + "\n"  # ~90 bytes
    n_rows = 40_000  # ≈3.4 MiB → 3 chunks of ≤1.5 MiB
    csv_text = header + "".join(line.format(i) for i in range(n_rows))
    assert len(csv_text.encode()) > 2 * MAX_CHUNK_BYTES

    total = await engine.load_csv("dbid_root", "data", csv_text, columns={"id": "INTEGER", "text": "TEXT"})
    loads = [r for r in fake.requests if r["path"].endswith("/loads")]
    assert len(loads) == 3
    assert all(r["path"] == "/v1/databases/dbid_root/schemas/public/tables/data/loads" for r in loads)
    assert [r["json"]["mode"] for r in loads] == ["replace", "append", "append"]
    for r in loads:
        assert r["json"]["data"].startswith(header)
        assert len(r["json"]["data"].encode()) <= MAX_CHUNK_BYTES
        assert r["json"]["columns"] == {"id": "INTEGER", "text": "TEXT"}
    assert sum(r["json"]["data"].count("\n") - 1 for r in loads) == n_rows
    assert total == n_rows

    await engine.load_csv("dbid_root", "data", "id,text\n1,a\n", mode="append")
    assert fake.requests[-1]["json"]["mode"] == "append"


async def test_query_parses_columns_rows_and_metadata(engine: HotdataEngine, fake: FakeHotdata):
    res = await engine.query("dbid_root", "SELECT customer_id, feedback FROM default.public.data;")
    req = fake.requests[-1]
    assert (req["method"], req["path"]) == ("POST", "/v1/query")
    assert req["headers"]["x-database-id"] == "dbid_root"
    assert req["json"] == {"sql": "SELECT customer_id, feedback FROM default.public.data\nLIMIT 200"}
    assert res.columns == ["customer_id", "feedback"]
    assert res.rows == [[1, "slow refund"], [2, "great"]]
    assert res.row_count == 2 and res.elapsed_ms == 12.5 and res.truncated is False

    fake.query_response = {"columns": ["a", "b"], "rows": [{"a": 1, "b": "x"}], "truncated": True, "total_row_count": 500}
    res = await engine.query("dbid_root", "SELECT a, b FROM default.public.data LIMIT 1")
    assert res.columns == ["a", "b"] and res.rows == [[1, "x"]] and res.truncated and res.row_count == 500
    assert res.elapsed_ms >= 0  # falls back to wall time when the server omits execution_time_ms


async def test_query_errors_map_to_query_error_with_server_message(engine: HotdataEngine):
    with pytest.raises(QueryError) as exc:
        await engine.query("dbid_root", "SELECT boom FROM default.public.data")
    assert "column boom not found" in str(exc.value) and "400" in str(exc.value)
    with pytest.raises(QueryError):
        await engine.query("dbid_root", "DROP TABLE default.public.data")


async def test_retries_on_5xx_and_429(engine: HotdataEngine, fake: FakeHotdata):
    fake.fail_next = [503, 429]
    res = await engine.query("dbid_root", "SELECT 1")
    assert res.rows and len([r for r in fake.requests if r["path"] == "/v1/query"]) == 3
    fake.fail_next = [500, 500, 500]
    with pytest.raises(QueryError) as exc:
        await engine.query("dbid_root", "SELECT 1")
    assert "try later" in str(exc.value)


async def test_fork_records_parent_and_connection(engine: HotdataEngine, fake: FakeHotdata):
    child = await engine.fork("dbid_root", "branch-1")
    req = fake.requests[-1]
    assert (req["method"], req["path"]) == ("POST", "/v1/databases/dbid_root/fork")
    assert req["json"] == {"name": "branch-1", "expires_at": "24h"}
    assert child.id == "dbid_fork_of_dbid_root" and child.parent_id == "dbid_root"
    assert child.connection_id == "conn_fork" and child.created_at == "2026-09-11T10:05:00Z"


async def test_create_index_posts_then_polls_until_ready(engine: HotdataEngine, fake: FakeHotdata):
    await engine.create_database("x")  # caches conn_root
    name = await engine.create_index("dbid_root", "data", "feedback", "bm25")
    assert name == "data_feedback_bm25"
    post = next(r for r in fake.requests if r["method"] == "POST" and r["path"].endswith("/indexes"))
    assert post["path"] == "/v1/connections/conn_root/tables/public/data/indexes"
    assert post["json"] == {"index_name": "data_feedback_bm25", "columns": ["feedback"], "index_type": "bm25"}
    assert post["headers"]["x-database-id"] == "dbid_root"
    polls = [r for r in fake.requests if r["method"] == "GET" and r["path"].endswith("/indexes")]
    assert len(polls) == 2 and polls[0]["path"] == post["path"]

    name = await engine.create_index("dbid_root", "data_vec", "feedback", "vector")
    assert name == "data_vec_feedback_vector"
    post = [r for r in fake.requests if r["method"] == "POST" and r["path"].endswith("/indexes")][-1]
    assert post["json"] == {"index_name": "data_vec_feedback_vector", "columns": ["feedback"], "index_type": "vector",
                            "metric": "cosine"}
    with pytest.raises(DataEngineError):
        await engine.create_index("dbid_root", "data", "feedback", "hash")


async def test_create_index_resolves_connection_id_via_get(engine: HotdataEngine, fake: FakeHotdata):
    await engine.create_index("dbid_orphan", "data", "feedback", "bm25")
    assert any(r["method"] == "GET" and r["path"] == "/v1/databases/dbid_orphan" for r in fake.requests)
    post = next(r for r in fake.requests if r["method"] == "POST" and r["path"].endswith("/indexes"))
    assert post["path"].startswith("/v1/connections/conn_orphan/")


async def test_create_index_times_out(engine: HotdataEngine, fake: FakeHotdata, monkeypatch: pytest.MonkeyPatch):
    fake.index_polls_until_ready = 10_000
    monkeypatch.setattr(hotdata_mod, "INDEX_POLL_TIMEOUT_S", 0.0)
    await engine.create_database("x")  # caches conn_root
    with pytest.raises(DataEngineError) as exc:
        await engine.create_index("dbid_root", "data", "feedback", "bm25")
    assert "not ready" in str(exc.value)


async def test_bm25_and_vector_search_sql(engine: HotdataEngine, fake: FakeHotdata):
    res = await engine.bm25_search("dbid_root", "data", "feedback", "refund's slow", k=5)
    sql = [r for r in fake.requests if r["path"] == "/v1/query"][-1]["json"]["sql"]
    assert sql == ("SELECT \"customer_id\", \"feedback\", score FROM bm25_search('default.public.data', 'feedback', "
                   "'refund''s slow', 5) ORDER BY score DESC\nLIMIT 5")
    assert res.columns == ["customer_id", "feedback"]

    await engine.vector_search("dbid_root", "data_vec", "feedback", "frustrated about pricing", k=7)
    sql = [r for r in fake.requests if r["path"] == "/v1/query"][-1]["json"]["sql"]
    assert sql == ("SELECT \"customer_id\", \"feedback\", _distance FROM vector_search('default.public.data_vec', "
                   "'feedback', 'frustrated about pricing', 7) ORDER BY _distance ASC\nLIMIT 7")


async def test_tables_uses_information_schema_and_counts(engine: HotdataEngine, fake: FakeHotdata):
    tables = await engine.tables("dbid_root")
    assert [t.name for t in tables] == ["data"]
    assert tables[0].columns == [("customer_id", "Utf8"), ("company", "Utf8"), ("feedback", "Utf8")]
    assert tables[0].row_count == 42
    count_sql = [r for r in fake.requests if r["path"] == "/v1/query"][-1]["json"]["sql"]
    assert count_sql.startswith("SELECT COUNT(*) AS n FROM default.public.data")


async def test_lineage_maps_root_ancestors_and_forks(engine: HotdataEngine, fake: FakeHotdata):
    nodes = await engine.lineage("dbid_child_a")
    paths = [r["path"] for r in fake.requests if r["path"].endswith("/lineage")]
    assert paths == ["/v1/databases/dbid_child_a/lineage", "/v1/databases/dbid_root/lineage"]
    assert fake.requests[-1]["query"] == {"forks_limit": "100"}
    by_id = {n.id: n for n in nodes}
    assert nodes[0].id == "dbid_root" and nodes[0].parent_id is None
    assert by_id["dbid_child_a"].parent_id == "dbid_root" and by_id["dbid_child_a"].exists is True
    assert by_id["dbid_child_a"].created_at == "2026-09-11T10:06:00Z"
    assert by_id["dbid_child_b"].parent_id == "dbid_root" and by_id["dbid_child_b"].exists is False
    assert len(nodes) == 3

    nodes = await engine.lineage("dbid_root")  # from the root only one call is needed
    assert [r["path"] for r in fake.requests if r["path"].endswith("/lineage")][-1] == "/v1/databases/dbid_root/lineage"
    assert {n.id for n in nodes} == {"dbid_root", "dbid_child_a", "dbid_child_b"}


async def test_context_roundtrip_delete_and_health(engine: HotdataEngine, fake: FakeHotdata):
    await engine.set_context("dbid_root", "NOTES", "# notes")
    req = fake.requests[-1]
    assert (req["method"], req["path"], req["json"]) == ("POST", "/v1/databases/dbid_root/context",
                                                         {"name": "NOTES", "content": "# notes"})
    assert await engine.get_context("dbid_root") == {"NOTES": "hello", "PLAN": "world"}
    await engine.delete("dbid_root")
    assert (fake.requests[-1]["method"], fake.requests[-1]["path"]) == ("DELETE", "/v1/databases/dbid_root")
    assert await engine.healthy() is True
    assert fake.requests[-1]["path"] == "/v1/databases"

    def down(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom")

    dead = HotdataEngine(api_url=API, api_key=KEY, workspace_id=WS, transport=httpx.MockTransport(down))
    assert await dead.healthy() is False
    with pytest.raises(DataEngineError) as exc:
        await dead.get_context("dbid_root")
    assert "unreachable" in str(exc.value)
    await dead.aclose()
    await engine.aclose()
