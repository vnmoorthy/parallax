"use client";
// Typed API client for the Parallax backend (docs/SPEC.md §4). Every function throws ApiClientError on failure.
import { useEffect, useRef, useState } from "react";
import type {
  BurstResult, Dataset, DatasetPreview, Health, LineageNode, MemoryHit, QueryResult, Run, RunEvent, RunSummary,
} from "./types";
import { useRunStore } from "./store";

export const API_URL: string =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_URL) || "http://localhost:8000";

export class ApiClientError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, { ...init, headers: { Accept: "application/json", ...(init?.headers || {}) } });
  } catch (e) {
    throw new ApiClientError(0, "network", `Cannot reach backend at ${API_URL}. Is it running? (${(e as Error).message})`);
  }
  if (!res.ok) {
    let code = "http_error";
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      code = body?.error?.code || code;
      message = body?.error?.message || body?.detail || message;
    } catch { /* ignore */ }
    throw new ApiClientError(res.status, code, message);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

const json = (body: unknown): RequestInit => ({
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

// ── endpoints ───────────────────────────────────────────────────────────
export const api = {
  health: () => request<Health>("/health"),
  datasets: () => request<Dataset[]>("/datasets"),
  datasetPreview: (id: string, limit = 20) => request<DatasetPreview>(`/datasets/${encodeURIComponent(id)}/preview?limit=${limit}`),
  uploadDataset: async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<Dataset>("/datasets/upload", { method: "POST", body: fd });
  },
  createRun: (body: { dataset_id: string; question: string; agents: number; search_column?: string }) =>
    request<{ run_id: string }>("/runs", json(body)),
  runs: () => request<RunSummary[]>("/runs"),
  run: (id: string) => request<Run>(`/runs/${id}`),
  deleteRun: (id: string) => request<{ ok: boolean }>(`/runs/${id}`, { method: "DELETE" }),
  query: (id: string, branch_id: string, sql: string) => request<QueryResult>(`/runs/${id}/query`, json({ branch_id, sql })),
  search: (id: string, branch_id: string, kind: "bm25" | "vector", q: string, k = 10) =>
    request<QueryResult>(`/runs/${id}/search`, json({ branch_id, kind, q, k })),
  lineage: (id: string) => request<LineageNode[]>(`/runs/${id}/lineage`),
  burst: (id: string, queries = 100) => request<BurstResult>(`/runs/${id}/burst`, json({ queries })),
  reportUrl: (id: string) => `${API_URL}/api/runs/${id}/report.md`,
  memory: () => request<{ kind: string; stats: Record<string, number | string>; recent: MemoryHit[] }>("/memory"),
  recall: (q: string, tags?: string[]) => request<MemoryHit[]>("/memory/recall", json({ q, tags })),
  memoryGraphUrl: () => `${API_URL}/api/memory/graph`,
  eventsUrl: (id: string) => `${API_URL}/api/runs/${id}/events`,
};

// ── live run stream ────────────────────────────────────────────────────
export type StreamStatus = "idle" | "connecting" | "live" | "done" | "error";
// Stable empty array: selectors must return referentially-stable values or useSyncExternalStore loops.
const EMPTY_EVENTS: RunEvent[] = [];

/**
 * Subscribes to a run's SSE stream, hydrates the zustand store with the full run first, then applies
 * events as they arrive. Returns the live run from the store plus stream status.
 */
export function useRunStream(runId: string | null) {
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const run = useRunStore((s) => (runId ? s.runs[runId] ?? null : null));
  const events = useRunStore((s) => (runId ? s.events[runId] ?? EMPTY_EVENTS : EMPTY_EVENTS));
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    setStatus("connecting");
    setError(null);
    const store = useRunStore.getState();

    api.run(runId)
      .then((r) => { if (!cancelled) store.setRun(r); })
      .catch((e: Error) => { if (!cancelled) { setError(e.message); setStatus("error"); } });

    const es = new EventSource(api.eventsUrl(runId));
    esRef.current = es;
    es.onopen = () => { if (!cancelled) setStatus("live"); };
    es.onmessage = (msg) => {
      if (cancelled) return;
      try {
        const ev = JSON.parse(msg.data) as RunEvent;
        store.applyEvent(ev);
        if (ev.type === "run.finished") {
          setStatus("done");
          es.close();
          // final authoritative snapshot
          api.run(runId).then((r) => { if (!cancelled) store.setRun(r); }).catch(() => {});
        }
      } catch { /* ignore malformed */ }
    };
    es.onerror = () => {
      if (cancelled) return;
      // EventSource auto-reconnects; if the run is already finished the server closes → mark done.
      const current = useRunStore.getState().runs[runId];
      if (current && (current.status === "done" || current.status === "failed")) { setStatus("done"); es.close(); }
      else setStatus("connecting");
    };
    return () => { cancelled = true; es.close(); esRef.current = null; };
  }, [runId]);

  return { run, events, status, error };
}
