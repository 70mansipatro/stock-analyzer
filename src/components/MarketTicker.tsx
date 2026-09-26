"use client";

import { useEffect, useState } from "react";

type Item = { symbol: string; label: string; price: number; changePercent: number; currency: string };

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 4 : 2, minimumFractionDigits: 2 });

/** Scrolling strip of indices, commodities, crypto and FX; refreshes every minute. */
export function MarketTicker({ initial }: { initial: Item[] }) {
  const [items, setItems] = useState(initial);

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/market");
        if (res.ok) {
          const data = (await res.json()) as Item[];
          if (data.length) setItems(data);
        }
      } catch {}
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  if (!items.length) return null;
  const row = items.map((i) => {
    const up = i.changePercent >= 0;
    return (
      <span key={i.symbol} className="flex items-center gap-2 whitespace-nowrap px-5 text-xs">
        <span className="font-medium text-slate-300">{i.label}</span>
        <span className="tabular-nums text-slate-100">{fmt(i.price)}</span>
        <span className={`tabular-nums ${up ? "text-emerald-400" : "text-red-400"}`}>
          {up ? "▲" : "▼"} {Math.abs(i.changePercent).toFixed(2)}%
        </span>
      </span>
    );
  });

  return (
    <div className="group relative overflow-hidden border-b border-slate-800 bg-slate-950/80 py-1.5" aria-label="Market overview">
      <div className="flex w-max animate-marquee group-hover:[animation-play-state:paused]">
        <div className="flex">{row}</div>
        <div className="flex" aria-hidden>{row}</div>
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-slate-950 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-slate-950 to-transparent" />
    </div>
  );
}
