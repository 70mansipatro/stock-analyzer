"use client";

import { Area, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { Legend } from "@/components/charts";

// Categorical slots (dataviz dark steps), fixed order; validated on the app surface. Cash is a neutral, not a hue.
const SLOTS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9", "#e66767"];
const CASH = "var(--chart-neutral)";
const PORTFOLIO = "#3987e5";
const BENCH = "#d95926";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtDate = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

type Point = { date: string; portfolio: number; benchmark: number | null };

export function PerformanceChart({ points, benchmarkLabel }: { points: Point[]; benchmarkLabel: string }) {
  if (points.length < 2) {
    return (
      <div className="flex h-56 flex-col items-center justify-center rounded-lg border border-dashed border-slate-800 text-center text-sm text-slate-400">
        <svg viewBox="0 0 120 40" className="mb-3 h-10 w-28 text-slate-700" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M2 34 L30 26 L52 30 L78 14 L100 18 L118 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Your performance line appears after your first trade.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <Legend items={[{ label: "Your portfolio", color: PORTFOLIO }, { label: benchmarkLabel + " (same $100k start)", color: BENCH, dashed: true }]} />
      <div className="h-64 w-full">
        <ResponsiveContainer>
          <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="pf-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={PORTFOLIO} stopOpacity={0.35} />
                <stop offset="100%" stopColor={PORTFOLIO} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmtDate} stroke="var(--chart-axis)" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={40} />
            <YAxis domain={["auto", "auto"]} tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`} stroke="var(--chart-axis)" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={52} />
            <Tooltip
              cursor={{ stroke: "var(--chart-axis)", strokeDasharray: "3 3" }}
              content={({ active, payload, label }: TooltipContentProps) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as Point;
                return (
                  <div className="rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs shadow-xl">
                    <div className="mb-1 font-medium text-slate-200">{fmtDate(String(label))}</div>
                    <div className="flex justify-between gap-4"><span className="text-slate-400">Portfolio</span><span className="tabular-nums">{money(p.portfolio)}</span></div>
                    {p.benchmark !== null && <div className="flex justify-between gap-4"><span className="text-slate-400">{benchmarkLabel}</span><span className="tabular-nums">{money(p.benchmark)}</span></div>}
                  </div>
                );
              }}
            />
            <Area dataKey="portfolio" stroke={PORTFOLIO} strokeWidth={2} fill="url(#pf-fill)" isAnimationActive={false} />
            <Line dataKey="benchmark" stroke={BENCH} strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

type Slice = { name: string; value: number; pct: number };

export function AllocationDonut({ slices, title }: { slices: Slice[]; title: string }) {
  if (!slices.length) return <p className="text-sm text-slate-400">Nothing to show yet.</p>;
  let slot = 0;
  const colored = slices.map((s) => ({ ...s, color: s.name === "Cash" ? CASH : SLOTS[slot++ % SLOTS.length] }));
  const top = [...colored].filter((s) => s.name !== "Cash").sort((a, b) => b.pct - a.pct)[0];

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative h-40 w-40 shrink-0">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={colored} dataKey="value" nameKey="name" innerRadius="64%" outerRadius="100%" paddingAngle={1.5} stroke="var(--chart-gap)" strokeWidth={2} isAnimationActive={false}>
              {colored.map((s) => (
                <Cell key={s.name} fill={s.color} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }: TooltipContentProps) => {
                if (!active || !payload?.length) return null;
                const s = payload[0].payload as Slice;
                return (
                  <div className="rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs shadow-xl">
                    <div className="font-medium text-slate-100">{s.name}</div>
                    <div className="tabular-nums text-slate-300">{money(s.value)} · {s.pct}%</div>
                  </div>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">{title}</span>
          {top && <span className="max-w-24 truncate text-sm font-semibold text-slate-100">{top.name}</span>}
          {top && <span className="text-xs tabular-nums text-slate-400">{top.pct}%</span>}
        </div>
      </div>
      <ul className="w-full space-y-1.5 text-sm">
        {colored.map((s) => (
          <li key={s.name} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
              <span className="truncate text-slate-300">{s.name}</span>
            </span>
            <span className="tabular-nums text-slate-400">{s.pct}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
