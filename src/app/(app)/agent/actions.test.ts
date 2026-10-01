// Server actions for the Auto-Trader's stock list: every add, remove and backtest is scoped to the signed-in
// user (from the session, never from the client) and works on exactly that user's saved selection.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import type { createFakeDb } from "@/test/fake-db";

const h = vi.hoisted(() => {
  class AccessError extends Error {}
  return {
    AccessError,
    actor: { id: "u1", email: "a@example.com", name: "A", role: "USER" } as { id: string; email: string; name: string | null; role: string } | null,
    runBacktest: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/prisma", async () => {
  const { createFakeDb } = await import("@/test/fake-db");
  return { prisma: createFakeDb() };
});
vi.mock("@/lib/authz", () => ({
  AccessError: h.AccessError,
  requirePermission: async () => {
    if (!h.actor) throw new h.AccessError("Please sign in.");
    return h.actor;
  },
}));
vi.mock("@/lib/market", () => {
  class MarketError extends Error {}
  return {
    MarketError,
    normalizeSymbol: (s: string) => s.trim().toUpperCase(),
    getQuote: async (symbol: string) => ({ symbol, name: symbol, price: 100, priceUsd: 100, currency: "USD", change: 0, changePercent: 0 }),
    getQuotes: async () => [],
    getHistory: async () => [],
  };
});
vi.mock("@/lib/agent/backtest", () => ({ runBacktest: h.runBacktest }));
vi.mock("@/lib/agent/notifications", () => ({ notifyAgentEvent: async () => {}, notifyAgentError: async () => {}, sendDailySummaries: async () => {}, sendTradeNotifications: async () => {} }));
vi.mock("@/lib/audit", () => ({ audit: async () => {} }));
vi.mock("@/lib/ai", () => ({ chatModel: () => "test-model" }));
vi.mock("ai", () => ({ generateText: vi.fn(), Output: { object: (x: unknown) => x } }));
vi.mock("@/lib/roles", () => ({ roleOf: async () => "USER" }));
vi.mock("@/lib/settings", () => ({ getSettings: async () => ({ tradingEnabled: true, aiEnabled: true }) }));
vi.mock("@/lib/trading", () => ({ executeOrder: vi.fn(), TradeError: class extends Error {} }));

const { prisma } = (await import("@/lib/prisma")) as unknown as { prisma: ReturnType<typeof createFakeDb> };
const { addAgentStock, removeAgentStock, backtestAgent, getAutoTraderConfig } = await import("./actions");

const as = (id: string) => (h.actor = { id, email: `${id}@example.com`, name: id, role: "USER" });
const selection = (userId: string) => prisma.tables.agentConfig.find((c) => c.userId === userId)?.universe;

beforeEach(() => {
  for (const k of Object.keys(prisma.tables)) prisma.tables[k].length = 0;
  as("u1");
  h.runBacktest.mockReset().mockImplementation(async (symbols: string[]) => ({ symbols, returnPct: 0, trades: 0, settings: {} }));
});

describe("Auto-Trader stock selection", () => {
  it("starts a new user with no stocks selected", async () => {
    expect((await getAutoTraderConfig()).stocks).toEqual([]);
    expect(selection("u1")).toEqual([]);
  });

  it("adds stocks one at a time to the signed-in user's list", async () => {
    expect(await addAgentStock("meta")).toMatchObject({ ok: true, symbol: "META" });
    expect(selection("u1")).toEqual(["META"]);
    expect(await addAgentStock("TCS.NS")).toMatchObject({ ok: true, symbol: "TCS.NS" });
    expect(selection("u1")).toEqual(["META", "TCS.NS"]);
    expect(await addAgentStock("META")).toMatchObject({ ok: true, message: "META is already selected." });
    expect(selection("u1")).toEqual(["META", "TCS.NS"]);
  });

  it("removes a stock and keeps the rest", async () => {
    await addAgentStock("META");
    await addAgentStock("TCS.NS");
    expect(await removeAgentStock("META")).toMatchObject({ ok: true });
    expect(selection("u1")).toEqual(["TCS.NS"]);
  });

  it("keeps trade history, decisions and notifications when a stock is removed", async () => {
    await addAgentStock("META");
    prisma.tables.trade.push({ id: "t1", userId: "u1", symbol: "META", side: "BUY", quantity: 1, price: new Prisma.Decimal(100), source: "AGENT", createdAt: new Date() });
    prisma.tables.agentDecision.push({ id: "d1", userId: "u1", symbol: "META", action: "BUY", status: "executed" });
    prisma.tables.notification.push({ id: "n1", userId: "u1", kind: "agent_trade", title: "Auto-Trader BUY: META" });
    await removeAgentStock("META");
    expect(selection("u1")).toEqual([]);
    expect(prisma.tables.trade).toHaveLength(1);
    expect(prisma.tables.agentDecision).toHaveLength(1);
    expect(prisma.tables.notification).toHaveLength(1);
  });

  it("keeps each user's list separate", async () => {
    as("u1");
    await addAgentStock("META");
    await addAgentStock("TCS.NS");
    as("u2");
    await addAgentStock("AAPL");
    await addAgentStock("NVDA");
    // u2 removing META (which only u1 has) changes nothing for u1.
    await removeAgentStock("META");
    expect(selection("u1")).toEqual(["META", "TCS.NS"]);
    expect(selection("u2")).toEqual(["AAPL", "NVDA"]);
    expect((await getAutoTraderConfig()).stocks).toEqual(["AAPL", "NVDA"]);
  });

  it("refuses to change anything without a signed-in user", async () => {
    h.actor = null;
    expect(await addAgentStock("META")).toMatchObject({ ok: false });
    expect(prisma.tables.agentConfig).toHaveLength(0);
  });
});

describe("backtest", () => {
  it("backtests only the selected stocks", async () => {
    await addAgentStock("META");
    await addAgentStock("TCS.NS");
    const r = await backtestAgent(126);
    expect(r.ok).toBe(true);
    expect(h.runBacktest).toHaveBeenCalledOnce();
    expect(h.runBacktest.mock.calls[0][0]).toEqual(["META", "TCS.NS"]);
  });

  it("doesn't backtest anything with zero selected stocks", async () => {
    as("u3");
    expect(await backtestAgent(126)).toEqual({ ok: false, message: "Select at least one stock to backtest." });
    expect(h.runBacktest).not.toHaveBeenCalled();
  });
});
