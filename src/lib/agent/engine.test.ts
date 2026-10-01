// End-to-end tests of an auto-trader run against an in-memory database: scan → decide → AI review →
// idempotent virtual order → trade history → notifications. Market data, the AI and the order book are faked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import type { createFakeDb } from "@/test/fake-db";

const h = vi.hoisted(() => {
  class TradeError extends Error {}
  return {
    TradeError,
    executeOrder: vi.fn(),
    generateText: vi.fn(),
    notify: vi.fn(),
    audit: vi.fn(),
    role: "USER" as string | null,
    settings: { tradingEnabled: true, aiEnabled: true, maxOrderValue: 50_000, maxSharesPerOrder: 10_000, startingCash: 100_000, updatedAt: null },
    scores: new Map<string, { score: number; uptrend: boolean }>(),
    quotes: new Map<string, number>(),
    // Every symbol whose price history was loaded, i.e. every stock a run scanned.
    scanned: [] as string[],
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", async () => {
  const { createFakeDb } = await import("@/test/fake-db");
  return { prisma: createFakeDb() };
});
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/ai", () => ({ chatModel: () => "test-model" }));
vi.mock("ai", () => ({ generateText: h.generateText, Output: { object: (x: unknown) => x } }));
vi.mock("@/lib/roles", () => ({ roleOf: async () => h.role }));
vi.mock("@/lib/settings", () => ({ getSettings: async () => h.settings }));
vi.mock("@/lib/notify", () => ({ notify: h.notify }));
vi.mock("@/lib/trading", () => ({ executeOrder: h.executeOrder, TradeError: h.TradeError }));
vi.mock("@/lib/market", () => ({
  getQuote: async (symbol: string) => {
    const p = h.quotes.get(symbol);
    if (p === undefined) throw new Error("no quote");
    return { symbol, name: symbol, price: p, priceUsd: p, currency: "USD", change: 0, changePercent: 0 };
  },
  getHistory: async (symbol: string) => (h.scanned.push(symbol), Array.from({ length: 300 }, (_, i) => ({ date: `2025-01-${String((i % 28) + 1).padStart(2, "0")}`, close: 100, volume: 1 }))),
}));
vi.mock("./strategy", async (orig) => {
  const real = await orig<typeof import("./strategy")>();
  return {
    ...real,
    scoreStock: (symbol: string) => {
      const s = h.scores.get(symbol) ?? { score: 0, uptrend: true };
      return { symbol, score: s.score, confidence: 80, reasons: [{ factor: "Long-term trend", points: s.uptrend ? 20 : -20, detail: "test" }, { factor: "Momentum", points: s.score > 0 ? 20 : -20, detail: "test" }] };
    },
  };
});

const { prisma } = (await import("@/lib/prisma")) as unknown as { prisma: ReturnType<typeof createFakeDb> };
const { runAgent, runDueAgents, approveDecision, getAgentConfig, AgentError } = await import("./engine");

const D = (n: number) => new Prisma.Decimal(n);
const U = "u1";

function seed(cfg: Record<string, unknown> = {}) {
  for (const k of Object.keys(prisma.tables)) prisma.tables[k].length = 0;
  prisma.tables.user.push({ id: U, email: "trader@example.com", name: "Test Trader", cashBalance: D(100_000), role: "USER", suspended: false });
  prisma.tables.agentConfig.push({
    userId: U, enabled: true, mode: "FULL_AUTO", risk: "BALANCED", budget: D(10_000), maxPositionPct: 20, maxTradesPerDay: 10,
    stopLossPct: D(15), takeProfitPct: D(15), trailingStopEnabled: false, trailingStopPct: D(10), universe: ["AAPL"], useAiReview: false,
    marketHoursOnly: false, dailyEmail: true, summaryHour: 20, tradeEmails: true, demoSpeed: false, lastRunAt: null, runningSince: null, lastSummaryDate: null, ...cfg,
  });
}

/** An open position the agent bought `days` ago. */
function holdPosition(symbol: string, quantity: number, avgCost: number, o: { highWater?: number; days?: number } = {}) {
  const at = new Date(Date.now() - (o.days ?? 10) * 86_400_000);
  prisma.tables.holding.push({ id: `h-${symbol}`, userId: U, symbol, quantity, avgCost: D(avgCost) });
  prisma.tables.trade.push({ id: `t-${symbol}`, userId: U, symbol, side: "BUY", quantity, price: D(avgCost), source: "AGENT", createdAt: at });
  if (o.highWater) prisma.tables.agentPosition.push({ id: `p-${symbol}`, userId: U, symbol, highWaterUsd: D(o.highWater), openedAt: at });
}

const decisions = (where: Record<string, unknown> = {}) => prisma.tables.agentDecision.filter((d) => Object.entries(where).every(([k, v]) => d[k] === v));

beforeEach(() => {
  seed();
  h.scores.clear();
  h.quotes.clear();
  h.scanned.length = 0;
  h.role = "USER";
  h.settings.tradingEnabled = true;
  h.settings.aiEnabled = true;
  h.notify.mockReset().mockResolvedValue({ inApp: true, email: true, message: false });
  h.audit.mockReset();
  h.generateText.mockReset();
  // Fills at the quoted price, updates the holding and runs the caller's transaction hook, like executeOrder.
  h.executeOrder.mockReset().mockImplementation(async (userId: string, input: { symbol: string; side: "BUY" | "SELL"; quantity: number }, source: string, opts?: { inTransaction?: (tx: unknown, t: unknown) => Promise<void> }) => {
    const price = h.quotes.get(input.symbol)!;
    const holding = prisma.tables.holding.find((x) => x.symbol === input.symbol);
    const entryPrice = input.side === "SELL" && holding ? Number(holding.avgCost) : null;
    const realizedPnl = entryPrice === null ? null : Number(((price - entryPrice) * input.quantity).toFixed(2));
    const trade = await prisma.trade.create({ data: { userId, symbol: input.symbol, side: input.side, quantity: input.quantity, price: D(price), realizedPnl, source } });
    if (input.side === "BUY") prisma.tables.holding.push({ id: `h-${trade.id}`, userId, symbol: input.symbol, quantity: input.quantity, avgCost: D(price) });
    else prisma.tables.holding = prisma.tables.holding.filter((x) => x.symbol !== input.symbol);
    const preview = { symbol: input.symbol, name: input.symbol, side: input.side, quantity: input.quantity, price, localPrice: price, currency: "USD", total: price * input.quantity, cashBefore: 0, cashAfter: 0, sharesOwned: 0 };
    await opts?.inTransaction?.(prisma, { tradeId: trade.id, realizedPnl, entryPrice, preview });
    return { ...preview, tradeId: trade.id, realizedPnl, entryPrice };
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("FULL_AUTO buying", () => {
  it("buys automatically with no approval, and records the trade, position, audit and notification", async () => {
    h.scores.set("AAPL", { score: 60, uptrend: true });
    h.quotes.set("AAPL", 100);
    const r = await runAgent(U, "scheduled");
    expect(r.status).toBe("completed");
    expect(h.executeOrder).toHaveBeenCalledWith(U, { symbol: "AAPL", side: "BUY", quantity: 20 }, "AGENT", expect.anything());
    const [d] = decisions({ symbol: "AAPL", action: "BUY" });
    expect(d).toMatchObject({ status: "executed", aiStatus: "off", idempotencyKey: expect.stringMatching(/^buy:u1:AAPL:/) });
    expect(d.tradeId).toBeTruthy();
    expect(decisions({ status: "suggested" })).toHaveLength(0);
    expect(prisma.tables.agentPosition.find((p) => p.symbol === "AAPL")).toBeTruthy();
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ inApp: expect.objectContaining({ title: "Auto-Trader BUY: AAPL" }), email: expect.objectContaining({ subject: "Auto-Trader BUY Executed - AAPL" }) }));
    expect(h.audit).toHaveBeenCalledWith(U, "agent_decision", expect.objectContaining({ symbol: "AAPL", action: "BUY", result: "executed" }));
    expect(prisma.tables.agentRun[0]).toMatchObject({ status: "completed", buyCount: 1, sellCount: 0 });
  });

  it("holds when the score is below the buy level, and explains why", async () => {
    h.scores.set("AAPL", { score: 20, uptrend: true });
    h.quotes.set("AAPL", 100);
    await runAgent(U, "scheduled");
    expect(h.executeOrder).not.toHaveBeenCalled();
    const [d] = decisions({ symbol: "AAPL" });
    expect(d).toMatchObject({ action: "HOLD", status: "hold" });
    expect((d.reasons as { detail: string }[])[0].detail).toMatch(/below the buy level/);
  });

  it("lets the AI veto a risky buy", async () => {
    seed({ useAiReview: true });
    h.scores.set("AAPL", { score: 60, uptrend: true });
    h.quotes.set("AAPL", 100);
    h.generateText.mockResolvedValue({ output: { decisions: [{ symbol: "AAPL", approve: false, note: "Chasing a spike." }], summary: "x" } });
    await runAgent(U, "scheduled");
    expect(h.executeOrder).not.toHaveBeenCalled();
    expect(decisions({ symbol: "AAPL" })[0]).toMatchObject({ status: "skipped", aiStatus: "vetoed", aiNote: "Chasing a spike." });
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ inApp: expect.objectContaining({ kind: "agent_ai_veto" }) }));
  });

  it("falls back to the rule engine when the AI is unavailable, and logs it", async () => {
    seed({ useAiReview: true });
    h.scores.set("AAPL", { score: 60, uptrend: true });
    h.quotes.set("AAPL", 100);
    h.generateText.mockRejectedValue(new Error("Vertex down"));
    await runAgent(U, "scheduled");
    expect(h.executeOrder).toHaveBeenCalledOnce();
    expect(decisions({ symbol: "AAPL" })[0]).toMatchObject({ status: "executed", aiStatus: "unavailable" });
    expect(h.audit).toHaveBeenCalledWith(U, "agent_ai_unavailable", expect.anything());
  });

  it("respects the daily trade limit and logs the held-back order", async () => {
    seed({ universe: ["AAPL", "MSFT"], maxTradesPerDay: 1 });
    h.scores.set("AAPL", { score: 70, uptrend: true });
    h.scores.set("MSFT", { score: 60, uptrend: true });
    h.quotes.set("AAPL", 100);
    h.quotes.set("MSFT", 100);
    await runAgent(U, "scheduled");
    expect(h.executeOrder).toHaveBeenCalledOnce();
    expect(decisions({ symbol: "MSFT" })[0]).toMatchObject({ status: "blocked", error: expect.stringMatching(/Daily trade limit/) });
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ inApp: expect.objectContaining({ kind: "agent_risk_limit" }) }));
  });

  it("never buys more than the per-stock limit or the available cash", async () => {
    h.scores.set("AAPL", { score: 60, uptrend: true });
    h.quotes.set("AAPL", 300);
    prisma.tables.user[0].cashBalance = D(650);
    await runAgent(U, "scheduled");
    // 20% of 10,000 = 2,000 → 6 shares, but only 650 cash → 2 shares.
    expect(h.executeOrder.mock.calls[0][1]).toMatchObject({ quantity: 2 });
  });

  it("records an insufficient-cash rejection and releases the idempotency key", async () => {
    h.scores.set("AAPL", { score: 60, uptrend: true });
    h.quotes.set("AAPL", 100);
    h.executeOrder.mockRejectedValueOnce(new h.TradeError("Not enough cash for this order."));
    const r = await runAgent(U, "scheduled");
    expect(r.status).toBe("completed");
    expect(decisions({ symbol: "AAPL" })[0]).toMatchObject({ status: "failed", error: "Not enough cash for this order.", idempotencyKey: null });
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ inApp: expect.objectContaining({ kind: "agent_trade_failed" }) }));
    expect(prisma.tables.agentRun[0]).toMatchObject({ errorCount: 1 });
  });
});

