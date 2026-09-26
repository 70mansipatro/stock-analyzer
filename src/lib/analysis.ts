import "server-only";
import { dailyLogReturns, macd, rsi, sma, stdev } from "@/lib/indicators";
import { getHistory, getQuote, type Bar, type Quote } from "@/lib/market";

export { dailyLogReturns, stdev };

function pctChange(values: number[], lookback: number): number | null {
  if (values.length <= lookback) return null;
  const past = values[values.length - 1 - lookback];
  return ((values[values.length - 1] - past) / past) * 100;
}

const round = (n: number | null, d = 2) => (n === null || !Number.isFinite(n) ? null : Number(n.toFixed(d)));

// ---------- Full analysis ----------

export type Signal = { label: string; stance: "bullish" | "bearish" | "neutral"; detail: string };

export type Analysis = {
  quote: Quote;
  indicators: {
    sma20: number | null;
    sma50: number | null;
    sma200: number | null;
    rsi14: number | null;
    macd: number | null;
    macdSignal: number | null;
    macdHistogram: number | null;
    annualizedVolatilityPct: number | null;
    return1mPct: number | null;
    return3mPct: number | null;
    return6mPct: number | null;
    return1yPct: number | null;
    percentFrom52wHigh: number | null;
  };
  signals: Signal[];
  overall: "bullish" | "bearish" | "neutral";
  score: number;
  chart: { date: string; close: number; sma50: number | null; sma200: number | null }[];
};

export async function analyzeStock(symbol: string): Promise<Analysis> {
  const [quote, history] = await Promise.all([getQuote(symbol), getHistory(symbol, 600)]);
  return buildAnalysis(quote, history);
}

export function buildAnalysis(quote: Quote, history: Bar[]): Analysis {
  const closes = history.map((b) => b.close);
  if (closes.length < 30) throw new Error(`Not enough price history for ${quote.symbol} to analyze.`);

  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  const s200 = sma(closes, 200);
  const last = closes.length - 1;
  const price = quote.price;
  const sma20v = s20[last];
  const sma50v = s50[last];
  const sma200v = s200[last];
  const rsi14 = rsi(closes);
  const m = macd(closes);
  const vol = stdev(dailyLogReturns(closes.slice(-252))) * Math.sqrt(252) * 100;

  const signals: Signal[] = [];
  if (sma50v !== null && sma200v !== null) {
    signals.push(
      sma50v > sma200v
        ? { label: "Golden cross regime", stance: "bullish", detail: "50-day average is above the 200-day average (long-term uptrend)." }
        : { label: "Death cross regime", stance: "bearish", detail: "50-day average is below the 200-day average (long-term downtrend)." },
    );
  }
  if (sma50v !== null) {
    signals.push(
      price > sma50v
        ? { label: "Above 50-day average", stance: "bullish", detail: `Price is ${(((price - sma50v) / sma50v) * 100).toFixed(1)}% above its 50-day average.` }
        : { label: "Below 50-day average", stance: "bearish", detail: `Price is ${(((sma50v - price) / sma50v) * 100).toFixed(1)}% below its 50-day average.` },
    );
  }
  if (rsi14 !== null) {
    if (rsi14 >= 70) signals.push({ label: "Overbought (RSI)", stance: "bearish", detail: `RSI(14) is ${rsi14.toFixed(0)}, above 70; a pullback is more likely.` });
    else if (rsi14 <= 30) signals.push({ label: "Oversold (RSI)", stance: "bullish", detail: `RSI(14) is ${rsi14.toFixed(0)}, below 30; a bounce is more likely.` });
    else signals.push({ label: "RSI neutral", stance: "neutral", detail: `RSI(14) is ${rsi14.toFixed(0)}, between 30 and 70.` });
  }
  signals.push(
    m.histogram >= 0
      ? { label: "MACD positive", stance: "bullish", detail: "MACD is above its signal line (momentum improving)." }
      : { label: "MACD negative", stance: "bearish", detail: "MACD is below its signal line (momentum weakening)." },
  );

  const score = signals.reduce((acc, s) => acc + (s.stance === "bullish" ? 1 : s.stance === "bearish" ? -1 : 0), 0);
  const overall = score >= 2 ? "bullish" : score <= -2 ? "bearish" : "neutral";

  const chartStart = Math.max(0, closes.length - 252);
  const chart = history.slice(chartStart).map((b, i) => ({
    date: b.date,
    close: round(b.close) as number,
    sma50: round(s50[chartStart + i]),
    sma200: round(s200[chartStart + i]),
  }));

  return {
    quote,
    indicators: {
      sma20: round(sma20v),
      sma50: round(sma50v),
      sma200: round(sma200v),
      rsi14: round(rsi14, 1),
      macd: round(m.macd, 3),
      macdSignal: round(m.signal, 3),
      macdHistogram: round(m.histogram, 3),
      annualizedVolatilityPct: round(vol, 1),
      return1mPct: round(pctChange(closes, 21)),
      return3mPct: round(pctChange(closes, 63)),
      return6mPct: round(pctChange(closes, 126)),
      return1yPct: round(pctChange(closes, 252)),
      percentFrom52wHigh: quote.fiftyTwoWeekHigh ? round(((price - quote.fiftyTwoWeekHigh) / quote.fiftyTwoWeekHigh) * 100) : null,
    },
    signals,
    overall,
    score,
    chart,
  };
}
