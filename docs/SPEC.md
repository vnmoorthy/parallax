# Parallax — Product Spec & Architecture (source of truth for all builders)

> **Parallax** is a multi-agent data-analysis swarm. Give it a dataset and a question. It forks an isolated
> **Hotdata** database per hypothesis, runs analyst agents **concurrently** (SQL + BM25 + vector search),
> synthesizes a cited report, and **remembers** what it learned in **Cognee** so the next investigation starts
> smarter. Analyst reasoning runs as a **RocketRide** pipeline deployable to RocketRide Cloud. The repo is
> continuously scanned by **Snyk**.

Tagline: **"Many agents. Many branches. One answer."**

Hackathon: Data & AI Hackathon (SF, 2026-09-11). Prize criteria we target, verbatim:
- RocketRide: "Build your project on RocketRide Cloud and deploy an AI pipeline without managing any infrastructure."
- Hotdata: "Build an application where multiple agents or users need to search, query, or analyze data concurrently."
- Cognee: "Build persistent memory and context for your AI agents."

## 1. Repo layout

```
parallax/
├── backend/            # Python 3.12, FastAPI, uv. All orchestration, data engines, LLM routing, memory.
│   ├── app/
│   │   ├── main.py             # FastAPI app factory, CORS, routers, lifespan
│   │   ├── config.py           # pydantic-settings; reads backend/.env and repo-root .env
│   │   ├── api/routes.py       # all HTTP + SSE endpoints (section 4)
│   │   ├── data/base.py        # DataEngine protocol + dataclasses (section 3.1)
│   │   ├── data/hotdata.py     # HotdataEngine (HTTP, httpx.AsyncClient)
│   │   ├── data/local.py       # LocalEngine (DuckDB files; fork = file copy; FTS + vector via ollama)
│   │   ├── data/factory.py     # get_engine() -> picks hotdata if creds+reachable else local (mode=auto)
│   │   ├── llm/base.py         # LLM protocol: complete(system, user, *, json=True) -> str | dict
│   │   ├── llm/anthropic_llm.py
│   │   ├── llm/ollama_llm.py
│   │   ├── llm/rocketride_llm.py   # routes calls through pipelines/parallax-llm.pipe via rocketride SDK
│   │   ├── llm/router.py       # chain: rocketride -> anthropic -> ollama (configurable), per-call fallback
│   │   ├── memory/base.py      # Memory protocol: remember(text, tags), recall(q, tags) -> list, graph_html()
│   │   ├── memory/cognee_memory.py
│   │   ├── memory/local_memory.py  # JSON + ollama embeddings fallback so the app ALWAYS works
│   │   ├── memory/factory.py
│   │   ├── swarm/orchestrator.py   # the run engine (section 5)
│   │   ├── swarm/prompts.py        # all prompt templates
│   │   ├── swarm/events.py         # EventBus: per-run asyncio queues + replay buffer
│   │   ├── swarm/models.py         # pydantic models: Run, Branch, AgentStep, Finding, Report, Metrics, Event
│   │   ├── swarm/store.py          # RunStore: JSON files under .parallax/runs/
│   │   └── datasets.py             # bundled + uploaded datasets registry, preview, profiling
│   ├── tests/                  # pytest (LocalEngine, orchestrator w/ FakeLLM, API smoke)
│   ├── pyproject.toml          # uv project; deps below
│   └── .env.example
├── frontend/           # Next.js 15 App Router, TS, Tailwind v4. Talks to backend via NEXT_PUBLIC_API_URL.
├── pipelines/          # RocketRide .pipe files + README (open in VS Code canvas, deploy to Cloud)
├── datasets/           # bundled CSVs + scripts/generate_datasets.py output
├── docs/               # SPEC.md (this), ARCHITECTURE.md (+ mermaid + PNG), DEMO.md, JUDGES.md
├── deck/               # Parallax.pptx (10 slides) + STORYBOARD.md (3-min talk track)
├── scripts/            # dev.sh (runs both), generate_datasets.py, fetch_datasets.py
├── .github/workflows/ci.yml   # pytest + next build + snyk (continue-on-error)
├── docker-compose.yml, Makefile, .env.example, README.md, LICENSE (MIT), SECURITY.md, CONTRIBUTING.md
```

