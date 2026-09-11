"use client";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Activity, Boxes, Clock, Cpu, Database, GitFork, Gauge, Sparkles, Timer, Zap } from "lucide-react";
import type { Run } from "@/lib/types";
import { fmtMs, fmtNum, parseTs } from "@/lib/chart";

/** Smoothly animates numeric changes (ease-out cubic, ~600ms). */
export function useCountUp(target: number, ms = 600): number {
  const [v, setV] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    const from = cur.current;
    const to = Number.isFinite(target) ? target : 0;
    if (from === to) return;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      const val = from + (to - from) * e;
      cur.current = val; setV(val);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function useElapsed(run: Run): number | null {
  const m = run.metrics;
  const running = run.status !== "done" && run.status !== "failed";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [running]);
  if (!running) return m?.elapsed_ms ?? (m?.started_at && m?.finished_at ? parseTs(m.finished_at) - parseTs(m.started_at) : null);
  const started = parseTs(m?.started_at);
  if (Number.isNaN(started)) return m?.elapsed_ms ?? null;
  return Math.max(0, now - started);
}

function Tile({ label, value, sub, Icon, accent, live, tooltip, className }: {
  label: string; value: string; sub?: string; Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; accent?: string; live?: boolean; tooltip?: React.ReactNode; className?: string;
}) {
  return (
    <div className={clsx("group relative card-2 flex min-w-0 flex-col gap-0.5 px-3 py-2", className)}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase text-faint">
        <Icon className="size-3 shrink-0" style={accent ? { color: accent } : undefined} />
        <span className="truncate">{label}</span>
        {live && <span className="ml-auto size-1.5 rounded-full bg-accent-2 animate-pulse" />}
      </div>
      <div className="mono truncate text-[17px] font-semibold tabular-nums leading-tight text-text" title={value}>{value}</div>
      {sub && <div className="truncate text-[10px] text-faint">{sub}</div>}
      {tooltip && (
        <div className="pointer-events-none absolute left-0 top-full z-30 mt-1 hidden min-w-[180px] rounded-lg border border-border-strong bg-surface-2 p-2 text-[11px] shadow-xl shadow-black/40 group-hover:block">
          {tooltip}
        </div>
      )}
    </div>
  );
}

export function MetricsStrip({ run, onBurst, className }: { run: Run; onBurst: () => void; className?: string }) {
  const m = run.metrics;
  const dbs = useCountUp(m?.databases_created ?? 0);
  const forks = useCountUp(m?.forks ?? 0);
  const queries = useCountUp(m?.queries ?? 0);
  const peak = useCountUp(m?.peak_concurrency ?? 0);
  const p50 = useCountUp(m?.p50_ms ?? 0);
  const p95 = useCountUp(m?.p95_ms ?? 0);
  const llm = useCountUp(m?.llm_calls ?? 0);
  const elapsed = useElapsed(run);
  const running = run.status !== "done" && run.status !== "failed";
  const providers = Object.entries(m?.llm_calls_by_provider ?? {}).sort((a, b) => b[1] - a[1]);
  const canBurst = !!run.root_db;

  return (
    <div className={clsx("flex flex-col gap-2 xl:flex-row xl:items-stretch", className)}>
      <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5 2xl:grid-cols-9">
        <Tile label="Databases" value={fmtNum(Math.round(dbs))} Icon={Database} accent="#22d3ee" sub={run.modes?.data === "hotdata" ? "Hotdata" : "local DuckDB"} />
        <Tile label="Forks" value={fmtNum(Math.round(forks))} Icon={GitFork} accent="#fbbf24" sub="isolated branches" />
        <Tile label="Queries" value={fmtNum(Math.round(queries))} Icon={Activity} accent="#6366f1" live={running && run.status === "exploring"} sub="sql + search" />
        <Tile label="Concurrency" value={fmtNum(Math.round(peak))} Icon={Boxes} accent="#34d399" sub="peak in-flight" />
        <Tile label="p50" value={fmtMs(p50)} Icon={Gauge} accent="#60a5fa" sub="query latency" />
        <Tile label="p95" value={fmtMs(p95)} Icon={Gauge} accent="#f87171" sub="query latency" />
        <Tile
          label="LLM calls" value={fmtNum(Math.round(llm))} Icon={Cpu} accent="#a5b4fc"
          sub={providers.length ? providers.map(([k]) => k).join(" · ") : String(run.modes?.llm ?? "—")}
          tooltip={
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wide text-faint">by provider</div>
              {providers.length ? providers.map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3"><span className="text-muted">{k}</span><span className="mono tabular-nums text-text">{v}</span></div>
              )) : <div className="text-faint">no calls yet</div>}
            </div>
          }
        />
        <Tile label="Elapsed" value={fmtMs(elapsed)} Icon={Clock} accent="#e6e9f2" live={running} sub={running ? "running" : "total"} />
        <Tile label="1st finding" value={fmtMs(m?.time_to_first_finding_ms)} Icon={Sparkles} accent="#34d399" sub="time to first" />
      </div>
      <button
        type="button"
        onClick={onBurst}
        disabled={!canBurst}
        title={canBurst ? "Fire 100 concurrent read queries across branches" : "Available once the root database exists"}
        className={clsx(
          "relative inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-xs font-semibold transition-all xl:w-40",
          canBurst
            ? "border-accent/50 bg-gradient-to-br from-accent/25 to-accent-2/15 text-text hover:from-accent/35 hover:to-accent-2/25 glow"
            : "border-border bg-surface-2 text-faint cursor-not-allowed",
        )}
      >
        <Zap className={clsx("size-4", canBurst && "text-warn")} />
        <span className="flex flex-col items-start leading-tight">
          <span>Burst 100 queries</span>
          <span className="text-[10px] font-normal text-muted">{m?.burst ? `last p95 ${fmtMs(m.burst.p95_ms)}` : "concurrency demo"}</span>
        </span>
        {!canBurst && <Timer className="absolute right-2 top-2 size-3 animate-pulse text-faint" />}
      </button>
    </div>
  );
}
