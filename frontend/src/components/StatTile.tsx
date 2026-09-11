import * as React from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "./ui/Skeleton";

type Tone = "neutral" | "accent" | "cyan" | "success" | "warn" | "danger" | "info";

const iconTones: Record<Tone, string> = {
  neutral: "bg-white/5 text-muted",
  accent: "bg-accent/15 text-[#c7d2fe]",
  cyan: "bg-accent-2/10 text-[#a5f3fc]",
  success: "bg-success/10 text-success",
  warn: "bg-warn/10 text-warn",
  danger: "bg-danger/10 text-danger",
  info: "bg-info/10 text-info",
};

export interface StatTileProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: Tone;
  loading?: boolean;
  /** Use mono digits for numeric values */
  mono?: boolean;
}

export function StatTile({ label, value, hint, icon, tone = "neutral", loading, mono, className, ...props }: StatTileProps) {
  return (
    <div className={cn("card relative flex flex-col gap-2 p-4 sm:p-5", className)} {...props}>
      <div className="flex items-start justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">{label}</div>
        {icon && <span className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4", iconTones[tone])} aria-hidden>{icon}</span>}
      </div>
      {loading ? (
        <Skeleton className="h-8 w-24" />
      ) : (
        <div className={cn("tabular text-2xl font-semibold tracking-tight text-text sm:text-[28px]", mono && "mono")}>{value}</div>
      )}
      {hint && <div className="text-xs text-muted">{loading ? <Skeleton className="h-3 w-32" /> : hint}</div>}
    </div>
  );
}
