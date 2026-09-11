"use client";
// Zustand store: holds runs + event logs and applies SSE events deterministically (docs/SPEC.md §5).
import { create } from "zustand";
import type {
  AgentStep, Branch, BranchStatus, DB, Finding, Hypothesis, MemoryHit, Metrics, Report, Run, RunEvent, RunStatus,
} from "./types";

interface RunState {
  runs: Record<string, Run>;
  events: Record<string, RunEvent[]>;
  selectedBranch: Record<string, string | null>;
  setRun: (run: Run) => void;
  applyEvent: (ev: RunEvent) => void;
  selectBranch: (runId: string, branchId: string | null) => void;
  clear: (runId: string) => void;
}

const MAX_EVENTS = 5000;

export const useRunStore = create<RunState>((set, get) => ({
  runs: {},
  events: {},
  selectedBranch: {},
  setRun: (run) => set((s) => ({ runs: { ...s.runs, [run.id]: run } })),
  selectBranch: (runId, branchId) => set((s) => ({ selectedBranch: { ...s.selectedBranch, [runId]: branchId } })),
  clear: (runId) => set((s) => {
    const runs = { ...s.runs }; delete runs[runId];
    const events = { ...s.events }; delete events[runId];
    return { runs, events };
  }),
  applyEvent: (ev) => {
    const s = get();
    const prevEvents = s.events[ev.run_id] ?? [];
    const nextEvents = prevEvents.length >= MAX_EVENTS ? [...prevEvents.slice(-MAX_EVENTS + 1), ev] : [...prevEvents, ev];
    const run = s.runs[ev.run_id];
    if (!run) { set({ events: { ...s.events, [ev.run_id]: nextEvents } }); return; }
    const p = ev.payload as Record<string, unknown>;
    let next: Run = run;
    const withBranch = (branchId: string, fn: (b: Branch) => Branch): Run => ({
      ...next, branches: next.branches.map((b) => (b.id === branchId ? fn(b) : b)),
    });
    switch (ev.type) {
      case "run.status":
        next = { ...next, status: p.status as RunStatus, error: (p.error as string) ?? next.error }; break;
      case "run.recalled":
        next = { ...next, recalled: (p.hits as MemoryHit[]) ?? [] }; break;
      case "run.plan": {
        const plan = (p.hypotheses as Hypothesis[]) ?? [];
        const branches = (p.branches as Branch[]) ?? next.branches;
        next = { ...next, plan, branches: branches.length ? branches : plan.map((h) => ({
          id: (h as Hypothesis & { branch_id?: string }).branch_id ?? `b_${h.id}`, hypothesis_id: h.id, db: null, status: "forking" as BranchStatus, steps: [], finding: null,
        })) };
        break;
      }
      case "db.created":
        next = { ...next, root_db: p.db as DB }; break;
      case "db.forked": {
        const bid = (ev.branch_id ?? (p.branch_id as string)) as string;
        if (next.branches.some((b) => b.id === bid)) next = withBranch(bid, (b) => ({ ...b, db: p.db as DB, status: "exploring" }));
        else next = { ...next, branches: [...next.branches, { id: bid, hypothesis_id: (p.hypothesis_id as string) ?? "", db: p.db as DB, status: "exploring", steps: [], finding: null }] };
        break;
      }
      case "agent.step": {
        const bid = ev.branch_id as string; const step = p.step as AgentStep;
        next = withBranch(bid, (b) => (b.steps.some((x) => x.n === step.n) ? { ...b, steps: b.steps.map((x) => (x.n === step.n ? step : x)) } : { ...b, steps: [...b.steps, step] }));
        break;
      }
      case "agent.finding":
        next = withBranch(ev.branch_id as string, (b) => ({ ...b, finding: p.finding as Finding })); break;
      case "branch.status":
        next = withBranch(ev.branch_id as string, (b) => ({ ...b, status: p.status as BranchStatus })); break;
      case "metrics.update":
        next = { ...next, metrics: { ...next.metrics, ...(p.metrics as Metrics) } }; break;
      case "metrics.burst":
        next = { ...next, metrics: { ...next.metrics, burst: p as unknown as Metrics["burst"] } }; break;
      case "report.ready":
        next = { ...next, report: p.report as Report }; break;
      case "run.error":
        next = { ...next, status: "failed", error: (p.message as string) ?? "Unknown error" }; break;
      case "run.finished":
        next = { ...next, status: next.status === "failed" ? "failed" : "done" }; break;
      default: break;
    }
    set({ runs: { ...s.runs, [ev.run_id]: next }, events: { ...s.events, [ev.run_id]: nextEvents } });
  },
}));
