import "server-only";
import { prisma } from "@/lib/prisma";
import { getQuotes } from "@/lib/market";

const DAY = 86_400_000;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
function lastDays(n: number) {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(dayKey(new Date(Date.now() - i * DAY)));
  return out;
}

// ---------- Users ----------

export type AdminUser = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  role: string;
  suspended: boolean;
  cash: number;
  portfolioValue: number;
  returnPct: number;
  trades: number;
  lastLoginAt: string | null;
  createdAt: string;
};

export async function listUsers(): Promise<AdminUser[]> {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    include: { holdings: true, _count: { select: { trades: true } } },
  });
  const quotes = await getQuotes([...new Set(users.flatMap((u) => u.holdings.map((h) => h.symbol)))]);
  return users.map((u) => {
    const invested = u.holdings.reduce((a, h) => a + h.quantity * (quotes.get(h.symbol)?.priceUsd ?? Number(h.avgCost)), 0);
    const value = Number(u.cashBalance) + invested;
    const start = Number(u.startingCash) || 100_000;
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      image: u.image,
      role: u.role,
      suspended: u.suspended,
      cash: Number(u.cashBalance),
      portfolioValue: Number(value.toFixed(2)),
      returnPct: Number((((value - start) / start) * 100).toFixed(2)),
      trades: u._count.trades,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
    };
  });
}

export async function listAssignments() {
  const rows = await prisma.roleAssignment.findMany({ orderBy: { updatedAt: "desc" } });
  const joined = new Set((await prisma.user.findMany({ where: { email: { in: rows.map((r) => r.email) } }, select: { email: true } })).map((u) => u.email.toLowerCase()));
  return rows.map((r) => ({ email: r.email, role: r.role, note: r.note, joined: joined.has(r.email), updatedAt: r.updatedAt.toISOString() }));
}

// ---------- Guardrails ----------

export const GUARDRAIL_TYPES = ["prompt_injection", "off_topic", "harmful", "rate_limited", "too_long"] as const;

export async function guardrailStats(days = 14) {
  const since = new Date(Date.now() - (days - 1) * DAY);
  since.setUTCHours(0, 0, 0, 0);
  const events = await prisma.auditLog.findMany({
    where: { createdAt: { gte: since }, event: { in: ["input_blocked", "rate_limited", "approval_forged", "output_filtered", "trade_denied"] } },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { email: true } } },
  });
  const reasonOf = (e: (typeof events)[number]) => {
    const d = (e.detail ?? {}) as Record<string, unknown>;
    return e.event === "rate_limited" ? "rate_limited" : String(d.reason ?? e.event);
  };
  const blocked = events.filter((e) => e.event === "input_blocked" || e.event === "rate_limited");
  const series = lastDays(days).map((date) => {
    const row: Record<string, number | string> = { date };
    GUARDRAIL_TYPES.forEach((t) => (row[t] = 0));
    return row;
  });
  const byDate = new Map(series.map((r) => [r.date as string, r]));
  for (const e of blocked) {
    const row = byDate.get(dayKey(e.createdAt));
    const reason = reasonOf(e);
    if (row && reason in row) (row[reason] as number)++;
  }
  const totals = Object.fromEntries(GUARDRAIL_TYPES.map((t) => [t, blocked.filter((e) => reasonOf(e) === t).length])) as Record<(typeof GUARDRAIL_TYPES)[number], number>;
  return {
    series,
    totals,
    blockedTotal: blocked.length,
    forged: events.filter((e) => e.event === "approval_forged").length,
    outputRewrites: events.filter((e) => e.event === "output_filtered").reduce((a, e) => a + Number(((e.detail ?? {}) as { rewrites?: number }).rewrites ?? 1), 0),
    tradesDenied: events.filter((e) => e.event === "trade_denied").length,
    recent: events.slice(0, 25).map((e) => {
      const d = (e.detail ?? {}) as Record<string, unknown>;
      return {
        id: e.id,
        at: e.createdAt.toISOString(),
        email: e.user?.email ?? "deleted user",
        event: e.event,
        reason: reasonOf(e),
        text: typeof d.text === "string" ? d.text : typeof d.error === "string" ? d.error : null,
        layer: typeof d.layer === "string" ? d.layer : null,
      };
    }),
  };
}