Backend deps (pyproject): fastapi, uvicorn[standard], httpx, pydantic, pydantic-settings, python-multipart,
sse-starlette, duckdb, pandas, pyarrow, anthropic, rocketride, cognee[anthropic], python-dotenv, orjson, numpy.
Dev: pytest, pytest-asyncio, ruff.

Frontend deps: next@16, react@19, tailwindcss@4, @xyflow/react (lineage tree), recharts, framer-motion,
lucide-react, sonner, react-markdown + remark-gfm, cmdk (command palette), clsx, tailwind-merge, zustand.

## 2. Environment & modes (backend/app/config.py)

All optional; the app runs with ZERO keys in local mode.

| Var | Purpose | Default |
|---|---|---|
| `PARALLAX_DATA_MODE` | `auto` \| `hotdata` \| `local` | `auto` (hotdata if key+workspace set and `GET /v1/databases` succeeds, else local) |
| `HOTDATA_API_KEY`, `HOTDATA_WORKSPACE_ID` | Hotdata Cloud | — |
| `HOTDATA_API_URL` | | `https://api.hotdata.dev/v1` |
| `PARALLAX_LLM_MODE` | `auto` \| `rocketride` \| `anthropic` \| `ollama` | `auto` (first healthy in chain rocketride→anthropic→ollama) |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | | model default `claude-sonnet-4-5` |
| `ROCKETRIDE_URI`, `ROCKETRIDE_APIKEY` | RocketRide engine (Cloud `https://api.rocketride.ai` or local `http://localhost:5565` key `MYAPIKEY`) | — |
| `ROCKETRIDE_ANTHROPIC_KEY` | substituted into .pipe files (only `${ROCKETRIDE_*}` vars substitute) | falls back to ANTHROPIC_API_KEY |
| `OLLAMA_HOST`, `OLLAMA_MODEL`, `OLLAMA_EMBED_MODEL` | local LLM/embeddings | `http://localhost:11434`, `llama3.1:8b`, `nomic-embed-text` |
| `PARALLAX_MEMORY_MODE` | `auto` \| `cognee` \| `local` | `auto` (cognee if importable AND an LLM key or ollama configured for it; else local) |
| `LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`, `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_ENDPOINT`, `EMBEDDING_DIMENSIONS` | Cognee's own config (we set sane defaults: anthropic LLM if key; embeddings via ollama nomic-embed-text 768) | — |
| `PARALLAX_DATA_DIR` | where runs/dbs/uploads live | `.parallax/` at repo root |
| `PARALLAX_MAX_AGENTS` | | 16 |

`GET /api/health` reports the resolved mode of each subsystem so the UI can show live badges
(e.g. `data: hotdata`, `llm: rocketride`, `memory: cognee`).

## 3. Core abstractions

### 3.1 DataEngine (backend/app/data/base.py)

```python
@dataclass
class DB:            id: str; name: str; parent_id: str | None; created_at: str; expires_at: str | None; connection_id: str | None = None
@dataclass
class QueryResult:   columns: list[str]; rows: list[list]; row_count: int; elapsed_ms: float; truncated: bool = False; sql: str = ""
@dataclass
class TableInfo:     name: str; columns: list[tuple[str, str]]; row_count: int | None
@dataclass
class LineageNode:   id: str; name: str; parent_id: str | None; created_at: str; exists: bool = True

class DataEngine(Protocol):
    kind: str  # "hotdata" | "local"
    async def create_database(self, name: str, *, expires: str = "24h") -> DB
    async def fork(self, db_id: str, name: str) -> DB
    async def load_csv(self, db_id: str, table: str, csv_text: str, *, mode: str = "replace", columns: dict[str,str] | None = None) -> int
    async def query(self, db_id: str, sql: str, *, limit: int = 200) -> QueryResult
    async def tables(self, db_id: str) -> list[TableInfo]
    async def create_index(self, db_id: str, table: str, column: str, kind: str) -> str   # kind: "bm25" | "vector"; returns index name; waits until ready
    async def bm25_search(self, db_id: str, table: str, column: str, q: str, k: int = 10) -> QueryResult
    async def vector_search(self, db_id: str, table: str, column: str, q: str, k: int = 10) -> QueryResult
    async def lineage(self, db_id: str) -> list[LineageNode]     # whole family tree (root + all forks)
    async def set_context(self, db_id: str, name: str, content: str) -> None
    async def get_context(self, db_id: str) -> dict[str, str]
    async def delete(self, db_id: str) -> None
    def table_ref(self, db_id: str, table: str) -> str   # fully-qualified name to use in SQL (hotdata: default.public.<t>; local: <t>)
```

