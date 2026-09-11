import * as React from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
  className?: string;
  tone?: "neutral" | "danger";
}

export function EmptyState({ icon, title, description, action, compact, className, tone = "neutral" }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "card flex flex-col items-center justify-center border-dashed text-center",
        compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-14",
        tone === "danger" && "border-danger/30 bg-danger/5",
        className,
      )}
      role={tone === "danger" ? "alert" : undefined}
    >
      {icon && (
        <span
          className={cn(
            "inline-flex items-center justify-center rounded-2xl border [&_svg]:size-6",
            compact ? "size-10" : "size-14",
            tone === "danger" ? "border-danger/30 bg-danger/10 text-danger" : "border-border-strong bg-surface-2 text-accent-2",
          )}
          aria-hidden
        >
          {icon}
        </span>
      )}
      <div>
        <h3 className={cn("font-semibold tracking-tight text-text", compact ? "text-sm" : "text-base")}>{title}</h3>
        {description && <p className={cn("mx-auto mt-1 max-w-md text-muted", compact ? "text-xs" : "text-sm")}>{description}</p>}
      </div>
      {action && <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}
