"use client";
import clsx from "clsx";
import { motion } from "framer-motion";
import { fmtPct } from "@/lib/chart";

export function confidenceColor(v: number): string {
  if (v < 0.4) return "#f87171";
  if (v < 0.7) return "#fbbf24";
  return "#34d399";
}

export function ConfidenceBar({ value, showLabel = true, size = "sm", className, label = "confidence" }: {
  value: number | null | undefined; showLabel?: boolean; size?: "xs" | "sm" | "md"; className?: string; label?: string;
}) {
  const raw = typeof value === "number" && Number.isFinite(value) ? value : 0;
  const v = raw > 1 ? Math.min(1, raw / 100) : Math.max(0, raw);
  const color = confidenceColor(v);
  return (
    <div className={clsx("flex items-center gap-2 min-w-0", className)} title={`${label}: ${fmtPct(v)}`}>
      <div className={clsx("relative flex-1 min-w-[48px] overflow-hidden rounded-full bg-surface-3", size === "xs" ? "h-1" : size === "sm" ? "h-1.5" : "h-2")}>
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ background: `linear-gradient(90deg, ${color}aa, ${color})` }}
          initial={{ width: 0 }}
          animate={{ width: `${v * 100}%` }}
          transition={{ type: "spring", stiffness: 120, damping: 20 }}
        />
      </div>
      {showLabel && (
        <span className={clsx("mono tabular-nums shrink-0", size === "xs" ? "text-[10px]" : "text-[11px]")} style={{ color }}>
          {fmtPct(v)}
        </span>
      )}
    </div>
  );
}
