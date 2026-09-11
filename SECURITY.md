# Security Policy

Parallax is a hackathon project, but it talks to real cloud services (Hotdata, RocketRide Cloud, Anthropic, Cognee) with real credentials, so we take reports seriously.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |
| < 0.1   | No        |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Email **vnarasingamoorthy@gmail.com** with:

- a description of the issue and its impact,
- steps to reproduce (a minimal request, dataset, or `.pipe` file is ideal),
- the commit SHA or version you tested against.

You will get an acknowledgement within 72 hours and a fix or mitigation plan within 14 days for anything rated high or critical. We will credit you in the changelog unless you ask us not to.

## What is in scope

- The FastAPI backend under `backend/` (all `/api/*` routes, SSE stream, file upload).
- The Next.js frontend under `frontend/`.
- The RocketRide pipelines under `pipelines/` and the helper scripts under `scripts/`.
- The CI workflow under `.github/workflows/`.

Out of scope: vulnerabilities in the sponsor platforms themselves (report those to Hotdata, RocketRide, Cognee, or Snyk directly), and issues that require an attacker to already hold your API keys.

## How the design limits blast radius

- **Read-only SQL by construction.** Hotdata's HotSQL endpoint is read-only (no `INSERT`/DDL); rows are only written through the loads API. On top of that, the orchestrator's SQL guard rejects anything that is not a `SELECT`/`WITH` statement, strips trailing semicolons, and appends a `LIMIT` when one is missing. The same guard applies to the ad-hoc SQL console (`POST /api/runs/{id}/query`) and to the local DuckDB engine.
- **Per-hypothesis isolation.** Every agent works in its own forked database. A bad query can only touch a disposable branch, never the root dataset or another agent's branch.
- **Secrets stay server-side.** API keys are read from environment variables / `.env` by `backend/app/config.py` only. The frontend never receives or enters credentials; `/settings` shows env-var *names* and live status, not values. `GET /api/health` reports resolved modes, never keys.
- **Ephemeral cloud state.** Hotdata databases are created with `expires_at: 24h`; `DELETE /api/runs/{id}` removes a run and its databases.
- **Upload limits.** CSV uploads are capped at 25 MB and are only ever loaded into a fresh table in a fresh database.
- **Dependency and code scanning.** Every push and pull request runs `snyk test --all-projects --severity-threshold=high` and `snyk code test` in CI (`.github/workflows/ci.yml`). The badge in the README links to the public Snyk report for this repository.

## Hardening checklist for self-hosters

- Put the backend behind an authenticating reverse proxy before exposing it beyond `localhost`; the API has no built-in auth.
- Tighten CORS in production (dev allows `http://localhost:3000` and `*`).
- Rotate any key that has ever been committed, even to a private fork. `.env` files are git-ignored; keep them that way.
- Run `make snyk` locally before releasing.
