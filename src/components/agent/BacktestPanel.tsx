"use client";

import { FlaskConical, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { backtestAgent } from "@/app/(app)/agent/actions";
import { Legend } from "@/components/charts";
import { useCurrency } from "@/components/CurrencyProvider";
import type { BacktestResult } from "@/lib/agent/backtest";

// Categorical slots in fixed order (validated palette): agent, buy & hold, S&P 500, NIFTY.
const C = { agent: "#3987e5", buyHold: "#d95926", sp500: "#199e70", nifty: "#c98500" };
const SERIES = [
  { key: "agent", label: "Auto-trader", color: C.agent },
  { key: "buyHold", label: "Buy & hold (same stocks)", color: C.buyHold, dashed: true },
  { key: "sp500", label: "S&P 500", color: C.sp500, dashed: true },
  { key: "nifty", label: "NIFTY 50", color: C.nifty, dashed: true },
] as const;
const PERIODS = [
  { days: 63, label: "3 months" },
  { days: 126, label: "6 months" },
  { days: 252, label: "12 months" },
];

const fmtDate = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const pctLabel = (n: number | null) => (n === null ? "—" : `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}%`);

export function BacktestPanel() {
  const ccy = useCurrency();
  const [days, setDays] = useState(126);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (d: number) => {
    setDays(d);
    setError(null);
    start(async () => {
      const r = await backtestAgent(d);
      if (r.ok) setResult(r.result);
      else setError(r.message);
    });
  };

  const beat = result ? result.returnPct - (result.benchmarks[0]?.returnPct ?? 0) : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-xl bg-ink/[0.04] p-1">
          {PERIODS.map((p) => (
            <button key={p.days} onClick={() => setDays(p.days)} className={`rounded-lg px-3 py-1.5 text-xs transition ${days === p.days ? "bg-surface-1 text-slate-50 shadow-sm" : "text-slate-400 hover:text-slate-100"}`}>
              {p.label}
            </button>
          ))}
        </div>
        <button onClick={() => run(days)} disabled={pending} className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-sky-500 px-4 py-2 text-sm font-medium text-white shadow-lg transition hover:brightness-110 disabled:opacity-50">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
          {pending ? "Replaying history…" : `Backtest last ${PERIODS.find((p) => p.days === days)?.label}`}
        </button>
        <span className="text-xs text-slate-500">Replays real daily prices through your current settings. Takes a few seconds.</span>
      </div>

      {error && <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">⚠ {error}</p>}

      {result && (
        <div className="animate-fade-up space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            {[
              { label: "Auto-trader return", value: pctLabel(result.returnPct), tone: result.returnPct },
              { label: "vs buy & hold", value: pctLabel(beat), tone: beat },
              ...result.benchmarks.slice(1).map((b) => ({ label: b.label, value: pctLabel(b.returnPct), tone: b.returnPct })),
              { label: "Max drawdown", value: `−${result.maxDrawdownPct.toFixed(2)}%`, tone: null },
              { label: "Win rate", value: result.winRatePct === null ? "—" : `${result.winRatePct}%`, tone: null },
              { label: "Trades", value: String(result.trades), tone: null },
              { label: "Sharpe ratio", value: result.sharpe === null ? "—" : String(result.sharpe), tone: null },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-ink/10 p-3">
                <div className="text-[11px] text-slate-500">{s.label}</div>
                <div className={`mt-1 text-lg font-semibold tabular-nums ${s.tone === null ? "" : s.tone >= 0 ? "text-emerald-400" : "text-red-400"}`}>{s.value}</div>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <Legend items={SERIES.filter((s) => s.key === "agent" || s.key === "buyHold" || result.curve.some((p) => p[s.key] !== null)).map((s) => ({ label: s.label, color: s.color, dashed: "dashed" in s }))} />
            <div className="h-72 w-full">
              <ResponsiveContainer>
                <LineChart data={result.curve} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={fmtDate} stroke="var(--chart-axis)" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={40} />
                  <YAxis domain={["auto", "auto"]} tickFormatter={(v) => ccy.fmt(v, 0)} stroke="var(--chart-axis)" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={72} />
                  <Tooltip
                    cursor={{ stroke: "var(--chart-axis)", strokeDasharray: "3 3" }}
                    content={({ active, payload, label }: TooltipContentProps) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0].payload as Record<string, number | null>;
                      return (
                        <div className="rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs shadow-xl">
                          <div className="mb-1 font-medium text-slate-100">{fmtDate(String(label))}</div>
                          {SERIES.filter((s) => row[s.key] !== null && row[s.key] !== undefined).map((s) => (
                            <div key={s.key} className="flex items-center justify-between gap-4">
                              <span className="flex items-center gap-1.5 text-slate-400">
                                <span className="inline-block h-0.5 w-3 rounded" style={{ background: s.color }} />
                                {s.label}
                              </span>
                              <span className="tabular-nums text-slate-100">{ccy.fmt(row[s.key] as number)}</span>
                            </div>
                          ))}
                        </div>
                      );
                    }}
                  />
                  {SERIES.map((s) => (
                    <Line key={s.key} dataKey={s.key} stroke={s.color} strokeWidth={s.key === "agent" ? 2.5 : 1.5} strokeDasharray={"dashed" in s ? "5 4" : undefined} dot={false} connectNulls isAnimationActive={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-slate-500">
              {fmtDate(result.startDate)} – {fmtDate(result.endDate)} · {result.days} trading days · {result.symbolsUsed} stocks · starting with {ccy.fmt(result.startValue, 0)}. Past results don&apos;t predict future returns; non-USD stocks use today&apos;s exchange rate.
            </p>
          </div>

          <details className="rounded-xl border border-ink/10">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Simulated trades ({result.trades})</summary>
            <div className="max-h-80 overflow-auto border-t border-ink/5">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="sticky top-0 bg-surface-2 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-normal">Date</th>
                    <th className="py-2 font-normal">Side</th>
                    <th className="py-2 font-normal">Stock</th>
                    <th className="py-2 text-right font-normal">Shares</th>
                    <th className="py-2 text-right font-normal">Price</th>
                    <th className="py-2 text-right font-normal">P&amp;L</th>
                    <th className="px-4 py-2 font-normal">Why</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/5">
                  {result.tradeLog.map((t, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2 text-slate-400">{fmtDate(t.date)}</td>
                      <td className="py-2">
                        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${t.side === "BUY" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>{t.side}</span>
                      </td>
                      <td className="py-2 font-medium">{t.symbol}</td>
                      <td className="py-2 text-right tabular-nums">{t.quantity}</td>
                      <td className="py-2 text-right tabular-nums">{ccy.fmt(t.priceUsd)}</td>
                      <td className={`py-2 text-right tabular-nums ${t.pnlUsd === null ? "text-slate-500" : t.pnlUsd >= 0 ? "text-emerald-400" : "text-red-400"}`}>{t.pnlUsd === null ? "—" : ccy.signed(t.pnlUsd)}</td>
                      <td className="px-4 py-2 text-xs text-slate-400">{t.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
