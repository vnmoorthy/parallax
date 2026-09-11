"""LocalEngine tests — fully offline (hashed embeddings, no ollama required)."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from app.data.base import DataEngine, DataEngineError, QueryError
from app.data.local import EMBED_DIM, Embedder, LocalEngine, hashed_embedding, jsonable, prepare_sql

CSV = (
    "customer_id,company,mrr,signup_date,churned,feedback\n"
    "1,Acme,120.5,2024-01-02,1,\"Refund was slow and support was unhelpful, very frustrating\"\n"
    "2,Globex,80,2024-02-03,0,\"Love the product, onboarding was smooth and fast\"\n"
    "3,Initech,,2024-03-04,1,\"Pricing is too high for a small team like ours\"\n"
    "4,Umbrella,300,2024-04-05,0,\"Great analytics dashboard, exports could be faster\"\n"
    "5,Hooli,45.25,2024-05-06,1,\"Slow support responses and a billing refund took weeks\"\n"
)


@pytest.fixture
def engine(tmp_path: Path) -> LocalEngine:
    return LocalEngine(tmp_path / "dbs", embedder=Embedder(offline=True))


async def _seed(engine: LocalEngine):
    db = await engine.create_database("test-root")
    n = await engine.load_csv(db.id, "data", CSV)
    assert n == 5
    return db


def test_protocol_conformance(engine: LocalEngine):
    assert isinstance(engine, DataEngine)
    assert engine.kind == "local"
    assert engine.table_ref("loc_000000000000", "data") == "data"


def test_prepare_sql_guardrails():
    assert prepare_sql("select 1;", 10) == "select 1\nLIMIT 10"
    assert prepare_sql("SELECT * FROM t LIMIT 5", 10) == "SELECT * FROM t LIMIT 5"
    assert prepare_sql("WITH x AS (SELECT 1) SELECT * FROM x -- comment", 7).endswith("LIMIT 7")
    with pytest.raises(QueryError):
        prepare_sql("DELETE FROM t", 10)
    with pytest.raises(QueryError):
        prepare_sql("SELECT 1; DROP TABLE t", 10)
    with pytest.raises(QueryError):
        prepare_sql("   ", 10)
    # semicolons inside string literals are fine
    assert "LIMIT" in prepare_sql("SELECT ';' AS s", 3)


def test_hashed_embedding_is_deterministic_and_normalised():
    a, b = hashed_embedding("refund slow support"), hashed_embedding("refund slow support")
    assert a == b and len(a) == EMBED_DIM
    assert abs(sum(x * x for x in a) - 1.0) < 1e-4
    assert hashed_embedding("") == [0.0] * EMBED_DIM


def test_jsonable_conversions():
    import datetime as dt
    import decimal

    import numpy as np

    assert jsonable(np.int64(3)) == 3
    assert jsonable(decimal.Decimal("1.50")) == 1.5
    assert jsonable(dt.date(2024, 1, 2)) == "2024-01-02"
    assert jsonable(float("nan")) is None
    assert jsonable([np.float32(1.5), {"k": np.bool_(True)}]) == [1.5, {"k": True}]


async def test_create_load_query_roundtrip(engine: LocalEngine, tmp_path: Path):
    db = await _seed(engine)
    assert db.id.startswith("loc_") and len(db.id) == 16
    assert (tmp_path / "dbs" / f"{db.id}.duckdb").exists()
    manifest = json.loads((tmp_path / "dbs" / "manifest.json").read_text())
    assert db.id in manifest["dbs"]

    res = await engine.query(db.id, "SELECT customer_id, company, mrr, signup_date FROM data ORDER BY customer_id;")
    assert res.columns == ["customer_id", "company", "mrr", "signup_date"]
    assert res.row_count == 5 and not res.truncated
    assert res.rows[0] == [1, "Acme", 120.5, "2024-01-02"]
    assert res.rows[2][2] is None  # NaN → NULL → None
    assert res.elapsed_ms >= 0
    assert res.sql.endswith("LIMIT 200")

    rowids = await engine.query(db.id, "SELECT __rowid FROM data ORDER BY __rowid")
    assert [r[0] for r in rowids.rows] == [1, 2, 3, 4, 5]


async def test_query_limit_and_truncation(engine: LocalEngine):
    db = await _seed(engine)
    res = await engine.query(db.id, "SELECT * FROM data", limit=2)
    assert len(res.rows) == 2 and res.row_count == 2 and res.sql.endswith("LIMIT 2")
    res = await engine.query(db.id, "SELECT * FROM data LIMIT 5", limit=2)
    assert len(res.rows) == 2 and res.row_count == 5 and res.truncated


async def test_query_errors(engine: LocalEngine):
    db = await _seed(engine)
    with pytest.raises(QueryError) as exc:
        await engine.query(db.id, "SELECT nope FROM data")
    assert "nope" in str(exc.value)  # duckdb message surfaces so the agent can self-correct
    with pytest.raises(QueryError):
        await engine.query(db.id, "INSERT INTO data VALUES (1)")
    with pytest.raises(DataEngineError):
        await engine.query("loc_deadbeef0000", "SELECT 1")
    with pytest.raises(DataEngineError):
        await engine.query("../etc/passwd", "SELECT 1")


async def test_append_continues_rowid_and_replace_resets(engine: LocalEngine):
    db = await _seed(engine)
    n = await engine.load_csv(db.id, "data", "customer_id,company,mrr,signup_date,churned,feedback\n6,Soylent,10,2024-06-07,0,ok\n",
                              mode="append")
    assert n == 1
    res = await engine.query(db.id, "SELECT __rowid, customer_id FROM data ORDER BY __rowid DESC LIMIT 1")
    assert res.rows[0] == [6, 6]
    await engine.load_csv(db.id, "data", "a,b\n1,x\n", mode="replace")
    tables = await engine.tables(db.id)
    assert [c for c, _ in tables[0].columns] == ["a", "b", "__rowid"]
    with pytest.raises(DataEngineError):
        await engine.load_csv(db.id, "data", CSV, mode="upsert")
    with pytest.raises(DataEngineError):
        await engine.load_csv(db.id, "bad name", CSV)


async def test_tables_reports_columns_and_counts(engine: LocalEngine):
    db = await _seed(engine)
    await engine.load_csv(db.id, "findings", "id,claim,confidence\nf1,claim one,0.7\n")
    tables = {t.name: t for t in await engine.tables(db.id)}
    assert set(tables) == {"data", "findings"}
    assert tables["data"].row_count == 5 and tables["findings"].row_count == 1
    assert ("feedback", "VARCHAR") in tables["data"].columns
    assert ("mrr", "DOUBLE") in tables["data"].columns


async def test_fork_is_isolated_and_lineage_tracks_family(engine: LocalEngine, tmp_path: Path):
    root = await _seed(engine)
    await engine.set_context(root.id, "NOTES", "root notes")
    a = await engine.fork(root.id, "branch-a")
    b = await engine.fork(root.id, "branch-b")
    grandchild = await engine.fork(a.id, "branch-a-2")
    assert a.parent_id == root.id and grandchild.parent_id == a.id
    assert (tmp_path / "dbs" / f"{a.id}.duckdb").exists()

    # writes on a branch never leak to the root or siblings
    await engine.load_csv(a.id, "data", "customer_id,company,mrr,signup_date,churned,feedback\n99,Fork,1,2024-01-01,0,x\n",
                          mode="append")
    assert (await engine.query(a.id, "SELECT count(*) FROM data")).rows[0][0] == 6
    assert (await engine.query(root.id, "SELECT count(*) FROM data")).rows[0][0] == 5
    assert (await engine.query(b.id, "SELECT count(*) FROM data")).rows[0][0] == 5

    for start in (root.id, a.id, grandchild.id):  # whole family from any member
        nodes = await engine.lineage(start)
        assert [n.id for n in nodes][0] == root.id
        assert {n.id: n.parent_id for n in nodes} == {root.id: None, a.id: root.id, b.id: root.id, grandchild.id: a.id}
        assert all(n.exists for n in nodes)

    assert await engine.get_context(a.id) == {}  # contexts are per-database notebooks, not inherited
    await engine.set_context(a.id, "NOTES", "a notes")
    await engine.set_context(a.id, "PLAN", "plan")
    assert await engine.get_context(a.id) == {"NOTES": "a notes", "PLAN": "plan"}
    assert await engine.get_context(root.id) == {"NOTES": "root notes"}


async def test_concurrent_queries_under_gather(engine: LocalEngine):
    root = await _seed(engine)
    branch = await engine.fork(root.id, "b")
    sqls = [
        "SELECT count(*) AS n FROM data",
        "SELECT company, mrr FROM data ORDER BY mrr DESC NULLS LAST",
        "SELECT churned, count(*) AS n, avg(mrr) AS avg_mrr FROM data GROUP BY churned ORDER BY churned",
        "SELECT * FROM data WHERE feedback ILIKE '%refund%'",
    ]
    tasks = [engine.query(root.id if i % 2 else branch.id, sqls[i % len(sqls)]) for i in range(20)]
    # interleave a write and a fork while the reads run
    tasks.append(engine.load_csv(branch.id, "findings", "id,claim\nf1,ok\n"))
    tasks.append(engine.fork(root.id, "c"))
    results = await asyncio.gather(*tasks)
    queries = [r for r in results if hasattr(r, "rows")]
    assert len(queries) == 20 and all(r.row_count >= 1 for r in queries)
    assert queries[0].rows[0][0] == 5


async def test_bm25_index_and_search(engine: LocalEngine):
    db = await _seed(engine)
    name = await engine.create_index(db.id, "data", "feedback", "bm25")
    assert name == "data_feedback_bm25"
    res = await engine.bm25_search(db.id, "data", "feedback", "refund slow support", k=3)
    assert res.columns[-1] == "score" and "feedback" in res.columns
    assert 1 <= len(res.rows) <= 3
    scores = [r[-1] for r in res.rows]
    assert scores == sorted(scores, reverse=True)
    top_feedback = res.rows[0][res.columns.index("feedback")].lower()
    assert "refund" in top_feedback or "slow" in top_feedback
    # survives a fork (index lives in the copied file) and an append (rebuilt)
    child = await engine.fork(db.id, "child")
    await engine.load_csv(child.id, "data", "customer_id,company,mrr,signup_date,churned,feedback\n7,New,1,2024-01-01,1,refund refund refund\n",
                          mode="append")
    res2 = await engine.bm25_search(child.id, "data", "feedback", "refund", k=1)
    assert res2.rows[0][0] == 7
    # searching without an explicit create_index builds one lazily
    other = await engine.fork(db.id, "lazy")
    await engine.load_csv(other.id, "docs", "id,body\n1,alpha beta\n2,gamma delta\n")
    assert (await engine.bm25_search(other.id, "docs", "body", "gamma", k=1)).rows[0][0] == 2
    with pytest.raises(DataEngineError):
        await engine.create_index(db.id, "data", "feedback", "hnsw")


async def test_vector_index_and_search_offline(engine: LocalEngine, tmp_path: Path):
    db = await _seed(engine)
    name = await engine.create_index(db.id, "data", "feedback", "vector")
    assert name == "data_feedback_vector"
    manifest = json.loads((tmp_path / "dbs" / "manifest.json").read_text())
    assert manifest["dbs"][db.id]["vector_methods"] == {"data.feedback": "hashed"}

    res = await engine.vector_search(db.id, "data", "feedback", "pricing too high small team", k=2)
    assert res.columns[-1] == "_distance"
    assert not any(c.endswith("__emb") for c in res.columns)
    assert len(res.rows) == 2
    assert res.rows[0][res.columns.index("customer_id")] == 3
    assert 0.0 <= res.rows[0][-1] <= res.rows[1][-1] <= 2.0

    # embedding column is hidden from plain queries and schema listings
    plain = await engine.query(db.id, "SELECT * FROM data LIMIT 1")
    assert not any(c.endswith("__emb") for c in plain.columns)
    assert not any(c.endswith("__emb") for c, _ in (await engine.tables(db.id))[0].columns)
    # a fork keeps the vectors and the recorded embedding method
    child = await engine.fork(db.id, "child")
    res2 = await engine.vector_search(child.id, "data", "feedback", "slow support refund weeks", k=1)
    assert res2.rows[0][res2.columns.index("customer_id")] in (1, 5)
    # lazily builds when no index exists yet
    fresh = await engine.create_database("fresh")
    await engine.load_csv(fresh.id, "t", "id,txt\n1,apples and oranges\n2,cars and trucks\n")
    assert (await engine.vector_search(fresh.id, "t", "txt", "oranges apples", k=1)).rows[0][0] == 1


async def test_delete_removes_file_and_manifest_entry(engine: LocalEngine, tmp_path: Path):
    db = await _seed(engine)
    child = await engine.fork(db.id, "child")
    await engine.delete(child.id)
    assert not (tmp_path / "dbs" / f"{child.id}.duckdb").exists()
    manifest = json.loads((tmp_path / "dbs" / "manifest.json").read_text())
    assert child.id not in manifest["dbs"]
    with pytest.raises(DataEngineError):
        await engine.query(child.id, "SELECT 1")
    assert [n.id for n in await engine.lineage(db.id)] == [db.id]
    await engine.delete(child.id)  # idempotent
    assert await engine.healthy() is True


async def test_manifest_survives_new_engine_instance(engine: LocalEngine, tmp_path: Path):
    db = await _seed(engine)
    await engine.set_context(db.id, "NOTES", "persisted")
    await engine.aclose()
    reopened = LocalEngine(tmp_path / "dbs", embedder=Embedder(offline=True))
    assert await reopened.get_context(db.id) == {"NOTES": "persisted"}
    assert (await reopened.query(db.id, "SELECT count(*) FROM data")).rows[0][0] == 5
