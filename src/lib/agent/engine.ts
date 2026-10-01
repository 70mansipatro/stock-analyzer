import "server-only";
import { generateText, Output } from "ai";
import { z } from "zod";
import { Prisma, type AgentConfig } from "@/generated/prisma/client";
import { chatModel } from "@/lib/ai";
import { audit } from "@/lib/audit";
import { getHistory, getQuote, type Quote } from "@/lib/market";
import { getMarketSession, marketOfSymbol, type MarketId, type MarketSession } from "@/lib/market-hours";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { roleOf } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { executeOrder, TradeError, type ExecutedTrade } from "@/lib/trading";
import { notifyAgentEvent, notifyAgentError, sendDailySummaries, sendTradeNotifications } from "./notifications";
import { aiVerdict, idempotencyKey, isDue, marketGate, realized, type AiReview, type AiStatus } from "./rules";
import { holdReason, planActionsDetailed, scoreStock, THRESHOLDS, type Candidate, type PlanConfig, type PlannedAction, type Position, type Reason, type Risk } from "./strategy";

/**
 * The AI auto-trader (virtual money only). Each run scans the user's selected stocks, scores every one
 * with the rule engine (strategy.ts), applies the exit rules and limits, lets Gemini review the buys, and
 * then — depending on the mode — trades by itself (FULL_AUTO), asks the user to approve (SUGGEST) or only
 * records what it would do (DRY_RUN). Every order goes through executeOrder, so all the normal trading
 * checks (role, suspension, kill switch, per-order limits, cash, holdings) still apply.
 *
 * Flow: scheduler → lock → permission → stocks → market hours → quotes + history → score → exit rules →
 * limits → AI review (buys) → idempotent order → trade + decision + position in one transaction → audit →
 * notifications (in-app, email, message; failures never undo a trade) → unlock.
 */

export class AgentError extends Error {}

/** @deprecated use marketOfSymbol from market-hours */
export const marketOf = marketOfSymbol;

/**
 * The user's Auto-Trader config. A new config starts with no stocks: the scan universe is exactly
 * AgentConfig.universe for this user, as the user selected it. There is no default or fallback list.
 */
export async function getAgentConfig(userId: string) {
  return prisma.agentConfig.upsert({ where: { userId }, create: { userId, universe: [] }, update: {} });
}

type ConfigNumbers = { risk: Risk; budget: Prisma.Decimal | number; maxPositionPct: number; maxTradesPerDay: number; stopLossPct: Prisma.Decimal | number; takeProfitPct: Prisma.Decimal | number; trailingStopEnabled?: boolean; trailingStopPct?: Prisma.Decimal | number };

export function planConfig(c: ConfigNumbers): PlanConfig {
  return {
    risk: c.risk,
    budgetUsd: Number(c.budget),
    maxPositionPct: c.maxPositionPct,
    maxTradesPerDay: c.maxTradesPerDay,
    stopLossPct: Number(c.stopLossPct),
    takeProfitPct: Number(c.takeProfitPct),
    trailingStopPct: c.trailingStopEnabled ? Number(c.trailingStopPct) : null,
    minHoldDays: 5,
    trendFilter: true,
  };
}

/** The risk settings in force, stored with every decision for the audit trail. */
export function riskSnapshot(c: AgentConfig) {
  return {
    mode: c.mode,
    risk: c.risk,
    budgetUsd: Number(c.budget),
    maxPositionPct: c.maxPositionPct,
    maxTradesPerDay: c.maxTradesPerDay,
    profitTargetPct: Number(c.takeProfitPct),
    maxLossPct: Number(c.stopLossPct),
    trailingStopPct: c.trailingStopEnabled ? Number(c.trailingStopPct) : null,
    aiReview: c.useAiReview,
    marketHoursOnly: c.marketHoursOnly,
    demoSpeed: c.demoSpeed,
  };
}

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
const today = () => new Date().toISOString().slice(0, 10);

export type AgentHolding = { symbol: string; quantity: number; avgCostUsd: number; heldDays: number; highWaterUsd: number | null; positionId: string | null; openedAt: Date | null };

