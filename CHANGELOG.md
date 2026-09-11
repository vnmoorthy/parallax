# Changelog

All notable changes to Parallax are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

- Merge branches: combine two forked databases' findings into a third fork.
- Hotdata bulk-create for thousands of tenant databases (`POST /databases/bulk`).
- "Deploy to RocketRide Cloud" button in the Pipeline tab.
- Cognee temporal memory (`SearchType.TEMPORAL`) so recalls can be scoped to "what changed since last quarter".
- Multi-user live cursors on Mission Control.

## [0.1.0] — 2026-09-11

Hackathon release, built in one day at the Data & AI Hackathon (AWS Builder Loft, San Francisco).

### Added

**Swarm orchestration**
- Five-phase run engine (`provisioning → planning → exploring → synthesizing → done`) in `backend/app/swarm/orchestrator.py`.
- Planner produces exactly `N` hypotheses (2–16) with diverse approaches (`sql`, `bm25`, `vector`, `mixed`), guaranteeing at least one BM25 and one vector hypothesis when the dataset has a text column.
- One isolated database fork per hypothesis; agents run concurrently under `asyncio.gather` with a semaphore sized to the agent count.
- Per-agent tool loop (up to 4 steps: think → sql / bm25 / vector → observe → finish) with SQL guardrails: `SELECT`/`WITH` only, trailing semicolons stripped, `LIMIT` injected, one retry on SQL error with the error in context.
- Each agent writes its finding back to a `findings` table on its branch and stores markdown notes as a per-database context doc (`NOTES`).
- Synthesizer produces a Markdown report with `[branch:<id>]` citations, key findings, and next questions.
- Live metrics: databases created, forks, queries, peak concurrency (in-flight counter), p50/p95 query latency, LLM calls by provider, time to first finding, elapsed.
- Burst mode (`POST /api/runs/{id}/burst`) fires 10–200 concurrent read queries across branches and reports p50/p95/max.
- Server-Sent Events stream per run (`GET /api/runs/{id}/events`) with a replay buffer so late subscribers see the full history.
- Runs persisted as JSON under `.parallax/runs/`; `GET /api/runs/{id}/report.md` for download.

**Data engines**
- `DataEngine` protocol (`backend/app/data/base.py`) with two implementations selected by `PARALLAX_DATA_MODE=auto|hotdata|local`.
- `HotdataEngine` (`backend/app/data/hotdata.py`): databases with 24 h expiry, `POST /databases/{id}/fork`, lineage, inline CSV loads chunked to 1.5 MiB, read-only HotSQL queries, BM25 and vector indexes created lazily per branch, per-database context docs.
- `LocalEngine` (`backend/app/data/local.py`): one DuckDB file per database, fork = file copy, BM25 via the DuckDB `fts` extension, vector search via Ollama `nomic-embed-text` embeddings with a deterministic hashed bag-of-words fallback.

**LLM routing**
- `RoutedLLM` chain `rocketride → anthropic → ollama` with per-call fallback and provider attribution in run metrics.
- `RocketRideLLM` (`backend/app/llm/rocketride_llm.py`) routes every planner/agent/synthesizer call through `pipelines/parallax-llm.pipe` using the `rocketride` SDK (`use()` once, cached token, `chat()` per call).
- `FakeLLM` (`PARALLAX_LLM_MODE=fake`) returns canned planner/agent/synth JSON so CI and `make demo` run with zero keys.

**Memory**
- `Memory` protocol with `CogneeMemory` (`backend/app/memory/cognee_memory.py`): `cognee.add` with node sets per dataset and run, background `cognify`, `GRAPH_COMPLETION` search, and `visualize_graph` HTML served at `GET /api/memory/graph`.
- `LocalMemory` fallback (JSON + Ollama embeddings) so the app always works.
- Planner is primed with recalled memory from previous runs on the same dataset.

**RocketRide pipelines**
- `pipelines/parallax-llm.pipe`: `chat → llm_anthropic → response_answers`.
- `pipelines/parallax-analyst.pipe`: `agent_rocketride` "Parallax Analyst" controlling `llm_anthropic`, `memory_internal`, `db_hotdata` (Hotdata tool with execute allowed) and `tool_cognee` (GRAPH_COMPLETION over the `parallax` dataset). Deployable to RocketRide Cloud.
- `scripts/validate_pipes.py` and `make pipes-validate`.

**Frontend (Next.js 16, App Router, Tailwind v4)**
- `/` Launch: live mode badges, dataset cards + CSV upload dropzone, preview drawer, suggested questions, agent-count slider.
- `/runs/[id]` Mission Control: status stepper, metrics tiles, lineage tree (React Flow), agent grid with live step timelines, SQL with copy, confidence bars and mini charts, tabs for Report / Findings / Query log / Memory / SQL console / Pipeline, burst-latency histogram, report download.
- `/runs` history, `/memory` recall + graph, `/settings` connection status (read-only; secrets never enter the browser).
- `⌘K` command palette.

**Datasets**
- Bundled `saas_customers` (6,000 rows), `ecommerce_orders` (8,000 rows), and `sf_airbnb_listings` (real listings fetched from hotdata.dev, with a synthetic stand-in if the fetch fails), registered in `datasets/registry.json`.

**Tooling and security**
- `Makefile` targets: `setup`, `dev`, `demo`, `test`, `pipes-validate`, `snyk`; `docker-compose.yml`.
- GitHub Actions CI: backend pytest (fake LLM, local data), frontend type-check + build, pipe validation, Snyk open-source and code scans.
- `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue and PR templates, `CODEOWNERS`.

[Unreleased]: https://github.com/vnmoorthy/parallax/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/vnmoorthy/parallax/releases/tag/v0.1.0