describe("FULL_AUTO selling", () => {
  it("sells at the +15% profit target and stores entry, exit and realized P/L", async () => {
    holdPosition("AAPL", 10, 100);
    h.scores.set("AAPL", { score: 10, uptrend: true });
    h.quotes.set("AAPL", 115);
    await runAgent(U, "scheduled");
    expect(h.executeOrder).toHaveBeenCalledWith(U, { symbol: "AAPL", side: "SELL", quantity: 10 }, "AGENT", expect.anything());
    const [d] = decisions({ action: "SELL" });
    expect(d).toMatchObject({ status: "executed", trigger: "take_profit", aiStatus: "not_required" });
    expect(Number(d.entryPriceUsd)).toBe(100);
    expect(Number(d.priceUsd)).toBe(115);
    expect(Number(d.realizedPnl)).toBe(150);
    expect(Number(d.realizedPnlPct)).toBe(15);
    expect(prisma.tables.agentPosition).toHaveLength(0);
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ inApp: expect.objectContaining({ title: "Auto-Trader SELL: AAPL" }), email: expect.objectContaining({ subject: "Auto-Trader SELL Executed - AAPL" }) }));
  });

  it("sells at the −15% maximum loss", async () => {
    holdPosition("AAPL", 10, 100);
    h.scores.set("AAPL", { score: 50, uptrend: true });
    h.quotes.set("AAPL", 85);
    await runAgent(U, "scheduled");
    expect(decisions({ action: "SELL" })[0]).toMatchObject({ status: "executed", trigger: "stop_loss" });
    expect(Number(decisions({ action: "SELL" })[0].realizedPnl)).toBe(-150);
  });

  it("sells on the trailing stop: bought at 100, peaked at 130, 10% trail sells near 117", async () => {
    seed({ trailingStopEnabled: true, trailingStopPct: D(10), takeProfitPct: D(0) });
    holdPosition("AAPL", 10, 100, { highWater: 130 });
    h.scores.set("AAPL", { score: 40, uptrend: true });
    h.quotes.set("AAPL", 116.5);
    await runAgent(U, "scheduled");
    expect(decisions({ action: "SELL" })[0]).toMatchObject({ status: "executed", trigger: "trailing_stop" });
  });

  it("tracks the highest price for the trailing stop between scans", async () => {
    seed({ trailingStopEnabled: true, trailingStopPct: D(10), takeProfitPct: D(0) });
    holdPosition("AAPL", 10, 100, { highWater: 110 });
    h.scores.set("AAPL", { score: 40, uptrend: true });
    h.quotes.set("AAPL", 125);
    await runAgent(U, "scheduled");
    expect(Number(prisma.tables.agentPosition[0].highWaterUsd)).toBe(125);
    expect(h.executeOrder).not.toHaveBeenCalled();
  });

  it("never sends a sell to the AI for a veto", async () => {
    seed({ useAiReview: true });
    holdPosition("AAPL", 10, 100);
    h.scores.set("AAPL", { score: 0, uptrend: true });
    h.quotes.set("AAPL", 80);
    h.generateText.mockResolvedValue({ output: { decisions: [{ symbol: "AAPL", approve: false, note: "no" }], summary: "" } });
    await runAgent(U, "scheduled");
    expect(h.generateText).not.toHaveBeenCalled();
    expect(decisions({ action: "SELL" })[0]).toMatchObject({ status: "executed" });
  });
});

