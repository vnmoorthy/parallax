# Parallax — guide for judges

Everything below can be verified in under a minute each on a running instance (`make dev`, or `make demo` for the zero-key version). Behaviour is specified in [`SPEC.md`](SPEC.md); this page maps each sponsor's stated criterion to what Parallax does, where the code is, and how to check it yourself.

## Sponsor criteria

### Hotdata

> **Criterion (verbatim):** "Build an application where multiple agents or users need to search, query, or analyze data concurrently."

| What Parallax does | Code path | 30-second verification |
|---|---|---|
| Creates a root Hotdata database per run (`POST /v1/databases`, `expires_at: 24h`), loads the dataset via inline CSV loads chunked to 1.5 MiB, then **forks it once per hypothesis** (`POST /v1/databases/{id}/fork`) so N agents query N isolated databases at the same time | `backend/app/data/hotdata.py` (`create_database`, `load_csv`, `fork`), `backend/app/swarm/orchestrator.py` (phase 1 + 3) | Launch a run with 8 agents. Watch the lineage tree fan out as `db.forked` events arrive. `curl localhost:8000/api/runs/<id>/lineage` returns the root and 8 forks; the Hotdata dashboard lists the same databases with `forked_from` set. |
| Agents run **concurrently** (`asyncio.gather` + semaphore) with an in-flight counter → `peak_concurrency`, plus per-query `elapsed_ms` → `p50_ms` / `p95_ms` | `backend/app/swarm/orchestrator.py` | The metrics strip shows `PEAK CONCURRENCY = agents` during the exploring phase; the Query log tab lists every query with its branch and latency. |
| **Search, not just SQL:** BM25 index on `data.<text>` and a provider-backed vector index on a `data_vec` copy (indexes created lazily per branch because forks do not carry indexes); queries use `bm25_search(...)`/`vector_search(...)` in HotSQL | `backend/app/data/hotdata.py` (`create_index`, `bm25_search`, `vector_search`) | Find an agent card with a BM25 or VECTOR badge and read its SQL. Or use the SQL console's search box: pick a branch, `kind: bm25`, `q: slow support`. |
| **Read-only HotSQL** + orchestrator guard (SELECT/WITH only, LIMIT injected); results written back with the loads API into a per-branch `findings` table; agent notes stored as per-database **context docs** (`POST /databases/{id}/context`) | `backend/app/data/hotdata.py` (`set_context`, `get_context`), `orchestrator.py` | In the SQL console run `SELECT * FROM default.public.findings` on a finished branch. Try `DROP TABLE data` and watch it get rejected. |
| **Burst mode:** 10–200 concurrent reads spread across the forks, returning p50 / p95 / max | `POST /api/runs/{id}/burst` in `backend/app/api/routes.py` | Click **Burst 100 queries**; the histogram modal and the `metrics.burst` payload appear within seconds. |
| Same protocol, zero keys: DuckDB engine where fork = file copy, BM25 = DuckDB FTS, vectors = Ollama embeddings | `backend/app/data/local.py`, `backend/app/data/base.py` (the `DataEngine` protocol) | `PARALLAX_DATA_MODE=local make dev` → badge flips to `data: local`; everything else is identical. |

### RocketRide

> **Criterion (verbatim):** "Build your project on RocketRide Cloud and deploy an AI pipeline without managing any infrastructure."

| What Parallax does | Code path | 30-second verification |
|---|---|---|
| **Every planner / agent / synthesizer LLM call is routed through a RocketRide pipeline** (`parallax-llm.pipe`: `chat → llm_anthropic → response_answers`) using the `rocketride` SDK: `RocketRideClient(uri=ROCKETRIDE_URI, auth=ROCKETRIDE_APIKEY)`, `use(filepath=...)` once with a cached token, `chat(token, Question)` per call | `backend/app/llm/rocketride_llm.py`, `pipelines/parallax-llm.pipe`, `backend/app/llm/router.py` | `curl localhost:8000/api/health` → `llm.active: "rocketride"`, `rocketride.configured: true`, `rocketride.reachable: true`. After a run, the LLM CALLS tile reads `rocketride N`; `GET /api/runs/<id>` → `metrics.llm_calls_by_provider`. |
| Runs **on RocketRide Cloud** when `ROCKETRIDE_URI=https://api.rocketride.ai` (no engine to host); the same pipe runs unchanged on the local Docker engine (`ghcr.io/rocketride-org/rocketride-engine:latest`, port 5565) | `backend/app/config.py`, `pipelines/README.md` | Check `ROCKETRIDE_URI` in the Settings page (`/settings`, RocketRide card shows the URI and live status; secrets are never shown). |
| A deployable **analyst agent pipeline** (`parallax-analyst.pipe`): `agent_rocketride` "Parallax Analyst" controlling `llm_anthropic` (Claude), `memory_internal`, `db_hotdata` (Hotdata as a tool, `allow_execute: true`, with its own LLM control link) and `tool_cognee` (`GRAPH_COMPLETION` on dataset `parallax`) | `pipelines/parallax-analyst.pipe`, `pipelines/README.md`, `scripts/validate_pipes.py` | Open the **Pipeline** tab in Mission Control: the node graph is rendered from the `.pipe` file and shows the Cloud status from `/health`. Or open the file in the RocketRide VS Code extension canvas. |
| Per-call **fallback chain** `rocketride → anthropic → ollama` with provider attribution, so a Cloud hiccup never fails a run | `backend/app/llm/router.py` | Stop the network for RocketRide mid-run: subsequent steps show `provider: anthropic` in the Query log / agent steps. |
| Pipes follow the repo format (`components` first, `${ROCKETRIDE_*}` placeholders only, literal `project_id`, `version: 1`) and are validated in CI | `.github/workflows/ci.yml` (`pipes` job), `scripts/validate_pipes.py` | `make pipes-validate` |

