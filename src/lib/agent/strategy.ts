// Auto-trader strategy: pure functions (no database or network) shared by live runs, backtests and tests.
import { macdSeries, rsi, sma } from "@/lib/indicators";

export type Risk = "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";

export type Reason = { factor: string; points: number; detail: string };
export type StockScore = { symbol: string; score: number; confidence: number; reasons: Reason[] };

/** Buy when the score is at least `buy`; sell a held stock when it falls to `sell` or below. */
export const THRESHOLDS: Record<Risk, { buy: number; sell: number }> = {
  CONSERVATIVE: { buy: 45, sell: -5 },
  BALANCED: { buy: 35, sell: -15 },
  AGGRESSIVE: { buy: 25, sell: -25 },
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * Scores one stock from daily closes (oldest first), -100 (strong sell) .. +100 (strong buy).
 * Factors: long-term trend, medium trend, momentum (MACD), RSI, recent return, and optional news tone (-1..1).
 */
export function scoreStock(symbol: string, closes: number[], newsTone?: number | null): StockScore {
  const reasons: Reason[] = [];
  if (closes.length < 60) return { symbol, score: 0, confidence: 0, reasons: [{ factor: "Data", points: 0, detail: "Not enough price history." }] };
  const last = closes.length - 1;
  const price = closes[last];
  const s20 = sma(closes, 20)[last];
  const s50 = sma(closes, 50)[last];
  const s200 = closes.length >= 200 ? sma(closes, 200)[last] : null;
  const r = rsi(closes);
  const m = macdSeries(closes);
  const hist = m[last].histogram;
  const histPrev = m[last - 1]?.histogram ?? hist;
  const ret20 = ((price - closes[last - 20]) / closes[last - 20]) * 100;

  if (s200 !== null) {
    const up = price > s200;
    reasons.push({ factor: "Long-term trend", points: up ? 20 : -20, detail: `Price is ${up ? "above" : "below"} its 200-day average.` });
    if (s50 !== null) {
      const golden = s50 > s200;
      reasons.push({ factor: "Trend regime", points: golden ? 10 : -10, detail: golden ? "50-day average is above the 200-day (uptrend)." : "50-day average is below the 200-day (downtrend)." });
    }
  }
  if (s50 !== null && s20 !== null) {
    const up = s20 > s50;
    reasons.push({ factor: "Medium trend", points: up ? 10 : -10, detail: `20-day average is ${up ? "above" : "below"} the 50-day.` });
  }
  if (hist > 0 && histPrev <= 0) reasons.push({ factor: "Momentum", points: 20, detail: "MACD just crossed above its signal line." });
  else if (hist < 0 && histPrev >= 0) reasons.push({ factor: "Momentum", points: -20, detail: "MACD just crossed below its signal line." });
  else reasons.push({ factor: "Momentum", points: hist > 0 ? 10 : -10, detail: `MACD is ${hist > 0 ? "above" : "below"} its signal line.` });

  if (r !== null) {
    if (r < 30) reasons.push({ factor: "RSI", points: 20, detail: `RSI ${r.toFixed(0)}: oversold, a rebound is more likely.` });
    else if (r < 40) reasons.push({ factor: "RSI", points: 8, detail: `RSI ${r.toFixed(0)}: on the weak side, room to rise.` });
    else if (r > 75) reasons.push({ factor: "RSI", points: -25, detail: `RSI ${r.toFixed(0)}: strongly overbought.` });
    else if (r > 68) reasons.push({ factor: "RSI", points: -12, detail: `RSI ${r.toFixed(0)}: getting overbought.` });
    else reasons.push({ factor: "RSI", points: 0, detail: `RSI ${r.toFixed(0)}: neutral.` });
  }

  const retPts = clamp(Math.round(ret20 * 1.2), -15, 15);
  reasons.push({ factor: "20-day return", points: retPts, detail: `${ret20 >= 0 ? "+" : ""}${ret20.toFixed(1)}% over the last 20 trading days.` });

  if (newsTone !== undefined && newsTone !== null) {
    const pts = clamp(Math.round(newsTone * 15), -15, 15);
    reasons.push({ factor: "News tone", points: pts, detail: pts > 0 ? "Recent headlines are mostly positive." : pts < 0 ? "Recent headlines are mostly negative." : "Recent headlines are neutral." });
  }

  const score = clamp(reasons.reduce((a, x) => a + x.points, 0), -100, 100);
  // Confidence: how much the factors agree with the overall direction.
  const dir = Math.sign(score) || 1;
  const agreeing = reasons.filter((x) => Math.sign(x.points) === dir).length;
  const confidence = Math.round((agreeing / Math.max(reasons.filter((x) => x.points !== 0).length, 1)) * 100 * Math.min(1, Math.abs(score) / 40));
  return { symbol, score, confidence: clamp(confidence, 0, 100), reasons };
}

export type Position = { symbol: string; quantity: number; avgCostUsd: number; priceUsd: number; heldDays?: number; /** Highest price since the buy (trailing stop). */ highWaterUsd?: number };
export type Candidate = StockScore & { priceUsd: number };

export type PlanConfig = {
  risk: Risk;
  budgetUsd: number;
  maxPositionPct: number;
  maxTradesPerDay: number;
  /** Maximum loss: sell when a position is this far below its buy price. */
  stopLossPct: number;
  /** Profit target: sell when a position is this far above its buy price (0 = off). */
  takeProfitPct: number;
  /** Trailing stop: sell when the price is this far below its highest price since the buy (null/0 = off). */
  trailingStopPct?: number | null;
  /** Signal-based sells wait this many days after buying (exit rules always apply). */
  minHoldDays?: number;
  /** Only buy stocks trading above their 200-day average. */
  trendFilter?: boolean;
};

export type Trigger = "signal" | "stop_loss" | "take_profit" | "trailing_stop";

export type PlannedAction = {
  symbol: string;
  action: "BUY" | "SELL";
  quantity: number;
  priceUsd: number;
  score: number;
  confidence: number;
  trigger: Trigger;
  reasons: Reason[];
};

/** An order the strategy wanted but a risk or portfolio limit stopped. */
export type BlockedAction = { symbol: string; action: "BUY" | "SELL"; score: number; confidence: number; priceUsd: number; reason: string; reasons: Reason[] };

const changePct = (p: Position) => ((p.priceUsd - p.avgCostUsd) / p.avgCostUsd) * 100;

// ---------- Exit rules (risk protection, not a promise of profit) ----------

/** Maximum loss: price at or below buy price − stopLossPct. */
export function checkStopLoss(p: Position, stopLossPct: number): Reason | null {
  const c = changePct(p);
  if (!(stopLossPct > 0) || c > -stopLossPct) return null;
  return { factor: "Maximum loss", points: -100, detail: `Down ${Math.abs(c).toFixed(1)}% from the buy price ${p.avgCostUsd.toFixed(2)} (limit ${stopLossPct}%).` };
}

/** Profit target: price at or above buy price + takeProfitPct (0 = off). */
export function checkProfitTarget(p: Position, takeProfitPct: number): Reason | null {
  const c = changePct(p);
  if (!(takeProfitPct > 0) || c < takeProfitPct) return null;
  return { factor: "Profit target", points: -100, detail: `Up ${c.toFixed(1)}% from the buy price ${p.avgCostUsd.toFixed(2)} (target ${takeProfitPct}%).` };
}

const peakOf = (p: Position) => Math.max(p.highWaterUsd ?? p.avgCostUsd, p.avgCostUsd);

/** The trailing-stop sell level: highest price since the buy minus trailingStopPct. */
export function trailingStopLevel(p: Position, trailingStopPct: number) {
  return peakOf(p) * (1 - trailingStopPct / 100);
}

/** Trailing stop: price at or below (highest price since the buy) − trailingStopPct. */
export function checkTrailingStop(p: Position, trailingStopPct: number | null | undefined): Reason | null {
  if (!trailingStopPct || trailingStopPct <= 0) return null;
  const peak = peakOf(p);
  if (p.priceUsd > trailingStopLevel(p, trailingStopPct)) return null;
  return { factor: "Trailing stop", points: -100, detail: `Fell to ${p.priceUsd.toFixed(2)}, ${(((peak - p.priceUsd) / peak) * 100).toFixed(1)}% below its high of ${peak.toFixed(2)} (trail ${trailingStopPct}%).` };
}

/** Which exit rule (if any) says to sell. Maximum loss first, then trailing stop, profit target, and a weak score after the minimum hold. */
export function exitRule(p: Position, cfg: PlanConfig, c?: StockScore): { trigger: Trigger; why: Reason } | null {
  const sl = checkStopLoss(p, cfg.stopLossPct);
  if (sl) return { trigger: "stop_loss", why: sl };
  const ts = checkTrailingStop(p, cfg.trailingStopPct);
  if (ts) return { trigger: "trailing_stop", why: ts };
  const tp = checkProfitTarget(p, cfg.takeProfitPct);
  if (tp) return { trigger: "take_profit", why: tp };
  const th = THRESHOLDS[cfg.risk];
  if (c && c.score <= th.sell && (p.heldDays ?? Infinity) >= (cfg.minHoldDays ?? 0)) return { trigger: "signal", why: { factor: "Sell signal", points: c.score, detail: `Score ${c.score} is at or below the sell level (${th.sell}).` } };
  return null;
}

/** Why a scanned stock was left alone (shown in the activity log). */
export function holdReason(c: StockScore, cfg: PlanConfig, held: boolean): string {
  const th = THRESHOLDS[cfg.risk];
  if (c.reasons[0]?.factor === "Data") return "Not enough price history.";
  if (held) return c.score <= th.sell ? `Holding: score ${c.score} is weak, but the minimum holding period hasn't passed.` : `Holding: no exit rule triggered (score ${c.score}).`;
  if (c.score < th.buy) return `No valid entry signal: score ${c.score} is below the buy level (${th.buy}).`;
  if (cfg.trendFilter && !c.reasons.some((r) => r.factor === "Long-term trend" && r.points > 0)) return "No valid entry: price is below its 200-day average (trend filter).";
  return `Score ${c.score}: no action.`;
}

/**
 * Turns scores into orders under the user's limits. Exits first (maximum loss, trailing stop, profit target,
 * sell signal), then buys the highest-scoring stocks the agent doesn't already hold, within budget, cash,
 * per-stock and daily trade caps. Protective exits are never held back by the daily cap (they still count);
 * signal sells and buys are. `positions` are the agent-managed holdings only.
 * Also returns the orders a limit stopped, so they can be logged.
 */
export function planActionsDetailed(o: { candidates: Candidate[]; positions: Position[]; cashUsd: number; tradesToday: number; cfg: PlanConfig }): { actions: PlannedAction[]; blocked: BlockedAction[] } {
  const { cfg } = o;
  const th = THRESHOLDS[cfg.risk];
  const out: PlannedAction[] = [];
  const blocked: BlockedAction[] = [];
  let tradesLeft = Math.max(0, cfg.maxTradesPerDay - o.tradesToday);
  const bySymbol = new Map(o.candidates.map((c) => [c.symbol, c]));
  let cash = o.cashUsd;
  let invested = o.positions.reduce((a, p) => a + p.quantity * p.priceUsd, 0);
  const dailyCap = `Daily trade limit reached (${cfg.maxTradesPerDay}).`;

  for (const p of o.positions) {
    const c = bySymbol.get(p.symbol);
    const exit = exitRule(p, cfg, c);
    if (!exit) continue;
    const reasons = [exit.why, ...(c?.reasons ?? [])];
    if (exit.trigger === "signal" && tradesLeft <= 0) {
      blocked.push({ symbol: p.symbol, action: "SELL", score: c?.score ?? 0, confidence: c?.confidence ?? 0, priceUsd: p.priceUsd, reason: dailyCap, reasons });
      continue;
    }
    out.push({ symbol: p.symbol, action: "SELL", quantity: p.quantity, priceUsd: p.priceUsd, score: c?.score ?? 0, confidence: c?.confidence ?? 100, trigger: exit.trigger, reasons });
    cash += p.quantity * p.priceUsd;
    invested -= p.quantity * p.priceUsd;
    tradesLeft = Math.max(0, tradesLeft - 1);
  }

  const held = new Set(o.positions.map((p) => p.symbol));
  const perPosition = (cfg.budgetUsd * cfg.maxPositionPct) / 100;
  const inUptrend = (c: Candidate) => !cfg.trendFilter || c.reasons.some((r) => r.factor === "Long-term trend" && r.points > 0);
  const buys = o.candidates.filter((c) => c.score >= th.buy && !held.has(c.symbol) && inUptrend(c)).sort((a, b) => b.score - a.score || b.confidence - a.confidence);
  for (const c of buys) {
    const block = (reason: string) => blocked.push({ symbol: c.symbol, action: "BUY", score: c.score, confidence: c.confidence, priceUsd: c.priceUsd, reason, reasons: c.reasons });
    if (tradesLeft <= 0) {
      block(dailyCap);
      continue;
    }
    const budgetLeft = cfg.budgetUsd - invested;
    const room = Math.min(perPosition, budgetLeft, cash);
    const qty = Math.floor(room / c.priceUsd);
    if (qty < 1) {
      if (room === cash && cash < perPosition) block(`Not enough virtual cash: ${cash.toFixed(2)} USD left, one share costs ${c.priceUsd.toFixed(2)} USD.`);
      else if (room === budgetLeft && budgetLeft < perPosition) block(`Budget fully used: ${Math.max(0, budgetLeft).toFixed(2)} USD of ${cfg.budgetUsd} USD left.`);
      else block(`One share (${c.priceUsd.toFixed(2)} USD) is more than the ${cfg.maxPositionPct}% per-stock limit (${perPosition.toFixed(2)} USD).`);
      continue;
    }
    out.push({ symbol: c.symbol, action: "BUY", quantity: qty, priceUsd: c.priceUsd, score: c.score, confidence: c.confidence, trigger: "signal", reasons: c.reasons });
    cash -= qty * c.priceUsd;
    invested += qty * c.priceUsd;
    tradesLeft--;
  }
  return { actions: out, blocked };
}

export function planActions(o: { candidates: Candidate[]; positions: Position[]; cashUsd: number; tradesToday: number; cfg: PlanConfig }): PlannedAction[] {
  return planActionsDetailed(o).actions;
}
