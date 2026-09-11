# Parallax — narration recording script (3:00)

Record these ten lines in your own voice and Parallax will rebuild the demo video with your narration.

## How to record

1. Quiet room, phone or laptop mic 15–20 cm from your mouth, normal presenting pace (about 2.5 words a second).
2. **Option A — ten short files (easiest to edit):** save each line as `deck/voice/01.m4a` … `deck/voice/10.m4a`
   (`.wav`, `.mp3` or `.aiff` also work). Leave half a second of silence at the start and end of each file.
3. **Option B — one continuous take:** read all ten lines in order, pausing about one second between them, and save
   as `deck/voice/narration.m4a`. The video segments are then muxed to the timestamps below, so keep each line
   close to its slot length.
4. Rebuild:
   - Option A: `python scripts/make_video.py --frames <frames dir> --voice-dir deck/voice --out deck/Parallax-demo.mp4`
   - Option B: `python scripts/make_video.py --frames <frames dir> --voice-file deck/voice/narration.m4a --out deck/Parallax-demo.mp4`
   - (`make video` runs the placeholder text-to-speech build; frames are optional — see `scripts/make_video.py`.)

## The lines

| # | Slot | Start | Read this |
|---|---|---|---|
| 01 | 20 s | 0:00 | Every analytics team has the same bottleneck: one analyst, one query, one hypothesis at a time. Parallax removes it. Give it a dataset and a question; it forks the database once per hypothesis, runs a swarm of agents across the branches at the same time, writes one cited answer, and remembers what it learned for next time. |
| 02 | 15 s | 0:20 | "Why are customers churning and where is revenue at risk?" is really eight questions: by plan, by region, by what people wrote, by how long they went quiet. One analyst runs them serially, a day of work. Eight agents on one shared database trip over each other. And whatever they learn never persists. |
| 03 | 20 s | 0:35 | So we fork the database per hypothesis. One root database per run; the planner, primed by memory, proposes N hypotheses; the root is forked once per hypothesis. N agents explore concurrently, each with its own snapshot, its own indexes, its own scratch tables and notes. A synthesizer writes one report where every claim cites its branch. Then Cognee remembers it, and the next plan starts from there. |
| 04 | 40 s | 0:55 | Here it is live. Six thousand SaaS accounts, the churn question, six agents. Launch. The root database is created; before planning, Parallax asks Cognee what it already knows. The plan lands: one card per hypothesis, a mix of SQL, keyword and vector strategies. The lineage tree fans out on the left, one node per real fork. Cards fill with SQL: think, query, observe, then a finding with a confidence score. The report on the right cites every claim with a branch chip; click one and the tree lights up. |
| 05 | 10 s | 1:35 | Under the hood: a Next.js Mission Control on a server-sent event stream, a FastAPI orchestrator, and three protocols — data engine, LLM router, memory — each with a cloud implementation and a zero-key local one. |
| 06 | 20 s | 1:45 | Hotdata is the data plane, and forking is the whole trick. One root per run, one fork per hypothesis, BM25 and vector indexes per branch, lineage straight from the API. Then burst mode: a hundred concurrent reads spread across five forks. p50 fifteen milliseconds, p95 thirty, fifty in flight. Isolation means no branch ever waits on another. |
| 07 | 15 s | 2:05 | Reasoning runs through RocketRide. Every planner, agent and synthesizer call goes through parallax-llm.pipe. And parallax-analyst.pipe is the deployable analyst: a RocketRide agent controlling Claude, a Hotdata tool and a Cognee tool. Point it at api.rocketride.ai and it runs on Cloud. Nothing to host. |
| 08 | 15 s | 2:20 | Cognee makes runs compound: findings go into the graph after each run, node sets per dataset, and a graph-completion search primes the next plan. The second run on a dataset starts smarter. Snyk scans every push and pull request, on top of a read-only SQL guard. |
| 09 | 10 s | 2:35 | Measured, not claimed, all from real runs today: a hundred-read burst at p50 fifteen, p95 thirty; first finding in 1.2 seconds; sixty-five tests pass; and the identical code runs offline with zero keys. |
| 10 | 15 s | 2:45 | Three commands: clone, make setup, make demo — no keys. Add keys and the same code runs on Hotdata, RocketRide Cloud and Cognee. github.com/vnmoorthy/parallax. Thank you RocketRide, Hotdata, Cognee, Snyk and Devnovate. Parallax: many agents, many branches, one answer. |

Tips: smile on line 1 and line 10 (it is audible); slow down on every number; say "p fifty" and "p ninety-five".
