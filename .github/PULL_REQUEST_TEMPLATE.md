## What

<!-- One or two sentences. Link the issue: Closes #123 -->

## Why

<!-- The problem this solves, or the SPEC section it implements. -->

## How

<!-- Notable design decisions. Call out anything that touches the DataEngine / LLM / Memory protocols or the SSE event schema. -->

## Screenshots / clip

<!-- Required for UI changes. Delete otherwise. -->

## Checklist

- [ ] `make test` passes locally (pytest + `next build`)
- [ ] `uv run ruff check .` and `pnpm lint` are clean
- [ ] Zero-key mode (`make demo`) still completes a full run end to end
- [ ] Behaviour matches `docs/SPEC.md`, or this PR updates the spec first
- [ ] If a pydantic model in `backend/app/swarm/models.py` changed, `frontend/src/lib/types.ts` changed with it
- [ ] New env vars are documented in `.env.example`, `docs/SPEC.md` §2 and the README
- [ ] `.pipe` files pass `make pipes-validate`
- [ ] No secrets, `.env`, or `.parallax/` data in the diff
- [ ] Conventional Commit title (`feat(scope): ...`, `fix(scope): ...`, `docs: ...`)
