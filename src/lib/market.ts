import "server-only";
import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"], validation: { logErrors: false } });

// Simple in-process TTL cache so repeated page loads and tool calls don't hammer Yahoo.
const cache = new Map<string, { expires: number; value: unknown }>();
async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await load();
  cache.set(key, { expires: Date.now() + ttlMs, value });
  return value;
}

// Letters/digits plus . - = & (e.g. BRK-B, RRKABEL.NS, INR=X, M&M.NS); indices start with ^ (e.g. ^GSPC).
export const SYMBOL_RE = /^\^?[A-Z0-9][A-Z0-9.\-=&]{0,14}$/;

// Google Finance / broker style exchange codes -> Yahoo suffix ("NSE: SWIGGY" -> "SWIGGY.NS").
const EXCHANGE_SUFFIX: Record<string, string> = {
  NSE: ".NS", NSEI: ".NS", BSE: ".BO", BOM: ".BO",
  NASDAQ: "", NYSE: "", NYSEARCA: "", NYSEAMERICAN: "", AMEX: "", BATS: "", OTC: "", OTCMKTS: "",
  LON: ".L", LSE: ".L", TSE: ".T", TYO: ".T", HKG: ".HK", HKEX: ".HK", TSX: ".TO", TSXV: ".V",
  ASX: ".AX", FRA: ".F", ETR: ".DE", XETRA: ".DE", EPA: ".PA", AMS: ".AS", SWX: ".SW", SHA: ".SS", SHE: ".SZ",
  KRX: ".KS", KOSDAQ: ".KQ", SGX: ".SI", TPE: ".TW",
};

/** Accepts "NSE: SWIGGY", "NSE:SWIGGY", "SWIGGY:NSE" and "nasdaq aapl"; returns Yahoo's form or the input unchanged. */
export function fromExchangeNotation(raw: string): string {
  const t = raw.trim().toUpperCase().replace(/\s+/g, " ");
  let m = t.match(/^([A-Z]+)\s*[:\s]\s*([A-Z0-9.\-&]+)$/);
  if (m && m[1] in EXCHANGE_SUFFIX) return m[2].replace(/\.(NS|BO)$/, "") + EXCHANGE_SUFFIX[m[1]];
  m = t.match(/^([A-Z0-9.\-&]+)\s*:\s*([A-Z]+)$/);
  if (m && m[2] in EXCHANGE_SUFFIX) return m[1] + EXCHANGE_SUFFIX[m[2]];
  return raw.trim();
}

// Brand or former names that Yahoo's search doesn't find, mapped to today's listing.
const NAME_ALIASES: Record<string, string> = {
  zomato: "ETERNAL.NS", "zomato ltd": "ETERNAL.NS", blinkit: "ETERNAL.NS", eternal: "ETERNAL.NS",
  paytm: "PAYTM.NS", "one97": "PAYTM.NS", nykaa: "NYKAA.NS", policybazaar: "POLICYBZR.NS", "pb fintech": "POLICYBZR.NS",
  "hero honda": "HEROMOTOCO.NS", "hero motocorp": "HEROMOTOCO.NS", mapmyindia: "MAPMYINDIA.NS", ixigo: "IXIGO.NS",
  groww: "GROWW.NS", dmart: "DMART.NS", "d mart": "DMART.NS", lic: "LICI.NS", "jio financial": "JIOFIN.NS",
  "ola electric": "OLAELEC.NS", "vodafone idea": "IDEA.NS", "urban company": "URBANCO.NS", lenskart: "LENSKART.NS",
  meesho: "MEESHO.NS", irctc: "IRCTC.NS", "l&t": "LT.NS", "larsen": "LT.NS", sbi: "SBIN.NS", airtel: "BHARTIARTL.NS",
  "tata passenger": "TMPV.NS", "tata motors": "TMPV.NS", "tata commercial": "TMCV.NS",
  facebook: "META", google: "GOOGL", "square": "XYZ", "cash app": "XYZ", "berkshire": "BRK-B", "berkshire hathaway": "BRK-B",
};
// Tickers that changed; the base symbol (without exchange suffix) maps to the new base.
const SYMBOL_RENAMES: Record<string, string> = { ZOMATO: "ETERNAL", FB: "META", SQ: "XYZ", TATAMOTORS: "TMPV" };

