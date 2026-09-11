"use client";
import clsx from "clsx";
import type { QueryResult } from "@/lib/types";
import { fmtCell, fmtMs } from "@/lib/chart";

export function MiniTable({ result, maxRows = 5, maxCols = 6, className, showMeta = true }: {
  result: QueryResult | null | undefined; maxRows?: number; maxCols?: number; className?: string; showMeta?: boolean;
}) {
  if (!result) return null;
  const cols = (result.columns ?? []).slice(0, maxCols);
  const rows = (result.rows ?? []).slice(0, maxRows);
  const hiddenCols = Math.max(0, (result.columns?.length ?? 0) - cols.length);
  const total = result.row_count ?? result.rows?.length ?? 0;
  const more = Math.max(0, total - rows.length);

  if (!cols.length) {
    return <div className={clsx("text-[11px] text-faint italic", className)}>empty result · {fmtMs(result.elapsed_ms)}</div>;
  }
  return (
    <div className={clsx("rounded-lg border border-border bg-bg-elev/60 overflow-hidden", className)}>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-[11px] mono border-collapse">
          <thead>
            <tr className="bg-surface-2/70">
              {cols.map((c) => (
                <th key={c} className="px-2 py-1 text-left font-semibold text-muted whitespace-nowrap border-b border-border">{c}</th>
              ))}
              {hiddenCols > 0 && <th className="px-2 py-1 text-left font-normal text-faint border-b border-border">+{hiddenCols}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="odd:bg-transparent even:bg-white/[0.015] hover:bg-accent/5">
                {cols.map((_, j) => {
                  const v = r[j];
                  const isNum = typeof v === "number";
                  return (
                    <td key={j} className={clsx("px-2 py-1 whitespace-nowrap max-w-[220px] truncate", isNum ? "text-right tabular-nums text-text" : "text-muted", v == null && "text-faint")} title={v == null ? "null" : String(v)}>
                      {fmtCell(v)}
                    </td>
                  );
                })}
                {hiddenCols > 0 && <td className="px-2 py-1 text-faint">…</td>}
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={cols.length + (hiddenCols ? 1 : 0)} className="px-2 py-2 text-faint italic text-center">no rows</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {showMeta && (
        <div className="flex items-center justify-between px-2 py-1 text-[10px] text-faint border-t border-border bg-surface/40">
          <span>{total.toLocaleString()} row{total === 1 ? "" : "s"}{result.truncated ? " (truncated)" : ""}{more > 0 ? ` · showing ${rows.length}` : ""}</span>
          <span className="tabular-nums">{fmtMs(result.elapsed_ms)}</span>
        </div>
      )}
    </div>
  );
}
