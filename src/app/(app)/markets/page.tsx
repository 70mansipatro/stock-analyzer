import { BarChart3, Bitcoin, Coins, Droplets, Globe2, IndianRupee, LayoutGrid, ListOrdered } from "lucide-react";
import Link from "next/link";
import { Change } from "@/components/Change";
import { Heatmap } from "@/components/Heatmap";
import { Card, ErrorNote, PageHeader } from "@/components/ui";
import { compact, money } from "@/lib/format";
import { getHeatmap, getMarketOverview, getTopStocks, TOP_CATEGORY_LABELS, type StockRow, type TopCategory } from "@/lib/market";
import { marketStatus } from "@/lib/market-hours";

const CATEGORIES = Object.keys(TOP_CATEGORY_LABELS) as TopCategory[];
const ICONS: Record<string, typeof Globe2> = { "GC=F": Coins, "CL=F": Droplets, "BTC-USD": Bitcoin, "INR=X": IndianRupee };

export default async function MarketsPage({ searchParams }: { searchParams: Promise<{ list?: string }> }) {
  const { list } = await searchParams;
  const category: TopCategory = CATEGORIES.includes(list as TopCategory) ? (list as TopCategory) : "most_actives";
  const [overview, heatmap, top] = await Promise.all([
    getMarketOverview().catch(() => []),
    getHeatmap("US").catch(() => []),
    getTopStocks(category, 15).catch(() => null as StockRow[] | null),
  ]);
  const status = marketStatus();

  return (
    <div className="space-y-6">
      <PageHeader title="Markets" subtitle={status.map((s) => `${s.label} ${s.open ? "open" : "closed"}`).join(" · ") + " · Prices may be delayed"} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {overview.map((o) => {
          const Icon = ICONS[o.symbol] ?? Globe2;
          const up = o.changePercent >= 0;
          return (
            <div key={o.symbol} className="glass relative overflow-hidden rounded-2xl p-4">
              <div aria-hidden className={`absolute -right-6 -top-6 h-20 w-20 rounded-full blur-2xl ${up ? "bg-emerald-500/15" : "bg-red-500/15"}`} />
              <div className="relative flex items-center justify-between">
                <span className="text-xs font-medium text-slate-400">{o.label}</span>
                <Icon className="h-4 w-4 text-slate-500" />
              </div>
              <div className="relative mt-2 text-lg font-semibold tabular-nums">
                {o.price.toLocaleString("en-US", { maximumFractionDigits: o.price < 10 ? 4 : 2, minimumFractionDigits: 2 })}
              </div>
              <div className="relative text-sm tabular-nums">
                <Change percent={o.changePercent} />
              </div>
            </div>
          );
        })}
      </div>

      <Card title="Market heatmap" subtitle="Large caps by sector · size = market cap · colour = today's move" icon={LayoutGrid} tone="emerald">
        <Heatmap initial={heatmap} />
      </Card>

      <Card
        title="Top stocks today"
        subtitle="US markets"
        icon={ListOrdered}
        tone="sky"
        action={
          <div className="flex gap-1 rounded-xl bg-white/[0.04] p-1">
            {CATEGORIES.map((c) => (
              <Link
                key={c}
                href={`/markets?list=${c}`}
                scroll={false}
                className={`rounded-lg px-3 py-1 text-xs transition ${c === category ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200"}`}
              >
                {TOP_CATEGORY_LABELS[c]}
              </Link>
            ))}
          </div>
        }
      >
        {!top ? (
          <ErrorNote>Market data is unavailable right now. Try again in a minute.</ErrorNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="pb-2 font-normal">#</th>
                  <th className="pb-2 font-normal">Symbol</th>
                  <th className="pb-2 text-right font-normal">Price</th>
                  <th className="pb-2 text-right font-normal">Change</th>
                  <th className="hidden pb-2 text-right font-normal sm:table-cell">Volume</th>
                  <th className="hidden pb-2 text-right font-normal md:table-cell">Market cap</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {top.map((s, i) => (
                  <tr key={s.symbol} className="transition hover:bg-white/[0.03]">
                    <td className="py-2.5 text-xs text-slate-600">{i + 1}</td>
                    <td className="py-2.5">
                      <Link href={`/stock/${encodeURIComponent(s.symbol)}`} className="flex items-center gap-3">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-[10px] font-semibold">{s.symbol.slice(0, 4)}</span>
                        <span>
                          <span className="block font-medium">{s.symbol}</span>
                          <span className="block max-w-[14rem] truncate text-xs text-slate-500">{s.name}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="py-2.5 text-right tabular-nums">{money(s.price)}</td>
                    <td className="py-2.5 text-right tabular-nums"><Change percent={s.changePercent} /></td>
                    <td className="hidden py-2.5 text-right tabular-nums text-slate-400 sm:table-cell">{compact(s.volume)}</td>
                    <td className="hidden py-2.5 text-right tabular-nums text-slate-400 md:table-cell">{compact(s.marketCap)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="flex items-center gap-2 text-xs text-slate-500">
        <BarChart3 className="h-3.5 w-3.5" /> Click any stock or heatmap tile for charts, AI news sentiment, forecasts and paper trading.
      </p>
    </div>
  );
}
