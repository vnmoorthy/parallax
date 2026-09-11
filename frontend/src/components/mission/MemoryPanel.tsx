"use client";
import { useMemo, useState } from "react";
import clsx from "clsx";
import { motion } from "framer-motion";
import { Brain, Check, Clock, Loader2, Tag } from "lucide-react";
import Link from "next/link";
import type { Run, RunEvent } from "@/lib/types";

export function MemoryPanel({ run, events, className }: { run: Run; events: RunEvent[]; className?: string }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const remembered = useMemo(() => events.find((e) => e.type === "memory.remembered"), [events]);
  const rememberedN = remembered ? Number((remembered.payload as { n?: number }).n ?? 0) : 0;
  const finished = run.status === "done" || run.status === "failed";
  const hits = run.recalled ?? [];

  return (
    <div className={clsx("space-y-4", className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-text"><Brain className="size-4 text-success" /> Memory <span className="rounded-full border border-border px-1.5 py-[1px] text-[10px] font-medium uppercase tracking-wide text-muted">{run.modes?.memory ?? "local"}</span></div>
        <Link href="/memory" className="text-[11px] text-accent-2 hover:underline">Browse all →</Link>
      </div>

      <div className={clsx("flex items-center gap-2 rounded-xl border px-3 py-2 text-[12px]",
        remembered ? "border-success/40 bg-success/10 text-success" : finished && run.status === "done" ? "border-accent-2/40 bg-accent-2/10 text-accent-2" : run.status === "failed" ? "border-border bg-surface-2 text-faint" : "border-border bg-surface-2 text-muted")}>
        {remembered ? <Check className="size-4" /> : run.status === "done" ? <Loader2 className="size-4 animate-spin" /> : <Clock className="size-4" />}
        <span className="font-medium">
          {remembered ? `Remembered ✓${rememberedN ? ` · ${rememberedN} item${rememberedN === 1 ? "" : "s"}` : ""}` : run.status === "done" ? "Remembering in background…" : run.status === "failed" ? "Nothing to remember (run failed)" : "Will remember after synthesis"}
        </span>
        <span className="ml-auto text-[10px] opacity-70">tags: {run.dataset_id}, run:{run.id.slice(0, 8)}</span>
      </div>

      <section>
        <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-faint">
          <span>Recalled before planning</span><span>{hits.length} hit{hits.length === 1 ? "" : "s"}</span>
        </div>
        {!hits.length ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[11px] text-muted">
            {run.status === "queued" || run.status === "provisioning" ? "Recall runs right before planning…" : "Nothing recalled — first investigation of this dataset. The next run on it will start from what this one learns."}
          </div>
        ) : (
          <ul className="space-y-2">
            {hits.map((h, i) => {
              const score = Math.max(0, Math.min(1, h.score > 1 ? h.score / 100 : h.score));
              const open = expanded === i;
              return (
                <motion.li key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className="card-2 p-3">
                  <button type="button" onClick={() => setExpanded(open ? null : i)} className="w-full text-left">
                    <p className={clsx("text-[12px] leading-relaxed text-text/90", !open && "line-clamp-3")}>{h.text}</p>
                  </button>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                      <motion.div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-success/70 to-success" initial={{ width: 0 }} animate={{ width: `${score * 100}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
                    </div>
                    <span className="mono text-[10px] tabular-nums text-success">{(score * 100).toFixed(0)}%</span>
                  </div>
                  {(h.tags?.length || h.created_at) ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      {h.tags?.length ? <Tag className="size-3 text-faint" /> : null}
                      {h.tags?.map((t) => <span key={t} className="rounded-full border border-border px-1.5 py-[1px] text-[10px] text-muted">{t}</span>)}
                      {h.created_at && <span className="ml-auto text-[10px] text-faint">{new Date(h.created_at).toLocaleString()}</span>}
                    </div>
                  ) : null}
                </motion.li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
