"use client";
import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Database, GitFork, SquareTerminal, Tag, X } from "lucide-react";
import type { Run } from "@/lib/types";
import { shortId } from "@/lib/layout";
import { ApproachBadge } from "./ApproachBadge";
import { StatusPill } from "./StatusPill";
import { StepTimeline } from "./StepTimeline";
import { ConfidenceBar } from "./ConfidenceBar";
import { MiniChart } from "./MiniChart";
import { CopyButton } from "./ExportMenu";

const noopSubscribe = () => () => {};
const useIsClient = () => useSyncExternalStore(noopSubscribe, () => true, () => false);

export function BranchDetailDrawer({ run, branchId, open, onClose, onOpenSql }: {
  run: Run; branchId: string | null; open: boolean; onClose: () => void; onOpenSql: (branchId: string) => void;
}) {
  const mounted = useIsClient();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const branch = branchId ? run.branches.find((b) => b.id === branchId) : undefined;
  const hyp = branch ? run.plan.find((h) => h.id === branch.hypothesis_id) : undefined;
  const show = open && !!branch;

  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {show && branch && (
        <motion.div className="fixed inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
          <motion.aside
            role="dialog" aria-modal="true" aria-label="Branch details"
            initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ type: "spring", stiffness: 260, damping: 28 }}
            className="absolute inset-y-0 right-0 flex w-full max-w-[560px] flex-col border-l border-border-strong bg-surface shadow-2xl shadow-black/60"
          >
            <header className="flex items-start gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <ApproachBadge approach={hyp?.approach} />
                  <StatusPill status={branch.status} />
                  <span className="mono text-[10px] text-faint">branch {shortId(branch.id, 8)}</span>
                </div>
                <h2 className="text-[15px] font-semibold leading-snug text-text">{hyp?.title || `Branch ${shortId(branch.id, 6)}`}</h2>
                {hyp?.rationale && <p className="mt-1 text-[12px] leading-relaxed text-muted">{hyp.rationale}</p>}
                {hyp?.target_columns?.length ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    <Tag className="size-3 text-faint" />
                    {hyp.target_columns.map((c) => <span key={c} className="mono rounded border border-border px-1.5 py-[1px] text-[10px] text-muted">{c}</span>)}
                  </div>
                ) : null}
              </div>
              <button type="button" onClick={onClose} className="rounded-md p-1 text-faint hover:bg-white/5 hover:text-text" aria-label="Close"><X className="size-4" /></button>
            </header>

            <div className="grid grid-cols-2 gap-2 border-b border-border bg-bg-elev/40 px-5 py-3 text-[11px]">
              <div className="min-w-0">
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-faint"><Database className="size-3 text-accent-2" /> database</div>
                <div className="mono mt-0.5 flex items-center gap-1 truncate text-text" title={branch.db?.id ?? undefined}>
                  <span className="truncate">{branch.db?.id ?? "forking…"}</span>
                  {branch.db?.id && <CopyButton text={branch.db.id} label="Database id copied" size={3} />}
                </div>
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-faint"><GitFork className="size-3 text-warn" /> parent</div>
                <div className="mono mt-0.5 truncate text-muted" title={branch.db?.parent_id ?? run.root_db?.id ?? undefined}>{branch.db?.parent_id ?? run.root_db?.id ?? "root"}</div>
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto scrollbar-thin px-5 py-4">
              <section>
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-faint">Agent timeline · {branch.steps.length} steps</div>
                <StepTimeline steps={branch.steps} finding={branch.finding} maxHeight="none" autoScroll={false} emptyHint="No steps yet." />
              </section>
              {branch.finding && (
                <section className="space-y-2 rounded-xl border border-success/30 bg-success/5 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-success">Finding</div>
                  <p className="text-[13px] font-medium leading-relaxed text-text">{branch.finding.claim}</p>
                  <ConfidenceBar value={branch.finding.confidence} size="md" />
                  {branch.finding.evidence && <p className="text-[12px] leading-relaxed text-muted">{branch.finding.evidence}</p>}
                  {branch.finding.chart && <MiniChart spec={branch.finding.chart} height={180} />}
                  {branch.finding.supporting_sql?.length ? (
                    <details>
                      <summary className="cursor-pointer text-[11px] text-faint hover:text-muted">supporting SQL ({branch.finding.supporting_sql.length})</summary>
                      <div className="mt-1 space-y-1">
                        {branch.finding.supporting_sql.map((s, i) => (
                          <div key={i} className="relative">
                            <pre className="mono whitespace-pre-wrap break-words rounded-lg border border-border bg-bg-elev/70 px-2.5 py-2 pr-8 text-[11px] text-text/90">{s}</pre>
                            <CopyButton text={s} label="SQL copied" className="absolute right-1 top-1" size={3} />
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : null}
                  {branch.finding.tags?.length ? (
                    <div className="flex flex-wrap gap-1">{branch.finding.tags.map((t) => <span key={t} className="rounded-full border border-border px-1.5 py-[1px] text-[10px] text-muted">#{t}</span>)}</div>
                  ) : null}
                </section>
              )}
            </div>

            <footer className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
              <span className="text-[11px] text-faint">Esc to close</span>
              <button
                type="button" onClick={() => onOpenSql(branch.id)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-accent/50 bg-accent/15 px-3 py-1.5 text-xs font-medium text-text hover:bg-accent/25 transition-colors"
              >
                <SquareTerminal className="size-3.5 text-accent-2" /> Open in SQL console
              </button>
            </footer>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
