// Chart normalization for recharts + number formatting helpers shared by mission-control tiles.
import type { ChartSpec } from "./types";

export const PALETTE = ["#6366f1", "#22d3ee", "#34d399", "#fbbf24", "#f87171", "#60a5fa"];

export type ChartRow = Record<string, string | number | null>;
export interface NormalizedChart {
  type: ChartSpec["type"];
  title: string;
  xKey: string;
  yKey: string;
  data: ChartRow[];
  /** single value for `number` charts */
  value: number | null;
}

const MAX_POINTS: Record<ChartSpec["type"], number> = { bar: 24, line: 60, pie: 8, number: 1 };

export function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const cleaned = v.replace(/[,$%\s]/g, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Normalizes a loose ChartSpec (LLM-produced) into something recharts can render safely. */
export function normalizeChart(spec: ChartSpec | null | undefined): NormalizedChart | null {
  if (!spec) return null;
  const type: ChartSpec["type"] = (["bar", "line", "pie", "number"] as const).includes(spec.type) ? spec.type : "bar";
  const rawData = Array.isArray(spec.data) ? spec.data.filter((r) => r && typeof r === "object") : [];
  const keys = Array.from(new Set(rawData.flatMap((r) => Object.keys(r))));

  // infer keys: prefer spec.x / spec.y when present in data; else first string-ish key / first numeric key
  const numericKeys = keys.filter((k) => rawData.some((r) => toNumber(r[k]) !== null && typeof r[k] !== "boolean"));
  const stringKeys = keys.filter((k) => rawData.some((r) => typeof r[k] === "string" && toNumber(r[k]) === null));
  let xKey = spec.x && keys.includes(spec.x) ? spec.x : stringKeys[0] ?? keys.find((k) => k !== numericKeys[0]) ?? keys[0] ?? "x";
  let yKey = spec.y && keys.includes(spec.y) ? spec.y : numericKeys.find((k) => k !== xKey) ?? numericKeys[0] ?? keys.find((k) => k !== xKey) ?? "y";
  if (xKey === yKey && keys.length > 1) yKey = keys.find((k) => k !== xKey) ?? yKey;
  if (!keys.length) { xKey = spec.x ?? "x"; yKey = spec.y ?? "y"; }

  let data: ChartRow[] = rawData.map((r, i) => {
    const xv = r[xKey];
    const yv = toNumber(r[yKey]);
    const out: ChartRow = { ...r };
    out[xKey] = xv === null || xv === undefined ? `#${i + 1}` : typeof xv === "number" ? xv : String(xv);
    out[yKey] = yv;
    return out;
  }).filter((r) => r[yKey] !== null || type === "number");

  const max = MAX_POINTS[type];
  if (data.length > max) {
    if (type === "pie") {
      const sorted = [...data].sort((a, b) => (Number(b[yKey]) || 0) - (Number(a[yKey]) || 0));
      const head = sorted.slice(0, max - 1);
      const rest = sorted.slice(max - 1).reduce((acc, r) => acc + (Number(r[yKey]) || 0), 0);
      data = [...head, { [xKey]: "Other", [yKey]: rest }];
    } else {
      data = data.slice(0, max);
    }
  }

  let value: number | null = null;
  if (type === "number") {
    const first = rawData[0];
    if (first) {
      value = toNumber(first[yKey]);
      if (value === null) for (const k of keys) { const n = toNumber(first[k]); if (n !== null) { value = n; break; } }
    }
  }

  return { type, title: spec.title || "", xKey, yKey, data, value };
}

/** Buckets a list of latencies into `bins` equal-width histogram buckets. */
export function histogram(values: number[], bins = 12): { bin: string; from: number; to: number; count: number }[] {
  const v = values.filter((x) => Number.isFinite(x));
  if (!v.length) return [];
  const min = Math.min(...v);
  const max = Math.max(...v);
  const width = max === min ? 1 : (max - min) / bins;
  const out = Array.from({ length: bins }, (_, i) => ({
    from: min + i * width, to: min + (i + 1) * width, count: 0,
    bin: "",
  }));
  for (const x of v) {
    let i = Math.floor((x - min) / width);
    if (i >= bins) i = bins - 1;
    if (i < 0) i = 0;
    out[i].count++;
  }
  return out.map((b) => ({ ...b, bin: `${fmtMs(b.from, true)}–${fmtMs(b.to, true)}` }));
}

// ── formatting ─────────────────────────────────────────────────────────
/** Parses an ISO timestamp; timezone-less stamps (e.g. Python `datetime.utcnow().isoformat()`) are treated as UTC. */
export function parseTs(ts: string | null | undefined): number {
  if (!ts) return NaN;
  const hasTz = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(ts);
  const t = Date.parse(hasTz ? ts : `${ts}Z`);
  return Number.isNaN(t) ? Date.parse(ts) : t;
}

const compact = typeof Intl !== "undefined" ? new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }) : null;
const plain = typeof Intl !== "undefined" ? new Intl.NumberFormat("en", { maximumFractionDigits: 2 }) : null;

export function fmtNum(n: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (opts.compact && Math.abs(n) >= 10000) return compact ? compact.format(n) : String(Math.round(n));
  return plain ? plain.format(n) : String(n);
}

/** 842 → "842 ms"; 12_400 → "12.4 s"; 90_000 → "1:30 m". `bare` omits the unit for ms values. */
export function fmtMs(ms: number | null | undefined, bare = false): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return bare ? `${Math.round(ms)}` : `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}:${String(s).padStart(2, "0")} m`;
}

export function fmtPct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const p = v <= 1 ? v * 100 : v;
  return `${p.toFixed(digits)}%`;
}

/** Formats a cell value for tables: numbers compact-ish, nulls as ∅, long strings truncated. */
export function fmtCell(v: unknown, maxLen = 48): string {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(Math.abs(v) < 1 ? 4 : 2);
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > maxLen ? s.slice(0, maxLen - 1) + "…" : s;
}
