"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, ChevronDown, CornerDownLeft, Loader2, Play, Search, SquareTerminal, TextSearch, Waypoints } from "lucide-react";
import { toast } from "sonner";
import type { Approach, QueryResult, Run } from "@/lib/types";
import { api } from "@/lib/api";
import { shortId } from "@/lib/layout";
import { fmtCell, fmtMs } from "@/lib/chart";
import { ApproachBadge } from "./ApproachBadge";

export const ROOT_BRANCH = "root";

function ResultTable({ result }: { result: QueryResult }) {
  const cols = result.columns ?? [];
  const rows = result.rows ?? [];
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-center justify-between bg-surface-2/70 px-3 py-1.5 text-[11px]">
        <span className="text-muted"><span className="text-text font-medium">{(result.row_count ?? rows.length).toLocaleString()}</span> rows · {cols.length} cols{result.truncated ? " · truncated" : ""}</span>
        <span className="mono tabular-nums text-success">{fmtMs(result.elapsed_ms)}</span>
      </div>
      <div className="max-h-[360px] overflow-auto scrollbar-thin">
        <table className="w-full border-collapse text-[11px] mono">
          <thead>
            <tr className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur">
              <th className="px-2 py-1 text-left font-normal text-faint">#</th>
              {cols.map((c) => <th key={c} className="px-2 py-1 text-left font-semibold text-muted whitespace-nowrap">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-border/50 hover:bg-accent/5">
                <td className="px-2 py-1 text-faint">{i + 1}</td>
                {cols.map((_, j) => { const v = r[j]; return <td key={j} className={clsx("max-w-[280px] truncate px-2 py-1 whitespace-nowrap", typeof v === "number" ? "text-right tabular-nums text-text" : "text-muted", v == null && "text-faint")} title={v == null ? "null" : String(v)}>{fmtCell(v, 80)}</td>; })}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={cols.length + 1} className="px-2 py-4 text-center text-faint italic">no rows</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SqlConsole({ run, branchId, onBranchChange, className }: { run: Run; branchId: string; onBranchChange: (id: string) => void; className?: string }) {
  const [mode, setMode] = useState<"sql" | "search">("sql");
  const table = run.modes?.data === "hotdata" ? "default.public.data" : "data";
  const [sql, setSql] = useState(`SELECT * FROM ${table} LIMIT 20`);
  const [kind, setKind] = useState<"bm25" | "vector">("bm25");
  const [q, setQ] = useState("");
  const [k, setK] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [history, setHistory] = useState<{ label: string; ms: number; ok: boolean }[]>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const options = useMemo<{ id: string; label: string; sub: string; disabled: boolean; approach?: Approach }[]>(() => [
    { id: ROOT_BRANCH, label: `root · ${run.dataset_name}`, sub: run.root_db?.id ? shortId(run.root_db.id) : "provisioning…", disabled: !run.root_db },
    ...run.branches.map((b) => {
      const h = run.plan.find((x) => x.id === b.hypothesis_id);
      return { id: b.id, label: h?.title || `Branch ${shortId(b.id, 6)}`, sub: b.db?.id ? shortId(b.db.id) : "forking…", disabled: !b.db, approach: h?.approach };
    }),
  ], [run]);
  const current = options.find((o) => o.id === branchId) ?? options[0];
  const branchReady = !!current && !current.disabled;

  // infer columns from any observed result for smarter examples
  const sampleCols = useMemo<string[]>(() => {
    let cols: string[] = [];
    for (const b of run.branches) {
      for (const s of b.steps) {
        if (s.result?.columns?.length) { cols = s.result.columns.filter((c) => !c.startsWith("__")); break; }
      }
      if (cols.length) break;
    }
    return cols;
  }, [run]);

  const examples = useMemo(() => {
    const ex: { label: string; sql: string }[] = [
      { label: "Peek at rows", sql: `SELECT * FROM ${table} LIMIT 20` },
      { label: "Row count", sql: `SELECT COUNT(*) AS rows FROM ${table}` },
    ];
    if (sampleCols[0]) ex.push({ label: `Top values of ${sampleCols[0]}`, sql: `SELECT ${sampleCols[0]}, COUNT(*) AS n\nFROM ${table}\nGROUP BY 1\nORDER BY 2 DESC\nLIMIT 10` });
    if (sampleCols[1]) ex.push({ label: `Distinct ${sampleCols[1]}`, sql: `SELECT COUNT(DISTINCT ${sampleCols[1]}) AS distinct_${sampleCols[1]} FROM ${table}` });
    ex.push({ label: "Branch findings table", sql: `SELECT * FROM ${table.replace(/data$/, "findings")} LIMIT 20` });
    ex.push({ label: "Tables in this database", sql: run.modes?.data === "hotdata" ? "SELECT table_schema, table_name FROM information_schema.tables ORDER BY 1, 2" : "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY 1" });
    return ex;
  }, [table, sampleCols, run.modes?.data]);

  const runSql = async () => {
    if (busy || !sql.trim()) return;
    if (!branchReady) { toast.error("That database is still being created"); return; }
    setBusy(true); setError(null);
    const t0 = performance.now();
    try {
      const r = await api.query(run.id, branchId, sql.trim());
      setResult(r);
      setHistory((h) => [{ label: sql.trim().split("\n")[0].slice(0, 60), ms: r.elapsed_ms ?? performance.now() - t0, ok: true }, ...h].slice(0, 8));
    } catch (e) {
      const msg = (e as Error).message; setError(msg); setResult(null); toast.error(msg);
      setHistory((h) => [{ label: sql.trim().split("\n")[0].slice(0, 60), ms: performance.now() - t0, ok: false }, ...h].slice(0, 8));
    } finally { setBusy(false); }
  };
  const runSearch = async () => {
    if (busy || !q.trim()) return;
    if (!branchReady) { toast.error("That database is still being created"); return; }
    setBusy(true); setError(null);
    try {
      const r = await api.search(run.id, branchId, kind, q.trim(), k);
      setResult(r);
      setHistory((h) => [{ label: `${kind}: ${q.trim().slice(0, 50)}`, ms: r.elapsed_ms ?? 0, ok: true }, ...h].slice(0, 8));
    } catch (e) {
      const msg = (e as Error).message; setError(msg); setResult(null); toast.error(msg);
    } finally { setBusy(false); }
  };

  useEffect(() => { if (mode === "sql") taRef.current?.focus(); }, [mode, branchId]);

  return (
    <div className={clsx("space-y-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-text"><SquareTerminal className="size-4 text-accent" /> Console</div>
        <div className="ml-auto flex rounded-lg border border-border bg-surface-2 p-0.5 text-[11px]">
          <button type="button" onClick={() => setMode("sql")} className={clsx("rounded-md px-2.5 py-1 font-medium transition-colors", mode === "sql" ? "bg-accent/25 text-text" : "text-muted hover:text-text")}>SQL</button>
          <button type="button" onClick={() => setMode("search")} className={clsx("rounded-md px-2.5 py-1 font-medium transition-colors", mode === "search" ? "bg-accent/25 text-text" : "text-muted hover:text-text")}>Search</button>
        </div>
      </div>

      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-faint">Database</span>
        <div className="relative">
          <select
            value={current?.id ?? ROOT_BRANCH} onChange={(e) => onBranchChange(e.target.value)}
            className="w-full appearance-none rounded-lg border border-border-strong bg-surface-2 py-2 pl-3 pr-8 text-[12px] text-text outline-none focus:border-accent"
          >
            {options.map((o) => <option key={o.id} value={o.id} disabled={o.disabled}>{o.id === ROOT_BRANCH ? "" : `[${shortId(o.id, 6)}] `}{o.label} — {o.sub}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
        </div>
        {current?.approach && <div className="mt-1 flex items-center gap-1.5 text-[10px] text-faint">agent approach <ApproachBadge approach={current.approach} size="xs" /></div>}
      </label>

      {mode === "sql" ? (
        <div className="space-y-2">
          <div className="relative">
            <textarea
              ref={taRef} value={sql} onChange={(e) => setSql(e.target.value)} spellCheck={false} rows={5}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void runSql(); } }}
              className="mono w-full resize-y rounded-xl border border-border-strong bg-bg-elev/70 px-3 py-2.5 text-[12px] leading-relaxed text-text outline-none placeholder:text-faint focus:border-accent"
              placeholder={`SELECT * FROM ${table} LIMIT 20`}
            />
            <span className="pointer-events-none absolute bottom-2 right-3 hidden items-center gap-1 text-[10px] text-faint sm:flex"><kbd className="rounded border border-border px-1">⌘</kbd><CornerDownLeft className="size-3" /> run</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void runSql()} disabled={busy || !branchReady || !sql.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-accent to-accent-2 px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg shadow-accent/25 hover:brightness-110 disabled:opacity-50 disabled:shadow-none">
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} Run
            </button>
            <div className="relative">
              <select onChange={(e) => { const ex = examples[Number(e.target.value)]; if (ex) setSql(ex.sql); e.target.value = ""; }} defaultValue="" className="appearance-none rounded-lg border border-border bg-surface-2 py-1.5 pl-2.5 pr-7 text-[11px] text-muted outline-none hover:text-text focus:border-accent">
                <option value="" disabled>Examples…</option>
                {examples.map((ex, i) => <option key={ex.label} value={i}>{ex.label}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-faint" />
            </div>
            <span className="ml-auto mono text-[10px] text-faint">table <span className="text-muted">{table}</span> · read-only</span>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex rounded-lg border border-border bg-surface-2 p-0.5 text-[11px]">
            {(["bm25", "vector"] as const).map((kk) => (
              <label key={kk} className={clsx("flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1.5 font-medium transition-colors", kind === kk ? (kk === "bm25" ? "bg-warn/20 text-warn" : "bg-accent-2/20 text-accent-2") : "text-muted hover:text-text")}>
                <input type="radio" name="search-kind" className="sr-only" checked={kind === kk} onChange={() => setKind(kk)} />
                {kk === "bm25" ? <TextSearch className="size-3.5" /> : <Waypoints className="size-3.5" />}
                {kk === "bm25" ? "BM25 keyword" : "Vector semantic"}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <label className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
              <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void runSearch(); }} placeholder={kind === "bm25" ? "keywords, e.g. cancelled because pricing" : "natural language, e.g. unhappy about support response time"} className="w-full rounded-lg border border-border-strong bg-bg-elev/70 py-2 pl-8 pr-3 text-[12px] text-text outline-none placeholder:text-faint focus:border-accent" />
            </label>
            <input type="number" min={1} max={50} value={k} onChange={(e) => setK(Math.max(1, Math.min(50, Number(e.target.value) || 10)))} className="mono w-16 rounded-lg border border-border-strong bg-bg-elev/70 px-2 text-[12px] text-text outline-none focus:border-accent" title="k results" aria-label="k results" />
            <button type="button" onClick={() => void runSearch()} disabled={busy || !branchReady || !q.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-accent to-accent-2 px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg shadow-accent/25 hover:brightness-110 disabled:opacity-50 disabled:shadow-none">
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />} Search
            </button>
          </div>
          <p className="text-[10px] text-faint">{kind === "bm25" ? "Ranked by BM25 score over the text column index." : "Ranked by cosine distance over embeddings (data_vec)."} Indexes are created lazily on first use per branch.</p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /><pre className="mono whitespace-pre-wrap break-words">{error}</pre>
        </div>
      )}
      {busy && !result && <div className="space-y-2"><div className="skeleton h-7" /><div className="skeleton h-24" /></div>}
      {result && <div className={clsx(busy && "opacity-50")}><ResultTable result={result} /></div>}
      {!result && !busy && !error && (
        <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[11px] text-muted">
          {branchReady ? `Query any branch's isolated database directly. Results are read-only and capped at 200 rows.` : "Waiting for the selected database to be created…"}
        </div>
      )}
      {history.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-faint">
          <span>recent:</span>
          {history.map((h, i) => <span key={i} className={clsx("mono rounded border px-1.5 py-[1px]", h.ok ? "border-border text-muted" : "border-danger/40 text-danger")} title={h.label}>{h.label.length > 24 ? h.label.slice(0, 23) + "…" : h.label} · {fmtMs(h.ms)}</span>)}
        </div>
      )}
    </div>
  );
}
