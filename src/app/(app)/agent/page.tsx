import { Activity, Bot, Briefcase, FlaskConical, Gauge, Inbox, ListChecks, Settings2 } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AgentSettingsForm, RunNowButton, SuggestionActions } from "@/components/agent/AgentControls";
import { BacktestPanel } from "@/components/agent/BacktestPanel";
import { Card, PageHeader, Stat } from "@/components/ui";
import { agentPositions, getAgentConfig, marketOf } from "@/lib/agent/engine";
import { DEFAULT_UNIVERSE, THRESHOLDS, type Reason } from "@/lib/agent/strategy";
import { currentActor } from "@/lib/authz";
import { inCcy, signedInCcy } from "@/lib/display-currency";
import { getDisplayCurrency } from "@/lib/display-currency-server";
import { money } from "@/lib/format";
import { getQuotes } from "@/lib/market";
import { marketStatus } from "@/lib/market-hours";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { getSettings } from "@/lib/settings";

const MODE_LABEL = { AUTO: "Auto", SUGGEST: "Suggest", DRY_RUN: "Dry run" } as const;
const STATUS: Record<string, { label: string; cls: string }> = {
  executed: { label: "Placed", cls: "bg-emerald-500/15 text-emerald-300" },
  approved: { label: "Approved", cls: "bg-emerald-500/15 text-emerald-300" },
  suggested: { label: "Waiting for you", cls: "bg-amber-500/15 text-amber-300" },
  dry_run: { label: "Dry run", cls: "bg-sky-500/15 text-sky-300" },
  skipped: { label: "Vetoed", cls: "bg-slate-500/15 text-slate-300" },
  rejected: { label: "Dismissed", cls: "bg-slate-500/15 text-slate-400" },
  failed: { label: "Failed", cls: "bg-red-500/15 text-red-400" },
};

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
const startOfToday = () => new Date(new Date().setHours(0, 0, 0, 0));

