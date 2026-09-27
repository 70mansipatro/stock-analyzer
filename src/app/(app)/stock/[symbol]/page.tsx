import { ArrowLeftRight, CandlestickChart, Gauge, ListChecks, Newspaper, Telescope } from "lucide-react";
import Link from "next/link";
import { AssistantMark } from "@/components/AssistantMark";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Change } from "@/components/Change";
import { Suspense } from "react";
import { CandleChart } from "@/components/CandleChart";
import { ForecastChart } from "@/components/charts";
import { NewsPanel, NewsSkeleton } from "@/components/NewsPanel";
import { TradeForm } from "@/components/TradeForm";
import { Card, ErrorNote } from "@/components/ui";
import { analyzeStock, type Analysis } from "@/lib/analysis";
import { compact, money, num, pct } from "@/lib/format";
import { MarketError, resolveSymbol } from "@/lib/market";
import { prisma } from "@/lib/prisma";
import { predictStock, type Prediction } from "@/lib/prediction";
import { can } from "@/lib/rbac";
import { getSettings } from "@/lib/settings";

const HORIZONS = [10, 30, 60, 90];

const STANCE_STYLE = {
  bullish: { cls: "text-emerald-400 bg-emerald-500/10", icon: "▲", label: "Bullish" },
  bearish: { cls: "text-red-400 bg-red-500/10", icon: "▼", label: "Bearish" },
  neutral: { cls: "text-slate-300 bg-slate-500/10", icon: "●", label: "Neutral" },
} as const;