function aliasFor(query: string): string | undefined {
  const key = query
    .toLowerCase()
    .replace(/\b(ltd|limited|inc|corp|shares?|stocks?|stoks?|company)\b\.?/g, "")
    .replace(/[^a-z0-9& ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return NAME_ALIASES[key];
}

/** New symbol for a renamed ticker ("ZOMATO.NS" -> "ETERNAL.NS"), or undefined. */
function renamedSymbol(symbol: string): string | undefined {
  const [base, ...rest] = symbol.split(".");
  const next = SYMBOL_RENAMES[base];
  return next ? [next, ...rest].join(".") : undefined;
}

export function normalizeSymbol(raw: string): string {
  const symbol = fromExchangeNotation(raw).toUpperCase();
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
      const renamed = renamedSymbol(symbol);
      if (renamed) return getQuote(renamed);
      throw new MarketError(
        `No market data found for "${symbol}". The company may trade under a new or legal name: search by company name with searchStocks.`,
      );
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
  const q = fromExchangeNotation(query).slice(0, 50);
  if (!q) return [];
  return cached(`search:${q.toLowerCase()}`, 10 * 60_000, async () => {
    let result = await yf.search(q, { quotesCount: 8, newsCount: 0 });
    if (!result.quotes.length && /\s/.test(q)) {
      result = await yf.search(q.replace(/\s+/g, ""), { quotesCount: 8, newsCount: 0 });
    }
    const alias = aliasFor(q);
    const hits = result.quotes
      .filter((x): x is typeof x & { symbol: string; quoteType: string } =>
        "symbol" in x && typeof x.symbol === "string" && TRADABLE_TYPES.has(String(x.quoteType)),
      )
      .map((x) => ({
        symbol: x.symbol,
        name: String(("longname" in x && x.longname) || ("shortname" in x && x.shortname) || x.symbol),
        exchange: String(("exchDisp" in x && x.exchDisp) || ""),
        type: x.quoteType,
      }));
    if (alias && !hits.some((h) => h.symbol === alias)) {
      const aq = await yf.quote(alias).catch(() => undefined);
      if (aq) hits.unshift({ symbol: aq.symbol, name: aq.longName ?? aq.shortName ?? aq.symbol, exchange: aq.fullExchangeName ?? aq.exchange ?? "", type: aq.quoteType });
    } else if (alias) {
      hits.sort((a, b) => (a.symbol === alias ? -1 : b.symbol === alias ? 1 : 0));
    }
    return hits;
  });
}

/**
 * Turns what a user typed into a symbol with market data: "RR KABEL" -> "RRKABEL.NS", "tcs" -> "TCS.NS".
 * Returns null when nothing matches.
 */
export async function resolveSymbol(text: string): Promise<string | null> {
  const raw = fromExchangeNotation(text);
  if (!raw) return null;
  const alias = aliasFor(raw);
  if (alias) return alias;
  if (SYMBOL_RE.test(raw.toUpperCase())) {
    const ok = await getQuote(raw).then(() => true, () => false);
    if (ok) return raw.toUpperCase();
  }
  const hits = await searchSymbols(raw).catch(() => []);
  return hits[0]?.symbol ?? null;
}

// ---------- Market overview (indices, commodities, crypto, FX) ----------

export const OVERVIEW_SYMBOLS: { symbol: string; label: string }[] = [
  { symbol: "^GSPC", label: "S&P 500" },
  { symbol: "^IXIC", label: "NASDAQ" },
  { symbol: "^DJI", label: "Dow Jones" },
  { symbol: "^NSEI", label: "NIFTY 50" },
  { symbol: "^BSESN", label: "SENSEX" },
  { symbol: "GC=F", label: "Gold" },
  { symbol: "CL=F", label: "Crude oil" },
  { symbol: "BTC-USD", label: "Bitcoin" },
  { symbol: "INR=X", label: "USD/INR" },
];

export type OverviewItem = { symbol: string; label: string; price: number; changePercent: number; currency: string };

export async function getMarketOverview(): Promise<OverviewItem[]> {
  return cached("overview", 60_000, async () => {
    const quotes = await yf.quote(OVERVIEW_SYMBOLS.map((s) => s.symbol));
    const bySymbol = new Map(quotes.map((q) => [q.symbol, q]));
    return OVERVIEW_SYMBOLS.flatMap(({ symbol, label }) => {
      const q = bySymbol.get(symbol);
      if (!q || typeof q.regularMarketPrice !== "number") return [];
      return [{ symbol, label, price: q.regularMarketPrice, changePercent: q.regularMarketChangePercent ?? 0, currency: q.currency ?? "USD" }];
    });
  });
}

// ---------- Heatmap universes (large caps grouped by sector) ----------

const HEATMAP_UNIVERSE: Record<"US" | "IN", Record<string, string[]>> = {
  US: {
    Technology: ["AAPL", "MSFT", "NVDA", "AVGO", "ORCL", "CRM", "AMD", "ADBE", "INTC", "CSCO"],
    Communication: ["GOOGL", "META", "NFLX", "DIS", "T", "VZ"],
    "Consumer Cyclical": ["AMZN", "TSLA", "HD", "MCD", "NKE", "SBUX"],
    Financial: ["JPM", "V", "MA", "BAC", "WFC", "GS"],
    Healthcare: ["LLY", "UNH", "JNJ", "ABBV", "MRK", "PFE"],
    "Consumer Defensive": ["WMT", "PG", "KO", "PEP", "COST"],
    Energy: ["XOM", "CVX", "COP"],
    Industrials: ["GE", "CAT", "BA", "UPS"],
  },
  IN: {
    Financial: ["HDFCBANK.NS", "ICICIBANK.NS", "SBIN.NS", "KOTAKBANK.NS", "AXISBANK.NS", "BAJFINANCE.NS"],
    Technology: ["TCS.NS", "INFY.NS", "HCLTECH.NS", "WIPRO.NS", "TECHM.NS"],
    Energy: ["RELIANCE.NS", "ONGC.NS", "NTPC.NS", "POWERGRID.NS"],
    "Consumer Defensive": ["HINDUNILVR.NS", "ITC.NS", "NESTLEIND.NS"],
    "Consumer Cyclical": ["MARUTI.NS", "M&M.NS", "TITAN.NS"],
    Industrials: ["LT.NS", "ADANIPORTS.NS"],
    Materials: ["TATASTEEL.NS", "JSWSTEEL.NS", "ULTRACEMCO.NS"],
    Healthcare: ["SUNPHARMA.NS", "DRREDDY.NS"],
    Communication: ["BHARTIARTL.NS"],
  },
};

export type HeatmapTile = {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  changePercent: number;
  marketCap: number;
  currency: string;
};

export async function getHeatmap(region: "US" | "IN"): Promise<HeatmapTile[]> {
  return cached(`heatmap:${region}`, 2 * 60_000, async () => {
    const sectorOf = new Map<string, string>();
    for (const [sector, symbols] of Object.entries(HEATMAP_UNIVERSE[region])) symbols.forEach((s) => sectorOf.set(s, sector));
    const quotes = await yf.quote([...sectorOf.keys()]);
    return quotes
      .filter((q) => typeof q.regularMarketPrice === "number" && typeof q.marketCap === "number")
      .map((q) => ({
        symbol: q.symbol,
        name: q.shortName ?? q.symbol,
        sector: sectorOf.get(q.symbol) ?? "Other",
        price: q.regularMarketPrice as number,
        changePercent: q.regularMarketChangePercent ?? 0,
        marketCap: q.marketCap as number,
        currency: q.currency ?? "USD",
      }));
  });
}

// ---------- Candles for the pro chart ----------

export const CHART_RANGES = ["1D", "5D", "1M", "6M", "1Y", "5Y"] as const;
export type ChartRange = (typeof CHART_RANGES)[number];

const RANGE_CONFIG: Record<ChartRange, { days: number; interval: "5m" | "15m" | "1d" | "1wk"; intraday: boolean }> = {
  "1D": { days: 4, interval: "5m", intraday: true },
  "5D": { days: 8, interval: "15m", intraday: true },
  "1M": { days: 32, interval: "1d", intraday: false },
  "6M": { days: 184, interval: "1d", intraday: false },
  "1Y": { days: 366, interval: "1d", intraday: false },
  "5Y": { days: 5 * 366, interval: "1wk", intraday: false },
};

/** `time` is unix seconds for intraday bars and YYYY-MM-DD for daily/weekly bars. */
export type Candle = { time: number | string; open: number; high: number; low: number; close: number; volume: number };

export async function getCandles(rawSymbol: string, range: ChartRange): Promise<{ candles: Candle[]; intraday: boolean }> {
  const symbol = normalizeSymbol(rawSymbol);
  const cfg = RANGE_CONFIG[range];
  return cached(`candles:${symbol}:${range}`, cfg.intraday ? 60_000 : 10 * 60_000, async () => {
    const result = await yf.chart(symbol, {
      period1: new Date(Date.now() - cfg.days * 86_400_000),
      interval: cfg.interval,
      includePrePost: false,
    });
    let bars = result.quotes.filter(
      (b) => [b.open, b.high, b.low, b.close].every((v) => typeof v === "number") && (b.high as number) > 0,
    );
    if (range === "1D" && bars.length) {
      // Keep only the latest trading session.
      const lastDay = bars[bars.length - 1].date.toISOString().slice(0, 10);
      bars = bars.filter((b) => b.date.toISOString().slice(0, 10) === lastDay);
    }
    const candles = bars.map((b) => ({
      time: cfg.intraday ? Math.floor(b.date.getTime() / 1000) : b.date.toISOString().slice(0, 10),
      open: b.open as number,
      high: b.high as number,
      low: b.low as number,
      close: b.close as number,
      volume: b.volume ?? 0,
    }));
    // Daily keys must be unique and ascending for the chart.
    const seen = new Set<string | number>();
    return { candles: candles.filter((c) => (seen.has(c.time) ? false : (seen.add(c.time), true))), intraday: cfg.intraday };
  });
}

// ---------- Company sector (for portfolio allocation) ----------

export async function getSector(rawSymbol: string): Promise<string> {
  const symbol = normalizeSymbol(rawSymbol);
  return cached(`sector:${symbol}`, 24 * 3600_000, async () => {
    try {
      const r = await yf.quoteSummary(symbol, { modules: ["assetProfile"] });
      return r.assetProfile?.sector || "Other";
    } catch {
      return "Other";
    }
  });
}

// ---------- News headlines ----------

export type NewsItem = { id: string; title: string; publisher: string; link: string; publishedAt: string; thumbnail: string | null };

/**
 * Headlines for a stock. Yahoo's search mixes in general market stories, so this queries by ticker and by
 * company name, then ranks stories whose headline names the company, then stories tagged with the ticker.
 */
export async function getNews(rawSymbol: string, count = 8, companyName?: string): Promise<NewsItem[]> {
  const symbol = normalizeSymbol(rawSymbol);
  return cached(`news:${symbol}:${count}`, 15 * 60_000, async () => {
    const name = (companyName ?? "")
      .replace(/\b(inc|incorporated|corp|corporation|ltd|limited|plc|co|company|holdings?|group|class [a-z])\b\.?/gi, "")
      .replace(/[,.]+/g, " ")
      .trim();
    const queries = [symbol, ...(name && name.toUpperCase() !== symbol ? [name] : [])];
    const results = await Promise.all(queries.map((q) => yf.search(q, { quotesCount: 0, newsCount: 20 }).catch(() => ({ news: [] }))));
    const unique = new Map<string, (typeof results)[number]["news"][number]>();
    results.flatMap((r) => r.news).forEach((n) => unique.has(n.uuid) || unique.set(n.uuid, n));

    const base = symbol.split(".")[0];
    const firstWord = name.split(/\s+/)[0]?.toLowerCase() ?? "";
    const score = (n: { title: string; relatedTickers?: string[] }) => {
      const title = n.title.toLowerCase();
      const tickers = n.relatedTickers ?? [];
      return (
        (firstWord.length > 2 && title.includes(firstWord) ? 4 : 0) +
        (title.includes(base.toLowerCase()) ? 2 : 0) +
        (tickers[0] === symbol ? 2 : tickers.some((t) => t === symbol || t.split(".")[0] === base) ? 1 : 0)
      );
    };
    const ranked = [...unique.values()]
      .map((n) => ({ n, s: score(n) }))
      .sort((a, b) => b.s - a.s || new Date(b.n.providerPublishTime).getTime() - new Date(a.n.providerPublishTime).getTime())
      .slice(0, count)
      .map(({ n }) => n);

    return ranked.map((n) => ({
      id: n.uuid,
      title: n.title,
      publisher: n.publisher,
      link: n.link,
      publishedAt: new Date(n.providerPublishTime).toISOString(),
      thumbnail: n.thumbnail?.resolutions?.find((t) => t.width >= 140)?.url ?? n.thumbnail?.resolutions?.[0]?.url ?? null,
    }));
  });
}
