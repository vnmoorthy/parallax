"use client";
import { useMemo } from "react";
import { Bot } from "lucide-react";
import type { Run } from "@/lib/types";
import { AgentCard } from "./AgentCard";

export function sortedBranches(run: Run) {
  return [...run.branches].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

export function AgentGrid({ run, selectedBranch, onSelect, onOpenDetail }: {
  run: Run; selectedBranch: string | null; onSelect: (id: string) => void; onOpenDetail: (id: string) => void;
}) {
  const branches = useMemo(() => sortedBranches(run), [run]);
  const planning = run.status === "queued" || run.status === "provisioning" || run.status === "planning";

  if (!branches.length) {
    return (
      <div className="@container">
        <div className="grid gap-3 @3xl:grid-cols-2">
          {Array.from({ length: Math.min(run.agents || 4, 8) }).map((_, i) => (
            <div key={i} className="card p-3.5 space-y-3">
              <div className="skeleton h-4 w-3/4" />
              <div className="skeleton h-3 w-full" />
              <div className="flex gap-2"><div className="skeleton h-4 w-12" /><div className="skeleton h-4 w-16" /></div>
              <div className="skeleton h-20 w-full" />
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-center gap-2 text-xs text-faint">
          <Bot className="size-3.5 animate-pulse text-accent-2" />
          {planning ? `Planning ${run.agents} hypotheses…` : run.status === "failed" ? "Run failed before agents were dispatched." : "Waiting for agents…"}
        </div>
      </div>
    );
  }

  return (
    <div className="@container">
      <div className="grid gap-3 @3xl:grid-cols-2">
        {branches.map((b, i) => (
          <AgentCard
            key={b.id}
            run={run}
            branch={b}
            index={i}
            selected={selectedBranch === b.id}
            onSelect={() => onSelect(b.id)}
            onOpenDetail={() => onOpenDetail(b.id)}
          />
        ))}
      </div>
    </div>
  );
}
