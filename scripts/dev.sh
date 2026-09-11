#!/usr/bin/env bash
# Parallax dev runner: starts the FastAPI backend and the Next.js frontend together,
# waits for the backend health endpoint, prints URLs + resolved modes, and tears both down on exit.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
BACKEND_URL="http://localhost:${BACKEND_PORT}"
FRONTEND_URL="http://localhost:${FRONTEND_PORT}"
UVICORN="${ROOT}/backend/.venv/bin/uvicorn"
PY="${ROOT}/backend/.venv/bin/python"

if [[ ! -x "${UVICORN}" ]]; then
  echo "backend/.venv not found — run 'make setup' (cd backend && uv sync --extra dev) first" >&2
  exit 1
fi
if [[ ! -d "${ROOT}/frontend/node_modules" ]]; then
  echo "frontend/node_modules not found — run 'make setup' (cd frontend && pnpm install) first" >&2
  exit 1
fi

pids=()
cleanup() {
  local code=$?
  trap - EXIT INT TERM
  echo
  echo "stopping parallax…"
  for pid in "${pids[@]:-}"; do
    [[ -n "${pid}" ]] && kill "${pid}" 2>/dev/null || true
  done
  # give children a moment, then make sure the process groups are gone
  sleep 0.5
  for pid in "${pids[@]:-}"; do
    [[ -n "${pid}" ]] && kill -9 "${pid}" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  exit "${code}"
}
trap cleanup EXIT INT TERM

echo "▶ backend  → ${BACKEND_URL}  (uvicorn --reload)"
(
  cd "${ROOT}/backend"
  exec "${UVICORN}" app.main:app --host 0.0.0.0 --port "${BACKEND_PORT}" --reload
) &
pids+=($!)

echo "▶ frontend → ${FRONTEND_URL}  (next dev)"
(
  cd "${ROOT}/frontend"
  export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-${BACKEND_URL}}"
  exec pnpm dev -p "${FRONTEND_PORT}"
) &
pids+=($!)

# wait for the backend health endpoint (max ~60 s) with a small spinner
spinner='|/-\'
health=""
for i in $(seq 1 120); do
  if health="$(curl -sf --max-time 1 "${BACKEND_URL}/api/health" 2>/dev/null)"; then
    break
  fi
  printf "\r  waiting for backend %s" "${spinner:i%4:1}"
  # bail out early if the backend died
  if ! kill -0 "${pids[0]}" 2>/dev/null; then
    printf "\r"; echo "backend process exited — see the log above" >&2
    exit 1
  fi
  sleep 0.5
done
printf "\r%-40s\r" ""

if [[ -z "${health}" ]]; then
  echo "backend did not become healthy at ${BACKEND_URL}/api/health (still starting?) — continuing" >&2
else
  echo "${health}" | "${PY}" - <<'PY'
import json, sys
try:
    h = json.load(sys.stdin)
except Exception:
    print("  health: (unparseable)"); sys.exit(0)
def g(*ks, d="?"):
    cur = h
    for k in ks:
        cur = cur.get(k, {}) if isinstance(cur, dict) else {}
    return cur if cur not in ({}, None) else d
data = g("data", "kind", d=g("data", "mode"))
llm = g("llm", "active", d=g("llm", "mode"))
mem = g("memory", "kind", d=g("memory", "mode"))
rr = h.get("rocketride", {}) if isinstance(h.get("rocketride"), dict) else {}
rr_s = "cloud/engine reachable" if rr.get("reachable") else ("configured, unreachable" if rr.get("configured") else "not configured")
print(f"  modes   data={data}  llm={llm}  memory={mem}  rocketride={rr_s}  version={h.get('version','?')}")
PY
fi

echo
echo "  Parallax is up"
echo "  UI       ${FRONTEND_URL}"
echo "  API      ${BACKEND_URL}/api/health   docs: ${BACKEND_URL}/docs"
echo "  Ctrl-C stops both processes."
echo

# keep running until one child exits; cleanup trap handles the rest
wait -n "${pids[@]}" 2>/dev/null || wait "${pids[@]}"
