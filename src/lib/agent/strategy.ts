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

export type Position = { symbol: string; quantity: number; avgCostUsd: number; priceUsd: number; heldDays?: number };
export type Candidate = StockScore & { priceUsd: number };

export type PlanConfig = {
  risk: Risk;
  budgetUsd: number;
  maxPositionPct: number;
  maxTradesPerDay: number;
  stopLossPct: number;
  takeProfitPct: number;
  /** Signal-based sells wait this many days after buying (stop-loss / take-profit always apply). */
  minHoldDays?: number;
  /** Only buy stocks trading above their 200-day average. */
  trendFilter?: boolean;
};

export type PlannedAction = {
  symbol: string;
  action: "BUY" | "SELL";
  quantity: number;
  priceUsd: number;
  score: number;
  confidence: number;
  trigger: "signal" | "stop_loss" | "take_profit";
  reasons: Reason[];
};

/**
 * Turns scores into orders under the user's limits. Exits first (stop-loss, take-profit, sell signal),
 * then buys the highest-scoring stocks the agent doesn't already hold, within budget, cash and trade caps.
 * `positions` are the agent-managed holdings only.
 */
export function planActions(o: { candidates: Candidate[]; positions: Position[]; cashUsd: number; tradesToday: number; cfg: PlanConfig }): PlannedAction[] {
  const { cfg } = o;
  const th = THRESHOLDS[cfg.risk];
  const out: PlannedAction[] = [];
  let tradesLeft = Math.max(0, cfg.maxTradesPerDay - o.tradesToday);
  const bySymbol = new Map(o.candidates.map((c) => [c.symbol, c]));
  let cash = o.cashUsd;
  let invested = o.positions.reduce((a, p) => a + p.quantity * p.priceUsd, 0);

  for (const p of o.positions) {
    if (tradesLeft <= 0) break;
    const c = bySymbol.get(p.symbol);
    const changePct = ((p.priceUsd - p.avgCostUsd) / p.avgCostUsd) * 100;
    let trigger: PlannedAction["trigger"] | null = null;
    let why: Reason | null = null;
    if (changePct <= -cfg.stopLossPct) {
      trigger = "stop_loss";
      why = { factor: "Stop-loss", points: -100, detail: `Down ${Math.abs(changePct).toFixed(1)}% from the buy price (limit ${cfg.stopLossPct}%).` };
    } else if (changePct >= cfg.takeProfitPct) {
      trigger = "take_profit";
      why = { factor: "Take-profit", points: -100, detail: `Up ${changePct.toFixed(1)}% from the buy price (target ${cfg.takeProfitPct}%).` };
    } else if (c && c.score <= th.sell && (p.heldDays ?? Infinity) >= (cfg.minHoldDays ?? 0)) {
      trigger = "signal";
      why = { factor: "Sell signal", points: c.score, detail: `Score ${c.score} is at or below the sell level (${th.sell}).` };
    }
    if (trigger && why) {
      out.push({ symbol: p.symbol, action: "SELL", quantity: p.quantity, priceUsd: p.priceUsd, score: c?.score ?? 0, confidence: c?.confidence ?? 100, trigger, reasons: [why, ...(c?.reasons ?? [])] });
      cash += p.quantity * p.priceUsd;
      invested -= p.quantity * p.priceUsd;
      tradesLeft--;
    }
  }

  const held = new Set(o.positions.map((p) => p.symbol));
  const perPosition = (cfg.budgetUsd * cfg.maxPositionPct) / 100;
  const inUptrend = (c: Candidate) => !cfg.trendFilter || c.reasons.some((r) => r.factor === "Long-term trend" && r.points > 0);
  const buys = o.candidates.filter((c) => c.score >= th.buy && !held.has(c.symbol) && inUptrend(c)).sort((a, b) => b.score - a.score || b.confidence - a.confidence);
  for (const c of buys) {
    if (tradesLeft <= 0) break;
    const room = Math.min(perPosition, cfg.budgetUsd - invested, cash);
    const qty = Math.floor(room / c.priceUsd);
    if (qty < 1) continue;
    out.push({ symbol: c.symbol, action: "BUY", quantity: qty, priceUsd: c.priceUsd, score: c.score, confidence: c.confidence, trigger: "signal", reasons: c.reasons });
    cash -= qty * c.priceUsd;
    invested += qty * c.priceUsd;
    tradesLeft--;
  }
  return out;
}

/** The default 24-stock universe: 12 US and 12 NIFTY large caps. */
export const DEFAULT_UNIVERSE = [
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "JPM", "V", "LLY", "AVGO", "COST",
  "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS", "BHARTIARTL.NS", "ITC.NS", "LT.NS", "SBIN.NS", "HINDUNILVR.NS", "MARUTI.NS", "SUNPHARMA.NS",
];