### Cognee

> **Criterion (verbatim):** "Build persistent memory and context for your AI agents."

| What Parallax does | Code path | 30-second verification |
|---|---|---|
| After every run, a summary (`Dataset <name>: Q: <question>. Findings: …`) is written with `cognee.add(text, dataset_name="parallax", node_set=[dataset_id, "run:<id>"])` followed by `cognee.cognify(datasets=["parallax"])` **in a background task** so runs never block on memory | `backend/app/memory/cognee_memory.py` (`remember`), `orchestrator.py` phase 5 | The Memory tab shows `memory.remembered`. `curl localhost:8000/api/memory` → `{kind: "cognee", stats, recent}`. |
| **Memory primes the planner:** before planning, `recall(question, tags=[dataset_id])` runs `cognee.search(query_type=SearchType.GRAPH_COMPLETION, datasets=["parallax"], top_k=8)`; hits are injected into the planner prompt and streamed as `run.recalled` | `backend/app/memory/cognee_memory.py` (`recall`), `backend/app/swarm/prompts.py` | Run the same question twice on `saas_customers`. The second run's Memory tab lists what was recalled; the plan's hypotheses reference prior findings. `curl -X POST localhost:8000/api/memory/recall -d '{"q":"churn"}'`. |
| **Node sets per dataset and per run** scope memory so recalls for `ecommerce_orders` do not surface SaaS churn facts | `cognee_memory.py` | `POST /api/memory/recall {"q": "...", "tags": ["ecommerce_orders"]}` vs `["saas_customers"]`. |
| The **graph is rendered in the UI**: `cognee.visualize_graph()` HTML served at `GET /api/memory/graph` and embedded in `/memory` | `cognee_memory.py` (`graph_html`), `frontend/src/app/memory` | Open http://localhost:3000/memory; the iframe shows the Cognee graph (or an explanation card with "how to enable Cognee" in local mode). |
| Cognee is also exposed **to the RocketRide agent** as `tool_cognee` (remember / recall / memory_status) in `parallax-analyst.pipe` | `pipelines/parallax-analyst.pipe` | Pipeline tab → `tool_cognee` node with `search_type: GRAPH_COMPLETION`, dataset `parallax`. |
| Always works: if Cognee cannot initialise (no LLM + embedding provider), `LocalMemory` (JSON + Ollama embeddings) takes over with the same protocol | `backend/app/memory/local_memory.py`, `backend/app/memory/factory.py` | `PARALLAX_MEMORY_MODE=local` → badge `memory: local`, runs still recall and remember. |

### Snyk

| What Parallax does | Code path | 30-second verification |
|---|---|---|
| `snyk test --all-projects --severity-threshold=high` and `snyk code test` on every push and PR; `continue-on-error` so a missing token never blocks contributors | `.github/workflows/ci.yml` (`snyk` job) | Open the Actions tab → latest CI run → **Security · Snyk**. |
| Public badge + disclosure policy | `README.md`, `SECURITY.md` | Click the Snyk badge at the top of the README. |
| Design that limits blast radius: read-only SQL guard, per-branch isolation, secrets server-side only, 24 h database expiry | `SECURITY.md`, `backend/app/swarm/orchestrator.py`, `backend/app/config.py` | `/settings` shows env-var names and status, never values. |

## General judging

**Real job.** The question in the demo ("Why are customers churning and where is revenue at risk?") is the kind of thing an analyst spends a day on: slicing churn by segment, reading feedback, sizing MRR at risk, checking behavioural leading indicators. Parallax does all of those in parallel and returns a report whose every claim cites the branch and SQL that produced it. Upload any CSV up to 25 MB (`POST /api/datasets/upload`) and ask your own question.

**Real AI.** This is not a template filler. The planner produces distinct hypotheses with distinct strategies; each agent runs a think → act → observe loop with real tools (SQL, BM25, vector search) against real data, gets the observation fed back, retries on SQL errors, and decides when to finish. The synthesizer reconciles conflicting findings and writes next questions. Memory changes the plan on the next run. The whole chain runs through a RocketRide pipeline on Claude, with automatic fallback.

**Real scale.** Concurrency is measured, not claimed: `peak_concurrency`, `p50_ms`, `p95_ms`, `time_to_first_finding_ms`, and burst results are in every run's `metrics` and in the UI. Eight forks and one hundred concurrent reads are the demo defaults; `PARALLAX_MAX_AGENTS` (16) and burst (200) are the current caps, and Hotdata's `bulk` endpoint is on the roadmap for thousands of tenant databases.

**Real engineering.** Zero-key local mode runs the identical orchestrator and event protocol on DuckDB with a fake LLM; CI smoke-tests a full run that way on every commit. Type-safe API client mirrors the pydantic models. Every button in the UI does something real; every error surfaces as a toast plus inline state.

## Quick verification checklist

```bash
make dev                                   # or: make demo (zero keys)
curl -s localhost:8000/api/health          # resolved modes + rocketride reachability
open http://localhost:3000                 # Launch → saas_customers → 8 agents → Launch swarm
curl -s localhost:8000/api/runs | head     # RunSummary list
curl -s localhost:8000/api/runs/<id>/lineage
curl -s -X POST localhost:8000/api/runs/<id>/burst -H 'content-type: application/json' -d '{"queries":100}'
curl -s localhost:8000/api/runs/<id>/report.md
curl -s -X POST localhost:8000/api/memory/recall -H 'content-type: application/json' -d '{"q":"churn"}'
make test && make pipes-validate && make snyk
```
