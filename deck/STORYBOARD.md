# Parallax — 3-minute storyboard

**Total: 180 seconds across 10 slides.** Slide 1 is the 20-second opener, slide 10 is the 15-second close. Every "Say" block is sized to its slot at a normal pace (about 2.5 words a second). Read it once out loud with a timer, then stop reading it.

Setup (15 minutes before): `make dev` (cloud keys) or `make demo` (zero keys) running; http://localhost:3000 open on **Launch** with `saas_customers` selected; one finished run in **/runs** as a backup; `curl -s localhost:8000/api/health` checked so no badge surprises you. Deck in one window, browser in another (1440 px+, 110 % zoom).

| # | Slide | Starts | Length |
|---|---|---|---|
| 1 | Title — opener | 0:00 | 20 s |
| 2 | The problem | 0:20 | 15 s |
| 3 | The idea | 0:35 | 20 s |
| 4 | Live demo | 0:55 | 40 s |
| 5 | Architecture | 1:35 | 10 s |
| 6 | Hotdata | 1:45 | 20 s |
| 7 | RocketRide | 2:05 | 15 s |
| 8 | Cognee + Snyk | 2:20 | 15 s |
| 9 | Real scale | 2:35 | 10 s |
| 10 | Try it — close | 2:45 | 15 s |

---

## 1 · Title — the 20-second opener (0:00 → 0:20)

**Say:** "Every analytics team has the same bottleneck: one analyst, one query, one hypothesis at a time. Parallax removes it. Give it a dataset and a question; it forks the database once per hypothesis, runs a swarm of agents across the branches at the same time, writes one cited answer, and remembers what it learned for next time."

**Show:** Slide 1. Nothing to click. Stand still for this one.

**If asked** *"What is it in one sentence?"* — "A multi-agent data-analysis swarm on forked Hotdata databases, reasoning through RocketRide, remembering in Cognee."

## 2 · The problem (0:20 → 0:35)

**Say:** "'Why are customers churning and where is revenue at risk?' is really eight questions: by plan, by region, by what people wrote, by how long they went quiet. One analyst runs them serially, a day of work. Eight agents on one shared database trip over each other. And whatever they learn never persists."

**Show:** Point along the serial chain, then at the three rows on the right.

**If asked** *"Why not one agent with a bigger context window?"* — "The bottleneck is the database and reproducibility, not the prompt: one agent still runs one query at a time, and nobody can re-run what it saw."

## 3 · The idea (0:35 → 0:55)

**Say:** "So we fork the database per hypothesis. One root database per run; the planner, primed by memory, proposes N hypotheses; the root is forked once per hypothesis. N agents explore concurrently, each with its own snapshot, its own indexes, its own scratch tables and notes. A synthesizer writes one report where every claim cites its branch. Then Cognee remembers it, and the next plan starts from there."

**Show:** Trace the strip left to right: root, four forks, report, memory, and the dashed recall loop back to the start.

**If asked** *"How many hypotheses?"* — "Two to sixteen agents per run, a slider on the Launch page; eight is the demo default, `PARALLAX_MAX_AGENTS` is the cap."

## 4 · Live demo (0:55 → 1:35)

**Say:** "Here it is live. Six thousand SaaS accounts, the churn question, eight agents. Launch. Root database created on Hotdata; before planning it asks Cognee what it already knows. The plan lands: eight cards, a mix of SQL, keyword and vector strategies. The lineage tree fans out on the left, one node per real fork. Cards fill with SQL: think, query, observe, up to four steps, then a finding with a confidence score. Peak concurrency eight, p50 in the tens of milliseconds. The report on the right cites every claim with a branch chip; click one and the tree lights up."

**Show / click:** Switch to the browser. **Launch** → `saas_customers` card → suggested question *"Why are customers churning and where is revenue at risk?"* → slider to **8** → **Launch swarm**. When `run.recalled` lands, open the **Memory** tab for two seconds and switch back. Click a finished node in the lineage tree to focus its card. Open **Report**, click one `[branch:…]` chip. If the run is slow, open the backup run in **/runs** and narrate from it. Return to the deck on slide 5.

**If asked** *"Is the tree real?"* — "Yes. It is the response of `GET /api/runs/{id}/lineage`; the Hotdata dashboard lists the same databases with `forked_from` set."

## 5 · Architecture (1:35 → 1:45)

**Say:** "Under the hood: a Next.js Mission Control on an SSE stream, a FastAPI orchestrator, and three protocols, data engine, LLM router, memory, each with a cloud implementation and a zero-key local one."

