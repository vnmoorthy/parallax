import * as React from "react";
import { cn } from "@/lib/utils";

export type BadgeTone = "neutral" | "accent" | "cyan" | "success" | "warn" | "danger" | "info";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-white/5 text-muted border-white/10",
  accent: "bg-accent/15 text-[#c7d2fe] border-accent/30",
  cyan: "bg-accent-2/10 text-[#a5f3fc] border-accent-2/30",
  success: "bg-success/10 text-success border-success/30",
  warn: "bg-warn/10 text-warn border-warn/30",
  danger: "bg-danger/10 text-danger border-danger/30",
  info: "bg-info/10 text-info border-info/30",
};

const dots: Record<BadgeTone, string> = {
  neutral: "bg-faint",
  accent: "bg-accent",
  cyan: "bg-accent-2",
  success: "bg-success",
  warn: "bg-warn",
  danger: "bg-danger",
  info: "bg-info",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: "sm" | "md";
  /** Leading status dot */
  dot?: boolean;
  /** Animate the dot (in-progress states) */
  pulse?: boolean;
  icon?: React.ReactNode;
  mono?: boolean;
}

export function Badge({ tone = "neutral", size = "md", dot, pulse, icon, mono, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-medium leading-none",
        size === "sm" ? "h-5 px-2 text-[10px]" : "h-6 px-2.5 text-xs",
        tones[tone],
        mono && "mono",
        className,
      )}
      {...props}
    >
      {dot && <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", dots[tone], pulse && "pulse-ring")} />}
      {icon && <span className="inline-flex [&_svg]:size-3" aria-hidden>{icon}</span>}
      {children}
    </span>
  );
}

/** Tone for a run / branch status string. */
export function statusTone(status: string | null | undefined): BadgeTone {
  switch (status) {
    case "done": return "success";
    case "failed": return "danger";
    case "exploring": return "cyan";
    case "synthesizing": return "info";
    case "planning": return "accent";
    case "provisioning":
    case "forking": return "warn";
    default: return "neutral";
  }
}

/** True while a run/branch is still in flight. */
export function isActiveStatus(status: string | null | undefined): boolean {
  return status === "queued" || status === "provisioning" || status === "planning" || status === "exploring" || status === "synthesizing" || status === "forking";
}

/** Tone for a hypothesis approach. */
export function approachTone(approach: string | null | undefined): BadgeTone {
  switch (approach) {
    case "sql": return "accent";
    case "bm25": return "warn";
    case "vector": return "cyan";
    case "mixed": return "info";
    default: return "neutral";
  }
}
