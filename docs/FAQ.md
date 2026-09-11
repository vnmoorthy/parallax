# Parallax FAQ

### 1. Why fork a database per hypothesis instead of letting all agents share one?

Three reasons, in order of importance:

- **Isolation.** Each agent gets its own tables, its own `findings` table and its own `NOTES` context doc. One agent creating a `data_vec` copy or an index cannot slow down or confuse another. A runaway query is confined to a disposable branch.
- **Reproducibility.** A fork is a snapshot of the root at fork time. The report cites `[branch:<id>]`; you can open the SQL console, pick that branch, and re-run the exact `supporting_sql` against exactly the data the agent saw, even after the root has been reloaded.
- **Lineage is free.** Hotdata's `GET /databases/{id}/lineage` returns the whole family tree, so the Mission Control tree is a real API response rather than a UI-side drawing.

On Hotdata a fork is a server-side copy of schemas, tables and data that completes in milliseconds and has its own query path, so N agents can query N databases at once without contending for one. Locally, a fork is a DuckDB file copy. See [`ARCHITECTURE.md` §5](ARCHITECTURE.md#5-the-dataengine-abstraction-and-fork-per-hypothesis).

### 2. Does it work offline, or without any API keys?

Yes. `make demo` runs the whole product with zero keys: the data engine is DuckDB (fork = file copy, BM25 via the `fts` extension, vector search via Ollama `nomic-embed-text` or a deterministic hashed bag-of-words fallback if Ollama is not running), the LLM is `FakeLLM` (`PARALLAX_LLM_MODE=fake`, canned planner / agent / synthesizer JSON), and memory is a local JSON store. The orchestrator, event protocol, persistence and UI are identical; CI smoke-tests a full run this way. With Ollama installed you can set `PARALLAX_LLM_MODE=ollama` for real (local) reasoning. `GET /api/health` tells you which mode each subsystem resolved to.

### 3. What does it cost to run?

- **Hotdata:** databases are created with `expires_at: 24h` and deleted with the run; a demo run creates 1 root + N forks (N = agents, 2–16) and tens of small read queries. Vector indexes use the workspace's system embedding provider.
- **RocketRide Cloud:** one pipeline session per backend process (`use()` is called once and the token cached); each planner / agent-step / synthesizer call is one `chat()`. A run with 8 agents is typically 15–40 LLM calls.
- **Anthropic:** billed per token behind RocketRide (or directly, if RocketRide is not configured). Prompts are small: schema, a few sample rows, up to 15 observed rows per step.
- **Cognee:** `cognify` makes a handful of LLM calls per remembered run plus embeddings (Ollama, free, or your configured provider).
- **Zero-key mode:** free.

Set `PARALLAX_MAX_AGENTS` (default 16) and the burst cap (200) to bound worst-case usage.

### 4. How does memory work? What exactly is remembered?

After the report is written, the orchestrator calls `Memory.remember(text, tags=[dataset_id, "run:<id>"])` where `text` is `Dataset <name>: Q: <question>. Findings: <claims with confidence>`. With Cognee this becomes `cognee.add(text, dataset_name="parallax", node_set=tags)` followed by `cognee.cognify(datasets=["parallax"])` in a background task, so the run reaches `done` without waiting for the graph to build.

Before planning the next run on the same dataset, `Memory.recall(question, tags=[dataset_id])` runs `cognee.search(query_type=SearchType.GRAPH_COMPLETION, datasets=["parallax"], top_k=8)`. The hits are streamed to the UI as `run.recalled` and injected into the planner prompt, so the second investigation starts from what the first one learned (and can be told to look elsewhere). Node sets keep datasets apart: churn facts from `saas_customers` do not surface when you ask about `ecommerce_orders`. The graph is rendered at `/memory` via `cognee.visualize_graph()`. Code: `backend/app/memory/cognee_memory.py`.

If Cognee cannot initialise (it needs both an LLM and an embedding provider), `LocalMemory` (JSON + Ollama embeddings) takes over with the same protocol.

### 5. How do I add a dataset?

Two ways:

- **Upload in the UI.** Drop a CSV (up to 25 MB) on the Launch page; it goes through `POST /api/datasets/upload`, is profiled, and appears as a card with detected text columns.
- **Bundle it.** Put a CSV (3 MB or smaller) in `datasets/` (or extend `scripts/generate_datasets.py`) and add an entry to `datasets/registry.json` with `id`, `name`, `description`, `file`, `text_columns` and `suggested_questions`. Restart the backend.

The first entry in `text_columns` is what BM25 and vector search index; you can override it per run with `search_column`.

### 6. How do I deploy the pipeline to RocketRide Cloud?

The backend already *executes* on RocketRide Cloud when you set `ROCKETRIDE_URI=https://api.rocketride.ai` and a Cloud API key: `RocketRideClient.use(filepath="pipelines/parallax-llm.pipe")` uploads the pipeline and every `chat()` runs there, with no engine to host. To publish `parallax-analyst.pipe` as a standing deployment:

1. Fill in `pipelines/.env.example` → `.env` with `ROCKETRIDE_ANTHROPIC_KEY`, `ROCKETRIDE_DB_HOTDATA_KEY`, `ROCKETRIDE_DB_HOTDATA_WORKSPACE_ID`, `ROCKETRIDE_COGNEE_BASE_URL` (only `${ROCKETRIDE_*}` placeholders are substituted).
2. Open the `.pipe` in the RocketRide VS Code extension canvas, set `rocketride.deployment.connectionMode` to `cloud` with your team id, and click **Deploy**; or use the SDK's `client.deploy.add / publish / deploy`.
3. To try it locally first: `docker run -p 5565:5565 ghcr.io/rocketride-org/rocketride-engine:latest`, then `ROCKETRIDE_URI=http://localhost:5565 ROCKETRIDE_APIKEY=MYAPIKEY`.

`pipelines/README.md` has the step-by-step; `make pipes-validate` checks the files before you push.

### 7. Which LLM answers, and what happens when a provider fails?

`backend/app/llm/router.py` builds a `RoutedLLM` over the chain `rocketride → anthropic → ollama` (configurable with `PARALLAX_LLM_MODE`). Every call tries providers in order and falls back on exception, and each `AgentStep` records the `provider` that served it; run metrics expose `llm_calls_by_provider`. The default model behind RocketRide is `claude-sonnet-4-6` (pipeline profile) and behind the direct Anthropic client `claude-sonnet-4-5` (`ANTHROPIC_MODEL`). `PARALLAX_LLM_MODE=fake` selects the deterministic `FakeLLM` used by tests.

### 8. Can an agent modify or delete my data?

No. Hotdata's SQL endpoint is read-only at the platform level (no `INSERT`/DDL; rows only enter through the loads API). On top of that the orchestrator strips trailing semicolons, rejects anything that is not a `SELECT`/`WITH` statement, and appends a `LIMIT` when one is missing; the same guard covers the ad-hoc SQL console and the local DuckDB engine. The only writes Parallax performs are `load_csv` calls into tables it created itself (`data`, `data_vec`, `findings`) inside databases it created itself. See [`SECURITY.md`](../SECURITY.md).

### 9. What happens to the databases after a run?

Every Hotdata database is created with `expires_at: 24h`, so they disappear on their own. `DELETE /api/runs/{id}` (the trash icon in `/runs`) deletes the run record *and* every database it created immediately. Run JSON lives under `.parallax/runs/`; local DuckDB files under `.parallax/dbs/`. `PARALLAX_DATA_DIR` moves all of it.

### 10. How does the UI stay live, and what if I refresh mid-run?

`GET /api/runs/{id}/events` is a Server-Sent Events stream. The `EventBus` keeps a per-run replay buffer, so a new subscriber (a refresh, a second tab, a colleague with the share link) first receives every event since the run started, then the live tail; the zustand store applies them in order and rebuilds the same state. The stream ends with `run.finished`. Event types and payloads are listed in [`ARCHITECTURE.md` §4](ARCHITECTURE.md#4-event-protocol-sse).
