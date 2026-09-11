import * as React from "react";
import { cn } from "@/lib/utils";
import { formatNumber, truncate } from "@/lib/format";
import { Skeleton } from "./Skeleton";

type Align = "left" | "right" | "center";
const alignCls: Record<Align, string> = { left: "text-left", right: "text-right", center: "text-center" };

/* ── primitives ─────────────────────────────────────────────────────── */

export function TableScroll({ className, maxHeight, children, ...props }: React.HTMLAttributes<HTMLDivElement> & { maxHeight?: number | string }) {
  return (
    <div
      className={cn("relative w-full overflow-auto rounded-xl border bg-surface/60 scrollbar-thin", className)}
      style={maxHeight ? { maxHeight } : undefined}
      {...props}
    >
      {children}
    </div>
  );
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full min-w-max border-separate border-spacing-0 text-sm", className)} {...props} />;
}

export function THead({ className, sticky = true, ...props }: React.HTMLAttributes<HTMLTableSectionElement> & { sticky?: boolean }) {
  return <thead className={cn(sticky && "sticky top-0 z-10", "bg-surface-2/95 backdrop-blur", className)} {...props} />;
}

export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("[&_tr:last-child_td]:border-b-0", className)} {...props} />;
}

export function Tr({ className, interactive, ...props }: React.HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean }) {
  return <tr className={cn("group/row transition-colors hover:bg-white/[.025]", interactive && "cursor-pointer", className)} {...props} />;
}

export function Th({ className, align = "left", ...props }: Omit<React.ThHTMLAttributes<HTMLTableCellElement>, "align"> & { align?: Align }) {
  return (
    <th
      scope="col"
      className={cn("whitespace-nowrap border-b border-border-strong px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-faint", alignCls[align], className)}
      {...props}
    />
  );
}

export function Td({ className, align = "left", mono, ...props }: Omit<React.TdHTMLAttributes<HTMLTableCellElement>, "align"> & { align?: Align; mono?: boolean }) {
  return (
    <td
      className={cn("whitespace-nowrap border-b border-border/70 px-3 py-1.5 align-middle text-text/90", alignCls[align], mono && "mono tabular text-[13px]", className)}
      {...props}
    />
  );
}

/* ── data table ─────────────────────────────────────────────────────── */

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  render?: (row: T, index: number) => React.ReactNode;
  align?: Align;
  mono?: boolean;
  width?: number | string;
  className?: string;
  headerClassName?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  loading?: boolean;
  loadingRows?: number;
  emptyMessage?: React.ReactNode;
  maxHeight?: number | string;
  stickyHeader?: boolean;
  onRowClick?: (row: T) => void;
  className?: string;
  caption?: string;
}

export function DataTable<T>({
  columns, rows, rowKey, loading, loadingRows = 5, emptyMessage = "Nothing here yet", maxHeight, stickyHeader = true, onRowClick, className, caption,
}: DataTableProps<T>) {
  return (
    <TableScroll className={className} maxHeight={maxHeight}>
      <Table>
        {caption && <caption className="sr-only">{caption}</caption>}
        <THead sticky={stickyHeader}>
          <tr>
            {columns.map((c) => (
              <Th key={c.key} align={c.align} style={c.width ? { width: c.width } : undefined} className={c.headerClassName}>
                {c.header}
              </Th>
            ))}
          </tr>
        </THead>
        <TBody>
          {loading ? (
            Array.from({ length: loadingRows }).map((_, i) => (
              <tr key={`sk-${i}`}>
                {columns.map((c) => (
                  <Td key={c.key} className={c.className}>
                    <Skeleton className="h-4 w-full min-w-10 max-w-[160px]" />
                  </Td>
                ))}
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-10 text-center text-sm text-faint">{emptyMessage}</td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <Tr key={rowKey(row, i)} interactive={!!onRowClick} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                {columns.map((c) => (
                  <Td key={c.key} align={c.align} mono={c.mono} className={c.className}>
                    {c.render ? c.render(row, i) : String((row as Record<string, unknown>)[c.key] ?? "")}
                  </Td>
                ))}
              </Tr>
            ))
          )}
        </TBody>
      </Table>
    </TableScroll>
  );
}

/* ── query-result table (columns: string[], rows: any[][]) ───────────── */

export interface ResultTableProps {
  columns: string[];
  rows: unknown[][];
  maxRows?: number;
  maxHeight?: number | string;
  className?: string;
  caption?: string;
  emptyMessage?: React.ReactNode;
  /** Total row count if `rows` is already truncated */
  totalRows?: number;
}

function cellText(v: unknown): string {
  if (v == null) return "null";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function formatCell(v: unknown): React.ReactNode {
  if (v == null) return <span className="italic text-faint">null</span>;
  if (typeof v === "number") return Number.isInteger(v) ? formatNumber(v) : formatNumber(v, { digits: 3 });
  if (typeof v === "boolean") return v ? "true" : "false";
  return truncate(cellText(v), 80);
}

export function ResultTable({ columns, rows, maxRows = 50, maxHeight = 360, className, caption, emptyMessage = "No rows returned", totalRows }: ResultTableProps) {
  const shown = rows.slice(0, maxRows);
  const numeric = columns.map((_, ci) =>
    shown.some((r) => typeof r[ci] === "number") && shown.every((r) => r[ci] == null || typeof r[ci] === "number"),
  );
  const total = totalRows ?? rows.length;
  return (
    <TableScroll className={className} maxHeight={maxHeight}>
      <Table>
        {caption && <caption className="sr-only">{caption}</caption>}
        <THead>
          <tr>
            {columns.map((c, i) => (
              <Th key={`${c}-${i}`} align={numeric[i] ? "right" : "left"} className="mono normal-case tracking-normal">
                {c}
              </Th>
            ))}
          </tr>
        </THead>
        <TBody>
          {shown.length === 0 ? (
            <tr>
              <td colSpan={Math.max(1, columns.length)} className="px-3 py-8 text-center text-sm text-faint">{emptyMessage}</td>
            </tr>
          ) : (
            shown.map((r, ri) => (
              <Tr key={ri}>
                {columns.map((_, ci) => (
                  <Td key={ci} align={numeric[ci] ? "right" : "left"} mono={numeric[ci]} className="max-w-[360px] truncate" title={cellText(r[ci])}>
                    {formatCell(r[ci])}
                  </Td>
                ))}
              </Tr>
            ))
          )}
        </TBody>
      </Table>
      {total > shown.length && (
        <div className="sticky bottom-0 border-t bg-surface-2/95 px-3 py-1.5 text-[11px] text-faint backdrop-blur">
          Showing {formatNumber(shown.length)} of {formatNumber(total)} rows
        </div>
      )}
    </TableScroll>
  );
}
