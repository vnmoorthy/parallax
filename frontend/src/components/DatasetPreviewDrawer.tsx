"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, Columns3, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { ColumnProfile, Dataset, DatasetPreview } from "@/lib/types";
import { cn, errorMessage } from "@/lib/utils";
import { useIsClient } from "@/lib/hooks";
import { formatNumber, truncate } from "@/lib/format";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { ResultTable } from "./ui/Table";
import { Skeleton } from "./ui/Skeleton";
import { Progress } from "./ui/Progress";

export interface DatasetPreviewDrawerProps {
  dataset: Dataset | null;
  open: boolean;
  onClose: () => void;
  onSelect?: (dataset: Dataset) => void;
  selected?: boolean;
}

function typeTone(type: string): "accent" | "cyan" | "warn" | "neutral" {
  const t = type.toLowerCase();
  if (/int|double|float|decimal|numeric|real|bigint/.test(t)) return "cyan";
  if (/date|time/.test(t)) return "warn";
  if (/char|text|string/.test(t)) return "accent";
  return "neutral";
}

function ProfileCard({ name, profile, totalRows }: { name: string; profile: ColumnProfile | undefined; totalRows: number }) {
  if (!profile) return null;
  const top = profile.top ?? [];
  const maxCount = Math.max(1, ...top.map((t) => t.count));
  return (
    <div className="card-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="mono text-sm font-semibold text-text">{name}</div>
        <Badge tone={typeTone(profile.type)} size="sm" mono>{profile.type}</Badge>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <div><dt className="text-faint">Nulls</dt><dd className="tabular mt-0.5 text-text">{formatNumber(profile.nulls)}{totalRows ? <span className="text-faint"> · {((profile.nulls / totalRows) * 100).toFixed(1)}%</span> : null}</dd></div>
        <div><dt className="text-faint">Distinct</dt><dd className="tabular mt-0.5 text-text">{formatNumber(profile.distinct)}</dd></div>
        <div><dt className="text-faint">Min</dt><dd className="mono mt-0.5 truncate text-text" title={String(profile.min ?? "")}>{profile.min == null ? "—" : String(profile.min)}</dd></div>
        <div><dt className="text-faint">Max</dt><dd className="mono mt-0.5 truncate text-text" title={String(profile.max ?? "")}>{profile.max == null ? "—" : String(profile.max)}</dd></div>
      </dl>
      {top.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">Top values</div>
          <ul className="space-y-1.5">
            {top.slice(0, 6).map((t) => (
              <li key={t.value} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-xs">
                <span className="truncate text-text" title={t.value}>{truncate(t.value, 60) || <span className="italic text-faint">empty</span>}</span>
                <span className="tabular text-muted">{formatNumber(t.count)}</span>
                <Progress value={t.count} max={maxCount} size="xs" tone="accent" className="col-span-2" label={`${t.value}: ${t.count}`} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function DatasetPreviewDrawer({ dataset, open, onClose, onSelect, selected }: DatasetPreviewDrawerProps) {
  const mounted = useIsClient();
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const datasetId = dataset?.id ?? null;
  // All async state is keyed by dataset id so switching datasets never needs an effect to reset it.
  const [loaded, setLoaded] = React.useState<{ id: string; data: DatasetPreview } | null>(null);
  const [failure, setFailure] = React.useState<{ id: string; message: string } | null>(null);
  const [pickedCol, setPickedCol] = React.useState<{ id: string; col: string } | null>(null);
  const preview = loaded && loaded.id === datasetId ? loaded.data : null;
  const error = failure && failure.id === datasetId ? failure.message : null;
  const loading = !preview && !error;
  const activeCol = pickedCol && pickedCol.id === datasetId && preview?.columns.includes(pickedCol.col) ? pickedCol.col : preview?.columns[0] ?? null;
  const setActiveCol = (col: string) => { if (datasetId) setPickedCol({ id: datasetId, col }); };

  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    if (!open || !datasetId) return;
    const id = datasetId;
    api.datasetPreview(id, 20)
      .then((p) => setLoaded({ id, data: p }))
      .catch((e: unknown) => {
        const msg = errorMessage(e);
        setFailure({ id, message: msg });
        toast.error("Couldn't load preview", { description: msg });
      });
  }, [open, datasetId, attempt]);

  const retry = () => { setFailure(null); setAttempt((a) => a + 1); };

  React.useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    document.body.classList.add("no-scroll");
    const t = setTimeout(() => panelRef.current?.focus({ preventScroll: true }), 30);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("no-scroll");
      prev?.focus?.({ preventScroll: true });
    };
  }, [open, onClose]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && dataset && (
        <div className="fixed inset-0 z-[90]">
          <motion.div
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={`Preview of ${dataset.name}`}
            tabIndex={-1}
            className="card-2 absolute inset-y-0 right-0 flex w-full flex-col rounded-none border-y-0 border-r-0 shadow-[-30px_0_80px_-20px_rgba(0,0,0,.9)] outline-hidden sm:w-[min(100vw,820px)] sm:rounded-l-2xl"
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
          >
            <header className="flex items-start gap-4 border-b px-5 py-4 sm:px-6">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="mono truncate text-lg font-semibold tracking-tight text-text">{dataset.name}</h2>
                  <Badge tone={dataset.source === "upload" ? "cyan" : "neutral"} size="sm">{dataset.source}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted">{dataset.description}</p>
                <div className="tabular mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  <span>{formatNumber(dataset.rows)} rows</span>
                  <span>{dataset.columns.length} columns</span>
                  {dataset.text_columns.length > 0 && <span>text: <span className="mono text-text">{dataset.text_columns.join(", ")}</span></span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {onSelect && (
                  <Button size="sm" variant={selected ? "secondary" : "primary"} icon={selected ? <Check /> : undefined} onClick={() => onSelect(dataset)} disabled={selected}>
                    {selected ? "Selected" : "Use this dataset"}
                  </Button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close preview"
                  className="inline-flex size-8 items-center justify-center rounded-lg text-muted outline-hidden transition-colors hover:bg-white/5 hover:text-text focus-visible:ring-2 focus-visible:ring-accent-2/80"
                >
                  <X className="size-4" />
                </button>
              </div>
            </header>

            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 scrollbar-thin sm:px-6">
              {error ? (
                <div role="alert" className="card flex flex-col items-start gap-3 border-danger/30 bg-danger/5 p-5 sm:flex-row sm:items-center">
                  <AlertTriangle className="size-5 shrink-0 text-danger" aria-hidden />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-text">Preview unavailable</div>
                    <div className="mt-0.5 text-xs text-muted">{error}</div>
                  </div>
                  <Button size="sm" icon={<RefreshCw />} onClick={retry}>Retry</Button>
                </div>
              ) : (
                <>
                  <section aria-labelledby="preview-columns">
                    <div className="mb-3 flex items-center gap-2">
                      <Columns3 className="size-4 text-accent-2" aria-hidden />
                      <h3 id="preview-columns" className="text-sm font-semibold text-text">Columns</h3>
                      <span className="text-xs text-faint">— click one to inspect its profile</span>
                    </div>
                    {loading || !preview ? (
                      <div className="flex flex-wrap gap-2" aria-busy="true">
                        {dataset.columns.map((c) => <Skeleton key={c.name} className="h-8 w-28 rounded-lg" />)}
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Columns">
                        {preview.columns.map((c) => {
                          const p = preview.profile[c];
                          const active = c === activeCol;
                          return (
                            <button
                              key={c}
                              type="button"
                              role="tab"
                              aria-selected={active}
                              onClick={() => setActiveCol(c)}
                              className={cn(
                                "inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-accent-2/80",
                                active ? "border-accent/60 bg-accent/15 text-text" : "border-border-strong bg-surface text-muted hover:border-white/20 hover:text-text",
                              )}
                            >
                              <span className="mono font-medium">{c}</span>
                              {p && <span className={cn("rounded px-1 py-px text-[10px] uppercase", active ? "bg-white/10 text-text" : "bg-white/5 text-faint")}>{p.type}</span>}
                              {p && <span className="tabular text-[10px] text-faint">{formatNumber(p.distinct, { compact: true })} distinct</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <div className="mt-3">
                      {loading || !preview ? (
                        <Skeleton className="h-36 w-full rounded-xl" />
                      ) : activeCol ? (
                        <ProfileCard name={activeCol} profile={preview.profile[activeCol]} totalRows={dataset.rows} />
                      ) : null}
                    </div>
                  </section>

                  <section aria-labelledby="preview-rows">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 id="preview-rows" className="text-sm font-semibold text-text">First {preview ? Math.min(20, preview.rows.length) : 20} rows</h3>
                      {preview && <span className="text-xs text-faint">of {formatNumber(dataset.rows)}</span>}
                    </div>
                    {loading || !preview ? (
                      <div className="space-y-2" aria-busy="true">
                        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
                      </div>
                    ) : (
                      <ResultTable columns={preview.columns} rows={preview.rows} maxRows={20} maxHeight={420} caption={`First rows of ${dataset.name}`} />
                    )}
                  </section>
                </>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
