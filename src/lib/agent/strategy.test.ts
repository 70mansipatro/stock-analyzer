import { describe, expect, it } from "vitest";
import { planActions, scoreStock, THRESHOLDS, type Candidate, type PlanConfig } from "./strategy";

// Synthetic price series (oldest first).
const trend = (n: number, start: number, dailyPct: number, wiggle = 0.004) =>
  Array.from({ length: n }, (_, i) => start * Math.pow(1 + dailyPct, i) * (1 + Math.sin(i / 3) * wiggle));

const cfg: PlanConfig = { risk: "BALANCED", budgetUsd: 10_000, maxPositionPct: 20, maxTradesPerDay: 10, stopLossPct: 8, takeProfitPct: 15, minHoldDays: 5, trendFilter: true };

const cand = (symbol: string, score: number, priceUsd: number, uptrend = true): Candidate => ({
  symbol,
  score,
  confidence: 70,
  priceUsd,
  reasons: [{ factor: "Long-term trend", points: uptrend ? 20 : -20, detail: "" }],
});

describe("scoreStock", () => {
  it("reads trend direction correctly and ranks an uptrend above a downtrend", () => {
    const up = scoreStock("UP", trend(300, 100, 0.003));
    const down = scoreStock("DOWN", trend(300, 100, -0.003));
    const pts = (s: typeof up, f: string) => s.reasons.find((r) => r.factor === f)!.points;
    for (const f of ["Long-term trend", "Trend regime", "Medium trend"]) {
      expect(pts(up, f)).toBeGreaterThan(0);
      expect(pts(down, f)).toBeLessThan(0);
    }
    expect(up.score).toBeGreaterThan(down.score);
    expect(down.score).toBeLessThan(-20);
  });

  it("buys dips in an uptrend: an oversold stock above its 200-day average scores high", () => {
    const dip = [...trend(260, 100, 0.002, 0.01), ...Array.from({ length: 12 }, (_, i) => 168 * (1 - 0.012 * (i + 1)))];
    const s = scoreStock("DIP", dip);
    expect(s.reasons.find((r) => r.factor === "RSI")!.points).toBeGreaterThan(0);
    expect(s.reasons.find((r) => r.factor === "Long-term trend")!.points).toBeGreaterThan(0);
  });

  it("stays within -100..100 and explains itself", () => {
    const s = scoreStock("X", trend(300, 50, 0.01));
    expect(s.score).toBeLessThanOrEqual(100);
    expect(s.score).toBeGreaterThanOrEqual(-100);
    expect(s.reasons.map((r) => r.factor)).toEqual(expect.arrayContaining(["Long-term trend", "Momentum", "RSI"]));
  });

  it("refuses to score without enough history", () => {
    expect(scoreStock("NEW", trend(30, 10, 0.01))).toMatchObject({ score: 0, confidence: 0 });
  });

  it("penalises an overbought stock", () => {
    const parabolic = [...trend(250, 100, 0.001), ...trend(20, 128, 0.03, 0)];
    expect(scoreStock("HOT", parabolic).reasons.find((r) => r.factor === "RSI")!.points).toBeLessThan(0);
  });

  it("adds news tone when given", () => {
    const closes = trend(300, 100, 0.002);
    expect(scoreStock("N", closes, 1).score).toBeGreaterThan(scoreStock("N", closes, -1).score);
  });
});