export default async function StockPage({
  params,
  searchParams,
}: {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<{ h?: string }>;
}) {
  const { symbol: raw } = await params;
  const { h } = await searchParams;
  const symbol = decodeURIComponent(raw).toUpperCase();
  const horizon = HORIZONS.includes(Number(h)) ? Number(h) : 30;
  const session = await auth();
  const userId = session!.user.id;

  let analysis: Analysis;
  try {
    analysis = await analyzeStock(symbol);
  } catch (err) {
    // Maybe a company name or a ticker without its exchange suffix ("RR KABEL" -> RRKABEL.NS).
    const resolved = await resolveSymbol(decodeURIComponent(raw));
    if (resolved && resolved !== symbol) redirect(`/stock/${encodeURIComponent(resolved)}${h ? `?h=${h}` : ""}`);
    return (
      <div className="space-y-4">
        <Link href="/" className="text-sm text-slate-400 hover:text-slate-200">← Back</Link>
        <ErrorNote>{err instanceof MarketError || err instanceof Error ? err.message : `Could not load ${symbol}.`}</ErrorNote>
      </div>
    );
  }

  const [prediction, user, holding, settings] = await Promise.all([
    predictStock(symbol, horizon).catch((e: Error) => e),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { cashBalance: true } }),
    prisma.holding.findUnique({ where: { userId_symbol: { userId, symbol: analysis.quote.symbol } } }),
    getSettings(),
  ]);
  const tradeBlocked = !can(session!.user.role, "trade")
    ? "Your role can view markets but can't place trades. Ask an admin to make you a Trader."
    : !settings.tradingEnabled
      ? "Trading is paused by an administrator."
      : null;

  const q = analysis.quote;
  const ind = analysis.indicators;
  const overall = STANCE_STYLE[analysis.overall];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-sm text-slate-400">{q.exchange}</div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {q.symbol} <span className="text-base font-normal text-slate-400">{q.name}</span>
          </h1>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="text-4xl font-semibold tracking-tight tabular-nums">{money(q.price, q.currency)}</span>
            {q.currency !== "USD" && <span className="text-sm tabular-nums text-slate-400">≈ {money(q.priceUsd)}</span>}
            <span className="tabular-nums"><Change value={q.change} percent={q.changePercent} currency={q.currency} /></span>
            {q.marketState && <span className="text-xs text-slate-500">{q.marketState === "REGULAR" ? "Market open" : "Market closed"}</span>}
          </div>
        </div>
        <Link href={`/assistant?q=${encodeURIComponent(`Give me a full analysis and forecast of ${q.symbol}`)}`} className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-sky-500 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-emerald-500/20 transition hover:brightness-110">
          <AssistantMark className="h-4.5 w-4.5" /> Ask AI about {q.symbol}
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Chart" subtitle="Candles, volume and indicators" icon={CandlestickChart} tone="sky">
            <CandleChart symbol={q.symbol} currency={q.currency} />
          </Card>

          <Card
            title={`Forecast · next ${horizon} trading days`}
            subtitle="Statistical trend with a 90% range"
            icon={Telescope}
            tone="violet"
            action={
              <div className="flex gap-1 rounded-lg bg-ink/[0.04] p-1">
                {HORIZONS.map((d) => (
                  <Link key={d} href={`?h=${d}`} scroll={false} className={`rounded-md px-2.5 py-1 text-xs ${d === horizon ? "bg-surface-1 text-slate-50 shadow-sm" : "text-slate-400 hover:text-slate-200"}`}>
                    {d}d
                  </Link>
                ))}
              </div>
            }
          >
            {prediction instanceof Error ? (
              <ErrorNote>{prediction.message}</ErrorNote>
            ) : (
              <ForecastView p={prediction} />
            )}
          </Card>

          <Card title="Latest news" subtitle="Headlines rated positive, neutral or negative by AI" icon={Newspaper} tone="amber">
            <Suspense fallback={<NewsSkeleton />}>
              <NewsPanel symbol={q.symbol} />
            </Suspense>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Trade" subtitle="Virtual money · live price" icon={ArrowLeftRight} tone="emerald">
            {tradeBlocked ? (
              <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-300">{tradeBlocked}</p>
            ) : (
            <TradeForm
              symbol={q.symbol}
              price={q.priceUsd}
              localPrice={q.price}
              currency={q.currency}
              cash={Number(user.cashBalance)}
              owned={holding?.quantity ?? 0}
              maxOrderValue={settings.maxOrderValue}
            />
            )}
          </Card>

          <Card title="Technical analysis" icon={Gauge} tone="sky">
            <div className={`mb-4 inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium ${overall.cls}`}>
              <span aria-hidden>{overall.icon}</span> Overall: {overall.label} (score {analysis.score > 0 ? "+" : ""}{analysis.score})
            </div>
            <ul className="space-y-3">
              {analysis.signals.map((s) => {
                const st = STANCE_STYLE[s.stance];
                return (
                  <li key={s.label} className="text-sm">
                    <span className={`mr-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs ${st.cls}`}>
                      <span aria-hidden>{st.icon}</span>{st.label}
                    </span>
                    <span className="font-medium">{s.label}</span>
                    <p className="mt-0.5 text-slate-400">{s.detail}</p>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card title="Key stats" icon={ListChecks} tone="slate">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {[
                ["Day range", `${num(q.dayLow)} – ${num(q.dayHigh)}`],
                ["52-week range", `${num(q.fiftyTwoWeekLow)} – ${num(q.fiftyTwoWeekHigh)}`],
                ["From 52w high", pct(ind.percentFrom52wHigh)],
                ["Market cap", compact(q.marketCap)],
                ["P/E (TTM)", num(q.trailingPE)],
                ["Volume", compact(q.volume)],
                ["RSI (14)", num(ind.rsi14, 1)],
                ["Volatility (1y)", ind.annualizedVolatilityPct === null ? "—" : `${ind.annualizedVolatilityPct}%`],
                ["50-day avg", money(ind.sma50, q.currency)],
                ["200-day avg", money(ind.sma200, q.currency)],
                ["1-month return", pct(ind.return1mPct)],
                ["1-year return", pct(ind.return1yPct)],
              ].map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-slate-400">{k}</dt>
                  <dd className="text-right tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ForecastView({ p }: { p: Prediction }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <div className="text-xs text-slate-400">Trend estimate</div>
          <div className="text-lg font-semibold tabular-nums">{money(p.expectedPrice, p.currency)}</div>
          <div className="text-sm tabular-nums"><Change percent={p.expectedReturnPct} /></div>
        </div>
        <div>
          <div className="text-xs text-slate-400">90% range</div>
          <div className="text-lg font-semibold tabular-nums">{money(p.low90)} – {money(p.high90)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-400">Daily volatility</div>
          <div className="text-lg font-semibold tabular-nums">{p.dailyVolatilityPct}%</div>
        </div>
        {p.backtest && (
          <div>
            <div className="text-xs text-slate-400">Backtest ({p.backtest.days} days)</div>
            <div className="text-lg font-semibold tabular-nums">{p.backtest.errorPct}% error</div>
            <div className="text-xs text-slate-500">{p.backtest.withinBand ? "✓ actual inside range" : "✕ actual outside range"}</div>
          </div>
        )}
      </div>
      <ForecastChart history={p.history} forecast={p.forecast} />
      <p className="text-xs text-slate-500">
        {p.method} {p.disclaimer}
      </p>
    </div>
  );
}