/** Holdings the agent opened (net AGENT buys minus sells, capped by what the user still holds). */
export async function agentPositions(userId: string): Promise<AgentHolding[]> {
  const [trades, holdings, lastBuys, tracked] = await Promise.all([
    prisma.trade.groupBy({ by: ["symbol", "side"], where: { userId, source: "AGENT" }, _sum: { quantity: true } }),
    prisma.holding.findMany({ where: { userId } }),
    prisma.trade.groupBy({ by: ["symbol"], where: { userId, source: "AGENT", side: "BUY" }, _max: { createdAt: true } }),
    prisma.agentPosition.findMany({ where: { userId } }),
  ]);
  const boughtAt = new Map(lastBuys.map((b) => [b.symbol, b._max.createdAt]));
  const meta = new Map(tracked.map((t) => [t.symbol, t]));
  const net = new Map<string, number>();
  for (const t of trades) net.set(t.symbol, (net.get(t.symbol) ?? 0) + (t.side === "BUY" ? 1 : -1) * (t._sum.quantity ?? 0));
  return holdings
    .map((h) => {
      const m = meta.get(h.symbol);
      const opened = m?.openedAt ?? boughtAt.get(h.symbol) ?? null;
      return {
        symbol: h.symbol,
        quantity: Math.min(h.quantity, Math.max(0, net.get(h.symbol) ?? 0)),
        avgCostUsd: Number(h.avgCost),
        heldDays: Math.floor((Date.now() - (opened?.getTime() ?? Date.now())) / 86_400_000),
        highWaterUsd: m ? Number(m.highWaterUsd) : null,
        positionId: m?.id ?? null,
        openedAt: opened,
      };
    })
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

/** Gemini reviews the rule engine's buy candidates. It may veto, never add, resize or block a sell. Fails open to the rules. */
async function aiReview(buys: { symbol: string; score: number; reasons: string[] }[]): Promise<AiReview> {
  if (!buys.length) return { available: true, decisions: new Map(), summary: null };
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
    return { available: true, decisions: new Map(output.decisions.map((d) => [d.symbol.toUpperCase(), { approve: d.approve, note: d.note }])), summary: output.summary };
  } catch (err) {
    console.error("agent AI review failed", err);
    return { available: false, decisions: new Map(), summary: "AI review unavailable; rule engine decisions used." };
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

type DecisionBase = {
  runId: string;
  userId: string;
  symbol: string;
  market: MarketId;
  action: "BUY" | "SELL" | "HOLD";
  quantity: number;
  price: Prisma.Decimal | null;
  priceUsd: Prisma.Decimal | null;
  score: number;
  confidence: number;
  reasons: Prisma.InputJsonValue;
  trigger: string | null;
  aiNote: string | null;
  aiStatus: AiStatus | null;
  settings: Prisma.InputJsonValue;
};

/** Writes one decision row and, for anything other than a HOLD, an audit entry with the full context. */
async function recordAutoTraderDecision(base: DecisionBase, outcome: { status: string; error?: string | null; tradeId?: string | null }) {
  const d = await prisma.agentDecision.create({ data: { ...base, status: outcome.status, error: outcome.error ?? null, tradeId: outcome.tradeId ?? null } });
  if (base.action !== "HOLD") {
    await audit(base.userId, "agent_decision", {
      decisionId: d.id,
      runId: base.runId,
      symbol: base.symbol,
      action: base.action,
      quantity: base.quantity,
      price: base.price?.toString() ?? null,
      score: base.score,
      trigger: base.trigger,
      ai: base.aiStatus,
      aiNote: base.aiNote,
      reason: (base.reasons as Reason[])[0]?.detail ?? null,
      result: outcome.status,
      error: outcome.error ?? null,
      settings: base.settings,
    });
  }
  return d;
}

/**
 * Places one automatic order exactly once. A decision row carrying the idempotency key is claimed
 * first (a duplicate signal hits the unique index and is skipped); the trade, the decision update and
 * the agent position are then committed in one transaction. A failed order releases the key.
 */
async function executeAutoTrade(base: DecisionBase, o: { key: string; positionId: string | null }): Promise<{ status: "executed"; trade: ExecutedTrade; decisionId: string; pnl: number | null; pnlPct: number | null } | { status: "duplicate" | "failed"; error: string; decisionId: string | null }> {
  let decisionId: string;
  try {
    decisionId = (await prisma.agentDecision.create({ data: { ...base, status: "executing", idempotencyKey: o.key } })).id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const msg = base.action === "BUY" ? "Duplicate signal: the agent already bought this stock today." : "Duplicate signal: this position was already sold.";
      const d = await recordAutoTraderDecision(base, { status: "skipped", error: msg });
      return { status: "duplicate", error: msg, decisionId: d.id };
    }
    throw err;
  }
  let pnl: number | null = null;
  let pnlPct: number | null = null;
  try {
    const trade = await executeOrder(base.userId, { symbol: base.symbol, side: base.action as "BUY" | "SELL", quantity: base.quantity }, "AGENT", {
      inTransaction: async (tx, t) => {
        if (base.action === "SELL" && t.entryPrice !== null) ({ pnl, pct: pnlPct } = realized({ quantity: base.quantity, entryUsd: t.entryPrice, exitUsd: t.preview.price }));
        await tx.agentDecision.update({
          where: { id: decisionId },
          data: {
            status: "executed",
            tradeId: t.tradeId,
            priceUsd: new Prisma.Decimal(t.preview.price.toFixed(4)),
            price: new Prisma.Decimal(t.preview.localPrice.toFixed(4)),
            entryPriceUsd: t.entryPrice === null ? null : new Prisma.Decimal(t.entryPrice.toFixed(4)),
            realizedPnl: pnl === null ? null : new Prisma.Decimal(pnl),
            realizedPnlPct: pnlPct === null ? null : new Prisma.Decimal(pnlPct),
          },
        });
        if (base.action === "BUY") {
          const hw = new Prisma.Decimal(t.preview.price.toFixed(4));
          await tx.agentPosition.upsert({ where: { userId_symbol: { userId: base.userId, symbol: t.preview.symbol } }, create: { userId: base.userId, symbol: t.preview.symbol, highWaterUsd: hw, buyTradeId: t.tradeId }, update: { highWaterUsd: hw, buyTradeId: t.tradeId, openedAt: new Date() } });
        } else {
          await tx.agentPosition.deleteMany({ where: { userId: base.userId, symbol: t.preview.symbol } });
        }
      },
    });
    await audit(base.userId, "agent_decision", { decisionId, runId: base.runId, symbol: base.symbol, action: base.action, quantity: base.quantity, price: trade.localPrice, priceUsd: trade.price, score: base.score, trigger: base.trigger, ai: base.aiStatus, reason: (base.reasons as Reason[])[0]?.detail ?? null, result: "executed", tradeId: trade.tradeId, realizedPnl: pnl, realizedPnlPct: pnlPct, settings: base.settings });
    return { status: "executed", trade, decisionId, pnl, pnlPct };
  } catch (err) {
    const msg = err instanceof TradeError ? err.message : "Order failed.";
    if (!(err instanceof TradeError)) console.error("auto-trade order failed", base.symbol, err);
    await prisma.agentDecision.update({ where: { id: decisionId }, data: { status: "failed", error: msg, idempotencyKey: null } }).catch((e) => console.error("decision update failed", e));
    await audit(base.userId, "agent_decision", { decisionId, runId: base.runId, symbol: base.symbol, action: base.action, quantity: base.quantity, score: base.score, trigger: base.trigger, ai: base.aiStatus, result: "failed", error: msg, settings: base.settings });
    return { status: "failed", error: msg, decisionId };
  }
}

const dec = (n: number | null | undefined) => (n === null || n === undefined ? null : new Prisma.Decimal(n.toFixed(4)));

export async function runAgent(userId: string, trigger: "scheduled" | "manual"): Promise<RunResult> {
  if (!(await claimLock(userId))) throw new AgentError("The auto-trader is already running. Try again in a moment.");
  const cfg = await getAgentConfig(userId);
  const run = await prisma.agentRun.create({ data: { userId, trigger, mode: cfg.mode, status: "running" } });
  const counts = { scanned: 0, buy: 0, sell: 0, hold: 0, error: 0 };
  const finish = async (status: string, summary: string, aiNote: string | null = null) => {
    await prisma.agentRun.update({ where: { id: run.id }, data: { status, summary, finishedAt: new Date(), scanned: counts.scanned, buyCount: counts.buy, sellCount: counts.sell, holdCount: counts.hold, errorCount: counts.error, aiNote } });
    await prisma.agentConfig.update({ where: { userId }, data: { lastRunAt: new Date(), runningSince: null } });
    return { runId: run.id, status, summary };
  };

  try {
    const [settings, role] = await Promise.all([getSettings(), roleOf(userId)]);
    if (!role || !can(role, "trade")) return await finish("skipped", "Your role can't trade, or the account is suspended, so the auto-trader didn't run.");
    if (trigger === "scheduled" && !cfg.enabled) return await finish("skipped", "The auto-trader is switched off.");
    // A manual run while the auto-trader is off only scans: nothing is traded or suggested.
    const scanOnly = !cfg.enabled;
    if (!scanOnly && cfg.mode !== "DRY_RUN" && !settings.tradingEnabled) return await finish("skipped", "Trading is paused by an administrator (kill switch).");

    // The only stocks this run may scan or buy: the ones this user selected.
    const universe = cfg.universe;
    console.info(`[AutoTrader] user=${userId} selectedStocks=${JSON.stringify(universe)}`);
    if (!universe.length) {
      console.info("[AutoTrader] No stocks selected. Skipping run.");
      return await finish("skipped", "No stocks selected. Nothing to scan.");
    }

    const now = new Date();
    const sessions: Record<MarketId, MarketSession> = { US: getMarketSession("US", now), IN: getMarketSession("IN", now) };
    const enforceHours = cfg.marketHoursOnly && !cfg.demoSpeed;
    // Scheduled runs only scan stocks whose exchange is open; "Run now" scans everything (closed-market orders are still held back).
    const toScan = trigger === "scheduled" && enforceHours ? universe.filter((s) => sessions[marketOfSymbol(s)].open) : universe;
    if (!toScan.length) return await finish("skipped", "Markets are closed for every selected stock.");

    // 1. Latest quote + history, then the strategy score, for every stock.
    const data = await mapLimit(toScan, 6, async (symbol) => {
      console.info(`[AutoTrader] scanning ${symbol}`);
      try {
        const [quote, bars] = await Promise.all([getQuote(symbol), getHistory(symbol, 420)]);
        const closes = bars.map((b) => b.close);
        const day = new Date().toISOString().slice(0, 10);
        if (bars.length && bars[bars.length - 1].date !== day) closes.push(quote.price);
        else if (closes.length) closes[closes.length - 1] = quote.price;
        return { symbol, quote, score: scoreStock(symbol, closes) };
      } catch {
        return null;
      }
    });
    const scored = data.filter((d): d is { symbol: string; quote: Quote; score: ReturnType<typeof scoreStock> } => !!d);
    const missing = toScan.filter((s) => !scored.some((d) => d.symbol === s));
    const candidates: Candidate[] = scored.map((d) => ({ ...d.score, priceUsd: d.quote.priceUsd }));
    const quotes = new Map(scored.map((d) => [d.symbol, d.quote]));
    counts.scanned = candidates.length;

    // 2. Agent positions (with the highest price since the buy, for the trailing stop), cash and today's trade count.
    const [owned, user, tradesToday] = await Promise.all([
      agentPositions(userId),
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { cashBalance: true } }),
      prisma.agentDecision.count({ where: { userId, createdAt: { gte: startOfToday() }, status: { in: ["executed", "suggested", "approved", "executing"] } } }),
    ]);
    await prisma.agentPosition.deleteMany({ where: { userId, symbol: { notIn: owned.map((p) => p.symbol) } } });
    const positions: (Position & { positionId: string | null })[] = [];
    // Positions stay protected by the exit rules even if their stock was removed from the list; scheduled runs skip closed exchanges.
    for (const p of owned.filter((x) => trigger !== "scheduled" || !enforceHours || sessions[marketOfSymbol(x.symbol)].open)) {
      const q = quotes.get(p.symbol) ?? (await getQuote(p.symbol).catch(() => null));
      if (!q) continue;
      if (!quotes.has(p.symbol)) quotes.set(p.symbol, q);
      const highWaterUsd = Math.max(p.highWaterUsd ?? p.avgCostUsd, p.avgCostUsd, q.priceUsd);
      const row = await prisma.agentPosition.upsert({
        where: { userId_symbol: { userId, symbol: p.symbol } },
        create: { userId, symbol: p.symbol, highWaterUsd: new Prisma.Decimal(highWaterUsd.toFixed(4)), openedAt: p.openedAt ?? new Date() },
        update: { highWaterUsd: new Prisma.Decimal(highWaterUsd.toFixed(4)) },
      });
      positions.push({ symbol: p.symbol, quantity: p.quantity, avgCostUsd: p.avgCostUsd, heldDays: p.heldDays, priceUsd: q.priceUsd, highWaterUsd, positionId: row.id });
    }
    const pcfg = planConfig(cfg);
    const planned = planActionsDetailed({ candidates, positions, cashUsd: Number(user.cashBalance), tradesToday, cfg: pcfg });
    // Never open a position in a stock the user didn't select. Sells of positions already held are kept.
    const selected = new Set(universe);
    const plan = planned.actions.filter((a) => a.action !== "BUY" || selected.has(a.symbol));
    const blocked = planned.blocked.filter((b) => b.action !== "BUY" || selected.has(b.symbol));

    // 3. AI review of buys only. Sells (exit rules, risk protection) are never sent for a veto.
    const buys = plan.filter((p) => p.action === "BUY");
    const review = cfg.useAiReview && settings.aiEnabled ? await aiReview(buys.map((b) => ({ symbol: b.symbol, score: b.score, reasons: b.reasons.filter((r) => r.points !== 0).map((r) => r.detail) }))) : null;
    if (review && !review.available) await audit(userId, "agent_ai_unavailable", { runId: run.id, buys: buys.map((b) => b.symbol) });

    // 4. Act.
    const snapshot = riskSnapshot(cfg) as unknown as Prisma.InputJsonValue;
    const baseFor = (a: { symbol: string; action: "BUY" | "SELL" | "HOLD"; quantity: number; score: number; confidence: number; reasons: Reason[]; trigger?: string | null }, ai?: { status: AiStatus; note: string | null }): DecisionBase => {
      const q = quotes.get(a.symbol);
      return { runId: run.id, userId, symbol: a.symbol, market: marketOfSymbol(a.symbol), action: a.action, quantity: a.quantity, price: dec(q?.price), priceUsd: dec(q?.priceUsd), score: a.score, confidence: a.confidence, reasons: a.reasons as unknown as Prisma.InputJsonValue, trigger: a.trigger ?? null, aiNote: ai?.note ?? null, aiStatus: ai?.status ?? null, settings: snapshot };
    };
    const acted = new Set<string>();
    const vetoed: string[] = [];
    const closedMarket: string[] = [];
    let executed = 0;
    let suggested = 0;
    let wouldTrade = 0;

    for (const a of plan) {
      acted.add(a.symbol);
      const ai = aiVerdict(a.action, a.symbol, review);
      const base = baseFor(a, ai);
      if (!ai.allowed) {
        vetoed.push(a.symbol);
        await recordAutoTraderDecision(base, { status: "skipped", error: "Vetoed by AI review." });
        continue;
      }
      if (scanOnly || cfg.mode === "DRY_RUN") {
        wouldTrade++;
        await recordAutoTraderDecision(base, { status: "dry_run", error: scanOnly ? "Auto-Trader is off: scan only, no order placed." : null });
        continue;
      }
      const gate = marketGate(a.symbol, cfg, sessions);
      if (!gate.ok) {
        closedMarket.push(a.symbol);
        await recordAutoTraderDecision(base, { status: "market_closed", error: gate.reason });
        continue;
      }
      if (cfg.mode === "SUGGEST") {
        const d = await recordAutoTraderDecision(base, { status: "suggested" });
        await notifyAgentEvent(userId, { kind: "agent_suggestion", title: `Auto-trader suggests: ${a.action === "BUY" ? "Buy" : "Sell"} ${a.quantity} ${a.symbol}`, body: `Score ${a.score} · ${a.reasons[0]?.detail ?? ""}`, link: `/agent#d-${d.id}` });
        suggested++;
        continue;
      }

      // FULL_AUTO: stop at once if the user switched the auto-trader off (or changed mode) during the run.
      const live = await prisma.agentConfig.findUnique({ where: { userId }, select: { enabled: true, mode: true } });
      if (!live?.enabled || live.mode !== "FULL_AUTO") {
        await recordAutoTraderDecision(base, { status: "skipped", error: "Auto-Trader was switched off or changed mode during the run." });
        continue;
      }
      const pos = positions.find((p) => p.symbol === a.symbol);
      const r = await executeAutoTrade(base, { key: idempotencyKey({ userId, symbol: a.symbol, action: a.action, day: today(), positionId: pos?.positionId }), positionId: pos?.positionId ?? null });
      if (r.status === "executed") {
        executed++;
        if (a.action === "BUY") counts.buy++;
        else counts.sell++;
        await sendTradeNotifications(userId, cfg, { action: a, trade: r.trade, aiStatus: ai.status, aiNote: ai.note, pnl: r.pnl, pnlPct: r.pnlPct, entryUsd: r.trade.entryPrice });
      } else if (r.status === "failed") {
        counts.error++;
        await notifyAgentEvent(userId, { kind: "agent_trade_failed", title: `Auto-Trader couldn't ${a.action === "BUY" ? "buy" : "sell"} ${a.symbol}`, body: r.error, link: "/agent?filter=errors", dedupeMs: 6 * 3600_000 });
      }
    }

    // Orders a risk or portfolio limit held back.
    for (const b of blocked) {
      acted.add(b.symbol);
      await recordAutoTraderDecision(baseFor({ ...b, quantity: 0 }), { status: "blocked", error: b.reason });
    }
    if (blocked.length && !scanOnly && cfg.mode !== "DRY_RUN")
      await notifyAgentEvent(userId, { kind: "agent_risk_limit", title: `Auto-Trader held back ${blocked.length} order${blocked.length === 1 ? "" : "s"} (risk limits)`, body: blocked.slice(0, 3).map((b) => `${b.action} ${b.symbol}: ${b.reason}`).join(" · "), link: "/agent?filter=errors", dedupeMs: 6 * 3600_000 });
    if (vetoed.length) await notifyAgentEvent(userId, { kind: "agent_ai_veto", title: `AI review vetoed ${vetoed.length === 1 ? `a buy of ${vetoed[0]}` : `${vetoed.length} buys`}`, body: vetoed.map((s) => `${s}: ${review?.decisions.get(s.toUpperCase())?.note ?? "vetoed"}`).join(" · ").slice(0, 500), link: "/agent" });
    if (closedMarket.length) await notifyAgentEvent(userId, { kind: "agent_market_closed", title: "Auto-Trader waited: market closed", body: `No orders for ${closedMarket.join(", ")} while their exchange is closed. They'll be re-checked when it opens.`, link: "/agent", dedupeMs: 12 * 3600_000 });

    // HOLD rows so the activity log shows every stock scanned, its score and why nothing happened.
    const held = new Set(positions.map((p) => p.symbol));
    const holds = candidates.filter((c) => !acted.has(c.symbol));
    counts.hold = holds.length;
    if (holds.length)
      await prisma.agentDecision.createMany({
        data: holds.map((c) => ({ ...baseFor({ ...c, action: "HOLD", quantity: 0, reasons: [{ factor: "Decision", points: 0, detail: holdReason(c, pcfg, held.has(c.symbol)) }, ...c.reasons] }), status: "hold" })),
      });
    if (missing.length) {
      counts.error += missing.length;
      await prisma.agentDecision.createMany({ data: missing.map((symbol) => ({ ...baseFor({ symbol, action: "HOLD", quantity: 0, score: 0, confidence: 0, reasons: [{ factor: "Data", points: 0, detail: "Couldn't load price data." }] }), status: "failed", error: "Couldn't load price data for this stock." })) });
    }

    const th = THRESHOLDS[cfg.risk];
    const parts = [`Scanned ${candidates.length} stock${candidates.length === 1 ? "" : "s"}`];
    if (scanOnly) parts.push(`auto-trader is off, scan only (${wouldTrade} trade${wouldTrade === 1 ? "" : "s"} it would place)`);
    else if (cfg.mode === "FULL_AUTO") parts.push(`${counts.buy} bought, ${counts.sell} sold automatically`);
    else if (cfg.mode === "SUGGEST") parts.push(`${suggested} suggestion${suggested === 1 ? "" : "s"} waiting for approval`);
    else parts.push(`${wouldTrade} trade${wouldTrade === 1 ? "" : "s"} it would place (dry run)`);
    if (vetoed.length) parts.push(`${vetoed.length} vetoed by AI review`);
    if (blocked.length) parts.push(`${blocked.length} held back by limits`);
    if (closedMarket.length) parts.push(`${closedMarket.length} waiting for the market to open`);
    if (counts.error) parts.push(`${counts.error} error${counts.error === 1 ? "" : "s"}`);
    if (!plan.length && !blocked.length) parts.push(`no stock crossed the buy (${th.buy}) or sell (${th.sell}) level and no exit rule triggered`);
    const summary = parts.join(" · ") + ".";
    await audit(userId, "agent_run", { runId: run.id, trigger, mode: cfg.mode, scanOnly, scanned: candidates.length, executed, suggested, vetoed: vetoed.length, blocked: blocked.length, marketClosed: closedMarket.length, errors: counts.error, ai: review ? (review.available ? "on" : "unavailable") : "off" });
    return await finish("completed", summary, review?.summary ?? null);
  } catch (err) {
    console.error("agent run failed", err);
    counts.error++;
    await notifyAgentError(userId, err);
    return await finish("failed", err instanceof Error ? err.message.slice(0, 300) : "Run failed.");
  } finally {
    await prisma.agentConfig.updateMany({ where: { userId }, data: { runningSince: null } }).catch(() => {});
  }
}

