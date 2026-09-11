"use client";
import { Check, Database, Eye, Type, UploadCloud } from "lucide-react";
import type { Dataset } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";

export interface DatasetCardProps {
  dataset: Dataset;
  selected: boolean;
  onSelect: (dataset: Dataset) => void;
  onPreview: (dataset: Dataset) => void;
}

export function DatasetCard({ dataset, selected, onSelect, onPreview }: DatasetCardProps) {
  return (
    <article
      className={cn(
        "card group relative flex h-full flex-col gap-3 p-5 transition-[border-color,box-shadow,background-color] duration-200",
        "focus-within:ring-2 focus-within:ring-accent-2/60 hover:border-border-strong",
        selected && "glow border-accent/60 bg-surface-2",
      )}
      aria-label={dataset.name}
    >
      {/* Full-card select target (keyboard + pointer), sits under the content */}
      <button
        type="button"
        onClick={() => onSelect(dataset)}
        aria-pressed={selected}
        className="absolute inset-0 z-0 rounded-xl outline-hidden"
      >
        <span className="sr-only">{selected ? `${dataset.name} selected` : `Select ${dataset.name}`}</span>
      </button>

      <div className="pointer-events-none relative z-10 flex items-start gap-3">
        <span
          className={cn(
            "inline-flex size-10 shrink-0 items-center justify-center rounded-xl border transition-colors",
            selected ? "border-accent/40 bg-accent/15 text-[#c7d2fe]" : "border-border-strong bg-surface-2 text-muted group-hover:text-text",
          )}
          aria-hidden
        >
          {dataset.source === "upload" ? <UploadCloud className="size-5" /> : <Database className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="mono truncate text-[15px] font-semibold tracking-tight text-text">{dataset.name}</h3>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone={dataset.source === "upload" ? "cyan" : "neutral"} size="sm">{dataset.source}</Badge>
            <span className="tabular text-xs text-muted">{formatNumber(dataset.rows)} rows</span>
            <span className="text-faint" aria-hidden>·</span>
            <span className="tabular text-xs text-muted">{dataset.columns.length} columns</span>
          </div>
        </div>
        <span
          className={cn(
            "inline-flex size-6 shrink-0 items-center justify-center rounded-full border transition-all",
            selected ? "border-accent-2 bg-accent-2 text-[#07090f]" : "border-border-strong text-transparent group-hover:border-white/25",
          )}
          aria-hidden
        >
          <Check className="size-3.5" strokeWidth={3} />
        </span>
      </div>

      <p className="pointer-events-none relative z-10 line-clamp-2 text-sm leading-relaxed text-muted">{dataset.description}</p>

      <div className="pointer-events-none relative z-10 mt-auto flex flex-wrap items-center gap-1.5">
        {dataset.text_columns.length > 0 ? (
          dataset.text_columns.slice(0, 2).map((c) => (
            <Badge key={c} tone="accent" size="sm" mono icon={<Type />} title={`Text column: ${c} — BM25 + vector search`}>{c}</Badge>
          ))
        ) : (
          <span className="text-xs text-faint">No free-text column</span>
        )}
      </div>

      <div className="relative z-10 flex items-center justify-between border-t pt-3">
        <Button
          size="sm"
          variant="ghost"
          icon={<Eye />}
          onClick={(e) => { e.stopPropagation(); onPreview(dataset); }}
          aria-label={`Preview ${dataset.name}`}
          className="-ml-2"
        >
          Preview
        </Button>
        <span className={cn("pointer-events-none text-xs font-medium", selected ? "text-accent-2" : "text-faint")}>
          {selected ? "Selected" : "Click to select"}
        </span>
      </div>
    </article>
  );
}
