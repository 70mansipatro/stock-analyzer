import { describe, expect, it } from "vitest";
import { getMarketSession } from "@/lib/market-hours";
import { aiVerdict, idempotencyKey, isDue, marketGate, nextScanAt, realized, type AiReview } from "./rules";

const review = (decisions: [string, boolean][], available = true): AiReview => ({ available, summary: null, decisions: new Map(decisions.map(([s, approve]) => [s, { approve, note: approve ? "ok" : "too extended" }])) });

describe("aiVerdict", () => {
  it("lets the AI veto a buy", () => {
    expect(aiVerdict("BUY", "NVDA", review([["NVDA", false]]))).toMatchObject({ allowed: false, status: "vetoed" });
    expect(aiVerdict("BUY", "NVDA", review([["NVDA", true]]))).toMatchObject({ allowed: true, status: "approved" });
  });

  it("never lets the AI block a sell", () => {
    expect(aiVerdict("SELL", "NVDA", review([["NVDA", false]]))).toMatchObject({ allowed: true, status: "not_required" });
  });

  it("falls back to the rule engine when the AI is off, unavailable or silent", () => {
    expect(aiVerdict("BUY", "NVDA", null)).toMatchObject({ allowed: true, status: "off" });
    expect(aiVerdict("BUY", "NVDA", review([], false))).toMatchObject({ allowed: true, status: "unavailable" });
    expect(aiVerdict("BUY", "NVDA", review([["AAPL", false]]))).toMatchObject({ allowed: true, status: "not_reviewed" });
  });
});

describe("idempotencyKey", () => {
  it("allows one automatic buy per stock per day and one sell per position", () => {
    const a = idempotencyKey({ userId: "u", symbol: "NVDA", action: "BUY", day: "2026-10-01" });
    expect(a).toBe(idempotencyKey({ userId: "u", symbol: "NVDA", action: "BUY", day: "2026-10-01" }));
    expect(a).not.toBe(idempotencyKey({ userId: "u", symbol: "NVDA", action: "BUY", day: "2026-10-02" }));
    expect(idempotencyKey({ userId: "u", symbol: "NVDA", action: "SELL", day: "d", positionId: "p1" })).not.toBe(idempotencyKey({ userId: "u", symbol: "NVDA", action: "SELL", day: "d", positionId: "p2" }));
  });
});

const base = { enabled: true, demoSpeed: false, marketHoursOnly: true, lastRunAt: null as Date | null, universe: ["AAPL"] };
const usOpen = new Date("2026-10-01T15:00:00Z"); // Thu 11:00 New York, 20:30 India
const weekend = new Date("2026-10-03T15:00:00Z");

describe("isDue", () => {
  it("never runs a disabled auto-trader or one with no stocks", () => {
    expect(isDue({ ...base, enabled: false }, usOpen)).toBe(false);
    expect(isDue({ ...base, universe: [] }, usOpen)).toBe(false);
  });

  it("runs every 5 minutes while one of the user's markets is open", () => {
    expect(isDue(base, usOpen)).toBe(true);
    expect(isDue({ ...base, lastRunAt: new Date(usOpen.getTime() - 2 * 60_000) }, usOpen)).toBe(false);
    expect(isDue({ ...base, lastRunAt: new Date(usOpen.getTime() - 5 * 60_000) }, usOpen)).toBe(true);
  });

  it("waits while the user's markets are closed", () => {
    expect(isDue(base, weekend)).toBe(false);
    expect(isDue({ ...base, universe: ["TCS.NS"] }, usOpen)).toBe(false); // NSE closed at 20:30 IST
  });

  it("ignores market hours in demo speed, or when enforcement is off", () => {
    expect(isDue({ ...base, demoSpeed: true }, weekend)).toBe(true);
    expect(isDue({ ...base, marketHoursOnly: false }, weekend)).toBe(true);
  });
});

describe("nextScanAt", () => {
  it("is the next market open when markets are closed", () => {
    expect(nextScanAt(base, weekend)?.toISOString()).toBe("2026-10-05T13:30:00.000Z");
    expect(nextScanAt({ ...base, enabled: false }, weekend)).toBeNull();
  });
});

describe("marketGate", () => {
  const sessions = (now: Date) => ({ US: getMarketSession("US", now), IN: getMarketSession("IN", now) });
  it("blocks orders for a closed exchange", () => {
    const s = sessions(usOpen);
    expect(marketGate("AAPL", { marketHoursOnly: true, demoSpeed: false }, s)).toEqual({ ok: true });
    expect(marketGate("RELIANCE.NS", { marketHoursOnly: true, demoSpeed: false }, s)).toMatchObject({ ok: false });
    expect(marketGate("RELIANCE.NS", { marketHoursOnly: false, demoSpeed: false }, s)).toEqual({ ok: true });
  });
});

describe("realized", () => {
  it("computes P/L in USD and percent", () => {
    expect(realized({ quantity: 10, entryUsd: 100, exitUsd: 115 })).toEqual({ pnl: 150, pct: 15 });
    expect(realized({ quantity: 10, entryUsd: 100, exitUsd: 85 })).toEqual({ pnl: -150, pct: -15 });
  });
});
