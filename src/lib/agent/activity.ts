import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { getQuotes } from "@/lib/market";
import { marketOfSymbol } from "@/lib/market-hours";
import { prisma } from "@/lib/prisma";
import { agentPositions } from "./engine";
import { TRIGGER_LABEL } from "./rules";
import { trailingStopLevel, type Reason } from "./strategy";

/** Read models for the Auto-Trader dashboard, its server actions and the AI assistant. */

export const ACTIVITY_FILTERS = ["all", "buy", "sell", "hold", "errors"] as const;
export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number];

const ERROR_STATUSES = ["failed", "blocked", "market_closed"];

function filterWhere(userId: string, filter: ActivityFilter): Prisma.AgentDecisionWhereInput {
  switch (filter) {
    case "buy":
      return { userId, action: "BUY" };
    case "sell":
      return { userId, action: "SELL" };
    case "hold":
      return { userId, action: "HOLD", status: "hold" };
    case "errors":
      return { userId, OR: [{ status: { in: ERROR_STATUSES } }, { status: "skipped" }] };
    default:
      return { userId };
  }
}

export type ActivityItem = {
  id: string;
  runId: string;
  at: string;
  symbol: string;
  market: string;
  action: string;
  quantity: number;
  price: number | null;
  currency: string;
  score: number;
  confidence: number;
  status: string;
  trigger: string | null;
  reason: string;
  aiStatus: string | null;
  aiNote: string | null;
  error: string | null;
  entryPriceUsd: number | null;
  exitPriceUsd: number | null;
  realizedPnl: number | null;
  realizedPnlPct: number | null;
  reasons: Reason[];
};

const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));

/** The one-line reason shown for a decision. */
export function decisionReason(d: { action: string; status: string; score: number; trigger: string | null; error: string | null; reasons: Prisma.JsonValue }) {
  const reasons = (d.reasons ?? []) as Reason[];
  if (d.action === "HOLD") return reasons.find((r) => r.factor === "Decision")?.detail ?? d.error ?? "No action.";
  if (d.action === "SELL" && d.trigger && d.trigger !== "signal") return `${TRIGGER_LABEL[d.trigger] ?? d.trigger}: ${reasons[0]?.detail ?? ""}`.trim();
  const top = reasons.filter((r) => r.points > 0).sort((a, b) => b.points - a.points).slice(0, 2).map((r) => r.factor.toLowerCase());
  return d.action === "BUY" ? `Strategy score ${d.score}${top.length ? ` + ${top.join(" + ")}` : ""}` : reasons[0]?.detail ?? "Strategy sell signal.";
}

export async function listDecisions(userId: string, filter: ActivityFilter = "all", take = 60, runId?: string): Promise<ActivityItem[]> {
  const rows = await prisma.agentDecision.findMany({ where: { ...filterWhere(userId, filter), ...(runId ? { runId } : {}) }, orderBy: { createdAt: "desc" }, take: Math.min(take, 200) });
  return rows.map((d) => ({
    id: d.id,
    runId: d.runId,
    at: d.createdAt.toISOString(),
    symbol: d.symbol,
    market: d.market ?? marketOfSymbol(d.symbol),
    action: d.action,
    quantity: d.quantity,
    price: num(d.price),
    currency: (d.market ?? marketOfSymbol(d.symbol)) === "IN" ? "INR" : "USD",
    score: d.score,
    confidence: d.confidence,
    status: d.status,
    trigger: d.trigger,
    reason: decisionReason(d),
    aiStatus: d.aiStatus,
    aiNote: d.aiNote,
    error: d.error,
    entryPriceUsd: num(d.entryPriceUsd),
    exitPriceUsd: d.action === "SELL" ? num(d.priceUsd) : null,
    realizedPnl: num(d.realizedPnl),
    realizedPnlPct: num(d.realizedPnlPct),
    reasons: (d.reasons ?? []) as Reason[],
  }));
}

