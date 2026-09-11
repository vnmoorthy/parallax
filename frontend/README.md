# Parallax — frontend

Next.js 16 (App Router) + React 19 + Tailwind v4 UI for **Parallax**: many agents, many branches, one answer.

## Run

```bash
pnpm install
cp .env.example .env.local        # NEXT_PUBLIC_API_URL=http://localhost:8000
pnpm dev                          # http://localhost:3000 (backend on :8000 via `make dev` at repo root)
```

No backend handy? Run the UI against an in-browser mock (datasets, runs, live SSE-style event stream):

```bash
NEXT_PUBLIC_MOCK=1 pnpm dev
```

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | dev server |
| `pnpm build` / `pnpm start` | production build / serve |
| `npx tsc --noEmit -p .` | typecheck |
| `pnpm lint` | eslint |

## Layout

```
src/app            routes: / (Launch), /runs (History), /runs/[id] (Mission Control), /memory, /settings
src/components/ui  design-system primitives (Button, Card, Badge, Tabs, Dialog, Table, Tooltip, …)
src/components     Nav, ModeBadges, CommandPalette (⌘K), DatasetCard, LaunchForm, …
src/lib            api.ts (typed client + useRunStream), store.ts (zustand run store), types.ts, mock.ts
```

Design tokens live in `src/app/globals.css` (Tailwind theme: `bg`, `surface`, `accent`, `accent-2`, `success`, `warn`, `danger`, …).