Hotdata facts to honor (from docs, verified): SQL is read-only; rows are written via
`POST /v1/databases/{id}/schemas/public/tables/{table}/loads` with `{"mode":"replace|append","data":"<csv<=2MiB>"}`;
`POST /v1/databases` body `{"name","expires_at":"24h","schemas":[{"name":"public","tables":[{"name":"data"}]}]}`;
`POST /v1/databases/{id}/fork` `{"name"}`; `GET /v1/databases/{id}/lineage`; `POST /v1/query` with header
`X-Database-Id` and body `{"sql"}` → `{columns:[{name,..}], rows:[[..]], execution_time_ms, total_row_count, truncated}`;
indexes: `POST /v1/connections/{default_connection_id}/tables/public/{table}/indexes`
`{"index_name","columns":[col],"index_type":"bm25"|"vector","metric":"cosine"}` (201 ready / 202 poll `GET .../indexes` until status ready);
search SQL: `SELECT ..., score FROM bm25_search('default.public.t','col','q',k) ORDER BY score DESC` and
`SELECT ..., _distance FROM vector_search('default.public.t','col','q',k) ORDER BY _distance ASC`
(a provider-backed vector index must be the ONLY index on its table → for vector search create table `data_vec`
as a copy via load of the same CSV; forks drop indexes → create indexes on the branch that needs them);
context docs: `POST /v1/databases/{id}/context {"name","content"}`, `GET .../context`. Headers on every call:
`Authorization: Bearer`, `X-Workspace-Id`. Always fully-qualify tables as `default.public.<t>`.

Local engine: one DuckDB file per DB under `PARALLAX_DATA_DIR/dbs/<id>.duckdb`; fork = close+copy file;
BM25 = DuckDB `fts` extension (`PRAGMA create_fts_index('t','rowid_col','col')`, `fts_main_t.match_bm25`) — add an
integer `__rowid` column on load; vector = compute embeddings with ollama `nomic-embed-text` into `FLOAT[768]`
column `<col>__emb` on `create_index(kind="vector")`, query via `array_cosine_similarity`; if ollama is
unavailable, fall back to a deterministic hashed bag-of-words embedding so the code path still works. Lineage +
context stored in `PARALLAX_DATA_DIR/dbs/manifest.json`. Track `elapsed_ms` per query.

### 3.2 LLM (backend/app/llm/base.py)

```python
class LLM(Protocol):
    name: str   # "rocketride" | "anthropic" | "ollama"
    async def complete(self, system: str, user: str, *, json_mode: bool = True, max_tokens: int = 2000) -> str
    async def healthy(self) -> bool
```
`router.py`: `get_llm()` returns a `RoutedLLM` that tries providers in chain order per call, falling back on
exception, and records which provider served each call (exposed in run metrics as `llm_calls_by_provider`).
Provide `extract_json(text) -> dict|list` that tolerates code fences and leading prose.
RocketRideLLM: `RocketRideClient(uri=ROCKETRIDE_URI, auth=ROCKETRIDE_APIKEY)`, `use(filepath="pipelines/parallax-llm.pipe")` once
(cache token, `ttl` long), then `chat(token, Question)` where `Question(expectJson=json_mode)`, `addInstruction("System", system)`,
`addQuestion(user)`; parse `response.get("data",{}).get("answer") or (response.get("answers") or [None])[0]`.
Substitute `${ROCKETRIDE_ANTHROPIC_KEY}` from env before `use()` if SDK does not.

