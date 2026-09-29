import "server-only";
import { getHistory, getUsdRate, type Bar } from "@/lib/market";
import { planActions, scoreStock, type PlanConfig, type Position } from "./strategy";

/**
 * Replays real daily prices through the same strategy the live agent uses: every trading day it scores
 * the universe with only the data known that day, plans orders under the same limits, and fills them at
 * that day's close. Non-USD stocks use today's exchange rate for the whole period (a simplification).
 */

export type BacktestTrade = { date: string; symbol: string; side: "BUY" | "SELL"; quantity: number; priceUsd: number; reason: string; pnlUsd: number | null };

export type BacktestResult = {
  days: number;
  startDate: string;
  endDate: string;
  startValue: number;
  endValue: number;
  returnPct: number;
  benchmarks: { label: string; returnPct: number }[];
  maxDrawdownPct: number;
  sharpe: number | null;
  trades: number;
  closedTrades: number;
  winRatePct: number | null;
  curve: { date: string; agent: number; buyHold: number; sp500: number | null; nifty: number | null }[];
  tradeLog: BacktestTrade[];
  symbolsUsed: number;
};

const WARMUP = 210; // bars needed before the first decision (200-day average)

export async function runBacktest(universe: string[], cfg: PlanConfig, days = 126): Promise<BacktestResult> {
  const span = days + WARMUP + 40;
  const calendarDays = Math.ceil(span * 1.5);
  const loaded = await Promise.all(
    universe.map(async (symbol) => {
      try {
        const [bars, rate] = await Promise.all([getHistory(symbol, calendarDays), getUsdRate(/\.(NS|BO)$/.test(symbol) ? "INR" : "USD")]);
        return bars.length > WARMUP + 20 ? { symbol, bars, rate } : null;
      } catch {
        return null;
      }
    }),
  );
  const stocks = loaded.filter((x): x is { symbol: string; bars: Bar[]; rate: number } => !!x);
  if (!stocks.length) throw new Error("Not enough price history to backtest.");
  const [sp, nf] = await Promise.all([getHistory("^GSPC", calendarDays).catch(() => []), getHistory("^NSEI", calendarDays).catch(() => [])]);

  // Trading calendar = union of every stock's dates, limited to the test window.
  const allDates = [...new Set(stocks.flatMap((s) => s.bars.map((b) => b.date)))].sort();
  const window = allDates.slice(-days);
  const idx = new Map(stocks.map((s) => [s.symbol, new Map(s.bars.map((b, i) => [b.date, i]))]));
  const lastIdx = new Map<string, number>();

  let cash = cfg.budgetUsd;
  const pos = new Map<string, { quantity: number; avgCostUsd: number; boughtAt: number }>();
  const tradeLog: BacktestTrade[] = [];
  const curve: BacktestResult["curve"] = [];
  const priceOn = (sym: string) => {
    const s = stocks.find((x) => x.symbol === sym)!;
    const i = lastIdx.get(sym);
    return i === undefined ? null : s.bars[i].close * s.rate;
  };

  // Buy-and-hold: split the budget equally on the first day.
  const bh = new Map<string, number>();
  const spMap = new Map(sp.map((b) => [b.date, b.close]));
  const nfMap = new Map(nf.map((b) => [b.date, b.close]));
  let spStart: number | null = null;
  let nfStart: number | null = null;
  let spLast: number | null = null;
  let nfLast: number | null = null;

  for (const date of window) {
    for (const s of stocks) {
      const i = idx.get(s.symbol)!.get(date);
      if (i !== undefined) lastIdx.set(s.symbol, i);
    }
    if (!bh.size) {
      const each = cfg.budgetUsd / stocks.length;
      for (const s of stocks) {
        const p = priceOn(s.symbol);
        if (p) bh.set(s.symbol, each / p);
      }
    }

    // Decide with data up to today only.
    const candidates = stocks.flatMap((s) => {
      const i = idx.get(s.symbol)!.get(date);
      if (i === undefined || i < WARMUP) return [];
      const closes = s.bars.slice(0, i + 1).map((b) => b.close);
      return [{ ...scoreStock(s.symbol, closes), priceUsd: closes[closes.length - 1] * s.rate }];
    });
    const dayNo = curve.length;
    const positions: Position[] = [...pos.entries()].map(([symbol, p]) => ({ symbol, quantity: p.quantity, avgCostUsd: p.avgCostUsd, heldDays: dayNo - p.boughtAt, priceUsd: priceOn(symbol) ?? p.avgCostUsd }));
    const plan = planActions({ candidates, positions, cashUsd: cash, tradesToday: 0, cfg });
    for (const a of plan) {
      if (a.action === "BUY") {
        const cost = a.quantity * a.priceUsd;
        if (cost > cash) continue;
        cash -= cost;
        pos.set(a.symbol, { quantity: a.quantity, avgCostUsd: a.priceUsd, boughtAt: dayNo });
        tradeLog.push({ date, symbol: a.symbol, side: "BUY", quantity: a.quantity, priceUsd: a.priceUsd, reason: `Score ${a.score}: ${a.reasons.filter((r) => r.points > 0).slice(0, 2).map((r) => r.factor).join(", ")}`, pnlUsd: null });
      } else {
        const p = pos.get(a.symbol);
        if (!p) continue;
        cash += a.quantity * a.priceUsd;
        pos.delete(a.symbol);
        tradeLog.push({ date, symbol: a.symbol, side: "SELL", quantity: a.quantity, priceUsd: a.priceUsd, reason: a.reasons[0]?.factor ?? "Sell signal", pnlUsd: (a.priceUsd - p.avgCostUsd) * a.quantity });
      }
    }

    const invested = [...pos.entries()].reduce((a, [sym, p]) => a + p.quantity * (priceOn(sym) ?? p.avgCostUsd), 0);
    const bhValue = [...bh.entries()].reduce((a, [sym, q]) => a + q * (priceOn(sym) ?? 0), 0);
    if (spMap.has(date)) spLast = spMap.get(date)!;
    if (nfMap.has(date)) nfLast = nfMap.get(date)!;
    if (spStart === null && spLast !== null) spStart = spLast;
    if (nfStart === null && nfLast !== null) nfStart = nfLast;
    curve.push({
      date,
      agent: Number((cash + invested).toFixed(2)),
      buyHold: Number(bhValue.toFixed(2)),
      sp500: spStart && spLast ? Number(((spLast / spStart) * cfg.budgetUsd).toFixed(2)) : null,
      nifty: nfStart && nfLast ? Number(((nfLast / nfStart) * cfg.budgetUsd).toFixed(2)) : null,
    });
  }

  const end = curve[curve.length - 1];
  let peak = -Infinity;
  let maxDd = 0;
  for (const p of curve) {
    peak = Math.max(peak, p.agent);
    maxDd = Math.max(maxDd, (peak - p.agent) / peak);
  }
  const rets = curve.slice(1).map((p, i) => p.agent / curve[i].agent - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(rets.length - 1, 1));
  const closed = tradeLog.filter((t) => t.pnlUsd !== null);
  const pct = (v: number | null) => (v === null ? null : Number((((v - cfg.budgetUsd) / cfg.budgetUsd) * 100).toFixed(2)));

  return {
    days: curve.length,
    startDate: curve[0].date,
    endDate: end.date,
    startValue: cfg.budgetUsd,
    endValue: end.agent,
    returnPct: pct(end.agent)!,
    benchmarks: [
      { label: "Buy & hold (same stocks)", returnPct: pct(end.buyHold)! },
      ...(end.sp500 !== null ? [{ label: "S&P 500", returnPct: pct(end.sp500)! }] : []),
      ...(end.nifty !== null ? [{ label: "NIFTY 50", returnPct: pct(end.nifty)! }] : []),
    ],
    maxDrawdownPct: Number((maxDd * 100).toFixed(2)),
    sharpe: sd > 0 ? Number(((mean / sd) * Math.sqrt(252)).toFixed(2)) : null,
    trades: tradeLog.length,
    closedTrades: closed.length,
    winRatePct: closed.length ? Number(((closed.filter((t) => (t.pnlUsd ?? 0) > 0).length / closed.length) * 100).toFixed(1)) : null,
    curve,
    tradeLog: tradeLog.slice(-120).reverse(),
    symbolsUsed: stocks.length,
  };
}