**Show:** The slide. Point at the four rows on the right, not at the diagram's small print.

**If asked** *"Why SSE instead of polling?"* — "The stream replays a per-run buffer and then goes live, so a refresh or a shared link rebuilds the exact same Mission Control."

## 6 · Hotdata (1:45 → 2:05)

**Say:** "Hotdata is the data plane, and forking is the whole trick. One root per run, one fork per hypothesis, BM25 and vector indexes per branch, lineage straight from the API. Then burst mode: a hundred concurrent reads spread across five forks. p50 fifteen milliseconds, p95 thirty, fifty in flight. Isolation means no branch ever waits on another."

**Show / click:** If the app is still on screen, click **Burst 100 queries** and read the histogram's numbers out loud; otherwise point at the four tiles.

**If asked** *"Do forks copy the data?"* — "Forks copy schema, tables and data server-side in milliseconds. Indexes are not carried, so each branch builds its own lazily; vector search runs on a `data_vec` copy because a vector index must be the only index on its table."

## 7 · RocketRide (2:05 → 2:20)

**Say:** "Reasoning runs through RocketRide. Every planner, agent and synthesizer call goes through `parallax-llm.pipe`. And `parallax-analyst.pipe` is the deployable analyst: a RocketRide agent controlling Claude, a Hotdata tool and a Cognee tool. Point `ROCKETRIDE_URI` at api.rocketride.ai and it runs on Cloud. Nothing to host."

**Show:** The **Pipeline** tab in Mission Control if the browser is still up (node graph plus Cloud status); otherwise the slide.

**If asked** *"Is RocketRide really in the loop?"* — "The LLM tile shows calls by provider, `/api/health` reports `rocketride.reachable`, and the chain falls back to Anthropic, then Ollama, per call, with attribution on every step."

## 8 · Cognee + Snyk (2:20 → 2:35)

**Say:** "Cognee makes runs compound: findings go into the graph after each run, node sets per dataset, and a graph-completion search primes the next plan. The second run on a dataset starts smarter. Snyk scans every push and pull request, on top of a read-only SQL guard."

**Show:** The **Memory** tab showing `memory.remembered`, or the **/memory** page with the recall box. Then the slide.

**If asked** *"What if Cognee is down?"* — "LocalMemory takes over with the same protocol, JSON plus Ollama embeddings; recall and remember still happen and the badge says so."

## 9 · Real scale (2:35 → 2:45)

**Say:** "Measured, not claimed, all from real runs today: a hundred-read burst at p50 fifteen, p95 thirty; first finding in 1.2 seconds; sixty-five tests pass; and the identical code runs offline with zero keys."

**Show:** The tiles, then a glance at the **Next** card.

**If asked** *"What's next?"* — "Merge two forks' findings into a third fork; Hotdata bulk-create for ten thousand tenant databases; a deploy button for RocketRide Cloud in the Pipeline tab."

## 10 · Try it — the 15-second close (2:45 → 3:00)

**Say:** "Three commands: clone, make setup, make demo, no keys. Add keys and the same code runs on Hotdata, RocketRide Cloud and Cognee. github.com/vnmoorthy/parallax. Thank you RocketRide, Hotdata, Cognee, Snyk, Devnovate. Parallax: many agents, many branches, one answer."

**Show:** Slide 10. Leave the repo URL on screen through Q&A.

**If asked** *"Can it break my data?"* — "No. SQL is read-only at the platform level and guarded again in the orchestrator; writes only go to tables the run created, with a 24-hour expiry."

---

## If something is down

- **Hotdata unreachable:** `PARALLAX_DATA_MODE=local make dev`. Badge turns `data: local`; forks become DuckDB file copies. Say it out loud; it is a feature.
- **RocketRide unreachable:** the LLM chain falls back to Anthropic automatically and the LLM tile shows `anthropic`. Point at it: per-call fallback is the point.
- **Everything down:** `make demo`. Same UI, same events, fake LLM; it still forks, streams and produces a report.
- **Run slow on stage:** narrate from the finished backup run in `/runs`; never wait in silence.

## Two more answers to have ready

- *"Is the synthetic data cheating?"* — "Two datasets are seeded synthetic with documented effect sizes so you can check the agents' answers; the third is 6,102 real SF Airbnb listings from hotdata.dev, and you can upload any CSV up to 25 MB."
- *"Where were the numbers measured?"* — "Local runs on this laptop today: DuckDB forks, 100 concurrent reads across 5 forked databases. The same `POST /runs/{id}/burst` endpoint runs unchanged against Hotdata."
