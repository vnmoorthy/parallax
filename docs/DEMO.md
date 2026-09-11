# Parallax — 3-minute demo script

Goal: in three minutes a judge sees one real analytical question answered by eight concurrent agents on eight forked Hotdata databases, watches the concurrency and latency numbers move, reads a cited report, and sees that the system remembered the run.

## Pre-flight checklist (15 minutes before)

**Services**

- [ ] `cp .env.example .env` and fill in `HOTDATA_API_KEY`, `HOTDATA_WORKSPACE_ID`, `ROCKETRIDE_URI=https://api.rocketride.ai`, `ROCKETRIDE_APIKEY`, `ROCKETRIDE_ANTHROPIC_KEY` (or `ANTHROPIC_API_KEY`), and the Cognee block (`LLM_PROVIDER=anthropic`, `LLM_API_KEY`, `EMBEDDING_PROVIDER=ollama`, `EMBEDDING_MODEL=nomic-embed-text:latest`, `EMBEDDING_ENDPOINT=http://localhost:11434/api/embed`, `EMBEDDING_DIMENSIONS=768`).
- [ ] `ollama serve` is running; warm both models so the first embedding call is not slow:
  ```bash
  ollama pull nomic-embed-text && ollama pull llama3.1:8b
  curl -s localhost:11434/api/embed -d '{"model":"nomic-embed-text","input":"warm up"}' >/dev/null
  ```
- [ ] `make dev` → backend on :8000, frontend on :3000. Keep this terminal visible on a second screen; the orchestrator logs are part of the show.
- [ ] Health badges are all cloud:
  ```bash
  curl -s localhost:8000/api/health | python -m json.tool
  # expect data.kind = "hotdata", llm.active = "rocketride", memory.kind = "cognee", rocketride.reachable = true
  ```
  If any badge is `local`, fix it now or decide to demo it as the fallback story. Never be surprised by a badge on stage.

**Data and memory**

- [ ] Open http://localhost:3000 and confirm three dataset cards render: `saas_customers`, `ecommerce_orders`, `sf_airbnb_listings`.
- [ ] **Seed memory.** Run one warm-up swarm on `saas_customers` with any churn question 10+ minutes before the demo so `cognify` has finished. The demo run will then show real recalled hits under Memory. Check with:
  ```bash
  curl -s -X POST localhost:8000/api/memory/recall -H 'content-type: application/json' -d '{"q":"churn","tags":["saas_customers"]}'
  ```
- [ ] Leave that warm-up run in `/runs` history as a backup: if the live run misbehaves, open the finished one and narrate from it.

**Browser**

- [ ] One window, 1440 px wide or more, zoom 110 %, dark OS theme, notifications off.
- [ ] Tabs open in order: `localhost:3000` (Launch), Hotdata dashboard (databases list), RocketRide Cloud dashboard. Nothing else.
- [ ] Press `⌘K` once to make sure the command palette opens (it is a nice flourish if you have time).

**Fallback plan**

- If Hotdata is unreachable: `PARALLAX_DATA_MODE=local make dev`; the badge turns `data: local`, the demo is otherwise identical (forks become DuckDB file copies). Say so out loud; it is a feature.
- If RocketRide is unreachable: the LLM chain falls back to Anthropic automatically and the LLM tile shows `anthropic`. Point at it: per-call fallback is the point.
- If everything is down: `make demo` runs the whole thing on the fake LLM. It still forks, still streams, still produces a report.

## The script

Timings are cumulative. Bold text is what to say; bullets are what to click.

### 0:00 — Hook (20 s)

Screen: Launch page, hero visible with the three green badges.

**"Every analytics team has the same bottleneck: one analyst, one query at a time, one hypothesis at a time. Parallax removes that. Give it a dataset and a question; it forks the database once per hypothesis and lets a swarm of agents explore all of them at the same time. Then it writes one cited answer and remembers what it learned."**

- Point at the badges: **"Data on Hotdata, reasoning through RocketRide Cloud, memory in Cognee. All live right now."**