### 3.3 Memory (backend/app/memory/base.py)

```python
class Memory(Protocol):
    kind: str  # "cognee" | "local"
    async def remember(self, text: str, *, tags: list[str]) -> None       # tags -> cognee node_set; dataset_name="parallax"
    async def recall(self, query: str, *, tags: list[str] | None = None, k: int = 8) -> list[MemoryHit]  # MemoryHit(text, score, tags, created_at)
    async def stats(self) -> dict          # counts
    async def graph_html(self) -> str | None   # cognee.visualize_graph -> html; local: None
```
Cognee usage (v1.5.4): `cognee.add(text, dataset_name="parallax", node_set=tags)`, `cognee.cognify(datasets=["parallax"])`,
`cognee.search(query, query_type=SearchType.GRAPH_COMPLETION | CHUNKS, datasets=["parallax"], top_k=k)`,
`cognee.visualize_graph(path)`. Set `ENABLE_BACKEND_ACCESS_CONTROL=false`, `TELEMETRY_DISABLED=true`. Run cognify in a
background task (`asyncio.create_task`) so runs are never blocked by memory writes. Cognee requires BOTH an LLM and
an embedding provider configured (`LLM_PROVIDER=anthropic` + `EMBEDDING_PROVIDER=ollama`, model `nomic-embed-text:latest`,
endpoint `http://localhost:11434/api/embed`, dims 768; or `LLM_PROVIDER=ollama` fully local). If init fails → local memory.

## 4. HTTP API (backend/app/api/routes.py) — all JSON, prefix `/api`

| Method | Path | Body / Returns |
|---|---|---|
| GET | `/health` | `{ok, data:{mode,kind,detail}, llm:{chain:[...],active}, memory:{kind}, rocketride:{configured,reachable}, version}` |
| GET | `/datasets` | `[{id,name,description,rows,columns:[{name,type}],source:"bundled"|"upload",text_columns:[...],suggested_questions:[...]}]` |
| POST | `/datasets/upload` | multipart `file` (CSV ≤ 25MB) → dataset object |
| GET | `/datasets/{id}/preview?limit=20` | `{columns, rows, profile:{col:{type,nulls,distinct,min,max,top}}}` |
| POST | `/runs` | `{dataset_id, question, agents:int(2..16), search_column?:str}` → `{run_id}` (starts background task) |
| GET | `/runs` | `[RunSummary]` newest first |
| GET | `/runs/{id}` | full `Run` (section 5 model) |
| GET | `/runs/{id}/events` | **SSE**; replays buffered events then streams live; event `data` is an `Event` JSON; ends with `{type:"run.finished"}` |
| POST | `/runs/{id}/query` | `{branch_id, sql}` → `QueryResult` (ad-hoc SQL console against any branch) |
| POST | `/runs/{id}/search` | `{branch_id, kind:"bm25"|"vector", q, k}` → `QueryResult` |
| GET | `/runs/{id}/lineage` | `[LineageNode]` |
| GET | `/runs/{id}/report.md` | text/markdown download |
| POST | `/runs/{id}/burst` | `{queries:int(10..200)}` → fires N concurrent read queries spread across branches; returns `{count, p50_ms, p95_ms, max_ms, total_ms, per_query:[ms...]}` and also emits `metrics.burst` event |
| DELETE | `/runs/{id}` | deletes run + its databases |
| GET | `/memory` | `{kind, stats, recent:[MemoryHit]}` |
| POST | `/memory/recall` | `{q, tags?}` → `[MemoryHit]` |
| GET | `/memory/graph` | text/html (cognee graph) or 404 `{reason}` in local mode |

