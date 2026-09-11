# Parallax backend

FastAPI service that runs the swarm: it forks an isolated database per hypothesis, runs analyst agents concurrently
(SQL + BM25 + vector search), synthesises a cited report and remembers what it learned. Source of truth for the
architecture and API contract: [`docs/SPEC.md`](../docs/SPEC.md).

## Run

```bash
cd backend
uv sync                      # or: python -m venv .venv && .venv/bin/pip install -e ".[dev]"
cp .env.example .env         # optional — zero keys = fully local mode
.venv/bin/uvicorn app.main:app --reload --port 8000
```

* `GET http://localhost:8000/api/health` shows the resolved mode of every subsystem (`data`, `llm`, `memory`, `rocketride`).
* `PARALLAX_LLM_MODE=fake` completes a whole run with a deterministic fake LLM — no keys, no ollama. CI uses this.
* Interactive docs: `http://localhost:8000/docs`.

## Test

```bash
cd backend && .venv/bin/python -m pytest -q
```

`tests/fakes.py` provides `FakeEngine` (one in-memory DuckDB per database, fork = copy tables), `FakeLLM`
(canned JSON keyed on the `[[PLANNER]]` / `[[AGENT]]` / `[[SYNTH]]` prompt markers) and `FakeMemory`, so the
orchestrator and API tests never touch the network or the real engine/LLM/memory factories.

## Layout

| Path | What |
|---|---|
| `app/main.py` | `create_app(engine=…, llm=…, memory=…, registry=…)` factory; `app` for uvicorn |
| `app/api/routes.py` | every endpoint in SPEC §4 (JSON + SSE), `{"error":{"code","message"}}` errors, lazy `AppContainer` |
| `app/datasets.py` | bundled datasets from `datasets/registry.json` (hot-reloaded), CSV uploads (≤ 25 MB), pandas preview/profile, built-in fallback dataset |
| `app/swarm/models.py` | pydantic models: `Run`, `Branch`, `AgentStep`, `Finding`, `ChartSpec`, `Report`, `Metrics`, `Event`, request bodies |
| `app/swarm/orchestrator.py` | the run engine (provision → plan → explore → synthesize → remember → done) + `query_branch` / `search_branch` / `delete_run_dbs` |
| `app/swarm/prompts.py` | planner / agent / synthesizer prompt builders |
| `app/swarm/events.py` | `EventBus`: replay buffer + per-subscriber queues (SSE) |
| `app/swarm/store.py` | `RunStore`: atomic, debounced JSON persistence under `.parallax/runs/` |
| `app/swarm/burst.py` | `/burst`: N concurrent read queries across root + branch databases |
| `app/data/*`, `app/llm/*`, `app/memory/*` | engines, LLM router, memory (owned by backend-core; consumed only through `get_engine()` / `get_llm()` / `get_memory()`) |

## Run lifecycle (what the SSE stream emits)

`run.status` → `db.created` → `run.recalled` → `run.plan {hypotheses, branches}` → per branch `db.forked`,
`branch.status`, `agent.step` (think / sql / bm25 / vector / observe / finding), `agent.finding` → `report.ready`
→ `memory.remembered` → `metrics.update` → `run.finished`. `metrics.update` is also emitted after every query and
LLM call; `run.error {message}` precedes `run.finished` on failure. Events are buffered per run, so a late
`GET /api/runs/{id}/events` replays the full history before streaming live events.

Agent guardrails: read-only `SELECT`/`WITH` only, single statement, `LIMIT ≤ 50` enforced, SQL errors are fed back
as observations, ≤ 4 tool steps per agent, one JSON-only retry on malformed model output, then a low-confidence finding.

## Quick manual smoke

```bash
curl -s localhost:8000/api/health | jq .
curl -s localhost:8000/api/datasets | jq '.[].id'
RUN=$(curl -s -X POST localhost:8000/api/runs -H 'content-type: application/json' \
  -d '{"dataset_id":"saas_customers","question":"Why are customers churning?","agents":4}' | jq -r .run_id)
curl -N localhost:8000/api/runs/$RUN/events          # SSE, ends with run.finished
curl -s localhost:8000/api/runs/$RUN/report.md
curl -s -X POST localhost:8000/api/runs/$RUN/burst -H 'content-type: application/json' -d '{"queries":100}' | jq '{p50_ms,p95_ms,total_ms}'
```
