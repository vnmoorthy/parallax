"use client";
import clsx from "clsx";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ChartSpec } from "@/lib/types";
import { PALETTE, fmtNum, normalizeChart } from "@/lib/chart";

const tooltipStyle = {
  contentStyle: { background: "#141a2c", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, fontSize: 11, padding: "6px 10px", color: "#e6e9f2" },
  labelStyle: { color: "#9aa3b8", marginBottom: 2 },
  itemStyle: { color: "#e6e9f2", padding: 0 },
  cursor: { fill: "rgba(99,102,241,0.08)" },
};

const axisTick = { fill: "#667089", fontSize: 10 };
const shorten = (v: unknown) => { const s = String(v ?? ""); return s.length > 12 ? s.slice(0, 11) + "…" : s; };

export function MiniChart({ spec, height = 150, className, showTitle = true }: { spec: ChartSpec | null | undefined; height?: number; className?: string; showTitle?: boolean }) {
  const c = normalizeChart(spec);
  if (!c) return null;
  const empty = c.type !== "number" && c.data.length === 0;

  return (
    <div className={clsx("rounded-lg border border-border bg-bg-elev/50 p-2", className)}>
      {showTitle && c.title && <div className="mb-1 px-1 text-[11px] font-medium text-muted truncate" title={c.title}>{c.title}</div>}
      {empty ? (
        <div className="grid place-items-center text-[11px] text-faint italic" style={{ height: height * 0.6 }}>no chart data</div>
      ) : c.type === "number" ? (
        <div className="flex items-baseline gap-2 px-1 py-2">
          <span className="gradient-text text-3xl font-semibold tabular-nums tracking-tight">{fmtNum(c.value, { compact: true })}</span>
          {c.yKey && c.yKey !== "y" && <span className="text-[11px] text-faint">{c.yKey}</span>}
        </div>
      ) : (
        <div style={{ height, width: "100%" }}>
          <ResponsiveContainer width="100%" height="100%">
            {c.type === "line" ? (
              <LineChart data={c.data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey={c.xKey} tick={axisTick} tickLine={false} axisLine={false} tickFormatter={shorten} interval="preserveStartEnd" />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v: number) => fmtNum(v, { compact: true })} width={48} />
                <Tooltip {...tooltipStyle} />
                <Line type="monotone" dataKey={c.yKey} stroke={PALETTE[1]} strokeWidth={2} dot={c.data.length <= 20} activeDot={{ r: 4 }} isAnimationActive />
              </LineChart>
            ) : c.type === "pie" ? (
              <PieChart margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
                <Tooltip {...tooltipStyle} />
                <Pie data={c.data} dataKey={c.yKey} nameKey={c.xKey} innerRadius="45%" outerRadius="85%" paddingAngle={2} stroke="rgba(0,0,0,0.3)" strokeWidth={1}>
                  {c.data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                </Pie>
              </PieChart>
            ) : (
              <BarChart data={c.data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey={c.xKey} tick={axisTick} tickLine={false} axisLine={false} tickFormatter={shorten} interval={c.data.length > 8 ? "preserveStartEnd" : 0} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v: number) => fmtNum(v, { compact: true })} width={48} />
                <Tooltip {...tooltipStyle} />
                <Bar dataKey={c.yKey} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive>
                  {c.data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.9} />)}
                </Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
      {c.type === "pie" && c.data.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 px-1">
          {c.data.map((d, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-[10px] text-muted">
              <span className="size-2 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
              <span className="truncate max-w-[110px]">{String(d[c.xKey])}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
