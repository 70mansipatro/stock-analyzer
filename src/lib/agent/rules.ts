// Auto-trader run rules: pure functions (no database or network) used by the engine and its tests.
import { getMarketSession, marketOfSymbol, type MarketId, type MarketSession } from "@/lib/market-hours";

export type AiVerdict = { approve: boolean; note: string };
export type AiReview = { available: boolean; decisions: Map<string, AiVerdict>; summary: string | null };
/** approved | vetoed | unavailable (AI failed, rules used) | off (AI review switched off) | not_reviewed (AI skipped it) | not_required (sells) */
export type AiStatus = "approved" | "vetoed" | "unavailable" | "off" | "not_reviewed" | "not_required";

/**
 * What the AI review means for one planned order. The AI can only veto a buy: sells (exit rules and
 * risk protection) always go ahead, and if the AI is off or unavailable the rule engine decides alone.
 */
export function aiVerdict(action: "BUY" | "SELL", symbol: string, review: AiReview | null): { allowed: boolean; status: AiStatus; note: string | null } {
  if (action === "SELL") return { allowed: true, status: "not_required", note: null };
  if (!review) return { allowed: true, status: "off", note: null };
  if (!review.available) return { allowed: true, status: "unavailable", note: "AI review unavailable; rule engine decision used." };
  const v = review.decisions.get(symbol.toUpperCase());
  if (!v) return { allowed: true, status: "not_reviewed", note: null };
  return v.approve ? { allowed: true, status: "approved", note: v.note } : { allowed: false, status: "vetoed", note: v.note };
}

/**
 * Idempotency key for an automatic order. A stock is bought at most once per day by the agent, and an
 * open position is sold at most once, even if two runs overlap or a run is retried after a crash.
 */
export function idempotencyKey(o: { userId: string; symbol: string; action: "BUY" | "SELL"; day: string; positionId?: string | null }) {
  return o.action === "BUY" ? `buy:${o.userId}:${o.symbol}:${o.day}` : `sell:${o.userId}:${o.symbol}:${o.positionId ?? o.day}`;
}

export const SCAN_INTERVAL_MS = 5 * 60_000;
export const DEMO_INTERVAL_MS = 60_000;

/** Markets the user's selected stocks trade on. */
export function marketsOf(universe: string[]): MarketId[] {
  return [...new Set(universe.map(marketOfSymbol))];
}

type Schedulable = { enabled: boolean; demoSpeed: boolean; marketHoursOnly: boolean; lastRunAt: Date | null; universe: string[] };

/** Whether the scheduler should start a run now. lastRunAt is set when a run finishes, so allow for tick jitter. */
export function isDue(c: Schedulable, now = new Date()) {
  if (!c.enabled || !c.universe.length) return false;
  const since = c.lastRunAt ? now.getTime() - c.lastRunAt.getTime() : Infinity;
  if (c.demoSpeed) return since >= DEMO_INTERVAL_MS - 20_000;
  if (since < SCAN_INTERVAL_MS - 30_000) return false;
  return !c.marketHoursOnly || marketsOf(c.universe).some((m) => getMarketSession(m, now).open);
}

/** When the next scheduled scan should happen (null when the auto-trader is off). */
export function nextScanAt(c: Schedulable, now = new Date()): Date | null {
  if (!c.enabled || !c.universe.length) return null;
  const after = (ms: number) => new Date(Math.max(now.getTime(), (c.lastRunAt?.getTime() ?? 0) + ms));
  if (c.demoSpeed) return after(DEMO_INTERVAL_MS);
  if (!c.marketHoursOnly) return after(SCAN_INTERVAL_MS);
  const sessions = marketsOf(c.universe).map((m) => getMarketSession(m, now));
  if (sessions.some((s) => s.open)) return after(SCAN_INTERVAL_MS);
  const opens = sessions.map((s) => s.nextOpen?.getTime()).filter((t): t is number => !!t);
  return opens.length ? new Date(Math.min(...opens)) : null;
}

/** Whether an automatic order for this symbol may be placed now (market-hours enforcement). */
export function marketGate(symbol: string, o: { marketHoursOnly: boolean; demoSpeed: boolean }, sessions: Record<MarketId, MarketSession>): { ok: true } | { ok: false; reason: string } {
  if (!o.marketHoursOnly || o.demoSpeed) return { ok: true };
  const s = sessions[marketOfSymbol(symbol)];
  return s.open ? { ok: true } : { ok: false, reason: `${s.exchanges} is closed (${s.reason.replace(/^Closed: /, "").toLowerCase()}), so no order was placed.` };
}

/** Realized P/L of a sale, in USD and percent of the buy price. */
export function realized(o: { quantity: number; entryUsd: number; exitUsd: number }) {
  const pnl = Number(((o.exitUsd - o.entryUsd) * o.quantity).toFixed(2));
  const pct = o.entryUsd > 0 ? Number((((o.exitUsd - o.entryUsd) / o.entryUsd) * 100).toFixed(2)) : 0;
  return { pnl, pct };
}

export const TRIGGER_LABEL: Record<string, string> = {
  signal: "Strategy signal",
  stop_loss: "Maximum loss reached",
  take_profit: "Profit target reached",
  trailing_stop: "Trailing stop hit",
};
