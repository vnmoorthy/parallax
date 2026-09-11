"use client";
import { useEffect, useRef } from "react";
import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { Braces, Eye, Lightbulb, Sparkles, TextSearch, Waypoints } from "lucide-react";
import type { AgentStep, Finding, StepKind } from "@/lib/types";
import { fmtMs } from "@/lib/chart";
import { MiniTable } from "./MiniTable";
import { MiniChart } from "./MiniChart";
import { ConfidenceBar } from "./ConfidenceBar";
import { CopyButton } from "./ExportMenu";

export const STEP_META: Record<StepKind, { label: string; hex: string; Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }> }> = {
  think:   { label: "think",   hex: "#9aa3b8", Icon: Lightbulb },
  sql:     { label: "sql",     hex: "#6366f1", Icon: Braces },
  bm25:    { label: "bm25",    hex: "#fbbf24", Icon: TextSearch },
  vector:  { label: "vector",  hex: "#22d3ee", Icon: Waypoints },
  observe: { label: "observe", hex: "#60a5fa", Icon: Eye },
  finding: { label: "finding", hex: "#34d399", Icon: Sparkles },
};

export function ProviderChip({ provider }: { provider?: string | null }) {
  if (!provider) return null;
  return <span className="rounded border border-border px-1 py-[1px] text-[9px] uppercase tracking-wide text-faint">{provider}</span>;
}

export function ElapsedChip({ ms }: { ms?: number | null }) {
  if (ms === null || ms === undefined) return null;
  return <span className="mono tabular-nums text-[10px] text-faint">{fmtMs(ms)}</span>;
}

function StepBody({ step, finding, compact }: { step: AgentStep; finding?: Finding | null; compact?: boolean }) {
  switch (step.kind) {
    case "think":
      return <p className="text-[12px] italic leading-relaxed text-muted whitespace-pre-wrap break-words">{step.text}</p>;
    case "sql":
      return (
        <div className="space-y-1">
          {step.text && step.text !== step.sql && <p className="text-[11px] text-muted line-clamp-2">{step.text}</p>}
          <div className="group relative rounded-lg border border-border bg-bg-elev/70">
            <pre className={clsx("mono overflow-x-auto scrollbar-thin whitespace-pre-wrap break-words px-2.5 py-2 text-[11px] leading-relaxed text-text/90", compact ? "max-h-28" : "max-h-56")}>{step.sql || step.text}</pre>
            <div className="absolute right-1 top-1 flex items-center gap-1 rounded-md bg-surface-2/80 px-1 backdrop-blur">
              <ElapsedChip ms={step.elapsed_ms} />
              <ProviderChip provider={step.provider} />
              <CopyButton text={step.sql || step.text} label="SQL copied" title="Copy SQL" size={3} />
            </div>
          </div>
        </div>
      );
    case "bm25":
    case "vector": {
      const Icon = STEP_META[step.kind].Icon;
      const hex = STEP_META[step.kind].hex;
      return (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]" style={{ borderColor: `${hex}55`, background: `${hex}12`, color: hex }}>
              <Icon className="size-3 shrink-0" />
              <span className="truncate" title={step.text}>{step.text}</span>
            </span>
            <ElapsedChip ms={step.elapsed_ms} />
            <ProviderChip provider={step.provider} />
          </div>
          {step.sql && (
            <details className="group">
              <summary className="cursor-pointer text-[10px] text-faint hover:text-muted select-none">generated SQL</summary>
              <pre className="mono mt-1 max-h-32 overflow-auto scrollbar-thin whitespace-pre-wrap break-words rounded-lg border border-border bg-bg-elev/70 px-2.5 py-2 text-[11px] text-text/90">{step.sql}</pre>
            </details>
          )}
        </div>
      );
    }
    case "observe":
      return step.result ? (
        <div className="space-y-1">
          {step.text && <p className="text-[11px] text-muted line-clamp-2">{step.text}</p>}
          <MiniTable result={step.result} />
        </div>
      ) : (
        <p className="text-[12px] leading-relaxed text-muted whitespace-pre-wrap break-words">{step.text}</p>
      );
    case "finding": {
      const claim = finding?.claim || step.text;
      return (
        <div className="space-y-2 rounded-lg border border-success/30 bg-success/5 p-2.5">
          <p className="text-[12px] font-medium leading-relaxed text-text">{claim}</p>
          {finding && <ConfidenceBar value={finding.confidence} />}
          {finding?.evidence && <p className="text-[11px] leading-relaxed text-muted line-clamp-3" title={finding.evidence}>{finding.evidence}</p>}
          {finding?.chart && <MiniChart spec={finding.chart} height={140} />}
        </div>
      );
    }
    default:
      return <p className="text-[12px] text-muted">{step.text}</p>;
  }
}

export function StepTimeline({ steps, finding, autoScroll = true, maxHeight = 280, compact = false, className, emptyHint = "Waiting for the agent's first step…" }: {
  steps: AgentStep[]; finding?: Finding | null; autoScroll?: boolean; maxHeight?: number | string; compact?: boolean; className?: string; emptyHint?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const count = steps.length;
  useEffect(() => {
    if (!autoScroll || !ref.current) return;
    const el = ref.current;
    // only follow if the user hasn't scrolled far up
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distance < 240 || count <= 2) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [count, autoScroll, finding]);

  const sorted = [...steps].sort((a, b) => a.n - b.n);

  return (
    <div ref={ref} className={clsx("overflow-y-auto scrollbar-thin pr-1", className)} style={{ maxHeight }}>
      {!sorted.length && (
        <div className="flex items-center gap-2 py-3 text-[11px] text-faint">
          <span className="size-1.5 rounded-full bg-accent-2 animate-pulse" /> {emptyHint}
        </div>
      )}
      <ol className="relative space-y-2.5 pl-5">
        <span className="absolute left-[7px] top-2 bottom-2 w-px bg-border-strong" aria-hidden />
        <AnimatePresence initial={false}>
          {sorted.map((s) => {
            const meta = STEP_META[s.kind] ?? STEP_META.think;
            const Icon = meta.Icon;
            return (
              <motion.li
                key={s.n}
                initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }}
                className="relative"
              >
                <span className="absolute -left-5 top-0.5 grid size-[15px] place-items-center rounded-full border bg-surface" style={{ borderColor: `${meta.hex}88` }}>
                  <Icon className="size-2.5" style={{ color: meta.hex }} />
                </span>
                <div className="mb-0.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide" style={{ color: meta.hex }}>
                  <span className="font-semibold">{meta.label}</span>
                  <span className="text-faint normal-case tracking-normal">#{s.n}</span>
                </div>
                <StepBody step={s} finding={finding} compact={compact} />
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>
    </div>
  );
}
