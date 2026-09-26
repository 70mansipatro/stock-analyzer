/** Regular trading hours (ignores exchange holidays). */
const MARKETS = [
  { id: "US", label: "NYSE", tz: "America/New_York", open: 9 * 60 + 30, close: 16 * 60 },
  { id: "IN", label: "NSE", tz: "Asia/Kolkata", open: 9 * 60 + 15, close: 15 * 60 + 30 },
] as const;

export type MarketStatus = { id: string; label: string; open: boolean };

export function marketStatus(now = new Date()): MarketStatus[] {
  return MARKETS.map((m) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: m.tz, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const minutes = Number(get("hour")) * 60 + Number(get("minute"));
    const weekday = !["Sat", "Sun"].includes(get("weekday"));
    return { id: m.id, label: m.label, open: weekday && minutes >= m.open && minutes < m.close };
  });
}
