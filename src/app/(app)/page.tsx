import Link from "next/link";
import { auth } from "@/auth";
import { Change } from "@/components/Change";
import { Card, ErrorNote, Stat } from "@/components/ui";
import { compact, money, signedMoney } from "@/lib/format";
import { getTopStocks, TOP_CATEGORY_LABELS, type StockRow, type TopCategory } from "@/lib/market";
import { getPortfolio } from "@/lib/trading";

const CATEGORIES = Object.keys(TOP_CATEGORY_LABELS) as TopCategory[];

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ list?: string }> }) {
  const session = await auth();
  const userId = session!.user.id;
  const { list } = await searchParams;
  const category: TopCategory = CATEGORIES.includes(list as TopCategory) ? (list as TopCategory) : "most_actives";

  const [portfolio, top] = await Promise.all([
    getPortfolio(userId),
    getTopStocks(category, 15).catch(() => null as StockRow[] | null),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Hi, {session!.user.name?.split(" ")[0] ?? "there"}</h1>
        <p className="text-sm text-slate-400">Your paper portfolio and today&apos;s market movers.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total value" value={money(portfolio.totalValue)} sub={<Change percent={portfolio.totalReturnPct} />} />
        <Stat label="Cash" value={money(portfolio.cash)} sub={<span className="text-slate-500">of {money(portfolio.startingCash)} starting</span>} />
        <Stat label="Invested" value={money(portfolio.investedValue)} sub={<span className="text-slate-500">{portfolio.positions.length} positions</span>} />
        <Stat
          label="Unrealized P&L"
          value={<span className={portfolio.unrealizedPnl >= 0 ? "text-emerald-400" : "text-red-400"}>{signedMoney(portfolio.unrealizedPnl)}</span>}
          sub={<span className="text-slate-500">Realized {signedMoney(portfolio.realizedPnl)}</span>}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          title="Top stocks today"
          action={
            <div className="flex gap-1 rounded-lg bg-slate-800 p-1">
              {CATEGORIES.map((c) => (
                <Link
                  key={c}
                  href={`/?list=${c}`}
                  scroll={false}
                  className={`rounded-md px-3 py-1 text-xs ${c === category ? "bg-slate-950 text-white" : "text-slate-400 hover:text-slate-200"}`}
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
                    <th className="pb-2 font-normal">Symbol</th>
                    <th className="pb-2 text-right font-normal">Price</th>
                    <th className="pb-2 text-right font-normal">Change</th>
                    <th className="hidden pb-2 text-right font-normal sm:table-cell">Volume</th>
                    <th className="hidden pb-2 text-right font-normal md:table-cell">Market cap</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {top.map((s) => (
                    <tr key={s.symbol} className="hover:bg-slate-800/40">
                      <td className="py-2">
                        <Link href={`/stock/${encodeURIComponent(s.symbol)}`} className="block">
                          <span className="font-medium text-slate-100">{s.symbol}</span>
                          <span className="block max-w-[14rem] truncate text-xs text-slate-500">{s.name}</span>
                        </Link>
                      </td>
                      <td className="py-2 text-right tabular-nums">{money(s.price)}</td>
                      <td className="py-2 text-right tabular-nums"><Change percent={s.changePercent} /></td>
                      <td className="hidden py-2 text-right tabular-nums text-slate-400 sm:table-cell">{compact(s.volume)}</td>
                      <td className="hidden py-2 text-right tabular-nums text-slate-400 md:table-cell">{compact(s.marketCap)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card title="Your holdings" action={<Link href="/portfolio" className="text-xs text-emerald-400 hover:underline">View all</Link>}>
            {portfolio.positions.length === 0 ? (
              <p className="text-sm text-slate-400">
                No holdings yet. Open any stock and buy with your {money(portfolio.cash)} of virtual cash.
              </p>
            ) : (
              <ul className="divide-y divide-slate-800 text-sm">
                {portfolio.positions.slice(0, 6).map((p) => (
                  <li key={p.symbol} className="flex items-center justify-between py-2">
                    <Link href={`/stock/${encodeURIComponent(p.symbol)}`}>
                      <span className="font-medium">{p.symbol}</span>
                      <span className="block text-xs text-slate-500">{p.quantity} {p.quantity === 1 ? "share" : "shares"}</span>
                    </Link>
                    <div className="text-right tabular-nums">
                      <div>{money(p.marketValue)}</div>
                      <div className="text-xs"><Change percent={p.unrealizedPnlPct} /></div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Ask the AI assistant">
            <p className="mb-3 text-sm text-slate-400">Analyze, forecast or trade by chatting.</p>
            <div className="flex flex-col gap-2">
              {["What are today's top gainers?", "Analyze NVDA", "Forecast AAPL for 30 days", "Buy 5 shares of MSFT"].map((q) => (
                <Link key={q} href={`/assistant?q=${encodeURIComponent(q)}`} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800">
                  {q}
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