### 0:20 — Launch (30 s)

- Click the **saas_customers** card. **"Six thousand SaaS accounts: plan, MRR, NPS, support tickets, and free-text feedback."**
- Open the preview drawer for two seconds so the judges see real rows and the `feedback` text column chip. Close it.
- Click the suggested question **"Why are customers churning and where is revenue at risk?"**
- Drag the agent slider to **8**. **"Eight hypotheses, eight agents, eight isolated database forks."**
- Click **Launch swarm**.

### 0:50 — Mission Control, live (60 s)

Screen: `/runs/{id}`. Talk over what is happening; do not narrate ahead of the UI.

- Status stepper moves `provision → plan`. **"Root database created on Hotdata, CSV loaded, BM25 and vector search ready on the feedback column."**
- `run.recalled` lands; open the **Memory** tab for three seconds. **"Before planning, it asked Cognee what it already knows about this dataset. Those hits go into the planner prompt."** Switch back.
- The plan appears: eight agent cards with approach badges. **"The planner guaranteed a mix: SQL, BM25 keyword search, vector similarity, and mixed strategies."**
- Lineage tree fans out on the left as `db.forked` events arrive. **"Each node is a real Hotdata database forked from the root. This tree is the lineage API response, not a drawing."**
- Point at the metrics strip while cards fill with SQL: **"Peak concurrency 8: eight agents querying eight databases at the same moment. p50 in the tens of milliseconds."**
- Pick one card that is mid-loop and read a line of its SQL. **"Think, query, observe, up to four times, then a finding with a confidence score. Every query is read-only and guarded."**
- Click a finished branch node in the tree to focus its card; hover the confidence bar and mini chart.

### 1:50 — Burst (30 s)

- Click **Burst 100 queries**. **"Now pretend a hundred analysts hit these branches at once."**
- Histogram modal appears. Read the numbers: **"One hundred concurrent reads spread across the forks. p50, p95, max, right there. Isolation means no branch waits on another."**
- Close the modal; the `metrics.burst` tile is now populated.

### 2:20 — The answer (25 s)

By now the stepper should be at `synthesize → done` (if not, keep talking about the burst numbers for a few more seconds).

- Open the **Report** tab. **"One report, with citations."** Click a `[branch:…]` chip: the tree and card highlight that branch. **"Every claim traces to the fork and the SQL that produced it."**
- Open the **SQL console**, select that same branch, hit `⌘↵` on the pre-filled query. **"You can re-run any agent's evidence against the exact snapshot it saw."**
- Click **Download report.md** (a file downloads; do not open it).

### 2:45 — Memory and the pipeline (15 s)

- Open the **Memory** tab: `memory.remembered` shows the run was written back. **"The next run on this dataset starts from here."** Optionally click through to `/memory` to show the Cognee graph iframe.
- Open the **Pipeline** tab: the rendered `parallax-analyst.pipe` node graph with `agent_rocketride`, `db_hotdata`, `tool_cognee`, and the "Deployed on RocketRide Cloud" status. **"The analyst is a RocketRide pipeline: Claude, a Hotdata tool, and a Cognee tool, deployable to RocketRide Cloud with no infrastructure. The same repo runs with zero keys on a laptop."**

### 3:00 — Close

**"Parallax: many agents, many branches, one answer."**

## If a judge asks

- *"Is the tree real?"* Open the Hotdata dashboard tab: N databases with `forked_from` set, or `curl localhost:8000/api/runs/{id}/lineage`.
- *"Is RocketRide really in the loop?"* The LLM tile says `rocketride 21` (calls by provider) and `/api/health` reports `rocketride.reachable: true`; `pipelines/parallax-llm.pipe` is what every call goes through.
- *"What if I have no keys?"* `make demo`. Same UI, same events, DuckDB forks and a fake LLM.
- *"Can it break my data?"* No: SQL is read-only at the platform level and guarded again in the orchestrator; writes go only to tables the run created, with a 24 h expiry.
