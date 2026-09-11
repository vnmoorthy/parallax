// Formatting helpers shared across pages and components.

/** 842 → "842 ms", 1234 → "1.2 s", 72_000 → "1m 12s". */
export function formatMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

const nf = new Map<string, Intl.NumberFormat>();
function numberFormatter(compact: boolean, digits: number): Intl.NumberFormat {
  const key = `${compact}:${digits}`;
  let f = nf.get(key);
  if (!f) {
    f = new Intl.NumberFormat("en-US", compact
      ? { notation: "compact", maximumFractionDigits: digits }
      : { maximumFractionDigits: digits });
    nf.set(key, f);
  }
  return f;
}

/** 6000 → "6,000"; { compact: true } → "6K". */
export function formatNumber(
  n: number | null | undefined,
  opts: { compact?: boolean; digits?: number } = {},
): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const digits = opts.digits ?? (opts.compact ? 1 : Number.isInteger(n) ? 0 : 2);
  return numberFormatter(!!opts.compact, digits).format(n);
}

/** 0.83 → "83%". */
export function formatPct(x: number | null | undefined, digits = 0): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}

/** ISO → "Sep 11, 1:45 PM". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(t);
}

/** ISO → "just now" / "3m ago" / "2h ago" / "3d ago" / date. */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diff = Math.max(0, now - t);
  const s = Math.round(diff / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return formatDate(iso);
}

/** Truncate with an ellipsis; never longer than n characters. */
export function truncate(s: string | null | undefined, n: number): string {
  if (!s) return "";
  if (s.length <= n) return s;
  return `${s.slice(0, Math.max(0, n - 1)).trimEnd()}…`;
}

/** 25_000_000 → "23.8 MB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function pluralize(n: number, word: string, plural = `${word}s`): string {
  return `${formatNumber(n)} ${n === 1 ? word : plural}`;
}
