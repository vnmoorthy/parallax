# Parallax RocketRide pipelines

Three `.pipe` files (JSON, RocketRide pipeline format) that carry Parallax's analyst reasoning.
They open as a visual canvas in VS Code, run on a local RocketRide engine, and deploy unchanged to
**RocketRide Cloud** — no infrastructure to manage.

| File | Purpose | Used by |
|---|---|---|
| `parallax-llm.pipe` | LLM gateway: every planner / agent / synthesizer prompt the backend makes is routed through this pipe when RocketRide is configured | `backend/app/llm/rocketride_llm.py` |
| `parallax-analyst.pipe` | **Cloud showcase.** A self-contained analyst agent with a private Hotdata database (SQL + BM25 + vector) and persistent Cognee memory | VS Code canvas, RocketRide Cloud, `/runs/[id]` Pipeline tab |
| `parallax-planner.pipe` | Prompt-node variant of the hypothesis planner: schema + question in, JSON hypotheses out | Demo / experimentation |

Validate all of them with `make pipes-validate` (structural) or
`python scripts/validate_pipes.py --engine http://localhost:5565 --key MYAPIKEY` (engine-side).

## parallax-llm.pipe — "Parallax LLM gateway"

```
chat_1 ──questions──▶ llm_anthropic_1 ──answers──▶ response_answers_1
                       (claude-sonnet-4-6)
```

The backend calls `use(filepath="pipelines/parallax-llm.pipe")` once, caches the token, then sends
each prompt as a `Question` (system text as an instruction, user text as the question, `expectJson`
when a JSON reply is required). The reply arrives under `answers`.

## parallax-analyst.pipe — "Parallax Analyst"

```
chat_1 ──questions──▶ agent_rocketride_1 ──answers──▶ response_answers_1
                       "Parallax Analyst"
                            ▲  ▲  ▲  ▲          (control links point AT the agent)
            ┌───────────────┘  │  │  └────────────────────┐
   llm_anthropic_1    memory_internal_1    db_hotdata_1    tool_cognee_1
   classType llm      classType memory     classType tool  classType tool
        ▲                                    │
        └────────── classType llm ───────────┘   (Hotdata borrows the same LLM to write SQL)
```

What the agent does on every question (see `instructions` in the file):

1. `tool_cognee_1.recall` — pull prior knowledge about this dataset/question from the shared
   `parallax` Cognee dataset.
2. `db_hotdata_1.get_schema`, then `get_data` / `get_sql` / read-only `execute`; `build_index`
   (`bm25`, `vector`) on text columns and query with `bm25_search(...)` / `vector_search(...)`.
3. Form three competing hypotheses, test each, quantify with concrete numbers.
4. `tool_cognee_1.remember` — persist the findings so the next investigation starts smarter.
5. Answer: executive summary → findings with evidence → next questions.

Node configuration highlights:

- `db_hotdata_1` — profile `default`, `${ROCKETRIDE_DB_HOTDATA_KEY}` / `${ROCKETRIDE_DB_HOTDATA_WORKSPACE_ID}`,
  `ttl 24h`, table `data`, `allow_execute true` (raw read-only SQL), `max_execute_rows 25000`.
  A fresh ephemeral database is created per run and destroyed at teardown.
- `tool_cognee_1` — `${ROCKETRIDE_COGNEE_BASE_URL}` (self-hosted `http://localhost:8000` or Cognee Cloud),
  dataset `parallax`, `search_type GRAPH_COMPLETION`, `top_k 10`, dataset override disabled.
- `llm_anthropic_1` — profile `claude-sonnet-4-6`; controlled by both the agent and the Hotdata node.
- `memory_internal_1` — the agent's run-scoped working memory (required by `agent_rocketride`).

## parallax-planner.pipe — "Parallax planner"

```
chat_1 ──questions──▶ prompt_1 ──questions──▶ llm_anthropic_1 ──answers──▶ response_answers_1
                     (planner instructions)
```

