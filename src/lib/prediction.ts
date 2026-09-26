import "server-only";
import { dailyLogReturns, stdev } from "@/lib/analysis";
import { getHistory, getQuote } from "@/lib/market";

/**
 * Statistical price forecast. This is NOT a guarantee of future prices.
 *
 * Model: fit a straight line to log prices over the last 120 trading days (the trend, or drift),
 * then project it forward. The uncertainty band comes from recent daily volatility and widens
 * with the square root of time (a random-walk-with-drift assumption).
 * Accuracy is measured by backtesting: re-fit the model 20 trading days ago and compare its
 * forecast with what actually happened.
 */

const FIT_WINDOW = 120;
const BACKTEST_DAYS = 20;
const Z_90 = 1.645; // 90% interval

function fitDrift(closes: number[]): { slope: number; last: number } {
  const ys = closes.map((c) => Math.log(c));
  const n = ys.length;
  const xMean = (n - 1) / 2;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  ys.forEach((y, x) => {
    num += (x - xMean) * (y - yMean);
    den += (x - xMean) ** 2;
  });
  return { slope: num / den, last: closes[n - 1] };
}

export type ForecastPoint = { date: string; expected: number; low: number; high: number };

export type Prediction = {
  symbol: string;
  currency: string;
  currentPrice: number;
  horizonDays: number;
  expectedPrice: number;
  low90: number;
  high90: number;
  expectedReturnPct: number;
  direction: "up" | "down" | "flat";
  dailyVolatilityPct: number;
  backtest: { days: number; predicted: number; actual: number; errorPct: number; withinBand: boolean } | null;
  history: { date: string; close: number }[];
  forecast: ForecastPoint[];
  method: string;
  disclaimer: string;
};

function addTradingDays(from: Date, n: number): Date {
  const d = new Date(from);
  let added = 0;
  while (added < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) added++;
  }
  return d;
}

export async function predictStock(symbol: string, horizonDays = 30): Promise<Prediction> {
  const horizon = Math.min(Math.max(Math.round(horizonDays), 5), 90);
  const [quote, bars] = await Promise.all([getQuote(symbol), getHistory(symbol, 400)]);
  const closes = bars.map((b) => b.close);
  if (closes.length < FIT_WINDOW + BACKTEST_DAYS) {
    throw new Error(`Not enough price history for ${quote.symbol} to make a forecast.`);
  }

  // Use the live price as the latest point so the forecast starts from today's price.
  const series = [...closes.slice(-FIT_WINDOW - 1, -1), quote.price];
  const { slope } = fitDrift(series);
  const sigma = stdev(dailyLogReturns(closes.slice(-60)));
  const start = quote.price;

  const lastDate = new Date(bars[bars.length - 1].date + "T00:00:00Z");
  const forecast: ForecastPoint[] = [];
  for (let t = 1; t <= horizon; t++) {
    const mid = start * Math.exp(slope * t);
    const spread = Z_90 * sigma * Math.sqrt(t);
    forecast.push({
      date: addTradingDays(lastDate, t).toISOString().slice(0, 10),
      expected: Number(mid.toFixed(2)),
      low: Number((mid * Math.exp(-spread)).toFixed(2)),
      high: Number((mid * Math.exp(spread)).toFixed(2)),
    });
  }
  const end = forecast[forecast.length - 1];

  // Backtest: fit on data ending BACKTEST_DAYS ago, forecast to today, compare.
  const past = closes.slice(-FIT_WINDOW - BACKTEST_DAYS, -BACKTEST_DAYS);
  const pastFit = fitDrift(past);
  const pastSigma = stdev(dailyLogReturns(closes.slice(-60 - BACKTEST_DAYS, -BACKTEST_DAYS)));
  const predicted = pastFit.last * Math.exp(pastFit.slope * BACKTEST_DAYS);
  const actual = closes[closes.length - 1];
  const bandSpread = Z_90 * pastSigma * Math.sqrt(BACKTEST_DAYS);
  const backtest = {
    days: BACKTEST_DAYS,
    predicted: Number(predicted.toFixed(2)),
    actual: Number(actual.toFixed(2)),
    errorPct: Number(((Math.abs(predicted - actual) / actual) * 100).toFixed(2)),
    withinBand: actual >= predicted * Math.exp(-bandSpread) && actual <= predicted * Math.exp(bandSpread),
  };

  const expectedReturnPct = ((end.expected - start) / start) * 100;
  return {
    symbol: quote.symbol,
    currency: quote.currency,
    currentPrice: start,
    horizonDays: horizon,
    expectedPrice: end.expected,
    low90: end.low,
    high90: end.high,
    expectedReturnPct: Number(expectedReturnPct.toFixed(2)),
    direction: expectedReturnPct > 1 ? "up" : expectedReturnPct < -1 ? "down" : "flat",
    dailyVolatilityPct: Number((sigma * 100).toFixed(2)),
    backtest,
    history: bars.slice(-90).map((b) => ({ date: b.date, close: Number(b.close.toFixed(2)) })),
    forecast,
    method: `Log-linear trend fitted to the last ${FIT_WINDOW} trading days, with a 90% range from 60-day volatility.`,
    disclaimer:
      "Statistical projection from past prices only. It ignores news, earnings and market events and is not financial advice.",
  };
}
