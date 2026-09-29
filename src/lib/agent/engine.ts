import "server-only";
import { generateText, Output } from "ai";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { chatModel } from "@/lib/ai";
import { audit } from "@/lib/audit";
import { appUrl, reportEmail, sendEmail } from "@/lib/email";
import { money } from "@/lib/format";
import { getHistory, getQuote, type Quote } from "@/lib/market";
import { marketStatus } from "@/lib/market-hours";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { roleOf } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { executeOrder, TradeError } from "@/lib/trading";
import { DEFAULT_UNIVERSE, planActions, scoreStock, THRESHOLDS, type Candidate, type PlanConfig, type Position, type Risk } from "./strategy";

/**
 * The AI auto-trader. Each run scans the user's universe (24 stocks by default), scores every stock
 * with the rule engine, lets Gemini review the buy candidates, and then — depending on the mode —
 * trades (AUTO), asks the user to approve (SUGGEST) or only records what it would do (DRY_RUN).
 * All orders go through executeOrder, so every normal trading check (limits, cash, roles, kill switch) applies.
 */

export class AgentError extends Error {}

export const marketOf = (symbol: string) => (/\.(NS|BO)$/.test(symbol) ? "IN" : "US");

export async function getAgentConfig(userId: string) {
  return prisma.agentConfig.upsert({ where: { userId }, create: { userId, universe: DEFAULT_UNIVERSE }, update: {} });
}

