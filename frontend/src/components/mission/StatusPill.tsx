"use client";
import clsx from "clsx";
import { CheckCircle2, CircleDot, GitFork, Loader2, XCircle, Clock, Sparkles, Brain, Database } from "lucide-react";
import type { BranchStatus, RunStatus } from "@/lib/types";

export type PillStatus = BranchStatus | RunStatus;

export const STATUS_META: Record<PillStatus, { label: string; color: string; hex: string; Icon: React.ComponentType<{ className?: string }>; live?: boolean }> = {
  queued:        { label: "Queued",        color: "text-muted",   hex: "#9aa3b8", Icon: Clock },
  provisioning:  { label: "Provisioning",  color: "text-warn",    hex: "#fbbf24", Icon: Database, live: true },
  planning:      { label: "Planning",      color: "text-warn",    hex: "#fbbf24", Icon: Brain, live: true },
  forking:       { label: "Forking",       color: "text-warn",    hex: "#fbbf24", Icon: GitFork, live: true },
  exploring:     { label: "Exploring",     color: "text-accent-2",hex: "#22d3ee", Icon: CircleDot, live: true },
  synthesizing:  { label: "Synthesizing",  color: "text-accent-2",hex: "#22d3ee", Icon: Sparkles, live: true },
  done:          { label: "Done",          color: "text-success", hex: "#34d399", Icon: CheckCircle2 },
  failed:        { label: "Failed",        color: "text-danger",  hex: "#f87171", Icon: XCircle },
};

export function statusHex(status: PillStatus): string { return STATUS_META[status]?.hex ?? "#9aa3b8"; }

export function StatusPill({ status, size = "sm", className, showIcon = true }: { status: PillStatus; size?: "xs" | "sm" | "md"; className?: string; showIcon?: boolean }) {
  const meta = STATUS_META[status] ?? STATUS_META.queued;
  const Icon = meta.live && status !== "exploring" ? Loader2 : meta.Icon;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border font-medium whitespace-nowrap select-none",
        size === "xs" && "px-1.5 py-[1px] text-[10px]",
        size === "sm" && "px-2 py-0.5 text-[11px]",
        size === "md" && "px-2.5 py-1 text-xs",
        meta.color,
        className,
      )}
      style={{ borderColor: `${meta.hex}55`, background: `${meta.hex}14` }}
      title={meta.label}
    >
      {showIcon && (
        <span className="relative inline-flex">
          <Icon className={clsx("size-3", meta.live && status !== "exploring" && "animate-spin")} />
          {status === "exploring" && <span className="absolute inset-0 rounded-full pulse-ring" />}
        </span>
      )}
      {meta.label}
    </span>
  );
}
