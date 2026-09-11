"use client";
import clsx from "clsx";
import { motion } from "framer-motion";
import { AlertTriangle, Check } from "lucide-react";
import type { RunStatus } from "@/lib/types";

const STEPS: { key: RunStatus; label: string }[] = [
  { key: "queued", label: "Queued" },
  { key: "provisioning", label: "Provision" },
  { key: "planning", label: "Plan" },
  { key: "exploring", label: "Explore" },
  { key: "synthesizing", label: "Synthesize" },
  { key: "done", label: "Done" },
];

export function stepIndex(status: RunStatus): number {
  if (status === "failed") return -1;
  return STEPS.findIndex((s) => s.key === status);
}

export function StatusStepper({ status, error, className }: { status: RunStatus; error?: string | null; className?: string }) {
  const failed = status === "failed";
  const idx = failed ? STEPS.length : stepIndex(status);

  return (
    <div className={clsx("space-y-2", className)}>
      <ol className="flex items-center gap-1 overflow-x-auto scrollbar-thin py-1" aria-label="Run progress">
        {STEPS.map((s, i) => {
          const done = i < idx || (status === "done" && i === idx);
          const current = i === idx && status !== "done";
          return (
            <li key={s.key} className="flex items-center gap-1 shrink-0">
              <div className={clsx("flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                done && "border-success/40 bg-success/10 text-success",
                current && !failed && "border-accent-2/50 bg-accent-2/10 text-accent-2",
                !done && !current && "border-border text-faint",
                failed && !done && "border-danger/30 text-danger/70",
              )}>
                <span className="relative grid size-3.5 place-items-center">
                  {done ? (
                    <Check className="size-3" />
                  ) : current ? (
                    <>
                      <motion.span className="absolute inset-0 rounded-full bg-accent-2/40" animate={{ scale: [1, 1.9, 1], opacity: [0.6, 0, 0.6] }} transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }} />
                      <span className="size-1.5 rounded-full bg-accent-2" />
                    </>
                  ) : (
                    <span className={clsx("size-1.5 rounded-full", failed ? "bg-danger/60" : "bg-faint/50")} />
                  )}
                </span>
                <span className={clsx("font-medium", current && "tracking-wide")}>{s.label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <span className="relative h-px w-5 sm:w-8 overflow-hidden rounded bg-border-strong">
                  <motion.span
                    className={clsx("absolute inset-y-0 left-0", done ? "bg-success" : "bg-accent-2")}
                    initial={{ width: 0 }}
                    animate={{ width: done ? "100%" : current ? ["0%", "100%"] : "0%" }}
                    transition={current && !done ? { duration: 1.2, repeat: Infinity, ease: "easeInOut" } : { duration: 0.4 }}
                  />
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {failed && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} role="alert"
          className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <div className="font-semibold">Run failed</div>
            <div className="mono mt-0.5 whitespace-pre-wrap break-words text-[11px] text-danger/90">{error || "Unknown error — check backend logs."}</div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