/** Automatic (and approved) trades with their full context. Survives after the position is closed. */
export async function listAutoTrades(userId: string, take = 30) {
  const rows = await prisma.agentDecision.findMany({ where: { userId, status: { in: ["executed", "approved"] } }, orderBy: { createdAt: "desc" }, take: Math.min(take, 200) });
  const trades = await prisma.trade.findMany({ where: { id: { in: rows.map((r) => r.tradeId).filter((x): x is string => !!x) } } });
  const byId = new Map(trades.map((t) => [t.id, t]));
  return rows.map((d) => {
    const t = d.tradeId ? byId.get(d.tradeId) : undefined;
    return {
      id: d.id,
      tradeId: d.tradeId,
      at: (t?.createdAt ?? d.createdAt).toISOString(),
      symbol: d.symbol,
      side: d.action as "BUY" | "SELL",
      quantity: d.quantity,
      priceUsd: t ? Number(t.price) : num(d.priceUsd),
      price: num(d.price),
      currency: (d.market ?? marketOfSymbol(d.symbol)) === "IN" ? "INR" : "USD",
      score: d.score,
      trigger: d.trigger,
      reason: decisionReason(d),
      aiStatus: d.aiStatus,
      approved: d.status === "approved",
      entryPriceUsd: num(d.entryPriceUsd),
      realizedPnl: num(d.realizedPnl) ?? (t?.realizedPnl ? Number(t.realizedPnl) : null),
      realizedPnlPct: num(d.realizedPnlPct),
    };
  });
}

export type OpenPosition = {
  symbol: string;
  market: string;
  quantity: number;
  avgCostUsd: number;
  priceUsd: number | null;
  valueUsd: number;
  pnlUsd: number | null;
  pnlPct: number | null;
  highWaterUsd: number | null;
  maxLossPriceUsd: number;
  targetPriceUsd: number | null;
  trailingStopUsd: number | null;
  openedAt: string | null;
  heldDays: number;
};

export async function openPositions(userId: string, cfg: { stopLossPct: Prisma.Decimal | number; takeProfitPct: Prisma.Decimal | number; trailingStopEnabled: boolean; trailingStopPct: Prisma.Decimal | number }): Promise<OpenPosition[]> {
  const positions = await agentPositions(userId);
  const quotes = await getQuotes(positions.map((p) => p.symbol));
  const sl = Number(cfg.stopLossPct);
  const tp = Number(cfg.takeProfitPct);
  const trail = cfg.trailingStopEnabled ? Number(cfg.trailingStopPct) : null;
  return positions.map((p) => {
    const price = quotes.get(p.symbol)?.priceUsd ?? null;
    const hw = Math.max(p.highWaterUsd ?? p.avgCostUsd, price ?? 0);
    return {
      symbol: p.symbol,
      market: marketOfSymbol(p.symbol),
      quantity: p.quantity,
      avgCostUsd: p.avgCostUsd,
      priceUsd: price,
      valueUsd: p.quantity * (price ?? p.avgCostUsd),
      pnlUsd: price === null ? null : (price - p.avgCostUsd) * p.quantity,
      pnlPct: price === null ? null : ((price - p.avgCostUsd) / p.avgCostUsd) * 100,
      highWaterUsd: hw,
      maxLossPriceUsd: p.avgCostUsd * (1 - sl / 100),
      targetPriceUsd: tp > 0 ? p.avgCostUsd * (1 + tp / 100) : null,
      trailingStopUsd: trail ? trailingStopLevel({ symbol: p.symbol, quantity: p.quantity, avgCostUsd: p.avgCostUsd, priceUsd: price ?? p.avgCostUsd, highWaterUsd: hw }, trail) : null,
      openedAt: p.openedAt?.toISOString() ?? null,
      heldDays: p.heldDays,
    };
  });
}

const startOfToday = () => new Date(new Date().setHours(0, 0, 0, 0));

