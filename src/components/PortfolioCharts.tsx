"use client";

import { Area, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { useState } from "react";
import { Legend } from "@/components/charts";

// Categorical slots (dataviz dark steps), fixed order; validated on the app surface. Cash is a neutral, not a hue.
const SLOTS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9", "#e66767"];
const CASH = "var(--chart-neutral)";
const PORTFOLIO = "#3987e5";
const BENCH = "#d95926";

const fmtDate = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

type Point = { date: string; portfolio: number; benchmark: number | null };

export function PerformanceChart({ points, benchmarkLabel, currency = "USD", rate = 1 }: { points: Point[]; benchmarkLabel: string; currency?: string; rate?: number }) {
  const locale = currency === "INR" ? "en-IN" : "en-US";
  const full = (usd: number) => (usd * rate).toLocaleString(locale, { style: "currency", currency, maximumFractionDigits: 0 });
  const axis = (usd: number) => new Intl.NumberFormat(locale, { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(usd * rate);
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
      <Legend items={[{ label: "Your portfolio", color: PORTFOLIO }, { label: benchmarkLabel + " (same starting cash)", color: BENCH, dashed: true }]} />
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
            <YAxis domain={["auto", "auto"]} tickFormatter={axis} stroke="var(--chart-axis)" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={52} />
            <Tooltip
              cursor={{ stroke: "var(--chart-axis)", strokeDasharray: "3 3" }}
              content={({ active, payload, label }: TooltipContentProps) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as Point;
                return (
                  <div className="rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs shadow-xl">
                    <div className="mb-1 font-medium text-slate-200">{fmtDate(String(label))}</div>
                    <div className="flex justify-between gap-4"><span className="text-slate-400">Portfolio</span><span className="tabular-nums">{full(p.portfolio)}</span></div>
                    {p.benchmark !== null && <div className="flex justify-between gap-4"><span className="text-slate-400">{benchmarkLabel}</span><span className="tabular-nums">{full(p.benchmark)}</span></div>}
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

const shortName = (n: string) => n.replace(/\.(NS|BO)$/, "");

export function AllocationDonut({ slices, title, currency = "USD", rate = 1 }: { slices: Slice[]; title: string; currency?: string; rate?: number }) {
  const [active, setActive] = useState<number | null>(null);
  if (!slices.length) return <p className="text-sm text-slate-400">Nothing to show yet.</p>;
  let slot = 0;
  const colored = slices.map((s) => ({ ...s, color: s.name === "Cash" ? CASH : SLOTS[slot++ % SLOTS.length] }));
  const largest = colored.reduce((best, s, i) => (s.name !== "Cash" && (best < 0 || s.pct > colored[best].pct) ? i : best), -1);
  const shown = colored[active ?? (largest >= 0 ? largest : 0)];
  const label = shortName(shown.name);
  const fmt = (usd: number) => (usd * rate).toLocaleString(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency, maximumFractionDigits: 0 });

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <div className="relative h-44 w-44 shrink-0" onMouseLeave={() => setActive(null)}>
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={colored}
              dataKey="value"
              nameKey="name"
              innerRadius="66%"
              outerRadius="100%"
              paddingAngle={1.5}
              stroke="var(--chart-gap)"
              strokeWidth={2}
              isAnimationActive={false}
              onMouseEnter={(_, i) => setActive(i)}
            >
              {colored.map((s, i) => (
                <Cell key={s.name} fill={s.color} opacity={active === null || active === i ? 1 : 0.35} style={{ transition: "opacity .15s", cursor: "pointer" }} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        {/* The centre shows the hovered slice (or the largest holding) so nothing overlaps the ring. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-7 text-center">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">{active === null ? title : "Selected"}</span>
          <span className={`max-w-full truncate font-semibold text-slate-100 ${label.length > 9 ? "text-xs" : "text-sm"}`} title={shown.name}>
            {label}
          </span>
          <span className="text-xs tabular-nums text-slate-300">{shown.pct}%</span>
          <span className="text-[10px] tabular-nums text-slate-500">{fmt(shown.value)}</span>
        </div>
      </div>
      <ul className="w-full min-w-0 space-y-1 text-sm">
        {colored.map((s, i) => (
          <li
            key={s.name}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
            className={`flex cursor-default items-center justify-between gap-3 rounded-lg px-2 py-1 transition ${active === i ? "bg-ink/5" : ""}`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
              <span className="truncate text-slate-300" title={s.name}>
                {shortName(s.name)}
              </span>
            </span>
            <span className="tabular-nums text-slate-400">{s.pct}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