describe("safety", () => {
  it("never buys the same signal twice (idempotency key)", async () => {
    h.scores.set("AAPL", { score: 60, uptrend: true });
    h.quotes.set("AAPL", 100);
    await runAgent(U, "scheduled");
    // The position is sold elsewhere, so the strategy would buy again the same day.
    prisma.tables.holding.length = 0;
    prisma.tables.trade.length = 0;
    await runAgent(U, "scheduled");
    expect(h.executeOrder).toHaveBeenCalledOnce();
    expect(decisions({ symbol: "AAPL", status: "skipped" })[0].error).toMatch(/Duplicate signal/);
  });

  it("refuses to start while another run holds the lock", async () => {
    prisma.tables.agentConfig[0].runningSince = new Date();
    await expect(runAgent(U, "manual")).rejects.toBeInstanceOf(AgentError);
  });

  it("takes over a stale lock left by a crashed run", async () => {
    prisma.tables.agentConfig[0].runningSince = new Date(Date.now() - 10 * 60_000);
    h.quotes.set("AAPL", 100);
    await expect(runAgent(U, "manual")).resolves.toMatchObject({ status: "completed" });
    expect(prisma.tables.agentConfig[0].runningSince).toBeNull();
  });

  it("does nothing on a scheduled run when the auto-trader is disabled", async () => {
    seed({ enabled: false });
    h.scores.set("AAPL", { score: 60, uptrend: true });
    h.quotes.set("AAPL", 100);
    const r = await runAgent(U, "scheduled");
    expect(r.status).toBe("skipped");
    expect(h.executeOrder).not.toHaveBeenCalled();
  });

  it("only scans (no order) on a manual run while disabled", async () => {
    seed({ enabled: false });
    h.scores.set("AAPL", { score: 60, uptrend: true });
    h.quotes.set("AAPL", 100);
    await runAgent(U, "manual");
    expect(h.executeOrder).not.toHaveBeenCalled();
    expect(decisions({ symbol: "AAPL" })[0]).toMatchObject({ status: "dry_run" });
  });

  it("stops trading if the auto-trader is switched off during the run", async () => {
    seed({ universe: ["AAPL", "MSFT"] });
    h.scores.set("AAPL", { score: 70, uptrend: true });
    h.scores.set("MSFT", { score: 60, uptrend: true });
    h.quotes.set("AAPL", 100);
    h.quotes.set("MSFT", 100);
    h.executeOrder.mockImplementationOnce(async () => {
      prisma.tables.agentConfig[0].enabled = false;
      throw new h.TradeError("simulated");
    });
    await runAgent(U, "scheduled");
    expect(h.executeOrder).toHaveBeenCalledOnce();
    expect(decisions({ symbol: "MSFT" })[0]).toMatchObject({ status: "skipped", error: expect.stringMatching(/switched off/) });
  });

  it("holds orders while the stock's market is closed (weekend)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-03T15:00:00Z")); // Saturday
    seed({ marketHoursOnly: true, universe: ["AAPL"] });
    h.scores.set("AAPL", { score: 60, uptrend: true });
    h.quotes.set("AAPL", 100);
    expect(await runAgent(U, "scheduled")).toMatchObject({ status: "skipped", summary: expect.stringMatching(/closed/) });
    await runAgent(U, "manual");
    expect(h.executeOrder).not.toHaveBeenCalled();
    expect(decisions({ symbol: "AAPL" })[0]).toMatchObject({ status: "market_closed" });
  });

  it("trades a US stock during US hours but holds an Indian one after NSE closes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T15:00:00Z")); // Thu 11:00 New York, 20:30 India
    seed({ marketHoursOnly: true, universe: ["AAPL", "TCS.NS"] });
    h.scores.set("AAPL", { score: 60, uptrend: true });
    h.scores.set("TCS.NS", { score: 60, uptrend: true });
    h.quotes.set("AAPL", 100);
    h.quotes.set("TCS.NS", 40);
    await runAgent(U, "manual");
    expect(h.executeOrder).toHaveBeenCalledOnce();
    expect(h.executeOrder.mock.calls[0][1]).toMatchObject({ symbol: "AAPL" });
    expect(decisions({ symbol: "TCS.NS" })[0]).toMatchObject({ status: "market_closed" });
  });

  it("doesn't trade when the admin kill switch is on", async () => {
    h.settings.tradingEnabled = false;
    h.scores.set("AAPL", { score: 60, uptrend: true });
    h.quotes.set("AAPL", 100);
    expect(await runAgent(U, "scheduled")).toMatchObject({ status: "skipped" });
    expect(h.executeOrder).not.toHaveBeenCalled();
  });

  it("doesn't trade for a suspended account or a role without trade permission", async () => {
    h.role = null;
    h.quotes.set("AAPL", 100);
    expect(await runAgent(U, "scheduled")).toMatchObject({ status: "skipped" });
    h.role = "VIEWER";
    expect(await runAgent(U, "scheduled")).toMatchObject({ status: "skipped" });
    expect(h.executeOrder).not.toHaveBeenCalled();
  });
});

