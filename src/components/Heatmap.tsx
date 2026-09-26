"use client";

import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type Tile = { symbol: string; name: string; sector: string; price: number; changePercent: number; marketCap: number; currency: string };
type Region = "US" | "IN";

// Diverging scale around 0% with a neutral grey midpoint; the % label on each tile carries the value too.
const STEPS: [number, string][] = [
  [-3, "#b3261e"],
  [-2, "#8f2420"],
  [-1, "#6b2323"],
  [-0.25, "#4a2a2a"],
  [0.25, "#3a3f47"],
  [1, "#1f4d36"],
  [2, "#1d6b43"],
  [3, "#1f8a50"],
  [Infinity, "#22a55c"],
];
function colorFor(pct: number) {
  if (pct <= STEPS[0][0]) return STEPS[0][1];
  for (const [limit, color] of STEPS) if (pct < limit) return color;
  return STEPS[STEPS.length - 1][1];
}

const LEGEND = ["−3%", "−2%", "−1%", "0%", "+1%", "+2%", "+3%"];

export function Heatmap({ initial, initialRegion = "US" }: { initial: Tile[]; initialRegion?: Region }) {
  const [region, setRegion] = useState<Region>(initialRegion);
  const [data, setData] = useState<Record<Region, Tile[] | undefined>>({ US: initialRegion === "US" ? initial : undefined, IN: initialRegion === "IN" ? initial : undefined });
  const [hover, setHover] = useState<{ tile: Tile; x: number; y: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const height = width < 640 ? 420 : 460;

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (data[region]) return;
    fetch(`/api/heatmap?region=${region}`)
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [])
      .then((tiles: Tile[]) => setData((d) => ({ ...d, [region]: tiles })));
  }, [region, data]);

  const loading = !data[region];
  const tiles = useMemo(() => data[region] ?? [], [data, region]);
  const layout = useMemo(() => {
    const bySector = new Map<string, Tile[]>();
    tiles.forEach((t) => bySector.set(t.sector, [...(bySector.get(t.sector) ?? []), t]));
    type Node = { name: string; children?: Node[]; tile?: Tile };
    const root = hierarchy<Node>({
      name: "root",
      children: [...bySector].map(([name, ts]) => ({ name, children: ts.map((t) => ({ name: t.symbol, tile: t })) })),
    })
      .sum((d) => d.tile?.marketCap ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    return treemap<Node>().tile(treemapSquarify.ratio(1.2)).size([width, height]).paddingOuter(2).paddingTop(18).paddingInner(2).round(true)(root);
  }, [tiles, width, height]);

  const sectors = layout.children ?? [];
  const leaves = layout.leaves().filter((l) => l.data.tile);
  const sectorMoves = sectors.map((s) => {
    const kids = s.leaves().map((l) => l.data.tile!).filter(Boolean);
    const cap = kids.reduce((a, t) => a + t.marketCap, 0);
    return { name: s.data.name, move: cap ? kids.reduce((a, t) => a + t.changePercent * t.marketCap, 0) / cap : 0 };
  });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg bg-slate-800 p-1">
          {(["US", "IN"] as Region[]).map((r) => (
            <button
              key={r}
              onClick={() => setRegion(r)}
              className={`rounded-md px-3 py-1 text-xs ${r === region ? "bg-slate-950 text-white" : "text-slate-400 hover:text-slate-200"}`}
            >
              {r === "US" ? "US large caps" : "India (NIFTY)"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 text-[10px] text-slate-400" aria-label="Colour scale: red is down, green is up">
          {LEGEND.map((l, i) => (
            <span key={l} className="flex flex-col items-center gap-0.5">
              <span className="block h-2.5 w-7 rounded-sm" style={{ background: colorFor([-3.5, -2.5, -1.5, 0, 1.5, 2.5, 3.5][i]) }} />
              {l}
            </span>
          ))}
        </div>
      </div>

      <div ref={boxRef} className="relative w-full overflow-hidden rounded-lg bg-slate-950" style={{ height }} onMouseLeave={() => setHover(null)}>
        {loading && !tiles.length && <div className="absolute inset-0 animate-pulse bg-slate-900" />}
        {sectors.map((s, i) => (
          <div
            key={s.data.name}
            className="pointer-events-none absolute truncate px-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400"
            style={{ left: s.x0, top: s.y0 + 2, width: s.x1 - s.x0 }}
          >
            {s.data.name}{" "}
            <span className={sectorMoves[i].move >= 0 ? "text-emerald-400" : "text-red-400"}>
              {sectorMoves[i].move >= 0 ? "+" : "−"}
              {Math.abs(sectorMoves[i].move).toFixed(2)}%
            </span>
          </div>
        ))}
        {leaves.map((l) => {
          const t = l.data.tile!;
          const w = l.x1 - l.x0;
          const h = l.y1 - l.y0;
          const big = w > 70 && h > 44;
          const show = w > 34 && h > 22;
          return (
            <Link
              key={t.symbol}
              href={`/stock/${encodeURIComponent(t.symbol)}`}
              onMouseMove={(e) => {
                const r = boxRef.current!.getBoundingClientRect();
                setHover({ tile: t, x: e.clientX - r.left, y: e.clientY - r.top });
              }}
              className="absolute flex flex-col items-center justify-center overflow-hidden rounded-[3px] text-white transition hover:z-10 hover:brightness-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
              style={{ left: l.x0, top: l.y0, width: w, height: h, background: colorFor(t.changePercent) }}
              aria-label={`${t.symbol} ${t.changePercent >= 0 ? "up" : "down"} ${Math.abs(t.changePercent).toFixed(2)}%`}
            >
              {show && (
                <>
                  <span className={`font-semibold leading-tight ${big ? "text-sm" : "text-[10px]"}`}>{t.symbol.replace(/\.NS$/, "")}</span>
                  <span className={`tabular-nums leading-tight opacity-90 ${big ? "text-xs" : "text-[9px]"}`}>
                    {t.changePercent >= 0 ? "+" : "−"}
                    {Math.abs(t.changePercent).toFixed(2)}%
                  </span>
                </>
              )}
            </Link>
          );
        })}
        {hover && (
          <div
            className="pointer-events-none absolute z-20 w-52 rounded-lg border border-slate-700 bg-slate-900/95 p-3 text-xs shadow-2xl"
            style={{ left: Math.min(hover.x + 14, width - 216), top: Math.min(hover.y + 14, height - 110) }}
          >
            <div className="font-semibold text-slate-100">{hover.tile.symbol}</div>
            <div className="truncate text-slate-400">{hover.tile.name}</div>
            <div className="mt-2 flex justify-between"><span className="text-slate-400">Price</span><span className="tabular-nums">{hover.tile.price.toLocaleString("en-US", { style: "currency", currency: hover.tile.currency })}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Today</span><span className={`tabular-nums ${hover.tile.changePercent >= 0 ? "text-emerald-400" : "text-red-400"}`}>{hover.tile.changePercent >= 0 ? "+" : "−"}{Math.abs(hover.tile.changePercent).toFixed(2)}%</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Market cap</span><span className="tabular-nums">{Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(hover.tile.marketCap)}</span></div>
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-slate-500">Tile size = market cap, colour and label = today&apos;s change. Click a tile to open the stock.</p>
    </div>
  );
}