// ---------- Trading activity ----------

export async function tradingStats(days = 14) {
  const since = new Date(Date.now() - (days - 1) * DAY);
  since.setUTCHours(0, 0, 0, 0);
  const [recent, windowTrades, allAgg] = await Promise.all([
    prisma.trade.findMany({ orderBy: { createdAt: "desc" }, take: 30, include: { user: { select: { email: true, name: true } } } }),
    prisma.trade.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true, total: true, side: true, symbol: true } }),
    prisma.trade.aggregate({ _sum: { total: true }, _count: true }),
  ]);
  const series = lastDays(days).map((date) => ({ date, buy: 0, sell: 0 }));
  const byDate = new Map(series.map((r) => [r.date, r]));
  for (const t of windowTrades) {
    const row = byDate.get(dayKey(t.createdAt));
    if (row) row[t.side === "BUY" ? "buy" : "sell"] += Number(t.total);
  }
  const bySymbol = await prisma.trade.groupBy({ by: ["symbol"], _count: { _all: true }, _sum: { total: true }, orderBy: { _sum: { total: "desc" } }, take: 8 });
  const traders = await prisma.trade.groupBy({ by: ["userId"], _count: { _all: true } });
  return {
    series: series.map((r) => ({ ...r, buy: Math.round(r.buy), sell: Math.round(r.sell) })),
    totalVolume: Number(allAgg._sum.total ?? 0),
    totalTrades: allAgg._count,
    activeTraders: traders.length,
    topSymbols: bySymbol.map((b) => ({ symbol: b.symbol, trades: b._count._all, volume: Math.round(Number(b._sum.total ?? 0)) })),
    recent: recent.map((t) => ({
      id: t.id,
      at: t.createdAt.toISOString(),
      user: t.user.name ?? t.user.email,
      email: t.user.email,
      symbol: t.symbol,
      side: t.side,
      quantity: t.quantity,
      price: Number(t.price),
      total: Number(t.total),
      source: t.source,
    })),
  };
}

// ---------- AI usage ----------

export async function aiUsageStats(days = 14) {
  const since = new Date(Date.now() - (days - 1) * DAY);
  since.setUTCHours(0, 0, 0, 0);
  const events = await prisma.auditLog.findMany({
    where: { createdAt: { gte: since }, event: { in: ["chat_message", "portfolio_review"] } },
    select: { event: true, createdAt: true, userId: true, user: { select: { email: true, name: true } } },
  });
  const series = lastDays(days).map((date) => ({ date, chats: 0, reviews: 0 }));
  const byDate = new Map(series.map((r) => [r.date, r]));
  const today = dayKey(new Date());
  const perUser = new Map<string, { user: string; email: string; today: number; week: number; total: number; reviews: number }>();
  const weekAgo = Date.now() - 7 * DAY;
  for (const e of events) {
    const row = byDate.get(dayKey(e.createdAt));
    if (row) row[e.event === "chat_message" ? "chats" : "reviews"]++;
    if (!e.userId) continue;
    const u = perUser.get(e.userId) ?? { user: e.user?.name ?? e.user?.email ?? "?", email: e.user?.email ?? "", today: 0, week: 0, total: 0, reviews: 0 };
    if (e.event === "chat_message") {
      u.total++;
      if (dayKey(e.createdAt) === today) u.today++;
      if (e.createdAt.getTime() >= weekAgo) u.week++;
    } else u.reviews++;
    perUser.set(e.userId, u);
  }
  return {
    series,
    chats: events.filter((e) => e.event === "chat_message").length,
    reviews: events.filter((e) => e.event === "portfolio_review").length,
    perUser: [...perUser.values()].sort((a, b) => b.total - a.total),
  };
}