describe("notifications never undo a trade", () => {
  it("keeps a successful trade when the notification service fails", async () => {
    h.scores.set("AAPL", { score: 60, uptrend: true });
    h.quotes.set("AAPL", 100);
    h.notify.mockRejectedValue(new Error("SMTP down"));
    const r = await runAgent(U, "scheduled");
    expect(r.status).toBe("completed");
    expect(decisions({ symbol: "AAPL" })[0]).toMatchObject({ status: "executed" });
    expect(prisma.tables.trade).toHaveLength(1);
  });
});

describe("Suggest mode approvals", () => {
  it("places the order once, even if approved twice", async () => {
    seed({ mode: "SUGGEST" });
    h.scores.set("AAPL", { score: 60, uptrend: true });
    h.quotes.set("AAPL", 100);
    await runAgent(U, "scheduled");
    expect(h.executeOrder).not.toHaveBeenCalled();
    const [s] = decisions({ status: "suggested" });
    await approveDecision(U, s.id as string);
    await expect(approveDecision(U, s.id as string)).rejects.toBeInstanceOf(AgentError);
    expect(h.executeOrder).toHaveBeenCalledOnce();
    expect(decisions({ id: s.id })[0]).toMatchObject({ status: "approved" });
  });
});

describe("scheduler", () => {
  it("runs due users and skips disabled ones", async () => {
    seed({ demoSpeed: true });
    prisma.tables.user.push({ id: "u2", email: "b@example.com", cashBalance: D(1000) });
    prisma.tables.agentConfig.push({ ...prisma.tables.agentConfig[0], userId: "u2", enabled: false });
    h.scores.set("AAPL", { score: 60, uptrend: true });
    h.quotes.set("AAPL", 100);
    await runDueAgents();
    expect(prisma.tables.agentRun.map((r) => r.userId)).toEqual([U]);
  });

  it("sends one daily summary with scans, trades, P/L and open positions", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(new Date().setHours(21, 0, 0, 0)));
    seed({ summaryHour: 20 });
    holdPosition("AAPL", 10, 100);
    h.scores.set("AAPL", { score: 10, uptrend: true });
    h.quotes.set("AAPL", 115);
    await runAgent(U, "manual");
    h.notify.mockClear();
    prisma.tables.agentConfig[0].lastRunAt = new Date(); // not due again
    await runDueAgents();
    await runDueAgents();
    const emails = h.notify.mock.calls.map((c) => c[0].email).filter((e) => e?.kind === "agent_daily_summary");
    expect(emails).toHaveLength(1);
    expect(emails[0].text).toMatch(/Scans: 1/);
    expect(emails[0].text).toMatch(/Sells: 1/);
    expect(emails[0].text).toMatch(/Realized P\/L: \+\$150\.00/);
  });
});

