# Contributing to Parallax

Thanks for helping. This document covers how to get a dev environment running, the conventions we use, and what we look for in a pull request. Everything else about *how the system works* lives in [`docs/SPEC.md`](docs/SPEC.md) (the source of truth) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Prerequisites

- Python 3.12 and [`uv`](https://docs.astral.sh/uv/)
- Node 22 and [`pnpm`](https://pnpm.io/) (the repo pins `pnpm@10`)
- Optional: [Ollama](https://ollama.com) with `llama3.1:8b` and `nomic-embed-text` pulled for fully local LLM + embeddings
- Optional: Docker (for `docker compose up` and the local RocketRide engine)

## Setup

```bash
git clone https://github.com/vnmoorthy/parallax
cd parallax
make setup        # uv sync (backend) + pnpm install (frontend)
make demo         # zero-key mode: local DuckDB + fake LLM + local memory
# or
make dev          # backend :8000 + frontend :3000 with whatever keys are in .env
```

Copy `.env.example` to `.env` to turn on Hotdata, RocketRide, Anthropic, or Cognee. Every variable is optional; the app degrades gracefully and `GET /api/health` tells you which mode each subsystem resolved to.

## Running checks

```bash
make test            # pytest (backend) + next build (frontend)
make pipes-validate  # validates pipelines/*.pipe structure
make snyk            # snyk test + snyk code test (needs `snyk auth` or SNYK_TOKEN)
```

CI (`.github/workflows/ci.yml`) runs the same four things: backend tests in `PARALLAX_LLM_MODE=fake PARALLAX_DATA_MODE=local`, a frontend type-check + build, pipe validation, and Snyk.

## Conventions

**Python (backend/)**

- Formatted and linted with [ruff](https://docs.astral.sh/ruff/) (`uv run ruff check . && uv run ruff format .`); line length 120.
- Async everywhere; never block the event loop (memory writes go through `asyncio.create_task`).
- New data backends implement the `DataEngine` protocol in `backend/app/data/base.py`. New LLM providers implement `LLM` in `backend/app/llm/base.py` and are added to the chain in `backend/app/llm/router.py`. New memory backends implement `Memory` in `backend/app/memory/base.py`.
- Tests live in `backend/tests/` and must pass with the `FakeLLM` and `LocalEngine` (no network, no keys).

**TypeScript (frontend/)**

- `eslint` via `pnpm lint`; strict TypeScript (`npx tsc --noEmit` must be clean).
- API types are hand-mirrored from `docs/SPEC.md` section 5 in `frontend/src/lib/types.ts`. If you change a model in `backend/app/swarm/models.py`, update the TS type in the same PR.
- Every button must do something real. No dead controls, no placeholder toasts.

**Pipelines (pipelines/)**

- `.pipe` files are JSON with `components` first; only `${ROCKETRIDE_*}` placeholders are substituted. Run `make pipes-validate` before committing.

**Commits**

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(orchestrator): track peak concurrency with an in-flight counter
fix(hotdata): fully qualify table refs as default.public.<t>
docs(readme): add Cognee setup table
chore(ci): pin setup-uv to v5
```

Scopes we use: `orchestrator`, `hotdata`, `local`, `llm`, `memory`, `api`, `ui`, `pipelines`, `datasets`, `docs`, `ci`.

## Pull request checklist

- [ ] `make test` passes locally
- [ ] `uv run ruff check .` and `pnpm lint` are clean
- [ ] Behaviour matches `docs/SPEC.md` (or the PR updates the spec first)
- [ ] New env vars are documented in `.env.example`, `docs/SPEC.md` section 2, and the README table
- [ ] Zero-key mode (`make demo`) still completes a full run end to end
- [ ] Screenshots or a short clip for UI changes
- [ ] No secrets, no `.env`, no `.parallax/` data in the diff

## Adding a bundled dataset

1. Put a CSV (3 MB or smaller) in `datasets/` or extend `scripts/generate_datasets.py`.
2. Add an entry to `datasets/registry.json` with `id`, `name`, `description`, `file`, `text_columns`, and `suggested_questions`.
3. Restart the backend; the dataset shows up on the Launch page.

## Reporting bugs and proposing features

Use the issue forms in `.github/ISSUE_TEMPLATE/`. Security issues go to the address in [`SECURITY.md`](SECURITY.md), not to the tracker.

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
