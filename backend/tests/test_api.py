"""HTTP smoke test over the ASGI app with fakes injected (docs/SPEC.md §4)."""
from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path

import httpx
import pytest

from app.datasets import DatasetRegistry
from app.main import create_app
from app.swarm.events import EventBus
from app.swarm.store import RunStore
from tests.fakes import FakeEngine, FakeLLM, FakeMemory


@pytest.fixture
async def client(tmp_path: Path):
    app = create_app(engine=FakeEngine(), llm=FakeLLM(), memory=FakeMemory(), store=RunStore(tmp_path / "runs"),
                     bus=EventBus(), registry=DatasetRegistry(tmp_path / "datasets", tmp_path / "uploads"))
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        c.app = app  # type: ignore[attr-defined]
        yield c
    await app.state.container.shutdown()


async def _wait_done(client: httpx.AsyncClient, run_id: str, timeout: float = 20.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        r = await client.get(f"/api/runs/{run_id}")
        assert r.status_code == 200, r.text
        run = r.json()
        if run["status"] in ("done", "failed"):
            return run
        await asyncio.sleep(0.1)
    raise AssertionError("run did not finish in time")


async def test_api_smoke(client: httpx.AsyncClient) -> None:
    # health
    r = await client.get("/api/health")
    assert r.status_code == 200
    h = r.json()
    assert h["ok"] is True and h["version"]
    assert set(h) >= {"data", "llm", "memory", "rocketride"}
    assert h["data"]["kind"] == "local" and h["memory"]["kind"] == "local"
    assert h["rocketride"] == {"configured": False, "reachable": False, "uri": None, "cloud": False}

    # datasets
    r = await client.get("/api/datasets")
    assert r.status_code == 200
    datasets = r.json()
    assert datasets and datasets[0]["source"] == "bundled" and datasets[0]["rows"] == 300
    ds = datasets[0]
    assert {"id", "name", "description", "rows", "columns", "source", "text_columns", "suggested_questions"} <= set(ds)
    assert ds["columns"][0] == {"name": "ticket_id", "type": "string"} and ds["text_columns"] == ["subject"]
    r = await client.get(f"/api/datasets/{ds['id']}/preview?limit=5")
    pv = r.json()
    assert r.status_code == 200 and len(pv["rows"]) == 5 and pv["columns"] == [c["name"] for c in ds["columns"]]
    assert pv["profile"]["priority"]["distinct"] == 4 and len(pv["profile"]["priority"]["top"]) == 4
    r = await client.get("/api/datasets/nope/preview")
    assert r.status_code == 404 and r.json()["error"]["code"] == "dataset_not_found"

    # upload
    csv = "id,city,note\n1,SF,\"The dashboard filters reset on refresh which is very annoying for the team\"\n2,LA,short\n"
    r = await client.post("/api/datasets/upload", files={"file": ("mine.csv", csv, "text/csv")})
    assert r.status_code == 201, r.text
    up = r.json()
    assert up["id"].startswith("up_") and up["source"] == "upload" and up["rows"] == 2 and up["text_columns"] == ["note"]
    r = await client.get("/api/datasets")
    assert any(d["id"] == up["id"] for d in r.json())
    r = await client.post("/api/datasets/upload", files={"file": ("bad.csv", "", "text/csv")})
    assert r.status_code == 400 and r.json()["error"]["code"] == "empty_file"

    # validation
    r = await client.post("/api/runs", json={"dataset_id": ds["id"], "question": "q", "agents": 1})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    r = await client.post("/api/runs", json={"dataset_id": "nope", "question": "q", "agents": 2})
    assert r.status_code == 404
    r = await client.post("/api/runs", json={"dataset_id": ds["id"], "question": "q", "agents": 2, "search_column": "zzz"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_search_column"

    # create + poll
    r = await client.post("/api/runs", json={"dataset_id": ds["id"], "question": "What drives long resolution times?",
                                             "agents": 3})
    assert r.status_code == 201, r.text
    run_id = r.json()["run_id"]
    r = await client.get(f"/api/runs/{run_id}")
    assert r.status_code == 200 and r.json()["status"] in ("queued", "provisioning", "planning", "exploring",
                                                              "synthesizing", "done")

    # SSE stream: must replay + stream and end with run.finished
    events = []
    async with client.stream("GET", f"/api/runs/{run_id}/events", timeout=20) as resp:
        assert resp.status_code == 200 and resp.headers["content-type"].startswith("text/event-stream")
        async for line in resp.aiter_lines():
            if line.startswith("data:"):
                ev = json.loads(line[5:].strip())
                events.append(ev)
                if ev["type"] == "run.finished":
                    break
    types = [e["type"] for e in events]
    assert types[-1] == "run.finished" and "run.plan" in types and "agent.finding" in types and "report.ready" in types
    assert all({"ts", "type", "run_id", "payload"} <= set(e) for e in events)

    run = await _wait_done(client, run_id)
    assert run["status"] == "done", run.get("error")
    assert run["modes"] == {"data": "local", "llm": "fake", "memory": "local"}
    assert len(run["branches"]) == 3 and all(b["finding"] for b in run["branches"])
    assert run["report"]["citations"] and run["metrics"]["queries"] > 0

    # replay after finish still ends with run.finished
    async with client.stream("GET", f"/api/runs/{run_id}/events", timeout=10) as resp:
        got = []
        async for line in resp.aiter_lines():
            if line.startswith("data:"):
                got.append(json.loads(line[5:].strip())["type"])
    assert got[-1] == "run.finished" and got.count("run.finished") == 1

    # list
    r = await client.get("/api/runs")
    assert r.status_code == 200 and r.json()[0]["id"] == run_id and r.json()[0]["status"] == "done"

    # lineage
    r = await client.get(f"/api/runs/{run_id}/lineage")
    nodes = r.json()
    assert r.status_code == 200 and len(nodes) == 4
    assert sum(1 for n in nodes if n["parent_id"] is None) == 1

    # query console: root + branch
    r = await client.post(f"/api/runs/{run_id}/query", json={"branch_id": "root", "sql": "SELECT COUNT(*) AS n FROM data"})
    assert r.status_code == 200 and r.json()["rows"][0][0] == 300 and r.json()["columns"] == ["n"]
    bid = run["branches"][0]["id"]
    r = await client.post(f"/api/runs/{run_id}/query", json={"branch_id": bid, "sql": "SELECT claim FROM findings"})
    assert r.status_code == 200 and r.json()["row_count"] == 1
    r = await client.post(f"/api/runs/{run_id}/query", json={"branch_id": bid, "sql": "DROP TABLE data"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "query_error"
    r = await client.post(f"/api/runs/{run_id}/query", json={"branch_id": bid, "sql": "SELECT nope FROM data"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "query_error"
    r = await client.post(f"/api/runs/{run_id}/query", json={"branch_id": "b_99", "sql": "SELECT 1"})
    assert r.status_code == 404

    # search
    r = await client.post(f"/api/runs/{run_id}/search", json={"branch_id": bid, "kind": "bm25", "q": "crash android", "k": 5})
    assert r.status_code == 200 and "score" in r.json()["columns"]
    r = await client.post(f"/api/runs/{run_id}/search", json={"branch_id": "root", "kind": "vector", "q": "invoice", "k": 3})
    assert r.status_code == 200 and "_distance" in r.json()["columns"] and r.json()["row_count"] == 3

    # burst
    r = await client.post(f"/api/runs/{run_id}/burst", json={"queries": 20})
    b = r.json()
    assert r.status_code == 200 and b["count"] == 20 and len(b["per_query"]) == 20 and b["concurrency"] == 50
    assert {"p50_ms", "p95_ms", "max_ms", "total_ms"} <= set(b)
    r = await client.post(f"/api/runs/{run_id}/burst", json={"queries": 5})
    assert r.status_code == 422
    r = await client.get(f"/api/runs/{run_id}")
    assert r.json()["metrics"]["burst"]["count"] == 20

    # report.md
    r = await client.get(f"/api/runs/{run_id}/report.md")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/markdown")
    assert "[branch:" in r.text

    # memory
    r = await client.get("/api/memory")
    assert r.status_code == 200 and r.json()["kind"] == "local" and r.json()["stats"]["items"] == 1
    r = await client.post("/api/memory/recall", json={"q": "resolution times", "tags": [ds["id"]]})
    assert r.status_code == 200 and len(r.json()) == 1 and r.json()[0]["text"].startswith("Dataset ")
    r = await client.get("/api/memory/graph")
    assert r.status_code == 404 and r.json()["error"]["code"] == "no_graph"

    # delete
    r = await client.delete(f"/api/runs/{run_id}")
    assert r.status_code == 200 and r.json()["ok"] is True and r.json()["deleted_databases"] == 4
    r = await client.get(f"/api/runs/{run_id}")
    assert r.status_code == 404 and r.json()["error"]["code"] == "run_not_found"
    r = await client.get("/api/runs")
    assert r.json() == []
    r = await client.get(f"/api/runs/{run_id}/report.md")
    assert r.status_code == 404


async def test_error_shape_for_unknown_route(client: httpx.AsyncClient) -> None:
    r = await client.get("/api/does-not-exist")
    assert r.status_code == 404 and r.json() == {"error": {"code": "not_found", "message": "Not Found"}}