/** Headline numbers for the dashboard. */
export async function dashboardStats(userId: string) {
  const since = startOfToday();
  const [today, allTime, lastRun, errorsToday] = await Promise.all([
    prisma.agentDecision.groupBy({ by: ["action"], where: { userId, createdAt: { gte: since }, status: { in: ["executed", "approved"] } }, _count: true, _sum: { realizedPnl: true } }),
    prisma.agentDecision.aggregate({ where: { userId, status: { in: ["executed", "approved"] } }, _count: true, _sum: { realizedPnl: true } }),
    prisma.agentRun.findFirst({ where: { userId }, orderBy: { startedAt: "desc" } }),
    prisma.agentDecision.count({ where: { userId, createdAt: { gte: since }, status: { in: ERROR_STATUSES } } }),
  ]);
  const buy = today.find((t) => t.action === "BUY");
  const sell = today.find((t) => t.action === "SELL");
  return {
    buysToday: buy?._count ?? 0,
    sellsToday: sell?._count ?? 0,
    realizedTodayUsd: Number(sell?._sum.realizedPnl ?? 0),
    totalTrades: allTime._count,
    realizedAllTimeUsd: Number(allTime._sum.realizedPnl ?? 0),
    errorsToday,
    lastRun: lastRun ? { at: lastRun.startedAt.toISOString(), status: lastRun.status, summary: lastRun.summary } : null,
  };
}

export async function agentNotifications(userId: string, take = 10) {
  const rows = await prisma.notification.findMany({ where: { userId, kind: { startsWith: "agent_" } }, orderBy: { createdAt: "desc" }, take });
  return rows.map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link, read: !!n.readAt, at: n.createdAt.toISOString() }));
}

/** Read-only summary of the auto-trader for the AI assistant. */
export async function getAgentActivity(userId: string, runs = 3) {
  const cfg = await prisma.agentConfig.findUnique({ where: { userId } });
  if (!cfg) return { configured: false, note: "The auto-trader hasn't been set up yet. It's on the Auto-Trader page (/agent)." };
  const recent = await prisma.agentRun.findMany({
    where: { userId },
    orderBy: { startedAt: "desc" },
    take: runs,
    include: { decisions: { where: { action: { not: "HOLD" } }, orderBy: { score: "desc" } } },
  });
  return {
    configured: true,
    note: "Paper trading only (virtual money). Profit targets and loss limits are risk rules, not guaranteed returns.",
    settings: {
      enabled: cfg.enabled,
      mode: cfg.mode,
      risk: cfg.risk,
      budgetUsd: Number(cfg.budget),
      maxPositionPct: cfg.maxPositionPct,
      maxTradesPerDay: cfg.maxTradesPerDay,
      maxLossPct: Number(cfg.stopLossPct),
      profitTargetPct: Number(cfg.takeProfitPct),
      trailingStopPct: cfg.trailingStopEnabled ? Number(cfg.trailingStopPct) : null,
      selectedStocks: cfg.universe,
      aiReview: cfg.useAiReview,
      marketHoursOnly: cfg.marketHoursOnly,
      lastRunAt: cfg.lastRunAt?.toISOString() ?? null,
    },
    runs: recent.map((r) => ({
      at: r.startedAt.toISOString(),
      trigger: r.trigger,
      status: r.status,
      summary: r.summary,
      aiReview: r.aiNote,
      decisions: r.decisions.map((d) => ({
        symbol: d.symbol,
        action: d.action,
        quantity: d.quantity,
        score: d.score,
        status: d.status,
        trigger: d.trigger,
        aiNote: d.aiNote,
        error: d.error,
        realizedPnlUsd: d.realizedPnl === null ? null : Number(d.realizedPnl),
        reasons: (d.reasons as Reason[]).filter((x) => x.points !== 0).map((x) => `${x.factor} (${x.points > 0 ? "+" : ""}${x.points}): ${x.detail}`),
      })),
    })),
  };
}