export function planConfig(c: { risk: Risk; budget: Prisma.Decimal | number; maxPositionPct: number; maxTradesPerDay: number; stopLossPct: Prisma.Decimal | number; takeProfitPct: Prisma.Decimal | number }): PlanConfig {
  return { risk: c.risk, budgetUsd: Number(c.budget), maxPositionPct: c.maxPositionPct, maxTradesPerDay: c.maxTradesPerDay, stopLossPct: Number(c.stopLossPct), takeProfitPct: Number(c.takeProfitPct), minHoldDays: 5, trendFilter: true };
}

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/** Holdings the agent opened (net AGENT buys minus sells, capped by what the user still holds). */
export async function agentPositions(userId: string): Promise<{ symbol: string; quantity: number; avgCostUsd: number; heldDays: number }[]> {
  const [trades, holdings, lastBuys] = await Promise.all([
    prisma.trade.groupBy({ by: ["symbol", "side"], where: { userId, source: "AGENT" }, _sum: { quantity: true } }),
    prisma.holding.findMany({ where: { userId } }),
    prisma.trade.groupBy({ by: ["symbol"], where: { userId, source: "AGENT", side: "BUY" }, _max: { createdAt: true } }),
  ]);
  const boughtAt = new Map(lastBuys.map((b) => [b.symbol, b._max.createdAt]));
  const net = new Map<string, number>();
  for (const t of trades) net.set(t.symbol, (net.get(t.symbol) ?? 0) + (t.side === "BUY" ? 1 : -1) * (t._sum.quantity ?? 0));
  return holdings
    .map((h) => ({
      symbol: h.symbol,
      quantity: Math.min(h.quantity, Math.max(0, net.get(h.symbol) ?? 0)),
      avgCostUsd: Number(h.avgCost),
      heldDays: Math.floor((Date.now() - (boughtAt.get(h.symbol)?.getTime() ?? Date.now())) / 86_400_000),
    }))
    .filter((p) => p.quantity > 0);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

const reviewSchema = z.object({
  decisions: z.array(z.object({ symbol: z.string(), approve: z.boolean(), note: z.string().describe("One short sentence.") })),
  summary: z.string().describe("Two sentences on today's picks. No promises about returns."),
});

/** Gemini reviews the rule engine's buy candidates. It may veto, never add or resize. Fails open to the rules. */
async function aiReview(buys: { symbol: string; score: number; reasons: string[] }[]) {
  if (!buys.length) return { approved: new Map<string, { approve: boolean; note: string }>(), summary: null as string | null };
  try {
    const { output } = await generateText({
      model: chatModel(),
      temperature: 0,
      instructions:
        "You are the risk reviewer for an automated VIRTUAL (simulated) swing-trading agent. A rule engine proposes buys from technical signals. " +
        "Approve a buy unless the reasons are contradictory or the setup looks like chasing an overextended move. " +
        "Reply for every symbol given. Never invent numbers. Never promise returns.",
      prompt: `Proposed buys (score -100..100):\n${buys.map((b) => `${b.symbol} score ${b.score}: ${b.reasons.join("; ")}`).join("\n")}`,
      output: Output.object({ schema: reviewSchema }),
    });
    return { approved: new Map(output.decisions.map((d) => [d.symbol.toUpperCase(), { approve: d.approve, note: d.note }])), summary: output.summary };
  } catch (err) {
    console.error("agent AI review failed", err);
    return { approved: new Map<string, { approve: boolean; note: string }>(), summary: "AI review unavailable; rule engine decisions used." };
  }
}

export type RunResult = { runId: string; status: string; summary: string };

const LOCK_MS = 5 * 60_000;

/** Atomically claims the per-user run lock in the database, so the scheduler and "Run now" never overlap. */
async function claimLock(userId: string) {
  await getAgentConfig(userId);
  const r = await prisma.agentConfig.updateMany({
    where: { userId, OR: [{ runningSince: null }, { runningSince: { lt: new Date(Date.now() - LOCK_MS) } }] },
    data: { runningSince: new Date() },
  });
  return r.count === 1;
}

export async function runAgent(userId: string, trigger: "scheduled" | "manual"): Promise<RunResult> {
  if (!(await claimLock(userId))) throw new AgentError("The auto-trader is already running. Try again in a moment.");
  const cfg = await getAgentConfig(userId);
  const run = await prisma.agentRun.create({ data: { userId, trigger, mode: cfg.mode, status: "running" } });
  const finish = async (status: string, summary: string, extra: { scanned?: number; aiNote?: string | null } = {}) => {
    await prisma.agentRun.update({ where: { id: run.id }, data: { status, summary, finishedAt: new Date(), scanned: extra.scanned ?? 0, aiNote: extra.aiNote ?? null } });
    await prisma.agentConfig.update({ where: { userId }, data: { lastRunAt: new Date(), runningSince: null } });
    return { runId: run.id, status, summary };
  };

  try {
    const [settings, role] = await Promise.all([getSettings(), roleOf(userId)]);
    if (!role || !can(role, "trade")) return await finish("skipped", "Your role can't trade, so the auto-trader didn't run.");
    if (cfg.mode !== "DRY_RUN" && !settings.tradingEnabled) return await finish("skipped", "Trading is paused by an administrator (kill switch).");

    const open = new Set(marketStatus().filter((m) => m.open).map((m) => m.id));
    const ignoreHours = cfg.demoSpeed || trigger === "manual";
    const universe = (cfg.universe.length ? cfg.universe : DEFAULT_UNIVERSE).filter((s) => ignoreHours || open.has(marketOf(s)));
    if (!universe.length) return await finish("skipped", "Markets are closed for every stock in your list.");

    // 1. Data + score for every stock.
    const data = await mapLimit(universe, 6, async (symbol) => {
      try {
        const [quote, bars] = await Promise.all([getQuote(symbol), getHistory(symbol, 420)]);
        const closes = bars.map((b) => b.close);
        const today = new Date().toISOString().slice(0, 10);
        if (bars.length && bars[bars.length - 1].date !== today) closes.push(quote.price);
        else if (closes.length) closes[closes.length - 1] = quote.price;
        return { symbol, quote, score: scoreStock(symbol, closes) };
      } catch {
        return null;
      }
    });
    const scored = data.filter((d): d is { symbol: string; quote: Quote; score: ReturnType<typeof scoreStock> } => !!d);
    const candidates: Candidate[] = scored.map((d) => ({ ...d.score, priceUsd: d.quote.priceUsd }));
    const quotes = new Map(scored.map((d) => [d.symbol, d.quote]));

    // 2. Positions, cash and today's trade count.
    const [owned, user, tradesToday] = await Promise.all([
      agentPositions(userId),
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { cashBalance: true, email: true, name: true } }),
      prisma.agentDecision.count({ where: { userId, createdAt: { gte: startOfToday() }, status: { in: ["executed", "suggested", "approved"] } } }),
    ]);
    const positions: Position[] = [];
    for (const p of owned) {
      const q = quotes.get(p.symbol) ?? (await getQuote(p.symbol).catch(() => null));
      if (q) positions.push({ ...p, priceUsd: q.priceUsd });
      if (q && !quotes.has(p.symbol)) quotes.set(p.symbol, q);
    }
    const plan = planActions({ candidates, positions, cashUsd: Number(user.cashBalance), tradesToday, cfg: planConfig(cfg) });

    // 3. AI review of buys (sells from stop-loss / take-profit / signal are never vetoed).
    const buys = plan.filter((p) => p.action === "BUY");
    const review = cfg.useAiReview && settings.aiEnabled ? await aiReview(buys.map((b) => ({ symbol: b.symbol, score: b.score, reasons: b.reasons.filter((r) => r.points !== 0).map((r) => r.detail) }))) : { approved: new Map(), summary: null };

    // 4. Act.
    let executed = 0;
    let suggested = 0;
    let vetoed = 0;
    const acted = new Set<string>();
    for (const a of plan) {
      acted.add(a.symbol);
      const q = quotes.get(a.symbol);
      const ai = a.action === "BUY" ? review.approved.get(a.symbol) : undefined;
      const base = { runId: run.id, userId, symbol: a.symbol, action: a.action, quantity: a.quantity, price: q ? new Prisma.Decimal(q.price.toFixed(4)) : null, score: a.score, confidence: a.confidence, reasons: a.reasons as unknown as Prisma.InputJsonValue, aiNote: ai?.note ?? (a.trigger !== "signal" ? `Automatic ${a.trigger.replace("_", "-")}.` : null) };
      if (ai && !ai.approve) {
        vetoed++;
        await prisma.agentDecision.create({ data: { ...base, status: "skipped", error: "Vetoed by AI review." } });
        continue;
      }
      if (cfg.mode === "DRY_RUN") {
        await prisma.agentDecision.create({ data: { ...base, status: "dry_run" } });
        continue;
      }
      if (cfg.mode === "SUGGEST") {
        const d = await prisma.agentDecision.create({ data: { ...base, status: "suggested" } });
        await prisma.notification.create({ data: { userId, kind: "agent_suggestion", title: `Auto-trader suggests: ${a.action === "BUY" ? "Buy" : "Sell"} ${a.quantity} ${a.symbol}`, body: `Score ${a.score} · ${a.reasons[0]?.detail ?? ""}`, link: `/agent#d-${d.id}` } });
        suggested++;
        continue;
      }
      if (a.action === "BUY") {
        const recent = await prisma.trade.count({ where: { userId, symbol: a.symbol, source: "AGENT", side: "BUY", createdAt: { gte: new Date(Date.now() - 30 * 60_000) } } });
        if (recent) {
          await prisma.agentDecision.create({ data: { ...base, status: "skipped", error: "Already bought by the agent in the last 30 minutes." } });
          continue;
        }
      }
      try {
        const t = await executeOrder(userId, { symbol: a.symbol, side: a.action, quantity: a.quantity }, "AGENT");
        await prisma.agentDecision.create({ data: { ...base, status: "executed", tradeId: t.tradeId } });
        await prisma.notification.create({ data: { userId, kind: "agent_trade", title: `Auto-trader ${a.action === "BUY" ? "bought" : "sold"} ${a.quantity} ${a.symbol}`, body: `${q ? money(q.price, q.currency) : ""} · ${a.trigger === "signal" ? `score ${a.score}` : a.trigger.replace("_", "-")}`, link: "/agent" } });
        executed++;
      } catch (err) {
        await prisma.agentDecision.create({ data: { ...base, status: "failed", error: err instanceof TradeError ? err.message : "Order failed." } });
      }
    }
    // HOLD rows so the activity feed shows every stock scanned and its score.
    const holds = candidates.filter((c) => !acted.has(c.symbol));
    if (holds.length)
      await prisma.agentDecision.createMany({
        data: holds.map((c) => ({ runId: run.id, userId, symbol: c.symbol, action: "HOLD", quantity: 0, price: quotes.get(c.symbol) ? new Prisma.Decimal(quotes.get(c.symbol)!.price.toFixed(4)) : null, score: c.score, confidence: c.confidence, reasons: c.reasons as unknown as Prisma.InputJsonValue, status: "hold" })),
      });

    const parts = [`Scanned ${candidates.length} stocks`];
    if (cfg.mode === "AUTO") parts.push(`${executed} trade${executed === 1 ? "" : "s"} placed`);
    if (cfg.mode === "SUGGEST") parts.push(`${suggested} suggestion${suggested === 1 ? "" : "s"} waiting for approval`);
    if (cfg.mode === "DRY_RUN") parts.push(`${plan.length - vetoed} trade${plan.length - vetoed === 1 ? "" : "s"} it would place (dry run)`);
    if (vetoed) parts.push(`${vetoed} vetoed by AI review`);
    if (!plan.length) parts.push(`no stock crossed the buy (${THRESHOLDS[cfg.risk].buy}) or sell (${THRESHOLDS[cfg.risk].sell}) level`);
    const summary = parts.join(" · ") + ".";
    await audit(userId, "agent_run", { trigger, mode: cfg.mode, scanned: candidates.length, executed, suggested, vetoed });
    return await finish("completed", summary, { scanned: candidates.length, aiNote: review.summary });
  } catch (err) {
    console.error("agent run failed", err);
    return await finish("failed", err instanceof Error ? err.message.slice(0, 300) : "Run failed.");
  } finally {
    await prisma.agentConfig.updateMany({ where: { userId }, data: { runningSince: null } }).catch(() => {});
  }
}