CORS: allow `http://localhost:3000` and `*` in dev. Errors: `{error:{code,message}}` with proper status codes.

## 5. Swarm run model & event protocol

```python
class Run(BaseModel):
    id: str; created_at: str; status: Literal["queued","provisioning","planning","exploring","synthesizing","done","failed"]
    dataset_id: str; dataset_name: str; question: str; agents: int
    modes: dict  # {data:"hotdata"|"local", llm:"rocketride"|..., memory:"cognee"|"local"}
    root_db: DB | None; branches: list[Branch]; recalled: list[MemoryHit]; plan: list[Hypothesis]
    report: Report | None; metrics: Metrics; error: str | None
class Hypothesis(BaseModel): id: str; title: str; rationale: str; approach: Literal["sql","bm25","vector","mixed"]; target_columns: list[str]
class Branch(BaseModel): id: str; hypothesis_id: str; db: DB | None; status: Literal["forking","exploring","done","failed"]; steps: list[AgentStep]; finding: Finding | None
class AgentStep(BaseModel): n: int; kind: Literal["think","sql","bm25","vector","observe","finding"]; text: str; sql: str | None; result: QueryResult | None; elapsed_ms: float | None; provider: str | None
class Finding(BaseModel): claim: str; evidence: str; confidence: float; supporting_sql: list[str]; chart: ChartSpec | None; tags: list[str]
class ChartSpec(BaseModel): type: Literal["bar","line","pie","number"]; title: str; x: str | None; y: str | None; data: list[dict]
class Report(BaseModel): title: str; executive_summary: str; markdown: str; key_findings: list[dict]; next_questions: list[str]; citations: list[dict]  # {branch_id, hypothesis}
class Metrics(BaseModel): databases_created: int; forks: int; queries: int; peak_concurrency: int; p50_ms: float; p95_ms: float; llm_calls: int; llm_calls_by_provider: dict; started_at: str; finished_at: str | None; elapsed_ms: float | None; time_to_first_finding_ms: float | None; burst: dict | None
class Event(BaseModel): ts: str; type: str; run_id: str; branch_id: str | None = None; payload: dict
```

Event types (SSE): `run.status` {status}, `run.recalled` {hits}, `run.plan` {hypotheses}, `db.created` {db},
`db.forked` {db, parent_id, branch_id}, `agent.step` {step}, `agent.finding` {finding}, `branch.status` {status},
`metrics.update` {metrics}, `metrics.burst` {…}, `report.ready` {report}, `memory.remembered` {n}, `run.error` {message},
`run.finished` {}.

Orchestrator algorithm (backend/app/swarm/orchestrator.py):
1. `provisioning`: root = create_database("parallax-<runid>"); load dataset CSV into table `data` (chunk CSV to ≤1.5MiB appends);
   profile schema via `tables()` + `SELECT` stats; if a text column exists (dataset.text_columns[0] or request.search_column)
   also load `data_vec` (same CSV) and create bm25 index on `data.<text>` and vector index on `data_vec.<text>` on the ROOT
   (LocalEngine) — on Hotdata, indexes don't survive forks, so create them lazily per branch when the agent first needs search
   (cache per branch). Emit db.created.
2. `planning`: recall(question, tags=[dataset_id]) → `recalled`; planner prompt (schema, sample rows, question, recalled)
   → exactly `agents` hypotheses with diverse approaches (ensure ≥1 bm25 and ≥1 vector when a text column exists).
3. `exploring`: `asyncio.gather` over hypotheses with a semaphore = agents. Each agent: fork root → branch db (emit db.forked);
   loop up to 4 tool steps: LLM returns `{"thought","action":"sql"|"bm25"|"vector"|"finish","sql"|"query","column"}`;
   execute via engine (record elapsed, concurrency counter); feed observation (columns + up to 15 rows) back; on `finish`
   return Finding JSON incl. chart spec built from the last result. Write finding row to branch table `findings`
   (load append csv: id,claim,confidence,evidence) and `set_context(branch, "NOTES", markdown notes)`. Emit agent.step per step.
   Guardrails: strip trailing semicolons, add LIMIT if missing, reject non-SELECT/WITH statements, retry once on SQL error
   with the error message in context. Track peak concurrency with an in-flight counter.
