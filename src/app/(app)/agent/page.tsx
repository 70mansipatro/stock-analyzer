import { Activity, Bell, Bot, Briefcase, FlaskConical, Gauge, History, Inbox, ListChecks, Radar, Settings2, ShieldAlert, ShieldCheck, Tags } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AgentSettingsForm, AutoRefresh, RunNowButton, StartStopButton, SuggestionActions } from "@/components/agent/AgentControls";
import { ActivityFilters, ActivityLog, AgentNotificationList, ago, CurrentActivity, PositionsTable, Reasons, StatusPanel, TradeHistory } from "@/components/agent/AgentPanels";
import { BacktestPanel } from "@/components/agent/BacktestPanel";
import { StockSelector } from "@/components/agent/StockSelector";
import { Card, PageHeader, Stat } from "@/components/ui";
import { ACTIVITY_FILTERS, agentNotifications, dashboardStats, listAutoTrades, listDecisions, openPositions, type ActivityFilter } from "@/lib/agent/activity";
import { getAgentConfig } from "@/lib/agent/engine";
import { nextScanAt } from "@/lib/agent/rules";
import { THRESHOLDS, type Reason } from "@/lib/agent/strategy";
import { currentActor } from "@/lib/authz";
import { inCcy, signedInCcy } from "@/lib/display-currency";
import { getDisplayCurrency } from "@/lib/display-currency-server";
import { money } from "@/lib/format";
import { getMarketSession, marketOfSymbol } from "@/lib/market-hours";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { getSettings } from "@/lib/settings";

const MODE_LABEL = { FULL_AUTO: "Full auto", SUGGEST: "Suggest", DRY_RUN: "Dry run" } as const;

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);

