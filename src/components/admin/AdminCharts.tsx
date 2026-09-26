"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { Legend } from "@/components/charts";

// Categorical slots in fixed order (validated palette).
const SLOTS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"];
const fmtDate = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

type Series = { key: string; label: string }[];

export function StackedBars({ data, series, money = false, height = 240 }: { data: Record<string, number | string>[]; series: Series; money?: boolean; height?: number }) {
  const fmt = (v: number) => (money ? `$${v.toLocaleString("en-US")}` : v.toLocaleString("en-US"));
  const empty = data.every((d) => series.every((s) => !d[s.key]));
  return (
    <div className="space-y-3">
      <Legend items={series.map((s, i) => ({ label: s.label, color: SLOTS[i % SLOTS.length], square: true }))} />
      <div className="relative w-full" style={{ height }}>
        {empty && <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-slate-500">No activity in this period yet.</div>}
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmtDate} stroke="var(--chart-axis)" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis allowDecimals={false} tickFormatter={(v) => (money ? `$${Math.round(v / 1000)}k` : String(v))} stroke="var(--chart-axis)" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={money ? 44 : 28} />
            <Tooltip
              cursor={{ fill: "var(--chart-grid)", opacity: 0.4 }}
              content={({ active, payload, label }: TooltipContentProps) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as Record<string, number>;
                return (
                  <div className="rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs shadow-xl">
                    <div className="mb-1 font-medium text-slate-100">{fmtDate(String(label))}</div>
                    {series.map((s, i) => (
                      <div key={s.key} className="flex items-center justify-between gap-4">
                        <span className="flex items-center gap-1.5 text-slate-400">
                          <span className="h-2 w-2 rounded-sm" style={{ background: SLOTS[i % SLOTS.length] }} />
                          {s.label}
                        </span>
                        <span className="tabular-nums text-slate-100">{fmt(row[s.key] ?? 0)}</span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            {series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} stackId="a" fill={SLOTS[i % SLOTS.length]} stroke="var(--chart-gap)" strokeWidth={1} radius={i === series.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
