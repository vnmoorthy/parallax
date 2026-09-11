"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Filter, ScrollText } from "lucide-react";
import type { AgentStep, Run, RunEvent, StepKind } from "@/lib/types";
import { shortId } from "@/lib/layout";
import { fmtMs } from "@/lib/chart";
import { STEP_META } from "./StepTimeline";
import { CopyButton } from "./ExportMenu";

const QUERY_KINDS = new Set<StepKind>(["sql", "bm25", "vector"]);
const CAP = 500;

interface LogRow { key: string; order: number; branchId: string; hypothesis: string; kind: StepKind; text: string; sql: string | null; elapsed: number | null; provider: string | null; n: number }

export function collectQueries(run: Run, events: RunEvent[]): LogRow[] {
  const orderOf = new Map<string, number>();
  events.forEach((e, i) => {
    if (e.type !== "agent.step") return;
    const step = e.payload?.step as AgentStep | undefined;
    if (step && e.branch_id) orderOf.set(`${e.branch_id}:${step.n}`, i);
  });
  const rows: LogRow[] = [];
  run.branches.forEach((b, bi) => {
    const h = run.plan.find((x) => x.id === b.hypothesis_id);
    for (const s of b.steps) {
      if (!QUERY_KINDS.has(s.kind)) continue;
      const key = `${b.id}:${s.n}`;
      rows.push({
        key, order: orderOf.get(key) ?? 1_000_000 + bi * 1000 + s.n, branchId: b.id, hypothesis: h?.title || "", kind: s.kind,
        text: s.text, sql: s.sql ?? null, elapsed: s.elapsed_ms ?? null, provider: s.provider ?? null, n: s.n,
      });
    }
  });
  rows.sort((a, b) => a.order - b.order);
  return rows.length > CAP ? rows.slice(-CAP) : rows;
}

export function QueryLog({ run, events, onSelectBranch, className }: { run: Run; events: RunEvent[]; onSelectBranch: (id: string) => void; className?: string }) {
  const [filter, setFilter] = useState("");
  const [kind, setKind] = useState<"all" | StepKind>("all");
  const ref = useRef<HTMLDivElement>(null);
  const all = useMemo(() => collectQueries(run, events), [run, events]);
  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return all.filter((r) => (kind === "all" || r.kind === kind) && (!q || r.text.toLowerCase().includes(q) || (r.sql ?? "").toLowerCase().includes(q) || r.branchId.toLowerCase().includes(q) || r.hypothesis.toLowerCase().includes(q)));
  }, [all, filter, kind]);

  const count = rows.length;
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distance < 200) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [count]);

  const totalMs = rows.reduce((a, r) => a + (r.elapsed ?? 0), 0);

  return (
    <div className={clsx("flex h-full min-h-0 flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[160px]">
          <Filter className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-faint" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by SQL, query, branch…" className="w-full rounded-lg border border-border bg-surface-2 py-1.5 pl-7 pr-2 text-[12px] text-text outline-none placeholder:text-faint focus:border-accent" />
        </label>
        <div className="flex rounded-lg border border-border bg-surface-2 p-0.5 text-[11px]">
          {(["all", "sql", "bm25", "vector"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={clsx("rounded-md px-2 py-1 transition-colors", kind === k ? "bg-surface-3 text-text" : "text-muted hover:text-text")}>{k}</button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between text-[10px] text-faint">
        <span><span className="text-muted">{rows.length}</span> of {all.length} queries{all.length >= CAP && " (capped at 500)"}</span>
        <span className="tabular-nums">Σ {fmtMs(totalMs)}</span>
      </div>
      <div ref={ref} className="min-h-[320px] flex-1 overflow-auto scrollbar-thin rounded-xl border border-border xl:min-h-0">
        {!rows.length ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
            <ScrollText className="size-5 text-accent-2" />
            <div className="text-sm font-medium text-text">{all.length ? "No queries match" : "No queries yet"}</div>
            <div className="text-[11px] text-muted">{all.length ? "Try a different filter." : "Every SQL, BM25 and vector query across all branches streams in here."}</div>
          </div>
        ) : (
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="sticky top-0 z-10 bg-surface-2/95 text-left text-[10px] uppercase tracking-wide text-faint backdrop-blur">
                <th className="px-2 py-1.5 w-8">#</th>
                <th className="px-2 py-1.5 w-[74px]">Branch</th>
                <th className="px-2 py-1.5 w-[58px]">Kind</th>
                <th className="px-2 py-1.5">Query</th>
                <th className="px-2 py-1.5 w-[70px] text-right">ms</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const meta = STEP_META[r.kind];
                const body = r.kind === "sql" ? (r.sql || r.text) : r.text;
                return (
                  <tr key={r.key} className="group border-t border-border/60 align-top hover:bg-accent/5">
                    <td className="mono px-2 py-1.5 text-faint">{i + 1}</td>
                    <td className="px-2 py-1.5">
                      <button type="button" onClick={() => onSelectBranch(r.branchId)} className="mono text-accent-2 hover:underline" title={r.hypothesis || r.branchId}>{shortId(r.branchId, 6)}</button>
                    </td>
                    <td className="px-2 py-1.5"><span className="rounded border px-1 py-[1px] text-[9px] font-semibold uppercase" style={{ color: meta.hex, borderColor: `${meta.hex}55`, background: `${meta.hex}12` }}>{r.kind}</span></td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-start gap-1">
                        <pre className="mono max-h-24 flex-1 overflow-hidden whitespace-pre-wrap break-words text-text/85" title={body}>{body}</pre>
                        <CopyButton text={body} label="Query copied" className="opacity-0 group-hover:opacity-100" size={3} />
                      </div>
                      {r.provider && <span className="text-[9px] uppercase tracking-wide text-faint">{r.provider}</span>}
                    </td>
                    <td className={clsx("mono px-2 py-1.5 text-right tabular-nums", (r.elapsed ?? 0) > 1000 ? "text-warn" : "text-muted")}>{r.elapsed === null ? "—" : fmtMs(r.elapsed, true)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