4. `synthesizing`: synthesizer prompt (question, all findings, metrics) → Report markdown with `[branch:<id>]` citations.
5. `remember`: text = f"Dataset {name}: Q: {question}. Findings: ..." tags=[dataset_id, "run:<id>"] (background). Emit memory.remembered.
6. `done`: metrics finalize; persist run JSON after every event (debounced).

Fake LLM for tests: `FakeLLM` returns canned JSON for planner/agent/synth prompts based on markers in the system prompt.

## 6. Frontend (Next.js) — pages & UX

Design: dark, premium "mission control". Background `#07090f`, surfaces `#0e1220`/`#141a2c`, borders `rgba(255,255,255,.08)`,
accent gradient indigo→cyan (`#6366f1`→`#22d3ee`), success `#34d399`, warn `#fbbf24`, danger `#f87171`. Font: Inter (via
next/font) + JetBrains Mono for SQL. Rounded-xl cards, subtle glass, motion on mount, skeleton loaders, empty states, toasts.
Every button does something real. Fully responsive. Keyboard: `⌘K` command palette (Launch run, Go to runs, Memory, Settings).

Routes:
- `/` **Launch**: hero ("Many agents. Many branches. One answer."), live mode badges from /health, dataset cards (bundled + upload
  dropzone), preview drawer (table + column chips), question input with suggested questions chips, agent-count slider (2–16,
  default 6), optional search column select, **Launch swarm** → POST /runs → router.push(`/runs/{id}`).
- `/runs/[id]` **Mission Control** (SSE-driven, zustand store):
  - Top strip: status stepper (provision→plan→explore→synthesize→done), metrics tiles (DBs, forks, queries, peak concurrency,
    p50/p95 ms, LLM calls by provider, elapsed) live-updating, mode badges, `Burst 100 queries` button → POST /burst → latency histogram modal.
  - Left: **Lineage tree** (React Flow, dagre-like vertical layout, root node + branch nodes; node color by status; click → selects branch;
    animated edges while exploring).
  - Center: **Agent grid** — one card per branch: hypothesis title, approach badge, status, live step timeline (think/sql/bm25/vector/observe),
    SQL rendered in mono with copy button, result mini-table (first 5 rows), finding with confidence bar + mini chart (recharts).
  - Right / bottom tabs: **Report** (react-markdown; `[branch:x]` citations rendered as clickable chips), **Findings** (sortable table),
    **Query log** (every query with ms + branch), **Memory** (what was recalled before planning + what was remembered), **SQL console**
    (branch select + textarea + Run ⌘↵ → table; also BM25/vector search box), **Pipeline** (shows pipelines/parallax-analyst.pipe as
    a rendered mini node graph + "Deployed on RocketRide Cloud" status from /health).
  - Export: Download report.md; Copy share link; Re-run with same question.
- `/runs` **History**: table of runs (status, dataset, question, agents, elapsed, p50) with delete.
- `/memory` **Memory**: recall search box, hits list, stats tiles, embedded graph iframe (`/api/memory/graph`) when cognee, otherwise
  an explanation card with "how to enable Cognee".
- `/settings` **Connections**: cards for Hotdata / RocketRide / Cognee / LLM showing live status from /health, the env var names to set,
  copy-to-clipboard `.env` template, and links to sponsor docs. (Read-only; secrets never entered in the browser.)
- Shared: `components/ui/*` (Button, Card, Badge, Tabs, Dialog, Table, Tooltip, Skeleton, Kbd), `lib/api.ts` (typed fetchers + `useRunStream`),
  `lib/store.ts` (zustand run store applying events), `components/Nav.tsx`, `components/ModeBadges.tsx`, `components/LineageTree.tsx`,
  `components/AgentCard.tsx`, `components/MetricsStrip.tsx`, `components/ReportView.tsx`, `components/SqlConsole.tsx`, `components/BurstDialog.tsx`,
  `components/CommandPalette.tsx`, `components/PipelineGraph.tsx`.

