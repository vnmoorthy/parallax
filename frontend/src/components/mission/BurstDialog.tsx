"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Loader2, X, Zap, Boxes, Gauge, Timer, Activity } from "lucide-react";
import { toast } from "sonner";
import type { BurstResult } from "@/lib/types";
import { api } from "@/lib/api";
import { PALETTE, fmtMs, histogram } from "@/lib/chart";

const noopSubscribe = () => () => {};
const useIsClient = () => useSyncExternalStore(noopSubscribe, () => true, () => false);

function Tile({ label, value, Icon, hex }: { label: string; value: string; Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; hex: string }) {
  return (
    <div className="card-2 flex flex-col gap-0.5 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-faint"><Icon className="size-3" style={{ color: hex }} />{label}</div>
      <div className="mono text-lg font-semibold tabular-nums text-text">{value}</div>
    </div>
  );
}

export function BurstDialog({ open, runId, initial, onClose }: { open: boolean; runId: string; initial?: BurstResult | null; onClose: () => void }) {
  const [n, setN] = useState(100);
  const [running, setRunning] = useState(false);
  const [fresh, setFresh] = useState<BurstResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useIsClient();
  const result = fresh ?? initial ?? null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !running) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, running, onClose]);

  const run = async () => {
    const count = Math.max(10, Math.min(200, Math.round(n) || 100));
    setN(count); setRunning(true); setError(null);
    try {
      const r = await api.burst(runId, count);
      setFresh(r);
      toast.success(`Burst done · ${r.count} queries · p95 ${fmtMs(r.p95_ms)}`);
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg); toast.error(`Burst failed: ${msg}`);
    } finally { setRunning(false); }
  };

  const bins = result ? histogram(result.per_query ?? [], 12) : [];
  const maxCount = bins.reduce((m, b) => Math.max(m, b.count), 0);

  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[60] grid place-items-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !running && onClose()} />
          <motion.div
            role="dialog" aria-modal="true" aria-labelledby="burst-title"
            initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }} transition={{ duration: 0.18 }}
            className="card relative w-full max-w-2xl overflow-hidden shadow-2xl shadow-black/60"
          >
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-accent via-accent-2 to-transparent" />
            <header className="flex items-start gap-3 px-5 pt-4 pb-3">
              <div className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-accent/30 to-accent-2/20 text-warn"><Zap className="size-4" /></div>
              <div className="min-w-0 flex-1">
                <h2 id="burst-title" className="text-sm font-semibold text-text">Concurrency burst</h2>
                <p className="text-[11px] text-muted">Fires N concurrent read queries spread across every branch database and measures tail latency.</p>
              </div>
              <button type="button" onClick={onClose} disabled={running} className="rounded-md p-1 text-faint hover:bg-white/5 hover:text-text disabled:opacity-40" aria-label="Close"><X className="size-4" /></button>
            </header>

            <div className="flex flex-wrap items-end gap-3 border-y border-border bg-bg-elev/40 px-5 py-3">
              <label className="flex flex-col gap-1 text-[11px] text-muted">
                Queries (10–200)
                <input
                  type="number" min={10} max={200} step={10} value={n} disabled={running}
                  onChange={(e) => setN(Number(e.target.value))}
                  onKeyDown={(e) => { if (e.key === "Enter") void run(); }}
                  className="mono w-32 rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-text outline-none focus:border-accent"
                />
              </label>
              <input type="range" min={10} max={200} step={10} value={n} disabled={running} onChange={(e) => setN(Number(e.target.value))} className="h-1.5 flex-1 min-w-[140px] accent-[#6366f1]" aria-label="Query count" />
              <button
                type="button" onClick={() => void run()} disabled={running}
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-accent to-accent-2 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-accent/30 hover:brightness-110 disabled:opacity-60"
              >
                {running ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
                {running ? `Running ${n}…` : `Run ${n} queries`}
              </button>
            </div>

            <div className="space-y-3 px-5 py-4">
              {error && <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>}
              {running && !result && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-14" />)}</div>
              )}
              {result ? (
                <>
                  <div className={clsx("grid grid-cols-2 gap-2 sm:grid-cols-5 transition-opacity", running && "opacity-50")}>
                    <Tile label="p50" value={fmtMs(result.p50_ms)} Icon={Gauge} hex="#60a5fa" />
                    <Tile label="p95" value={fmtMs(result.p95_ms)} Icon={Gauge} hex="#f87171" />
                    <Tile label="max" value={fmtMs(result.max_ms)} Icon={Timer} hex="#fbbf24" />
                    <Tile label="total wall" value={fmtMs(result.total_ms)} Icon={Activity} hex="#22d3ee" />
                    <Tile label="concurrency" value={String(result.concurrency ?? result.count)} Icon={Boxes} hex="#34d399" />
                  </div>
                  <div className="rounded-xl border border-border bg-bg-elev/50 p-3">
                    <div className="mb-1 flex items-center justify-between text-[11px]">
                      <span className="font-medium text-muted">Latency distribution · {result.count} queries</span>
                      <span className="text-faint">12 bins · ms</span>
                    </div>
                    <div className="h-44">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={bins} margin={{ top: 6, right: 6, left: -22, bottom: 0 }}>
                          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                          <XAxis dataKey="bin" tick={{ fill: "#667089", fontSize: 9 }} tickLine={false} axisLine={false} interval={1} />
                          <YAxis tick={{ fill: "#667089", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                          <Tooltip contentStyle={{ background: "#141a2c", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, fontSize: 11 }} labelStyle={{ color: "#9aa3b8" }} itemStyle={{ color: "#e6e9f2" }} cursor={{ fill: "rgba(99,102,241,0.08)" }} formatter={(v) => [String(v), "queries"]} />
                          <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive>
                            {bins.map((b, i) => <Cell key={i} fill={b.count === maxCount ? PALETTE[1] : PALETTE[0]} fillOpacity={0.9} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </>
              ) : !running && (
                <div className="flex items-center gap-3 rounded-xl border border-dashed border-border px-4 py-6 text-xs text-faint">
                  <Boxes className="size-5 text-accent-2" />
                  <div>Each branch is an isolated fork, so all {n} queries hit different databases at once. Results show p50 / p95 / max and a histogram.</div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