/** Executes a suggestion the user approved (re-checked against current cash, limits, roles and market hours). */
export async function approveDecision(userId: string, id: string) {
  const d = await prisma.agentDecision.findFirst({ where: { id, userId, status: "suggested" } });
  if (!d) throw new AgentError("This suggestion is no longer pending.");
  if (Date.now() - d.createdAt.getTime() > 24 * 3600_000) {
    await prisma.agentDecision.update({ where: { id }, data: { status: "rejected", error: "Expired after 24 hours." } });
    throw new AgentError("This suggestion expired. The next run will make a fresh one.");
  }
  const cfg = await getAgentConfig(userId);
  const gate = marketGate(d.symbol, cfg, { US: getMarketSession("US"), IN: getMarketSession("IN") });
  if (!gate.ok) throw new AgentError(gate.reason);
  // Claim it atomically so a double click can't place the order twice.
  const claimed = await prisma.agentDecision.updateMany({ where: { id, status: "suggested" }, data: { status: "executing" } });
  if (!claimed.count) throw new AgentError("This suggestion is no longer pending.");
  try {
    let pnl: number | null = null;
    let pnlPct: number | null = null;
    const t = await executeOrder(userId, { symbol: d.symbol, side: d.action as "BUY" | "SELL", quantity: d.quantity }, "AGENT", {
      inTransaction: async (tx, x) => {
        if (d.action === "SELL" && x.entryPrice !== null) ({ pnl, pct: pnlPct } = realized({ quantity: d.quantity, entryUsd: x.entryPrice, exitUsd: x.preview.price }));
        await tx.agentDecision.update({ where: { id }, data: { status: "approved", tradeId: x.tradeId, priceUsd: dec(x.preview.price), price: dec(x.preview.localPrice), entryPriceUsd: dec(x.entryPrice), realizedPnl: pnl === null ? null : new Prisma.Decimal(pnl), realizedPnlPct: pnlPct === null ? null : new Prisma.Decimal(pnlPct) } });
        if (d.action === "BUY") await tx.agentPosition.upsert({ where: { userId_symbol: { userId, symbol: x.preview.symbol } }, create: { userId, symbol: x.preview.symbol, highWaterUsd: dec(x.preview.price)!, buyTradeId: x.tradeId }, update: { highWaterUsd: dec(x.preview.price)!, buyTradeId: x.tradeId, openedAt: new Date() } });
        else await tx.agentPosition.deleteMany({ where: { userId, symbol: x.preview.symbol } });
      },
    });
    await audit(userId, "agent_decision", { decisionId: id, symbol: d.symbol, action: d.action, quantity: d.quantity, price: t.localPrice, score: d.score, result: "approved", tradeId: t.tradeId, realizedPnl: pnl });
    const reasons = d.reasons as Reason[];
    await sendTradeNotifications(userId, cfg, { action: { symbol: d.symbol, action: d.action as "BUY" | "SELL", quantity: d.quantity, score: d.score, trigger: (d.trigger ?? "signal") as PlannedAction["trigger"], reasons }, trade: t, aiStatus: (d.aiStatus ?? "off") as AiStatus, aiNote: d.aiNote, pnl, pnlPct, entryUsd: t.entryPrice, approved: true });
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
    const configs = await prisma.agentConfig.findMany({ where: { enabled: true, runningSince: null }, select: { userId: true, enabled: true, demoSpeed: true, marketHoursOnly: true, lastRunAt: true, universe: true } });
    for (const c of configs) {
      if (!isDue(c)) continue;
      await runAgent(c.userId, "scheduled").catch(async (err) => {
        if (err instanceof AgentError) return;
        console.error("scheduled agent run failed", err);
        await notifyAgentError(c.userId, err);
      });
    }
    await sendDailySummaries();
  } finally {
    ticking = false;
  }
}
