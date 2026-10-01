/**
 * Exchange sessions for the two markets the app trades: US (NYSE/Nasdaq, New York time) and
 * India (NSE/BSE, Asia/Kolkata). All times are computed in the exchange's own time zone, so the
 * server's time zone and daylight saving never matter.
 *
 * Holidays: the published full-day closures and early closes are listed below. Lists for future years
 * aren't always known in advance, so extra dates can be added without a code change through the
 * MARKET_HOLIDAYS_US / MARKET_HOLIDAYS_IN environment variables (comma-separated YYYY-MM-DD).
 */

export type MarketId = "US" | "IN";

type MarketDef = { id: MarketId; label: string; exchanges: string; tz: string; open: number; close: number };

const MARKETS: MarketDef[] = [
  { id: "US", label: "NYSE", exchanges: "NYSE / Nasdaq", tz: "America/New_York", open: 9 * 60 + 30, close: 16 * 60 },
  { id: "IN", label: "NSE", exchanges: "NSE / BSE", tz: "Asia/Kolkata", open: 9 * 60 + 15, close: 15 * 60 + 30 },
];

const HOLIDAYS: Record<MarketId, string[]> = {
  US: [
    // 2026
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
    // 2027
    "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
  ],
  IN: [
    // 2026 (NSE trading holidays)
    "2026-01-26", "2026-03-03", "2026-03-26", "2026-03-31", "2026-04-03", "2026-04-14", "2026-05-01", "2026-05-28", "2026-06-26", "2026-09-14", "2026-10-02", "2026-10-20", "2026-11-10", "2026-11-24", "2026-12-25",
  ],
};

/** Days the exchange closes early (local minutes after midnight). */
const EARLY_CLOSE: Record<MarketId, Record<string, number>> = {
  US: { "2026-11-27": 13 * 60, "2026-12-24": 13 * 60, "2027-11-26": 13 * 60 },
  IN: {},
};

function holidays(id: MarketId): Set<string> {
  const extra = (typeof process !== "undefined" ? process.env[`MARKET_HOLIDAYS_${id}`] : undefined) ?? "";
  return new Set([...HOLIDAYS[id], ...extra.split(",").map((d) => d.trim()).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))]);
}

/** US tickers have no suffix (AAPL, BRK-B); Indian ones end in .NS (NSE) or .BO (BSE). */
export function marketOfSymbol(symbol: string): MarketId {
  return /\.(NS|BO)$/i.test(symbol) ? "IN" : "US";
}

export function exchangeOfSymbol(symbol: string): string {
  return /\.NS$/i.test(symbol) ? "NSE" : /\.BO$/i.test(symbol) ? "BSE" : "US";
}

/** Whether the auto-trader can trade this symbol: US or NSE/BSE stocks, not indices, FX or other exchanges. */
export function isSupportedSymbol(symbol: string): boolean {
  if (/[\^=]/.test(symbol)) return false;
  const suffix = symbol.match(/\.([A-Z]+)$/i)?.[1]?.toUpperCase();
  return !suffix || suffix === "NS" || suffix === "BO";
}

type Local = { date: string; weekday: number; minutes: number; y: number; m: number; d: number };

function localParts(now: Date, tz: string): Local {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const y = Number(get("year"));
  const m = Number(get("month"));
  const d = Number(get("day"));
  return { y, m, d, date: `${get("year")}-${get("month")}-${get("day")}`, weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")), minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** The UTC instant of a wall-clock time in a time zone (handles daylight saving). */
export function zonedTimeToUtc(y: number, m: number, d: number, minutes: number, tz: string): Date {
  const wall = Date.UTC(y, m - 1, d, 0, minutes);
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(guess), tz);
    const seen = Date.UTC(p.y, p.m - 1, p.d, 0, p.minutes);
    guess += wall - seen;
  }
  return new Date(guess);
}

const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);

export type SessionState = "open" | "pre_open" | "after_close" | "weekend" | "holiday";

export type MarketSession = {
  market: MarketId;
  label: string;
  exchanges: string;
  open: boolean;
  state: SessionState;
  /** Short explanation, e.g. "Closed: weekend". */
  reason: string;
  /** Exchange-local time, e.g. "10:42". */
  localTime: string;
  /** When the current session ends (only while open). */
  closesAt: Date | null;
  /** Start of the next session (null while open). */
  nextOpen: Date | null;
};

export function getMarketSession(market: MarketId, now = new Date()): MarketSession {
  const def = MARKETS.find((x) => x.id === market)!;
  const hol = holidays(market);
  const local = localParts(now, def.tz);
  const closeMin = EARLY_CLOSE[market][local.date] ?? def.close;
  const weekend = local.weekday === 0 || local.weekday === 6;
  const holiday = hol.has(local.date);
  const state: SessionState = weekend ? "weekend" : holiday ? "holiday" : local.minutes < def.open ? "pre_open" : local.minutes >= closeMin ? "after_close" : "open";
  const open = state === "open";

  let nextOpen: Date | null = null;
  if (!open) {
    const base = Date.UTC(local.y, local.m - 1, local.d);
    for (let i = 0; i < 15 && !nextOpen; i++) {
      const t = base + i * 86_400_000;
      const day = new Date(t);
      const dow = day.getUTCDay();
      if (dow === 0 || dow === 6 || hol.has(ymd(t))) continue;
      const at = zonedTimeToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), def.open, def.tz);
      if (at.getTime() > now.getTime()) nextOpen = at;
    }
  }
  const hhmm = `${String(Math.floor(local.minutes / 60)).padStart(2, "0")}:${String(local.minutes % 60).padStart(2, "0")}`;
  const reason = { open: "Open", pre_open: "Closed: opens later today", after_close: "Closed for the day", weekend: "Closed: weekend", holiday: "Closed: exchange holiday" }[state];
  return {
    market,
    label: def.label,
    exchanges: def.exchanges,
    open,
    state,
    reason,
    localTime: hhmm,
    closesAt: open ? zonedTimeToUtc(local.y, local.m, local.d, closeMin, def.tz) : null,
    nextOpen,
  };
}

export function isMarketOpen(market: MarketId, now = new Date()) {
  return getMarketSession(market, now).open;
}

export type MarketStatus = { id: string; label: string; open: boolean };

export function marketStatus(now = new Date()): MarketStatus[] {
  return MARKETS.map((m) => {
    const s = getMarketSession(m.id, now);
    return { id: m.id, label: m.label, open: s.open };
  });
}