export default async function AgentPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  const sp = await searchParams;
  const filter: ActivityFilter = (ACTIVITY_FILTERS as readonly string[]).includes(sp.filter ?? "") ? (sp.filter as ActivityFilter) : "all";
  const canTrade = can(actor.role, "trade");
  const [cfg, settings, cur] = await Promise.all([getAgentConfig(actor.id), getSettings(), getDisplayCurrency()]);
  const [lastRun, pending, positions, stats, trades, log, notes] = await Promise.all([
    prisma.agentRun.findFirst({ where: { userId: actor.id, status: { not: "running" }, scanned: { gt: 0 } }, orderBy: { startedAt: "desc" } }),
    prisma.agentDecision.findMany({ where: { userId: actor.id, status: "suggested", createdAt: { gte: hoursAgo(24) } }, orderBy: { createdAt: "desc" } }),
    openPositions(actor.id, cfg),
    dashboardStats(actor.id),
    listAutoTrades(actor.id, 25),
    listDecisions(actor.id, filter, 80),
    agentNotifications(actor.id, 8),
  ]);
  const current = lastRun ? await listDecisions(actor.id, "all", 200, lastRun.id) : [];

  const universe = cfg.universe;
  const sessions = [getMarketSession("US"), getMarketSession("IN")];
  const openValue = positions.reduce((a, p) => a + p.valueUsd, 0);
  const unrealized = positions.reduce((a, p) => a + (p.pnlUsd ?? 0), 0);
  const budget = Number(cfg.budget);
  const running = canTrade && cfg.enabled && (settings.tradingEnabled || cfg.mode === "DRY_RUN");
  const statusText = !canTrade ? "Your role can't trade" : !settings.tradingEnabled && cfg.mode !== "DRY_RUN" ? "Paused by admin (kill switch)" : cfg.enabled ? `Running${cfg.demoSpeed ? " · demo speed" : ""}` : "Stopped";
  const th = THRESHOLDS[cfg.risk];
  const m = (usd: number) => inCcy(usd, cur);
  const tradesToday = stats.buysToday + stats.sellsToday;

  return (
    <div className="space-y-6">
      <AutoRefresh active={cfg.enabled} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
        <span className="flex items-center gap-2 font-semibold text-amber-200">
          <ShieldAlert className="h-4 w-4" /> Paper Trading Only — No Real Money Is Used.
        </span>
        <span className="text-xs text-amber-100/80">Auto-Trader uses configurable profit targets and risk protection, but market returns are not guaranteed.</span>
      </div>

      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            AI Auto-Trader
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${running ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-500/15 text-slate-300"}`}>
              {running ? "🟢" : "🔴"} {statusText} · {MODE_LABEL[cfg.mode]}
            </span>
          </span>
        }
        subtitle={`Watches ${universe.length} selected stock${universe.length === 1 ? "" : "s"} (${universe.filter((s) => marketOfSymbol(s) === "US").length} US · ${universe.filter((s) => marketOfSymbol(s) === "IN").length} India), scores each one and trades within your limits.`}
      >
        <div className="flex flex-wrap gap-2">
          <RunNowButton disabled={!canTrade} />
          {canTrade && <StartStopButton enabled={cfg.enabled} disabled={!cfg.enabled && !universe.length} />}
        </div>
      </PageHeader>

      {cfg.mode === "FULL_AUTO" && (
        <p className="rounded-xl border border-sky-500/20 bg-sky-500/5 px-4 py-2.5 text-sm text-sky-100/90">
          <b>FULL AUTO</b> means the bot automatically monitors your selected stocks and executes virtual BUY/SELL trades according to the strategy and risk rules. No approval is required.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat label="Today's realized P/L" icon={Gauge} tone={stats.realizedTodayUsd >= 0 ? "emerald" : "rose"} value={<span className={stats.realizedTodayUsd >= 0 ? "text-emerald-300" : "text-red-300"}>{signedInCcy(stats.realizedTodayUsd, cur)}</span>} sub={<span className="text-slate-500">All-time {signedInCcy(stats.realizedAllTimeUsd, cur)} · open {signedInCcy(unrealized, cur)}</span>} />
        <Stat label="Trades today" icon={ListChecks} tone="violet" value={`${tradesToday} / ${cfg.maxTradesPerDay}`} sub={<span className="text-slate-500">{stats.buysToday} buys · {stats.sellsToday} sells · {stats.totalTrades} all-time</span>} />
        <Stat label="Open positions" icon={Briefcase} tone="sky" value={positions.length} sub={<span className="text-slate-500">{m(openValue)} of {m(budget)} budget</span>} />
        <Stat label="Last scan" icon={Activity} tone={stats.errorsToday ? "amber" : "slate"} value={cfg.lastRunAt ? ago(cfg.lastRunAt) : "Never"} sub={<span className="text-slate-500">{stats.errorsToday} error{stats.errorsToday === 1 ? "" : "s"} / rejections today</span>} />
      </div>

      {pending.length > 0 && (
        <Card title={`Waiting for your approval (${pending.length})`} subtitle="Suggest mode: nothing is traded until you approve. Suggestions expire after 24 hours." icon={Inbox} tone="amber">
          <ul className="divide-y divide-ink/5">
            {pending.map((d) => (
              <li key={d.id} id={`d-${d.id}`} className="py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`rounded px-2 py-0.5 text-xs font-semibold ${d.action === "BUY" ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-400"}`}>{d.action}</span>
                  <Link href={`/stock/${encodeURIComponent(d.symbol)}`} className="font-semibold hover:underline">
                    {d.quantity} × {d.symbol}
                  </Link>
                  <span className="text-sm text-slate-400">at ~{d.price ? money(Number(d.price), marketOfSymbol(d.symbol) === "IN" ? "INR" : "USD") : "market"}</span>
                  <span className="text-xs text-slate-500">score {d.score} · confidence {d.confidence}%</span>
                  <span className="ml-auto">
                    <SuggestionActions id={d.id} />
                  </span>
                </div>
                {d.aiNote && <p className="mt-1 text-xs text-sky-300">AI: {d.aiNote}</p>}
                <Reasons reasons={d.reasons as Reason[]} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <div className="min-w-0 space-y-6">
          <Card title="Current activity" subtitle={lastRun ? `Latest scan ${ago(lastRun.startedAt)} · ${lastRun.summary ?? ""}` : "What the bot decided for each stock in its latest scan"} icon={Radar} tone="sky">
            {lastRun?.aiNote && <p className="mb-3 text-xs text-sky-300">AI review: {lastRun.aiNote}</p>}
            {current.length ? (
              <CurrentActivity items={current} />
            ) : (
              <div className="rounded-xl border border-dashed border-ink/15 p-6 text-center text-sm text-slate-400">
                No scans yet. Select stocks, then press <b className="text-slate-200">Start Auto-Trader</b>, or <b className="text-slate-200">Run now</b> for a one-off scan.
              </div>
            )}
          </Card>

          <Card title="Open Auto-Trader positions" subtitle="Each one is sold automatically when an exit rule triggers" icon={Briefcase} tone="emerald">
            <PositionsTable positions={positions} cur={cur} />
          </Card>

          <Card title="Recent automatic trades" subtitle="Kept permanently, including after a position is closed" icon={History} tone="violet">
            <TradeHistory trades={trades} cur={cur} />
          </Card>

          <section id="activity" className="scroll-mt-20">
            <Card title="Activity log" subtitle={`Every scan, every stock. Buys at score ≥ ${th.buy}, sells at ≤ ${th.sell} (${cfg.risk.toLowerCase()} risk).`} icon={Bot} tone="sky" action={<ActivityFilters active={filter} />}>
              <ActivityLog items={log} cur={cur} />
            </Card>
          </section>

          <Card title="Backtest" subtitle="Historical simulation of your saved settings on your selected stocks, compared with buying and holding" icon={FlaskConical} tone="violet">
            <BacktestPanel />
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Auto-Trader" icon={ShieldCheck} tone="emerald">
            <StatusPanel
              running={running}
              statusText={statusText}
              modeLabel={MODE_LABEL[cfg.mode]}
              stocks={universe}
              risk={cfg.risk}
              profitTargetPct={Number(cfg.takeProfitPct)}
              maxLossPct={Number(cfg.stopLossPct)}
              trailingStopPct={cfg.trailingStopEnabled ? Number(cfg.trailingStopPct) : null}
              aiReview={cfg.useAiReview}
              marketHoursOnly={cfg.marketHoursOnly}
              demoSpeed={cfg.demoSpeed}
              sessions={sessions}
              lastScan={cfg.lastRunAt?.toISOString() ?? null}
              nextScan={nextScanAt(cfg)}
            />
          </Card>

          <Card title={`Selected stocks (${universe.length})`} subtitle="Auto-Trader monitors only the stocks you select. US (NYSE/Nasdaq) and India (NSE .NS / BSE .BO)." icon={Tags} tone="sky">
            {canTrade ? <StockSelector symbols={universe} /> : <p className="text-sm text-slate-400">{universe.join(", ") || "None"}</p>}
          </Card>

          <Card title="Settings" icon={Settings2} tone="emerald">
            {canTrade ? (
              <AgentSettingsForm
                cfg={{
                  mode: cfg.mode,
                  risk: cfg.risk,
                  budget,
                  maxPositionPct: cfg.maxPositionPct,
                  maxTradesPerDay: cfg.maxTradesPerDay,
                  stopLossPct: Number(cfg.stopLossPct),
                  takeProfitPct: Number(cfg.takeProfitPct),
                  trailingStopEnabled: cfg.trailingStopEnabled,
                  trailingStopPct: Number(cfg.trailingStopPct),
                  useAiReview: cfg.useAiReview,
                  marketHoursOnly: cfg.marketHoursOnly,
                  dailyEmail: cfg.dailyEmail,
                  tradeEmails: cfg.tradeEmails,
                  summaryHour: cfg.summaryHour,
                  demoSpeed: cfg.demoSpeed,
                }}
              />
            ) : (
              <p className="text-sm text-slate-400">Your role can view markets but can&apos;t trade, so the auto-trader isn&apos;t available. Ask an admin to make you a Trader.</p>
            )}
          </Card>

          <Card title="Recent notifications" icon={Bell} tone="amber">
            <AgentNotificationList items={notes} />
          </Card>

          <Card title="How it decides" icon={ListChecks} tone="slate">
            <ol className="list-decimal space-y-1.5 pl-4 text-sm text-slate-400">
              <li>Every 5 minutes while a stock&apos;s exchange is open, it fetches the latest price and history.</li>
              <li>Scores each stock −100…+100 from the 200/50/20-day averages, MACD momentum, RSI and recent return.</li>
              <li>Sells first: maximum loss, trailing stop, profit target, or a weak score after a 5-day minimum hold.</li>
              <li>Buys the strongest stocks in an uptrend, within your budget, per-stock and daily limits and cash.</li>
              <li>AI reviews each buy and can veto it. It never adds, resizes or blocks a sell.</li>
              <li>Every order goes through the normal trade checks and the admin kill switch, and is logged.</li>
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