describe("scan universe = the user's selected stocks only", () => {
  // Every old default stock gets a strong buy signal and a price, so any leak would be scanned and bought.
  const OLD_DEFAULTS = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "JPM", "V", "LLY", "AVGO", "COST", "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS", "BHARTIARTL.NS", "ITC.NS", "LT.NS", "SBIN.NS", "HINDUNILVR.NS", "MARUTI.NS", "SUNPHARMA.NS", "TATASTEEL.NS"];
  beforeEach(() => {
    for (const s of OLD_DEFAULTS) {
      h.scores.set(s, { score: 70, uptrend: true });
      h.quotes.set(s, 50);
    }
  });
  const traded = () => h.executeOrder.mock.calls.map((c) => c[1].symbol as string).sort();
  const decided = () => [...new Set(decisions().map((d) => d.symbol as string))].sort();

  it("scans and buys exactly the 3 selected stocks", async () => {
    seed({ universe: ["META", "TCS.NS", "TATASTEEL.NS"], maxTradesPerDay: 50 });
    await runAgent(U, "scheduled");
    expect([...h.scanned].sort()).toEqual(["META", "TATASTEEL.NS", "TCS.NS"]);
    for (const s of ["AAPL", "MSFT", "NVDA"]) expect(h.scanned).not.toContain(s);
    expect(decided()).toEqual(["META", "TATASTEEL.NS", "TCS.NS"]);
    expect(traded()).toEqual(["META", "TATASTEEL.NS", "TCS.NS"]);
    expect(prisma.tables.agentRun[0]).toMatchObject({ scanned: 3 });
  });

  it("scans only META when only META is selected", async () => {
    seed({ universe: ["META"] });
    await runAgent(U, "scheduled");
    expect(h.scanned).toEqual(["META"]);
    expect(traded()).toEqual(["META"]);
  });

  it("does nothing at all with zero selected stocks: no scan, no AI review, no order", async () => {
    seed({ universe: [], useAiReview: true });
    const r = await runAgent(U, "manual");
    expect(r).toMatchObject({ status: "skipped", summary: "No stocks selected. Nothing to scan." });
    expect(h.scanned).toEqual([]);
    expect(h.generateText).not.toHaveBeenCalled();
    expect(h.executeOrder).not.toHaveBeenCalled();
    expect(decisions()).toHaveLength(0);
    expect(prisma.tables.agentRun[0]).toMatchObject({ scanned: 0, buyCount: 0, sellCount: 0 });
  });

  it("stops scanning a stock once it is removed, and keeps the others", async () => {
    seed({ universe: ["META", "TCS.NS"] });
    prisma.tables.user[0].cashBalance = D(0); // scan only, so the second run isn't affected by the first one's buys
    await runAgent(U, "scheduled");
    expect([...h.scanned].sort()).toEqual(["META", "TCS.NS"]);
    prisma.tables.agentConfig[0].universe = ["TCS.NS"];
    h.scanned.length = 0;
    await runAgent(U, "scheduled");
    expect(h.scanned).toEqual(["TCS.NS"]);
  });

  it("keeps users' selections separate (direct runs and the scheduler)", async () => {
    seed({ universe: ["META", "TCS.NS"], demoSpeed: true });
    prisma.tables.user.push({ id: "u2", email: "b@example.com", cashBalance: D(100_000), role: "USER", suspended: false });
    prisma.tables.agentConfig.push({ ...prisma.tables.agentConfig[0], userId: "u2", universe: ["AAPL", "NVDA"] });
    await runAgent(U, "manual");
    expect([...h.scanned].sort()).toEqual(["META", "TCS.NS"]);
    h.scanned.length = 0;
    await runAgent("u2", "manual");
    expect([...h.scanned].sort()).toEqual(["AAPL", "NVDA"]);

    // The scheduler, from scratch: each user's run scans only that user's list.
    seed({ universe: ["META", "TCS.NS"], demoSpeed: true });
    prisma.tables.user.push({ id: "u2", email: "b@example.com", cashBalance: D(100_000), role: "USER", suspended: false });
    prisma.tables.agentConfig.push({ ...prisma.tables.agentConfig[0], userId: "u2", universe: ["AAPL", "NVDA"] });
    h.executeOrder.mockClear();
    await runDueAgents();
    const byUser = (u: string) => h.executeOrder.mock.calls.filter((c) => c[0] === u).map((c) => c[1].symbol).sort();
    expect(byUser(U)).toEqual(["META", "TCS.NS"]);
    expect(byUser("u2")).toEqual(["AAPL", "NVDA"]);
    expect(decisions({ userId: U }).every((d) => ["META", "TCS.NS"].includes(d.symbol as string))).toBe(true);
    expect(decisions({ userId: "u2" }).every((d) => ["AAPL", "NVDA"].includes(d.symbol as string))).toBe(true);
  });

  it("Run Now processes only the selected stocks", async () => {
    seed({ universe: ["META", "TCS.NS", "TATASTEEL.NS"], maxTradesPerDay: 50 });
    const r = await runAgent(U, "manual");
    expect(r.status).toBe("completed");
    expect([...h.scanned].sort()).toEqual(["META", "TATASTEEL.NS", "TCS.NS"]);
    expect(traded()).toEqual(["META", "TATASTEEL.NS", "TCS.NS"]);
  });

  it("sends the AI review only the selected stocks' buy candidates", async () => {
    seed({ universe: ["META", "TCS.NS"], useAiReview: true });
    h.generateText.mockResolvedValue({ output: { decisions: [{ symbol: "META", approve: true, note: "ok" }, { symbol: "TCS.NS", approve: true, note: "ok" }], summary: "" } });
    await runAgent(U, "scheduled");
    expect(h.generateText).toHaveBeenCalledOnce();
    const prompt = h.generateText.mock.calls[0][0].prompt as string;
    expect(prompt).toMatch(/META/);
    expect(prompt).toMatch(/TCS\.NS/);
    for (const s of ["AAPL", "MSFT", "NVDA", "TATASTEEL.NS"]) expect(prompt).not.toContain(s);
  });

  it("uses an existing 24-stock selection exactly as stored, and never adds to it", async () => {
    const stored = OLD_DEFAULTS.slice(0, 24);
    seed({ universe: [...stored], maxTradesPerDay: 50 });
    await runAgent(U, "scheduled");
    expect([...h.scanned].sort()).toEqual([...stored].sort());
    expect(h.scanned).not.toContain("TATASTEEL.NS");
    expect(prisma.tables.agentConfig[0].universe).toEqual(stored);
  });

  it("creates a new user's config with no stocks, and a first run scans nothing", async () => {
    prisma.tables.user.push({ id: "new", email: "new@example.com", cashBalance: D(100_000), role: "USER", suspended: false });
    const cfg = await getAgentConfig("new");
    expect(cfg.universe).toEqual([]);
    expect(prisma.tables.agentConfig.find((c) => c.userId === "new")?.universe).toEqual([]);
    expect(await runAgent("new", "manual")).toMatchObject({ status: "skipped" });
    expect(h.scanned).toEqual([]);
  });

  it("still protects a held position after its stock is removed, but never buys an unselected stock", async () => {
    // AAPL was bought earlier and then removed from the list; it hits the maximum loss.
    seed({ universe: ["META"] });
    holdPosition("AAPL", 10, 100);
    h.quotes.set("AAPL", 80);
    await runAgent(U, "scheduled");
    expect(h.scanned).toEqual(["META"]);
    expect(decisions({ symbol: "AAPL", action: "SELL" })[0]).toMatchObject({ status: "executed", trigger: "stop_loss" });
    expect(h.executeOrder.mock.calls.filter((c) => c[1].side === "BUY").map((c) => c[1].symbol)).toEqual(["META"]);
  });
});
