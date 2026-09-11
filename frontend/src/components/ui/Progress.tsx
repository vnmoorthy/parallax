import * as React from "react";
import { cn } from "@/lib/utils";

export type ProgressTone = "gradient" | "accent" | "cyan" | "success" | "warn" | "danger" | "info";

const fills: Record<ProgressTone, string> = {
  gradient: "bg-linear-to-r from-accent to-accent-2",
  accent: "bg-accent",
  cyan: "bg-accent-2",
  success: "bg-success",
  warn: "bg-warn",
  danger: "bg-danger",
  info: "bg-info",
};

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 0..max */
  value?: number;
  max?: number;
  tone?: ProgressTone;
  size?: "xs" | "sm" | "md";
  indeterminate?: boolean;
  label?: string;
}

export function Progress({ value = 0, max = 100, tone = "gradient", size = "sm", indeterminate, label, className, ...props }: ProgressProps) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={indeterminate ? undefined : Math.round(value)}
      className={cn(
        "relative w-full overflow-hidden rounded-full bg-white/8",
        size === "xs" ? "h-1" : size === "sm" ? "h-1.5" : "h-2.5",
        className,
      )}
      {...props}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500 ease-out", fills[tone], indeterminate && "progress-indeterminate")}
        style={indeterminate ? undefined : { width: `${pct}%` }}
      />
    </div>
  );
}