/** Executes a suggestion the user approved (re-checked against current cash, limits and roles). */
export async function approveDecision(userId: string, id: string) {
  const d = await prisma.agentDecision.findFirst({ where: { id, userId, status: "suggested" } });
  if (!d) throw new AgentError("This suggestion is no longer pending.");
  if (Date.now() - d.createdAt.getTime() > 24 * 3600_000) {
    await prisma.agentDecision.update({ where: { id }, data: { status: "rejected", error: "Expired after 24 hours." } });
    throw new AgentError("This suggestion expired. The next run will make a fresh one.");
  }
  try {
    const t = await executeOrder(userId, { symbol: d.symbol, side: d.action as "BUY" | "SELL", quantity: d.quantity }, "AGENT");
    await prisma.agentDecision.update({ where: { id }, data: { status: "approved", tradeId: t.tradeId } });
    return t;
  } catch (err) {
    const msg = err instanceof TradeError ? err.message : "Order failed.";
    await prisma.agentDecision.update({ where: { id }, data: { status: "failed", error: msg } });
    throw new AgentError(msg);
  }
}

export async function rejectDecision(userId: string, id: string) {
  const r = await prisma.agentDecision.updateMany({ where: { id, userId, status: "suggested" }, data: { status: "rejected" } });
  if (!r.count) throw new AgentError("This suggestion is no longer pending.");
}