describe("planActions", () => {
  it("buys the strongest candidates first and skips weak ones", () => {
    const plan = planActions({ candidates: [cand("A", 40, 100), cand("B", 80, 100), cand("C", 10, 100)], positions: [], cashUsd: 10_000, tradesToday: 0, cfg });
    expect(plan.map((p) => p.symbol)).toEqual(["B", "A"]);
    expect(plan.every((p) => p.action === "BUY")).toBe(true);
  });

  it("never puts more than maxPositionPct of the budget in one stock", () => {
    const [p] = planActions({ candidates: [cand("A", 90, 100)], positions: [], cashUsd: 10_000, tradesToday: 0, cfg });
    expect(p.quantity * p.priceUsd).toBeLessThanOrEqual(cfg.budgetUsd * 0.2);
  });

  it("never exceeds the total budget or available cash", () => {
    const many = Array.from({ length: 12 }, (_, i) => cand(`S${i}`, 90 - i, 100));
    const plan = planActions({ candidates: many, positions: [], cashUsd: 10_000, tradesToday: 0, cfg });
    expect(plan.reduce((a, p) => a + p.quantity * p.priceUsd, 0)).toBeLessThanOrEqual(cfg.budgetUsd);
    const poor = planActions({ candidates: many, positions: [], cashUsd: 450, tradesToday: 0, cfg });
    expect(poor.reduce((a, p) => a + p.quantity * p.priceUsd, 0)).toBeLessThanOrEqual(450);
  });

  it("respects the daily trade limit, counting trades already made today", () => {
    const many = Array.from({ length: 12 }, (_, i) => cand(`S${i}`, 90, 10));
    expect(planActions({ candidates: many, positions: [], cashUsd: 10_000, tradesToday: 0, cfg: { ...cfg, maxTradesPerDay: 3 } })).toHaveLength(3);
    expect(planActions({ candidates: many, positions: [], cashUsd: 10_000, tradesToday: 3, cfg: { ...cfg, maxTradesPerDay: 3 } })).toHaveLength(0);
  });

  it("doesn't buy a stock it already holds, or one in a downtrend", () => {
    const plan = planActions({
      candidates: [cand("HELD", 90, 100), cand("FALLING", 90, 100, false)],
      positions: [{ symbol: "HELD", quantity: 5, avgCostUsd: 100, priceUsd: 100, heldDays: 10 }],
      cashUsd: 10_000,
      tradesToday: 0,
      cfg,
    });
    expect(plan).toHaveLength(0);
  });

  it("sells on stop-loss even inside the minimum holding period", () => {
    const [p] = planActions({ candidates: [cand("A", 50, 90)], positions: [{ symbol: "A", quantity: 10, avgCostUsd: 100, priceUsd: 90, heldDays: 1 }], cashUsd: 0, tradesToday: 0, cfg });
    expect(p).toMatchObject({ symbol: "A", action: "SELL", quantity: 10, trigger: "stop_loss" });
  });

  it("takes profit at the target", () => {
    const [p] = planActions({ candidates: [], positions: [{ symbol: "A", quantity: 4, avgCostUsd: 100, priceUsd: 116, heldDays: 30 }], cashUsd: 0, tradesToday: 0, cfg });
    expect(p).toMatchObject({ action: "SELL", trigger: "take_profit" });
  });

  it("sells on a weak score only after the minimum holding period", () => {
    const weak = cand("A", THRESHOLDS.BALANCED.sell - 5, 100);
    const early = planActions({ candidates: [weak], positions: [{ symbol: "A", quantity: 3, avgCostUsd: 100, priceUsd: 100, heldDays: 2 }], cashUsd: 0, tradesToday: 0, cfg });
    const later = planActions({ candidates: [weak], positions: [{ symbol: "A", quantity: 3, avgCostUsd: 100, priceUsd: 100, heldDays: 6 }], cashUsd: 0, tradesToday: 0, cfg });
    expect(early).toHaveLength(0);
    expect(later[0]).toMatchObject({ action: "SELL", trigger: "signal" });
  });

  it("uses cash freed by a sale for new buys in the same run", () => {
    const plan = planActions({
      candidates: [cand("NEW", 90, 100)],
      positions: [{ symbol: "OLD", quantity: 20, avgCostUsd: 100, priceUsd: 120, heldDays: 30 }],
      cashUsd: 0,
      tradesToday: 0,
      cfg,
    });
    expect(plan.map((p) => `${p.action} ${p.symbol}`)).toEqual(["SELL OLD", "BUY NEW"]);
  });

  it("is stricter at conservative risk", () => {
    const c = [cand("A", 40, 100)];
    expect(planActions({ candidates: c, positions: [], cashUsd: 10_000, tradesToday: 0, cfg: { ...cfg, risk: "AGGRESSIVE" } })).toHaveLength(1);
    expect(planActions({ candidates: c, positions: [], cashUsd: 10_000, tradesToday: 0, cfg: { ...cfg, risk: "CONSERVATIVE" } })).toHaveLength(0);
  });
});
