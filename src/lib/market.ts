import "server-only";
import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

// Simple in-process TTL cache so repeated page loads and tool calls don't hammer Yahoo.
const cache = new Map<string, { expires: number; value: unknown }>();
async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await load();
  cache.set(key, { expires: Date.now() + ttlMs, value });
  return value;
}

export const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.\-^=]{0,14}$/;

export function normalizeSymbol(raw: string): string {
  const symbol = raw.trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) throw new MarketError(`"${raw}" is not a valid ticker symbol.`);
  return symbol;
}

export class MarketError extends Error {}

export type TopCategory = "most_actives" | "day_gainers" | "day_losers";

export const TOP_CATEGORY_LABELS: Record<TopCategory, string> = {
  most_actives: "Most active",
  day_gainers: "Top gainers",
  day_losers: "Top losers",
};

export type StockRow = {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number | null;
  marketCap: number | null;
};

export async function getTopStocks(category: TopCategory, count = 10): Promise<StockRow[]> {
  return cached(`top:${category}:${count}`, 60_000, async () => {
    const result = await yf.screener({ scrIds: category, count });
    return result.quotes
      .filter((q) => typeof q.regularMarketPrice === "number")
      .map((q) => ({
        symbol: q.symbol,
        name: q.shortName ?? q.longName ?? q.symbol,
        price: q.regularMarketPrice ?? 0,
        change: q.regularMarketChange ?? 0,
        changePercent: q.regularMarketChangePercent ?? 0,
        volume: q.regularMarketVolume ?? null,
        marketCap: q.marketCap ?? null,
      }));
  });
}

export type Quote = {
  symbol: string;
  name: string;
  currency: string;
  exchange: string;
  price: number;
  change: number;
  changePercent: number;
  previousClose: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  volume: number | null;
  averageVolume: number | null;
  marketCap: number | null;
  trailingPE: number | null;
  marketState: string | null;
  /** USD per 1 unit of `currency` (1 for USD). Paper-trading cash is in USD. */
  usdRate: number;
  priceUsd: number;
};

// Yahoo quotes a few markets in minor units (London in pence, Johannesburg in cents, Tel Aviv in agorot).
const MINOR_UNITS: Record<string, string> = { GBp: "GBP", GBX: "GBP", ZAc: "ZAR", ILA: "ILS" };

/** Live exchange rate: how many USD one unit of `currency` is worth. */
export async function getUsdRate(currency: string): Promise<number> {
  if (currency === "USD") return 1;
  const major = MINOR_UNITS[currency];
  const base = major ?? currency.toUpperCase();
  const rate = await cached(`fx:${base}`, 10 * 60_000, async () => {
    const q = await yf.quote(`${base}USD=X`).catch(() => undefined);
    if (!q || typeof q.regularMarketPrice !== "number") {
      throw new MarketError(`No exchange rate available for ${currency}.`);
    }
    return q.regularMarketPrice;
  });
  return major ? rate / 100 : rate;
}

const TRADABLE_TYPES = new Set(["EQUITY", "ETF"]);

/** Live quote. Throws MarketError for unknown symbols or non-stock instruments. */
export async function getQuote(rawSymbol: string): Promise<Quote> {
  const symbol = normalizeSymbol(rawSymbol);
  return cached(`quote:${symbol}`, 30_000, async () => {
    let q;
    try {
      q = await yf.quote(symbol);
    } catch {
      q = undefined;
    }
    if (!q || typeof q.regularMarketPrice !== "number") {
      throw new MarketError(`No market data found for "${symbol}". Check the ticker symbol.`);
    }
    if (!TRADABLE_TYPES.has(q.quoteType)) {
      throw new MarketError(`${symbol} is a ${q.quoteType}, only stocks and ETFs are supported.`);
    }
    const currency = q.currency ?? "USD";
    const usdRate = await getUsdRate(currency);
    return {
      symbol: q.symbol,
      name: q.longName ?? q.shortName ?? q.symbol,
      currency,
      exchange: q.fullExchangeName ?? q.exchange ?? "",
      price: q.regularMarketPrice,
      change: q.regularMarketChange ?? 0,
      changePercent: q.regularMarketChangePercent ?? 0,
      previousClose: q.regularMarketPreviousClose ?? null,
      dayHigh: q.regularMarketDayHigh ?? null,
      dayLow: q.regularMarketDayLow ?? null,
      fiftyTwoWeekHigh: q.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow: q.fiftyTwoWeekLow ?? null,
      volume: q.regularMarketVolume ?? null,
      averageVolume: q.averageDailyVolume3Month ?? null,
      marketCap: q.marketCap ?? null,
      trailingPE: q.trailingPE ?? null,
      marketState: q.marketState ?? null,
      usdRate,
      priceUsd: q.regularMarketPrice * usdRate,
    };
  });
}

/** Quotes for several symbols; symbols that fail are left out. */
export async function getQuotes(symbols: string[]): Promise<Map<string, Quote>> {
  const results = await Promise.allSettled(symbols.map((s) => getQuote(s)));
  const map = new Map<string, Quote>();
  results.forEach((r, i) => {
    if (r.status === "fulfilled") map.set(symbols[i], r.value);
  });
  return map;
}

export type Bar = { date: string; close: number; volume: number };

/** Daily closes for roughly the last `days` calendar days, oldest first. */
export async function getHistory(rawSymbol: string, days = 400): Promise<Bar[]> {
  const symbol = normalizeSymbol(rawSymbol);
  return cached(`hist:${symbol}:${days}`, 10 * 60_000, async () => {
    const result = await yf.chart(symbol, {
      period1: new Date(Date.now() - days * 86_400_000),
      interval: "1d",
    });
    return result.quotes
      .filter((b) => typeof b.close === "number")
      .map((b) => ({
        date: b.date.toISOString().slice(0, 10),
        close: (b.adjclose ?? b.close) as number,
        volume: b.volume ?? 0,
      }));
  });
}

export type SearchHit = { symbol: string; name: string; exchange: string; type: string };

export async function searchSymbols(query: string): Promise<SearchHit[]> {
  const q = query.trim().slice(0, 50);
  if (!q) return [];
  return cached(`search:${q.toLowerCase()}`, 10 * 60_000, async () => {
    let result = await yf.search(q, { quotesCount: 8, newsCount: 0 });
    if (!result.quotes.length && /\s/.test(q)) {
      result = await yf.search(q.replace(/\s+/g, ""), { quotesCount: 8, newsCount: 0 });
    }
    return result.quotes
      .filter((x): x is typeof x & { symbol: string; quoteType: string } =>
        "symbol" in x && typeof x.symbol === "string" && TRADABLE_TYPES.has(String(x.quoteType)),
      )
      .map((x) => ({
        symbol: x.symbol,
        name: String(("longname" in x && x.longname) || ("shortname" in x && x.shortname) || x.symbol),
        exchange: String(("exchDisp" in x && x.exchDisp) || ""),
        type: x.quoteType,
      }));
  });
}

/**
 * Turns what a user typed into a symbol with market data: "RR KABEL" -> "RRKABEL.NS", "tcs" -> "TCS.NS".
 * Returns null when nothing matches.
 */
export async function resolveSymbol(text: string): Promise<string | null> {
  const raw = text.trim();
  if (!raw) return null;
  if (SYMBOL_RE.test(raw.toUpperCase())) {
    const ok = await getQuote(raw).then(() => true, () => false);
    if (ok) return raw.toUpperCase();
  }
  const hits = await searchSymbols(raw).catch(() => []);
  return hits[0]?.symbol ?? null;
}