## 7. RocketRide pipelines (pipelines/)

- `parallax-llm.pipe`: `chat_1` → `llm_anthropic_1` (input lane `questions`, profile `claude-sonnet-4-6`, apikey `${ROCKETRIDE_ANTHROPIC_KEY}`)
  → `response_answers_1` (`{"laneName":"answers"}`). Used by RocketRideLLM for every planner/agent/synth call when RocketRide is configured.
- `parallax-analyst.pipe` (showcase; deployable to Cloud): `chat_1` → `agent_rocketride_1` ("Parallax Analyst", instructions about
  hypothesis-driven analysis, `max_waves` 12) → `response_answers_1`; agent controls `llm_anthropic_1` (llm), `memory_internal_1` (memory),
  `db_hotdata_1` (tool; config profile default with `${ROCKETRIDE_DB_HOTDATA_KEY}`, `${ROCKETRIDE_DB_HOTDATA_WORKSPACE_ID}`, ttl 24h, table `data`,
  allow_execute true) whose own `control` includes `{classType:"llm", from:"db_hotdata_1"}` on `llm_anthropic_1`, and `tool_cognee_1`
  (`base_url` `${ROCKETRIDE_COGNEE_BASE_URL}`, dataset `parallax`, search_type `GRAPH_COMPLETION`).
- Format rules: JSON, `components` first, each component `{id, provider, config, input|control, ui}`; `project_id` literal UUID; `version: 1`;
  `viewport`. Only `${ROCKETRIDE_*}` placeholders substitute. Provide `pipelines/README.md` (how to open in VS Code, run locally on the
  Docker engine `ghcr.io/rocketride-org/rocketride-engine:latest` port 5565 key `MYAPIKEY`, deploy to Cloud) and `pipelines/.env.example`.

## 8. Datasets (datasets/ + scripts/generate_datasets.py)

Bundled (committed CSVs, each ≤ 3 MB):
1. `saas_customers.csv` (6,000 rows, synthetic, seeded): customer_id, company, industry, region, plan, seats, mrr, signup_date,
   last_active_date, support_tickets_90d, nps_score, churned (0/1), churn_reason (text, nullable), feedback (free text 1–2 sentences).
   Text column: `feedback`. Suggested Qs: "Why are customers churning and where is revenue at risk?", "Which segments have the best expansion potential?"
2. `ecommerce_orders.csv` (8,000 rows, synthetic): order_id, customer_id, order_date, city, state, category, product, quantity, unit_price,
   discount_pct, shipping_days, returned (0/1), rating (1–5), review_text. Text column: `review_text`.
   Suggested Qs: "What drives returns and low ratings?", "Where should we invest marketing next quarter?"
3. `sf_airbnb_listings.csv` (real; fetched by scripts/fetch_datasets.py from https://hotdata.dev/data/sf-airbnb-listings.parquet →
   CSV via pyarrow; if fetch fails, generate a 3,000-row synthetic stand-in with the same columns: id, name, neighbourhood, room_type,
   price, minimum_nights, number_of_reviews, availability_365, description). Text column: `description`.
   Suggested Qs: "What makes a listing command a premium price?", "Which neighborhoods are under-supplied for families?"
Registry: `datasets/registry.json` with id, name, description, file, text_columns, suggested_questions.

## 9. Quality bar

- `make dev` (or `scripts/dev.sh`) starts backend :8000 and frontend :3000; `make test` runs pytest + `next build`.
- Zero-key mode must complete a full run end-to-end on a laptop with only ollama (or even without ollama using FakeLLM when
  `PARALLAX_LLM_MODE=fake`) — this is how CI smoke-tests the orchestrator.
- No dead buttons. Every error surfaces as a toast + inline state. Loading skeletons everywhere data loads.
- Type-safe API client generated by hand in `frontend/src/lib/types.ts` mirroring section 5 models.
