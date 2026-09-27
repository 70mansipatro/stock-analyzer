import { Activity, ArrowRight, Briefcase, Flame, LineChart, PieChart, Sparkles, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import Link from "next/link";
import { AssistantMark } from "@/components/AssistantMark";
import { auth } from "@/auth";
import { Change } from "@/components/Change";
import { AllocationDonut, PerformanceChart } from "@/components/PortfolioCharts";
import { PortfolioReview } from "@/components/PortfolioReview";
import { Card, ErrorNote, PageHeader, Stat } from "@/components/ui";
import { inCcy, signedInCcy } from "@/lib/display-currency";
import { getDisplayCurrency } from "@/lib/display-currency-server";
import { money, pct } from "@/lib/format";
import { getTopStocks, type StockRow, type TopCategory } from "@/lib/market";
import { getAllocation, getPerformance } from "@/lib/performance";
import { getPortfolio } from "@/lib/trading";

const MOVERS: { id: TopCategory; title: string; icon: typeof Flame; tone: "emerald" | "rose" | "amber" }[] = [
  { id: "day_gainers", title: "Top gainers", icon: TrendingUp, tone: "emerald" },
  { id: "day_losers", title: "Top losers", icon: TrendingDown, tone: "rose" },
  { id: "most_actives", title: "Most active", icon: Flame, tone: "amber" },
];

const PROMPTS = ["What are today's top gainers?", "Analyze NVDA", "What's the news on Tesla?", "Review my portfolio risk"];

export default async function Dashboard() {
  const session = await auth();
  const user = session!.user;
  const [portfolio, cur] = await Promise.all([getPortfolio(user.id), getDisplayCurrency()]);
  const m = (usd: number | null) => inCcy(usd, cur);
  const sm = (usd: number) => signedInCcy(usd, cur);
  const [performance, allocation, ...movers] = await Promise.all([
    getPerformance(user.id, portfolio).catch(() => null),
    getAllocation(portfolio).catch(() => null),
    ...MOVERS.map((m) => getTopStocks(m.id, 5).catch(() => null as StockRow[] | null)),
  ]);

  const series = performance?.points.map((p) => p.portfolio) ?? [];
  const up = portfolio.totalReturnPct >= 0;
  const vsBench =
    performance?.benchmarkReturnPct !== null && performance?.benchmarkReturnPct !== undefined
      ? performance.portfolioReturnPct - performance.benchmarkReturnPct
      : null;
  const best = [...portfolio.positions].sort((a, b) => (b.unrealizedPnlPct ?? -1e9) - (a.unrealizedPnlPct ?? -1e9))[0];
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <>
            Welcome back, <span className="text-gradient">{user.name?.split(" ")[0] ?? "trader"}</span>
          </>
        }
        subtitle={`${today} · Your portfolio at a glance`}
      >
        <div className="flex gap-2">
          <Link href="/markets" className="glass flex items-center gap-2 rounded-xl px-4 py-2 text-sm text-slate-200 transition hover:border-ink/20">
            <Activity className="h-4 w-4 text-sky-300" /> Markets
          </Link>
          <Link
            href="/assistant"
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-sky-500 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-emerald-500/20 transition hover:brightness-110"
          >
            <AssistantMark className="h-4.5 w-4.5" /> Ask AI
          </Link>
        </div>
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat label="Portfolio value" icon={Wallet} tone="emerald" value={m(portfolio.totalValue)} sub={<Change percent={portfolio.totalReturnPct} />} trend={{ values: series, up }} />
        <Stat
          label="Unrealized P&L"
          icon={LineChart}
          tone={portfolio.unrealizedPnl >= 0 ? "emerald" : "rose"}
          value={<span className={portfolio.unrealizedPnl >= 0 ? "text-emerald-300" : "text-red-300"}>{sm(portfolio.unrealizedPnl)}</span>}
          sub={<span className="text-slate-500">Realized {sm(portfolio.realizedPnl)}</span>}
        />
        <Stat
          label="vs S&P 500"
          icon={Activity}
          tone="sky"
          value={vsBench === null ? "—" : <span className={vsBench >= 0 ? "text-emerald-300" : "text-red-300"}>{pct(vsBench)}</span>}
          sub={<span className="text-slate-500">{vsBench === null ? "After your first trade" : vsBench >= 0 ? "Beating the index" : "Trailing the index"}</span>}
        />
        <Stat
          label="Best holding"
          icon={Briefcase}
          tone="violet"
          value={best ? best.symbol.replace(/\.NS$/, "") : "—"}
          sub={best ? <Change percent={best.unrealizedPnlPct} /> : <span className="text-slate-500">No holdings yet</span>}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Performance" subtitle="Account value vs the S&P 500 from the same starting cash" icon={LineChart} tone="sky">
          <PerformanceChart points={performance?.points ?? []} benchmarkLabel={performance?.benchmarkLabel ?? "S&P 500"} currency={cur.code} rate={cur.rate} />
        </Card>
        <Card title="Allocation" subtitle={`${portfolio.positions.length} positions + cash`} icon={PieChart} tone="violet">
          <AllocationDonut slices={allocation?.byHolding ?? []} title="Largest" currency={cur.code} rate={cur.rate} />
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card
          className="relative overflow-hidden xl:col-span-2"
          title="AI portfolio review"
          subtitle="Risk score, diversification and ideas from AI"
          icon={Sparkles}
          tone="sky"
        >
          <div aria-hidden className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-sky-500/10 blur-3xl" />
          <PortfolioReview hasHoldings={portfolio.positions.length > 0} />
        </Card>

        <Card
          title="Holdings"
          icon={Briefcase}
          tone="emerald"
          action={
            <Link href="/portfolio" className="flex items-center gap-1 text-xs text-emerald-300 hover:underline">
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          }
        >
          {portfolio.positions.length === 0 ? (
            <p className="text-sm text-slate-400">No holdings yet. Open any stock and buy with your {m(portfolio.cash)} of virtual cash.</p>
          ) : (
            <ul className="space-y-1">
              {portfolio.positions.slice(0, 5).map((p) => (
                <li key={p.symbol}>
                  <Link href={`/stock/${encodeURIComponent(p.symbol)}`} className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-ink/[0.04]">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink/5 text-xs font-semibold text-slate-200">
                      {p.symbol.replace(/\.NS$/, "").slice(0, 4)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.name}</span>
                      <span className="block text-xs text-slate-500">
                        {p.quantity} {p.quantity === 1 ? "share" : "shares"}
                      </span>
                    </span>
                    <span className="text-right tabular-nums">
                      <span className="block text-sm">{m(p.marketValue)}</span>
                      <span className="block text-xs">
                        <Change percent={p.unrealizedPnlPct} />
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {MOVERS.map((m, i) => {
          const rows = movers[i];
          return (
            <Card
              key={m.id}
              title={m.title}
              icon={m.icon}
              tone={m.tone}
              action={
                <Link href="/markets" className="text-xs text-slate-400 hover:text-slate-50">
                  More
                </Link>
              }
            >
              {!rows ? (
                <ErrorNote>Market data is unavailable right now.</ErrorNote>
              ) : (
                <ul className="space-y-0.5">
                  {rows.map((s) => (
                    <li key={s.symbol}>
                      <Link href={`/stock/${encodeURIComponent(s.symbol)}`} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 transition hover:bg-ink/[0.04]">
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{s.symbol}</span>
                          <span className="block truncate text-xs text-slate-500">{s.name}</span>
                        </span>
                        <span className="text-right tabular-nums">
                          <span className="block text-sm">{money(s.price)}</span>
                          <span className="block text-xs">
                            <Change percent={s.changePercent} />
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>

      <Card title="Try the AI assistant" subtitle="Click a prompt, or use the chat button in the corner" icon={Sparkles} tone="violet">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {PROMPTS.map((q) => (
            <Link
              key={q}
              href={`/assistant?q=${encodeURIComponent(q)}`}
              className="glass flex items-center justify-between gap-2 rounded-xl px-3.5 py-3 text-sm text-slate-200 transition hover:border-violet-400/40"
            >
              {q}
              <ArrowRight className="h-4 w-4 shrink-0 text-slate-500" />
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
