"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

// Categorical slots validated for the dark surface (dataviz palette, dark steps).
export const SERIES = { price: "#3987e5", sma50: "#d95926", sma200: "#9085e9" };
const GRID = "#1e293b";
const AXIS = "#64748b";

const fmtDate = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fmtMonth = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
const fmtPrice = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;

function TooltipBox({ label, rows }: { label: string; rows: { name: string; value: string; color?: string }[] }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-medium text-slate-200">{label}</div>
      {rows.map((r) => (
        <div key={r.name} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-slate-400">
            {r.color && <span className="inline-block h-0.5 w-3 rounded" style={{ background: r.color }} />}
            {r.name}
          </span>
          <span className="tabular-nums text-slate-100">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean; band?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-slate-400">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          {i.band ? (
            <span className="inline-block h-3 w-4 rounded-sm" style={{ background: i.color, opacity: 0.25 }} />
          ) : (
            <span
              className="inline-block w-4"
              style={{ borderTop: `2px ${i.dashed ? "dashed" : "solid"} ${i.color}` }}
            />
          )}
          {i.label}
        </span>
      ))}
    </div>
  );
}

type PricePoint = { date: string; close: number; sma50: number | null; sma200: number | null };

export function PriceChart({ data }: { data: PricePoint[] }) {
  return (
    <div className="space-y-3">
      <Legend
        items={[
          { label: "Price", color: SERIES.price },
          { label: "50-day avg", color: SERIES.sma50 },
          { label: "200-day avg", color: SERIES.sma200 },
        ]}
      />
      <div className="h-72 w-full">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmtMonth} stroke={AXIS} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={40} />
            <YAxis domain={["auto", "auto"]} tickFormatter={(v) => `$${v}`} stroke={AXIS} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={56} />
            <Tooltip
              cursor={{ stroke: AXIS, strokeDasharray: "3 3" }}
              content={({ active, payload, label }: TooltipContentProps) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as PricePoint;
                return (
                  <TooltipBox
                    label={fmtDate(String(label))}
                    rows={[
                      { name: "Price", value: fmtPrice(p.close), color: SERIES.price },
                      ...(p.sma50 !== null ? [{ name: "50-day avg", value: fmtPrice(p.sma50), color: SERIES.sma50 }] : []),
                      ...(p.sma200 !== null ? [{ name: "200-day avg", value: fmtPrice(p.sma200), color: SERIES.sma200 }] : []),
                    ]}
                  />
                );
              }}
            />
            <Line dataKey="sma200" stroke={SERIES.sma200} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
            <Line dataKey="sma50" stroke={SERIES.sma50} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
            <Line dataKey="close" stroke={SERIES.price} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "#0f172a", strokeWidth: 2 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

type ForecastRow = { date: string; close?: number; expected?: number; band?: [number, number] };

export function ForecastChart({
  history,
  forecast,
  compactHeight = false,
}: {
  history: { date: string; close: number }[];
  forecast: { date: string; expected: number; low: number; high: number }[];
  compactHeight?: boolean;
}) {
  const last = history[history.length - 1];
  const rows: ForecastRow[] = [
    ...history.map((h) => ({ date: h.date, close: h.close })),
    ...forecast.map((f) => ({ date: f.date, expected: f.expected, band: [f.low, f.high] as [number, number] })),
  ];
  // Start the forecast at the last actual point so the lines connect.
  if (last) {
    const idx = rows.findIndex((r) => r.date === last.date);
    rows[idx] = { ...rows[idx], expected: last.close, band: [last.close, last.close] };
  }

  return (
    <div className="space-y-3">
      <Legend
        items={[
          { label: "Actual price", color: SERIES.price },
          { label: "Forecast (trend)", color: SERIES.price, dashed: true },
          { label: "90% range", color: SERIES.price, band: true },
        ]}
      />
      <div className={compactHeight ? "h-56 w-full" : "h-72 w-full"}>
        <ResponsiveContainer>
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmtDate} stroke={AXIS} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={40} />
            <YAxis domain={["auto", "auto"]} tickFormatter={(v) => `$${Math.round(v)}`} stroke={AXIS} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={56} />
            <Tooltip
              cursor={{ stroke: AXIS, strokeDasharray: "3 3" }}
              content={({ active, payload, label }: TooltipContentProps) => {
                if (!active || !payload?.length) return null;
                const r = payload[0].payload as ForecastRow;
                const out: { name: string; value: string; color?: string }[] = [];
                if (r.close !== undefined) out.push({ name: "Actual", value: fmtPrice(r.close), color: SERIES.price });
                if (r.expected !== undefined && r.close === undefined) out.push({ name: "Forecast", value: fmtPrice(r.expected), color: SERIES.price });
                if (r.band && r.close === undefined) out.push({ name: "90% range", value: `${fmtPrice(r.band[0])} – ${fmtPrice(r.band[1])}` });
                return <TooltipBox label={fmtDate(String(label))} rows={out} />;
              }}
            />
            <Area dataKey="band" stroke="none" fill={SERIES.price} fillOpacity={0.18} isAnimationActive={false} connectNulls={false} />
            <Line dataKey="close" stroke={SERIES.price} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line dataKey="expected" stroke={SERIES.price} strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
