"use client";
import { useMemo, useState } from "react";
import clsx from "clsx";
import { ArrowDown, ArrowUp, ArrowUpDown, Sparkles } from "lucide-react";
import type { Approach, Run } from "@/lib/types";
import { shortId } from "@/lib/layout";
import { ApproachBadge } from "./ApproachBadge";
import { ConfidenceBar } from "./ConfidenceBar";
import { StatusPill } from "./StatusPill";

type SortKey = "branch" | "hypothesis" | "approach" | "claim" | "confidence";
type SortState = { key: SortKey; dir: "asc" | "desc" };

function SortHeader({ k, label, sort, onToggle, className }: { k: SortKey; label: string; sort: SortState; onToggle: (k: SortKey) => void; className?: string }) {
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={clsx("sticky top-0 z-10 bg-surface-2/95 px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-faint backdrop-blur", className)} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onToggle(k)} className={clsx("inline-flex items-center gap-1 hover:text-text", active && "text-text")}>
        {label} <Icon className="size-3" />
      </button>
    </th>
  );
}
interface Row { branchId: string; branch: string; hypothesis: string; approach: Approach | undefined; claim: string; confidence: number; status: Run["branches"][number]["status"] }

export function FindingsTable({ run, selectedBranch, onSelect, className }: { run: Run; selectedBranch: string | null; onSelect: (id: string) => void; className?: string }) {
  const [sort, setSort] = useState<SortState>({ key: "confidence", dir: "desc" });

  const rows = useMemo<Row[]>(() => run.branches.filter((b) => b.finding).map((b) => {
    const h = run.plan.find((x) => x.id === b.hypothesis_id);
    return { branchId: b.id, branch: shortId(b.id, 8), hypothesis: h?.title || "—", approach: h?.approach, claim: b.finding!.claim, confidence: b.finding!.confidence ?? 0, status: b.status };
  }), [run]);

  const sorted = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const k = sort.key;
      if (k === "confidence") return (a.confidence - b.confidence) * dir;
      const av = String(a[k] ?? ""), bv = String(b[k] ?? "");
      return av.localeCompare(bv, undefined, { numeric: true }) * dir;
    });
  }, [rows, sort]);

  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "confidence" ? "desc" : "asc" }));

  const pending = run.branches.length - rows.length;

  if (!rows.length) {
    return (
      <div className={clsx("flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-10 text-center", className)}>
        <Sparkles className="size-5 text-accent-2 animate-pulse" />
        <div className="text-sm font-medium text-text">No findings yet</div>
        <div className="text-[11px] text-muted">{run.branches.length ? `${run.branches.length} agents exploring — findings land here as each branch finishes.` : "Findings appear once agents start returning results."}</div>
      </div>
    );
  }

  return (
    <div className={clsx("space-y-2", className)}>
      <div className="flex items-center justify-between text-[11px] text-muted">
        <span><span className="text-text font-medium">{rows.length}</span> finding{rows.length === 1 ? "" : "s"}{pending > 0 && <span className="text-faint"> · {pending} pending</span>}</span>
        <span className="text-faint">avg confidence {Math.round((rows.reduce((a, r) => a + r.confidence, 0) / rows.length) * 100)}%</span>
      </div>
      <div className="overflow-auto scrollbar-thin rounded-xl border border-border">
        <table className="w-full min-w-[560px] border-collapse text-[12px]">
          <thead>
            <tr>
              <SortHeader k="branch" label="Branch" sort={sort} onToggle={toggle} className="w-[86px]" />
              <SortHeader k="hypothesis" label="Hypothesis" sort={sort} onToggle={toggle} />
              <SortHeader k="approach" label="Approach" sort={sort} onToggle={toggle} className="w-[84px]" />
              <SortHeader k="claim" label="Claim" sort={sort} onToggle={toggle} />
              <SortHeader k="confidence" label="Confidence" sort={sort} onToggle={toggle} className="w-[130px]" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const sel = r.branchId === selectedBranch;
              return (
                <tr key={r.branchId} onClick={() => onSelect(r.branchId)} className={clsx("cursor-pointer border-t border-border/70 align-top transition-colors hover:bg-accent/5", sel && "bg-accent/10")}>
                  <td className="px-2 py-2">
                    <div className="mono text-[11px] text-accent-2">{r.branch}</div>
                    <StatusPill status={r.status} size="xs" className="mt-1" showIcon={false} />
                  </td>
                  <td className="px-2 py-2 text-text/90"><span className="line-clamp-2" title={r.hypothesis}>{r.hypothesis}</span></td>
                  <td className="px-2 py-2"><ApproachBadge approach={r.approach} size="xs" /></td>
                  <td className="px-2 py-2 text-text"><span className="line-clamp-3" title={r.claim}>{r.claim}</span></td>
                  <td className="px-2 py-2"><ConfidenceBar value={r.confidence} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
