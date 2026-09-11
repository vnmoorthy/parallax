"use client";
import clsx from "clsx";
import { Braces, TextSearch, Waypoints, Shuffle } from "lucide-react";
import type { Approach } from "@/lib/types";

export const APPROACH_META: Record<Approach, { label: string; hex: string; Icon: React.ComponentType<{ className?: string }>; hint: string }> = {
  sql:    { label: "SQL",    hex: "#6366f1", Icon: Braces,     hint: "Structured SQL analysis" },
  bm25:   { label: "BM25",   hex: "#fbbf24", Icon: TextSearch, hint: "Full-text keyword search" },
  vector: { label: "Vector", hex: "#22d3ee", Icon: Waypoints,  hint: "Semantic vector search" },
  mixed:  { label: "Mixed",  hex: "#34d399", Icon: Shuffle,    hint: "SQL + search combined" },
};

export function ApproachBadge({ approach, size = "sm", className }: { approach: Approach | string | undefined; size?: "xs" | "sm" | "md"; className?: string }) {
  const meta = APPROACH_META[(approach as Approach) ?? "sql"] ?? { label: String(approach ?? "?"), hex: "#9aa3b8", Icon: Braces, hint: "" };
  const Icon = meta.Icon;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-md border font-semibold uppercase tracking-wide whitespace-nowrap select-none",
        size === "xs" && "px-1 py-[1px] text-[9px]",
        size === "sm" && "px-1.5 py-0.5 text-[10px]",
        size === "md" && "px-2 py-1 text-[11px]",
        className,
      )}
      style={{ color: meta.hex, borderColor: `${meta.hex}55`, background: `${meta.hex}12` }}
      title={meta.hint}
    >
      <Icon className="size-3" />
      {meta.label}
    </span>
  );
}
