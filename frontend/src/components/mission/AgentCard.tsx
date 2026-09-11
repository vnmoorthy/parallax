"use client";
import { memo } from "react";
import clsx from "clsx";
import { motion } from "framer-motion";
import { Database, Maximize2 } from "lucide-react";
import type { Branch, Hypothesis, Run } from "@/lib/types";
import { shortId } from "@/lib/layout";
import { ApproachBadge } from "./ApproachBadge";
import { StatusPill } from "./StatusPill";
import { StepTimeline } from "./StepTimeline";
import { ConfidenceBar } from "./ConfidenceBar";
import { MiniChart } from "./MiniChart";
import { copyText } from "./ExportMenu";

export const agentCardDomId = (branchId: string) => `agent-card-${branchId}`;

/** Scrolls the AgentCard for `branchId` into view (used by report chips / findings table). */
export function scrollToBranchCard(branchId: string) {
  if (typeof document === "undefined") return;
  const el = document.getElementById(agentCardDomId(branchId));
  el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
}

export function hypothesisFor(run: Run, branch: Branch): Hypothesis | undefined {
  return run.plan.find((h) => h.id === branch.hypothesis_id);
}

export function branchTitle(run: Run, branch: Branch): string {
  return hypothesisFor(run, branch)?.title || `Branch ${shortId(branch.id, 6)}`;
}

export const AgentCard = memo(function AgentCard({ run, branch, selected, onSelect, onOpenDetail, index = 0 }: {
  run: Run; branch: Branch; selected: boolean; onSelect: () => void; onOpenDetail: () => void; index?: number;
}) {
  const hyp = hypothesisFor(run, branch);
  const showFindingBlock = !!branch.finding && !branch.steps.some((s) => s.kind === "finding");
  const live = branch.status === "exploring" || branch.status === "forking";

  return (
    <motion.article
      id={agentCardDomId(branch.id)}
      layout="position"
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: Math.min(index * 0.04, 0.3) }}
      onClick={onSelect}
      className={clsx(
        "card group relative flex cursor-pointer flex-col gap-2.5 p-3.5 transition-shadow scroll-mt-24",
        selected ? "ring-2 ring-accent shadow-[0_0_0_1px_rgba(99,102,241,0.4),0_10px_40px_-10px_rgba(99,102,241,0.35)]" : "hover:border-border-strong",
      )}
      aria-selected={selected}
    >
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold leading-snug text-text line-clamp-2" title={hyp?.title}>{hyp?.title || `Branch ${shortId(branch.id, 6)}`}</h3>
          {hyp?.rationale && <p className="mt-0.5 text-[11px] leading-relaxed text-muted line-clamp-2" title={hyp.rationale}>{hyp.rationale}</p>}
        </div>
        <button
          type="button" onClick={(e) => { e.stopPropagation(); onOpenDetail(); }}
          className="rounded-md p-1 text-faint opacity-0 transition-opacity hover:bg-white/5 hover:text-text group-hover:opacity-100 focus:opacity-100"
          title="Open branch details" aria-label="Open branch details"
        >
          <Maximize2 className="size-3.5" />
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-1.5">
        <ApproachBadge approach={hyp?.approach} />
        <StatusPill status={branch.status} />
        {branch.db ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); void copyText(branch.db!.id, "Database id copied"); }}
            className="mono inline-flex items-center gap-1 rounded-md border border-border bg-bg-elev/60 px-1.5 py-0.5 text-[10px] text-muted hover:border-border-strong hover:text-text transition-colors"
            title={`${branch.db.id}\nclick to copy`}
          >
            <Database className="size-3 text-accent-2" /> {shortId(branch.db.id)}
          </button>
        ) : (
          <span className="mono inline-flex items-center gap-1 rounded-md border border-dashed border-border px-1.5 py-0.5 text-[10px] text-faint">
            <Database className="size-3" /> forking…
          </span>
        )}
        <span className="ml-auto text-[10px] tabular-nums text-faint">{branch.steps.length} step{branch.steps.length === 1 ? "" : "s"}</span>
      </div>

      <StepTimeline steps={branch.steps} finding={branch.finding} maxHeight={300} compact emptyHint={live ? "Agent is starting up…" : "No steps recorded"} />

      {showFindingBlock && branch.finding && (
        <div className="space-y-2 rounded-lg border border-success/30 bg-success/5 p-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-success">Finding</div>
          <p className="text-[12px] font-medium leading-relaxed text-text">{branch.finding.claim}</p>
          <ConfidenceBar value={branch.finding.confidence} />
          {branch.finding.chart && <MiniChart spec={branch.finding.chart} height={140} />}
        </div>
      )}
    </motion.article>
  );
});
