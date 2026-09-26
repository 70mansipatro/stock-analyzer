import Link from "next/link";
import { auth } from "@/auth";
import { Change } from "@/components/Change";
import { Card, Stat } from "@/components/ui";
import { money, signedMoney } from "@/lib/format";
import { getPortfolio, getRecentTrades } from "@/lib/trading";

export default async function PortfolioPage() {
  const session = await auth();
  const userId = session!.user.id;
  const [p, trades] = await Promise.all([getPortfolio(userId), getRecentTrades(userId, 50)]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Portfolio</h1>
        <p className="text-sm text-slate-400">Paper trading account in USD. Values use live market prices; non-USD stocks are converted at live exchange rates.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total value" value={money(p.totalValue)} sub={<Change value={p.totalValue - p.startingCash} percent={p.totalReturnPct} />} />
        <Stat label="Cash" value={money(p.cash)} />
        <Stat label="Invested (market value)" value={money(p.investedValue)} sub={<span className="text-slate-500">Cost {money(p.costBasis)}</span>} />
        <Stat
          label="Unrealized / realized P&L"
          value={<span className={p.unrealizedPnl >= 0 ? "text-emerald-400" : "text-red-400"}>{signedMoney(p.unrealizedPnl)}</span>}
          sub={<span className="text-slate-400">Realized {signedMoney(p.realizedPnl)}</span>}
        />
      </div>

      <Card title={`Holdings (${p.positions.length})`}>
        {p.positions.length === 0 ? (
          <p className="text-sm text-slate-400">
            You don&apos;t own any stocks yet. <Link href="/" className="text-emerald-400 hover:underline">Browse top stocks</Link> or search for one to buy.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="pb-2 font-normal">Symbol</th>
                  <th className="pb-2 text-right font-normal">Shares</th>
                  <th className="pb-2 text-right font-normal">Avg cost</th>
                  <th className="pb-2 text-right font-normal">Price</th>
                  <th className="pb-2 text-right font-normal">Today</th>
                  <th className="pb-2 text-right font-normal">Market value</th>
                  <th className="pb-2 text-right font-normal">Unrealized P&L</th>
                  <th className="pb-2 text-right font-normal">Weight</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {p.positions.map((pos) => (
                  <tr key={pos.symbol} className="hover:bg-slate-800/40">
                    <td className="py-2">
                      <Link href={`/stock/${encodeURIComponent(pos.symbol)}`}>
                        <span className="font-medium">{pos.symbol}</span>
                        <span className="block max-w-[12rem] truncate text-xs text-slate-500">{pos.name}</span>
                      </Link>
                    </td>
                    <td className="py-2 text-right tabular-nums">{pos.quantity}</td>
                    <td className="py-2 text-right tabular-nums">{money(pos.avgCost)}</td>
                    <td className="py-2 text-right tabular-nums">
                      {money(pos.price)}
                      {pos.currency !== "USD" && <span className="block text-xs text-slate-500">{money(pos.localPrice, pos.currency)}</span>}
                    </td>
                    <td className="py-2 text-right tabular-nums"><Change percent={pos.dayChangePercent} /></td>
                    <td className="py-2 text-right tabular-nums">{money(pos.marketValue)}</td>
                    <td className="py-2 text-right tabular-nums"><Change value={pos.unrealizedPnl} percent={pos.unrealizedPnlPct} /></td>
                    <td className="py-2 text-right tabular-nums text-slate-400">{pos.weightPct ?? "—"}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Trade history">
        {trades.length === 0 ? (
          <p className="text-sm text-slate-400">No trades yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="pb-2 font-normal">Date</th>
                  <th className="pb-2 font-normal">Side</th>
                  <th className="pb-2 font-normal">Symbol</th>
                  <th className="pb-2 text-right font-normal">Shares</th>
                  <th className="pb-2 text-right font-normal">Price</th>
                  <th className="pb-2 text-right font-normal">Total</th>
                  <th className="pb-2 text-right font-normal">Realized P&L</th>
                  <th className="pb-2 text-right font-normal">Via</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {trades.map((t) => (
                  <tr key={t.id}>
                    <td className="py-2 text-slate-400">{new Date(t.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</td>
                    <td className="py-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${t.side === "BUY" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>{t.side}</span>
                    </td>
                    <td className="py-2 font-medium">{t.symbol}</td>
                    <td className="py-2 text-right tabular-nums">{t.quantity}</td>
                    <td className="py-2 text-right tabular-nums">{money(t.price)}</td>
                    <td className="py-2 text-right tabular-nums">{money(t.total)}</td>
                    <td className="py-2 text-right tabular-nums">{t.realizedPnl === null ? "—" : <Change value={t.realizedPnl} />}</td>
                    <td className="py-2 text-right text-xs text-slate-500">{t.source === "CHAT" ? "AI chat" : "App"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