// ---------- Scheduler (called every minute from instrumentation.ts) ----------

let ticking = false;

export async function runDueAgents() {
  if (ticking) return;
  ticking = true;
  try {
    const anyOpen = marketStatus().some((m) => m.open);
    const configs = await prisma.agentConfig.findMany({ where: { enabled: true, runningSince: null }, select: { userId: true, demoSpeed: true, lastRunAt: true } });
    for (const c of configs) {
      const since = c.lastRunAt ? Date.now() - c.lastRunAt.getTime() : Infinity;
      // lastRunAt is set when a run finishes, so allow for run time plus tick jitter.
      const due = c.demoSpeed ? since >= 40_000 : anyOpen && since >= 4.5 * 60_000;
      if (due) await runAgent(c.userId, "scheduled").catch((err) => !(err instanceof AgentError) && console.error("scheduled agent run failed", err));
    }
    await sendDailySummaries();
  } finally {
    ticking = false;
  }
}

/** One email per user per day (after 8 pm server time) listing the agent's trades and suggestions. */
async function sendDailySummaries() {
  const now = new Date();
  if (now.getHours() < 20) return;
  const today = now.toLocaleDateString("en-CA");
  const configs = await prisma.agentConfig.findMany({ where: { enabled: true, dailyEmail: true, OR: [{ lastSummaryDate: null }, { lastSummaryDate: { not: today } }] }, include: { user: { select: { email: true, name: true } } } });
  for (const c of configs) {
    await prisma.agentConfig.update({ where: { userId: c.userId }, data: { lastSummaryDate: today } });
    const decisions = await prisma.agentDecision.findMany({ where: { userId: c.userId, createdAt: { gte: startOfToday() }, status: { in: ["executed", "approved", "suggested", "dry_run"] } }, orderBy: { createdAt: "asc" } });
    const runs = await prisma.agentRun.count({ where: { userId: c.userId, startedAt: { gte: startOfToday() } } });
    if (!decisions.length && !runs) continue;
    const label: Record<string, string> = { executed: "Placed", approved: "Approved", suggested: "Waiting", dry_run: "Dry run" };
    const mail = reportEmail({
      name: c.user.name,
      eyebrow: "AI auto-trader · daily summary",
      title: decisions.length ? `${decisions.length} trade${decisions.length === 1 ? "" : "s"} today` : "No trades today",
      intro: decisions.length ? `here's what your auto-trader did today.` : `your auto-trader ran ${runs} time${runs === 1 ? "" : "s"} today and found no stock worth trading under your rules.`,
      stats: [
        { label: "Runs", value: String(runs) },
        { label: "Mode", value: c.mode === "AUTO" ? "Auto" : c.mode === "SUGGEST" ? "Suggest" : "Dry run" },
        { label: "Risk", value: c.risk[0] + c.risk.slice(1).toLowerCase() },
      ],
      table: decisions.length
        ? {
            columns: [{ label: "Stock" }, { label: "Action" }, { label: "Shares", align: "right" }, { label: "Score", align: "right" }, { label: "Status", align: "right" }],
            rows: decisions.map((d) => ({ cells: [d.symbol, d.action, String(d.quantity), String(d.score), label[d.status] ?? d.status], tone: [null, d.action === "BUY" ? "up" : "down", null, null, null] })),
          }
        : undefined,
      highlights: decisions.slice(0, 3).map((d) => `${d.action} ${d.symbol}: ${((d.reasons as { detail: string }[])[0]?.detail ?? "").slice(0, 140)}`),
      button: { label: "Open auto-trader", href: `${appUrl()}/agent` },
      asOf: now,
    });
    await sendEmail({ to: c.user.email, kind: "agent_daily_summary", userId: c.userId, ...mail });
  }
}