const ago = (d: Date) => {
  const m = Math.round((Date.now() - d.getTime()) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};

function ScoreBar({ score }: { score: number }) {
  const w = Math.min(Math.abs(score), 100) / 2;
  return (
    <span className="relative inline-block h-1.5 w-24 overflow-hidden rounded-full bg-ink/10" aria-label={`score ${score}`}>
      <span className="absolute inset-y-0 left-1/2 w-px bg-ink/30" />
      <span className={`absolute inset-y-0 ${score >= 0 ? "left-1/2 bg-emerald-500" : "right-1/2 bg-red-500"}`} style={{ width: `${w}%` }} />
    </span>
  );
}

function Reasons({ reasons }: { reasons: Reason[] }) {
  return (
    <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
      {reasons.map((r, i) => (
        <li key={i} className="flex gap-2">
          <span className={`w-9 shrink-0 text-right font-medium tabular-nums ${r.points > 0 ? "text-emerald-400" : r.points < 0 ? "text-red-400" : "text-slate-500"}`}>
            {r.points > 0 ? "+" : ""}
            {r.points}
          </span>
          <span className="text-slate-400">
            <b className="font-medium text-slate-300">{r.factor}:</b> {r.detail}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default async function AgentPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  const canTrade = can(actor.role, "trade");
  const [cfg, settings, cur] = await Promise.all([getAgentConfig(actor.id), getSettings(), getDisplayCurrency()]);
  const [runs, pending, positions, realized, tradesToday] = await Promise.all([
    prisma.agentRun.findMany({ where: { userId: actor.id }, orderBy: { startedAt: "desc" }, take: 8, include: { decisions: { orderBy: [{ score: "desc" }] } } }),
    prisma.agentDecision.findMany({ where: { userId: actor.id, status: "suggested", createdAt: { gte: hoursAgo(24) } }, orderBy: { createdAt: "desc" } }),
    agentPositions(actor.id),
    prisma.trade.aggregate({ where: { userId: actor.id, source: "AGENT", side: "SELL" }, _sum: { realizedPnl: true }, _count: true }),
    prisma.trade.count({ where: { userId: actor.id, source: "AGENT", createdAt: { gte: startOfToday() } } }),
  ]);
  const quotes = await getQuotes(positions.map((p) => p.symbol));
  const openValue = positions.reduce((a, p) => a + p.quantity * (quotes.get(p.symbol)?.priceUsd ?? p.avgCostUsd), 0);
  const unrealized = positions.reduce((a, p) => a + p.quantity * ((quotes.get(p.symbol)?.priceUsd ?? p.avgCostUsd) - p.avgCostUsd), 0);
  const realizedUsd = Number(realized._sum.realizedPnl ?? 0);
  const budget = Number(cfg.budget);
  const universe = cfg.universe.length ? cfg.universe : DEFAULT_UNIVERSE;
  const open = marketStatus().filter((m) => m.open).map((m) => m.id);
  const status = !canTrade
    ? { text: "Your role can't trade", cls: "bg-slate-500/15 text-slate-300" }
    : !settings.tradingEnabled && cfg.mode !== "DRY_RUN"
      ? { text: "Paused by admin", cls: "bg-red-500/15 text-red-400" }
      : cfg.enabled
        ? { text: `On · ${MODE_LABEL[cfg.mode]}${cfg.demoSpeed ? " · demo speed" : ""}`, cls: "bg-emerald-500/15 text-emerald-300" }
        : { text: "Off", cls: "bg-slate-500/15 text-slate-300" };
  const th = THRESHOLDS[cfg.risk];
  const m = (usd: number) => inCcy(usd, cur);

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            AI Auto-Trader <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${status.cls}`}>{status.text}</span>
          </span>
        }
        subtitle={`Watches ${universe.length} stocks (${universe.filter((s) => marketOf(s) === "US").length} US · ${universe.filter((s) => marketOf(s) === "IN").length} India), scores each one and trades within your limits. Virtual money only.`}
      >
        <RunNowButton disabled={!canTrade} />
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat label="Agent P&L" icon={Gauge} tone={realizedUsd + unrealized >= 0 ? "emerald" : "rose"} value={<span className={realizedUsd + unrealized >= 0 ? "text-emerald-300" : "text-red-300"}>{signedInCcy(realizedUsd + unrealized, cur)}</span>} sub={<span className="text-slate-500">Realized {signedInCcy(realizedUsd, cur)} · open {signedInCcy(unrealized, cur)}</span>} />
        <Stat label="Invested by agent" icon={Briefcase} tone="sky" value={m(openValue)} sub={<span className="text-slate-500">of {m(budget)} budget · {positions.length} positions</span>} />
        <Stat label="Trades today" icon={ListChecks} tone="violet" value={`${tradesToday} / ${cfg.maxTradesPerDay}`} sub={<span className="text-slate-500">{realized._count} closed all-time</span>} />
        <Stat label="Last run" icon={Activity} tone="amber" value={cfg.lastRunAt ? ago(cfg.lastRunAt) : "Never"} sub={<span className="text-slate-500">{open.length ? `${open.map((o) => (o === "US" ? "NYSE" : "NSE")).join(" + ")} open` : "Markets closed"}</span>} />
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
                  <span className="text-sm text-slate-400">at ~{d.price ? money(Number(d.price), marketOf(d.symbol) === "IN" ? "INR" : "USD") : "market"}</span>
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

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card title="Activity" subtitle={`Every run, every stock scored. Buys at score ≥ ${th.buy}, sells at ≤ ${th.sell} (${cfg.risk.toLowerCase()} risk).`} icon={Bot} tone="sky">
            {runs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-ink/15 p-6 text-center text-sm text-slate-400">
                No runs yet. Click <b className="text-slate-200">Run now</b> to scan your {universe.length} stocks, or switch the auto-trader on in settings.
              </div>
            ) : (
              <ol className="space-y-4">
                {runs.map((r) => {
                  const acted = r.decisions.filter((d) => d.action !== "HOLD");
                  const holds = r.decisions.filter((d) => d.action === "HOLD");
                  return (
                    <li key={r.id} className="rounded-xl border border-ink/10 p-4">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className={`h-2 w-2 rounded-full ${r.status === "completed" ? "bg-emerald-400" : r.status === "skipped" ? "bg-amber-400" : r.status === "failed" ? "bg-red-400" : "animate-pulse bg-sky-400"}`} />
                        <span className="font-medium">{r.trigger === "manual" ? "Manual run" : "Scheduled run"}</span>
                        <span className="text-xs text-slate-500">
                          {ago(r.startedAt)} · {MODE_LABEL[r.mode]}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-slate-300">{r.status === "running" ? "Scanning stocks and scoring them…" : r.summary}</p>
                      {r.aiNote && <p className="mt-1 text-xs text-sky-300">AI review: {r.aiNote}</p>}

                      {acted.length > 0 && (
                        <ul className="mt-3 space-y-2">
                          {acted.map((d) => (
                            <li key={d.id} className="rounded-lg bg-ink/[0.03] p-3">
                              <details>
                                <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                                  <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${d.action === "BUY" ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-400"}`}>{d.action}</span>
                                  <b>
                                    {d.quantity} {d.symbol}
                                  </b>
                                  <span className="text-xs text-slate-500">score {d.score}</span>
                                  <ScoreBar score={d.score} />
                                  <span className={`ml-auto rounded px-1.5 py-0.5 text-[11px] ${STATUS[d.status]?.cls ?? ""}`}>{STATUS[d.status]?.label ?? d.status}</span>
                                </summary>
                                {d.aiNote && <p className="mt-2 text-xs text-sky-300">AI: {d.aiNote}</p>}
                                {d.error && <p className="mt-1 text-xs text-amber-300">{d.error}</p>}
                                <Reasons reasons={d.reasons as Reason[]} />
                              </details>
                            </li>
                          ))}
                        </ul>
                      )}

                      {holds.length > 0 && (
                        <details className="mt-3">
                          <summary className="cursor-pointer text-xs text-slate-400">All {r.decisions.length} scores</summary>
                          <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                            {r.decisions.map((d) => (
                              <li key={d.id} className="flex items-center justify-between gap-3 text-xs">
                                <span className="w-28 truncate font-medium">{d.symbol}</span>
                                <ScoreBar score={d.score} />
                                <span className={`w-10 text-right tabular-nums ${d.score >= th.buy ? "text-emerald-400" : d.score <= th.sell ? "text-red-400" : "text-slate-400"}`}>{d.score}</span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>

          <Card title="Backtest" subtitle="How these settings would have done on real prices, compared with just buying and holding" icon={FlaskConical} tone="violet">
            <BacktestPanel />
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Settings" icon={Settings2} tone="emerald">
            {canTrade ? (
              <AgentSettingsForm
                cfg={{
                  enabled: cfg.enabled,
                  mode: cfg.mode,
                  risk: cfg.risk,
                  budget,
                  maxPositionPct: cfg.maxPositionPct,
                  maxTradesPerDay: cfg.maxTradesPerDay,
                  stopLossPct: Number(cfg.stopLossPct),
                  takeProfitPct: Number(cfg.takeProfitPct),
                  universe,
                  useAiReview: cfg.useAiReview,
                  dailyEmail: cfg.dailyEmail,
                  demoSpeed: cfg.demoSpeed,
                }}
              />
            ) : (
              <p className="text-sm text-slate-400">Your role can view markets but can&apos;t trade, so the auto-trader isn&apos;t available. Ask an admin to make you a Trader.</p>
            )}
          </Card>
          <Card title="How it decides" icon={ListChecks} tone="slate">
            <ol className="list-decimal space-y-1.5 pl-4 text-sm text-slate-400">
              <li>Scores every stock −100…+100 from trend, momentum (MACD), RSI and recent return.</li>
              <li>Sells first: stop-loss, take-profit, or a weak score after a 5-day minimum hold.</li>
              <li>Buys the strongest stocks in an uptrend, within your budget and per-stock limit.</li>
              <li>AI reviews each buy and can veto it (never adds or resizes).</li>
              <li>Every order goes through the normal trade checks and the admin kill switch.</li>
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
