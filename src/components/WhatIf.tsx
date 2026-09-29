"use client";

import { RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { useCurrency } from "@/components/CurrencyProvider";

type Holding = { symbol: string; name: string; value: number; cost: number };

const PRESETS = [
  { label: "Crash", move: -30, emoji: "💥" },
  { label: "Correction", move: -10, emoji: "📉" },
  { label: "Flat", move: 0, emoji: "➖" },
  { label: "Rally", move: 10, emoji: "📈" },
  { label: "Boom", move: 25, emoji: "🚀" },
];
const MIN = -50;
const MAX = 50;

const pct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(Math.abs(n) < 10 ? 2 : 1)}%`;
const tone = (n: number) => (n > 0.004 ? "text-emerald-400" : n < -0.004 ? "text-red-400" : "text-slate-300");

/**
 * "What if?" stress test: drag the market (or single stocks) up or down and see the portfolio react.
 * Pure client-side maths on today's values; cash doesn't move.
 */
export function WhatIf({ holdings, cash, startingCash }: { holdings: Holding[]; cash: number; startingCash: number }) {
  const ccy = useCurrency();
  const [market, setMarket] = useState(0);
  const [overrides, setOverrides] = useState<Record<string, number>>({});

  const r = useMemo(() => {
    const rows = holdings.map((h) => {
      const move = overrides[h.symbol] ?? market;
      const after = h.value * (1 + move / 100);
      return { ...h, move, after, delta: after - h.value, custom: h.symbol in overrides };
    });
    const investedNow = holdings.reduce((a, h) => a + h.value, 0);
    const investedAfter = rows.reduce((a, h) => a + h.after, 0);
    const now = cash + investedNow;
    const after = cash + investedAfter;
    const change = after - now;
    const biggest = [...rows].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
    // The uniform move that brings the account back to its starting cash.
    const breakEven = investedNow > 0 ? ((startingCash - cash) / investedNow - 1) * 100 : null;
    return {
      rows,
      now,
      after,
      change,
      changePct: now ? (change / now) * 100 : 0,
      returnAfter: ((after - startingCash) / startingCash) * 100,
      cashShare: now ? (cash / now) * 100 : 0,
      biggest,
      breakEven,
      maxAfter: Math.max(...rows.map((x) => Math.max(x.value, x.after)), 1),
    };
  }, [holdings, cash, startingCash, market, overrides]);

  if (!holdings.length) {
    return <p className="text-sm text-slate-400">Buy a stock first, then come back to stress-test your portfolio.</p>;
  }

  const setAll = (v: number) => {
    setMarket(v);
    setOverrides({});
  };
  const trackStyle = (v: number) => {
    // Colour the track from the centre (0%) to the thumb.
    const mid = 50;
    const pos = ((v - MIN) / (MAX - MIN)) * 100;
    const color = v >= 0 ? "#34d399" : "#f87171";
    const [a, b] = pos >= mid ? [mid, pos] : [pos, mid];
    return { background: `linear-gradient(to right, var(--slider-track) ${a}%, ${color} ${a}%, ${color} ${b}%, var(--slider-track) ${b}%)` };
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => {
          const active = market === p.move && Object.keys(overrides).length === 0;
          return (
            <button
              key={p.label}
              onClick={() => setAll(p.move)}
              aria-pressed={active}
              className={`rounded-xl px-3 py-1.5 text-sm transition ${active ? "bg-ink/10 text-slate-50 ring-1 ring-ink/20" : "bg-ink/[0.04] text-slate-400 hover:text-slate-100"}`}
            >
              <span aria-hidden>{p.emoji}</span> {p.label} <span className="tabular-nums text-xs opacity-70">{p.move > 0 ? "+" : ""}{p.move}%</span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
        <div>
          <label htmlFor="whatif-market" className="flex items-baseline justify-between text-sm">
            <span className="text-slate-300">If every stock you own moves</span>
            <span className={`text-2xl font-semibold tabular-nums ${tone(market)}`}>{market > 0 ? "+" : ""}{market}%</span>
          </label>
          <input
            id="whatif-market"
            type="range"
            min={MIN}
            max={MAX}
            step={1}
            value={market}
            onChange={(e) => setAll(Number(e.target.value))}
            className="whatif-range mt-2 w-full"
            style={trackStyle(market)}
          />
          <div className="mt-1 flex justify-between text-[11px] text-slate-500 tabular-nums">
            <span>−50%</span>
            <span>0</span>
            <span>+50%</span>
          </div>
        </div>

        <div className={`rounded-2xl border p-4 transition-colors ${r.change > 0.5 ? "border-emerald-500/30 bg-emerald-500/[0.06]" : r.change < -0.5 ? "border-red-500/30 bg-red-500/[0.06]" : "border-ink/10 bg-ink/[0.03]"}`} aria-live="polite">
          <div className="text-xs text-slate-400">Portfolio would be worth</div>
          <div className="text-3xl font-semibold tabular-nums">{ccy.fmt(r.after, 0)}</div>
          <div className={`text-sm tabular-nums ${tone(r.change)}`}>
            {ccy.signed(r.change)} ({pct(r.changePct)}) vs today
          </div>
          <div className="mt-3 flex justify-between border-t border-ink/10 pt-2 text-xs">
            <span className="text-slate-400">Total return</span>
            <span className={`font-medium tabular-nums ${tone(r.returnAfter)}`}>{pct(r.returnAfter)}</span>
          </div>
        </div>
      </div>

      <ul className="space-y-2.5">
        {r.rows.map((h) => (
          <li key={h.symbol} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[6.5rem_1fr_4rem_9rem]">
            <div className="min-w-0">
              <div className="flex items-center gap-1 text-sm font-medium">
                {h.symbol.replace(/\.(NS|BO)$/, "")}
                {h.custom && (
                  <button onClick={() => setOverrides(({ [h.symbol]: _drop, ...rest }) => (void _drop, rest))} aria-label={`Reset ${h.symbol} to market move`} title="Follow the market slider again" className="rounded p-0.5 text-slate-500 hover:text-slate-200">
                    <RotateCcw className="h-3 w-3" />
                  </button>
                )}
              </div>
              <div className="truncate text-[11px] text-slate-500">{h.name}</div>
            </div>
            <input
              type="range"
              min={MIN}
              max={MAX}
              step={1}
              value={h.move}
              onChange={(e) => setOverrides((o) => ({ ...o, [h.symbol]: Number(e.target.value) }))}
              aria-label={`${h.symbol} price move`}
              className="whatif-range whatif-range-sm w-full"
              style={trackStyle(h.move)}
            />
            <div className={`text-right text-sm tabular-nums ${tone(h.move)}`}>{h.move > 0 ? "+" : ""}{h.move}%</div>
            {/* Now vs after bars */}
            <div className="col-span-3 flex flex-col gap-0.5 sm:col-span-1">
              <span className="h-1.5 rounded-full bg-slate-500/40" style={{ width: `${(h.value / r.maxAfter) * 100}%` }} title={`Now ${ccy.fmt(h.value)}`} />
              <span className={`h-1.5 rounded-full transition-all ${h.delta >= 0 ? "bg-emerald-400" : "bg-red-400"}`} style={{ width: `${(h.after / r.maxAfter) * 100}%` }} title={`After ${ccy.fmt(h.after)}`} />
              <span className={`text-right text-[11px] tabular-nums ${tone(h.delta)}`}>{ccy.signed(h.delta)}</span>
            </div>
          </li>
        ))}
      </ul>

      <div className="grid gap-2 text-xs text-slate-400 sm:grid-cols-3">
        <p className="rounded-xl bg-ink/[0.03] p-3">
          💵 <b className="text-slate-200">{r.cashShare.toFixed(0)}%</b> of your account is cash, which doesn&apos;t move. It cushions every swing.
        </p>
        {r.biggest && Math.abs(r.biggest.delta) > 0.5 ? (
          <p className="rounded-xl bg-ink/[0.03] p-3">
            🎯 <b className="text-slate-200">{r.biggest.symbol.replace(/\.(NS|BO)$/, "")}</b> has the biggest impact here: <span className={tone(r.biggest.delta)}>{ccy.signed(r.biggest.delta)}</span>.
          </p>
        ) : (
          <p className="rounded-xl bg-ink/[0.03] p-3">🎯 Drag a slider to see which holding moves your account most.</p>
        )}
        {r.breakEven !== null && (
          <p className="rounded-xl bg-ink/[0.03] p-3">
            ⚖️ Your stocks need to move <b className={tone(r.breakEven)}>{pct(r.breakEven)}</b> from here for the account to be back at its starting cash.
          </p>
        )}
      </div>
      <p className="text-[11px] text-slate-500">A simple what-if on today&apos;s prices, not a forecast. Real stocks don&apos;t all move together.</p>
    </div>
  );
}