Send `schema + question`; get back `{"hypotheses":[{title, rationale, approach, target_columns}]}`.

## Open the canvas in VS Code

1. Install the extension **RocketRide** (marketplace id `RocketRide.rocketride`).
2. Open this repo; the extension scans `pipelines/*.pipe` and populates `.rocketride/` with the
   services catalog and per-node schemas.
3. Click a `.pipe` file → **Open with RocketRide Pipeline Editor** to see and edit the graph.
4. Copy `pipelines/.env.example` to `pipelines/.env` (or the repo root `.env`) and fill in the
   `ROCKETRIDE_*` values. Only `${ROCKETRIDE_*}` placeholders are substituted.

## Run locally

Start an engine (either works):

```bash
# Docker
docker run --rm -p 5565:5565 ghcr.io/rocketride-org/rocketride-engine:latest

# or the binary from https://github.com/rocketride-org/rocketride-server/releases (server-v3.3.1)
./rocketride-server --port 5565
```

Health check: `curl http://localhost:5565/ping`. The local dev API key is `MYAPIKEY`.

```bash
export ROCKETRIDE_URI=http://localhost:5565 ROCKETRIDE_APIKEY=MYAPIKEY ROCKETRIDE_ANTHROPIC_KEY=sk-ant-...
python scripts/validate_pipes.py --engine $ROCKETRIDE_URI --key $ROCKETRIDE_APIKEY   # validate() + use()/terminate()
rocketride start pipelines/parallax-llm.pipe                                        # CLI, or use the SDK below
```

## Deploy to RocketRide Cloud

Two equivalent routes:

- **VS Code** — set `rocketride.deployment.connectionMode` to `"cloud"` and
  `rocketride.deployment.teamId` to your team id (from https://cloud.rocketride.ai), open the pipe
  and press **Deploy**. The Cloud engine runs the pipeline; nothing to host.
- **Backend** — set `ROCKETRIDE_URI=https://api.rocketride.ai` and `ROCKETRIDE_APIKEY=<cloud key>` in
  the repo-root `.env`. `client.use(...)` then executes the pipeline on Cloud, so every Parallax LLM
  call runs there. `GET /api/health` reports `rocketride: {configured, reachable}` and the UI shows
  the `llm: rocketride` badge.

## How the backend calls the pipes

`backend/app/llm/rocketride_llm.py` (SDK `rocketride>=1.3.0`):

```python
from rocketride import RocketRideClient
from rocketride.schema import Question

async with RocketRideClient(uri=ROCKETRIDE_URI, auth=ROCKETRIDE_APIKEY) as client:
    token = (await client.use(filepath="pipelines/parallax-llm.pipe"))["token"]   # once; cached
    q = Question(expectJson=True)
    q.addInstruction("System", system_prompt)
    q.addQuestion(user_prompt)
    resp = await client.chat(token=token, question=q)
    answer = resp.get("data", {}).get("answer") or (resp.get("answers") or [None])[0]
    await client.terminate(token)
```

The client substitutes `${ROCKETRIDE_*}` from its environment before upload; the backend mirrors
`ANTHROPIC_API_KEY` → `ROCKETRIDE_ANTHROPIC_KEY` and the Hotdata vars so a single `.env` is enough.

## Format rules honoured by every file

`components` is the first key; each component has `id`, `provider`, `name`, `config` and either
`input` (data lanes) or `control` (placed on the controlled node, pointing at the invoker);
`project_id` is a literal UUID (different per file); `version` is `1`; `viewport` and `isLocked`
are present; data flow is acyclic; `agent_rocketride` has exactly one `llm` and one `memory_internal`
controller. `scripts/validate_pipes.py` enforces all of this in CI.

## Hackathon submission

Post in the RocketRide `#showcase` channel with the GitHub link to this repo and attach the three
`.pipe` files from this directory (they are self-contained — the recipient only needs their own
`ROCKETRIDE_*` values).
