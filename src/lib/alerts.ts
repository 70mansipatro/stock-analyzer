import "server-only";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { appUrl, priceAlertEmail, sendEmail, wantsEmail } from "@/lib/email";
import { money } from "@/lib/format";
import { getQuote, getQuotes, MarketError, resolveSymbol, type Quote } from "@/lib/market";
import { prisma } from "@/lib/prisma";

export class AlertError extends Error {}

const MAX_ACTIVE = 50;

export const alertInput = z.object({
  symbol: z.string().trim().min(1, "Enter a stock symbol.").max(30),
  targetPrice: z.coerce.number().positive("Target price must be above zero.").max(10_000_000),
  // Omitted = inferred from the current price (target above it = ABOVE).
  condition: z.enum(["ABOVE", "BELOW"]).optional(),
  note: z.string().trim().max(140).optional(),
});
export type AlertInput = z.input<typeof alertInput>;

async function quoteFor(raw: string): Promise<Quote> {
  try {
    return await getQuote(raw);
  } catch (err) {
    const resolved = await resolveSymbol(raw).catch(() => null);
    if (resolved) return getQuote(resolved);
    throw err instanceof MarketError ? new AlertError(err.message) : err;
  }
}

export async function createAlert(userId: string, raw: AlertInput) {
  const parsed = alertInput.safeParse(raw);
  if (!parsed.success) throw new AlertError(parsed.error.issues[0].message);
  const { targetPrice, note } = parsed.data;

  const active = await prisma.priceAlert.count({ where: { userId, active: true } });
  if (active >= MAX_ACTIVE) throw new AlertError(`You can have up to ${MAX_ACTIVE} active alerts. Delete some first.`);

  const q = await quoteFor(parsed.data.symbol);
  const condition = parsed.data.condition ?? (targetPrice > q.price ? "ABOVE" : "BELOW");
  if (condition === "ABOVE" && q.price >= targetPrice) throw new AlertError(`${q.symbol} is already above ${money(targetPrice, q.currency)} (now ${money(q.price, q.currency)}).`);
  if (condition === "BELOW" && q.price <= targetPrice) throw new AlertError(`${q.symbol} is already below ${money(targetPrice, q.currency)} (now ${money(q.price, q.currency)}).`);

  const alert = await prisma.priceAlert.create({
    data: { userId, symbol: q.symbol, condition, targetPrice, currency: q.currency, note: note || null },
  });
  await audit(userId, "alert_created", { symbol: q.symbol, condition, targetPrice, currency: q.currency });
  return {
    id: alert.id,
    symbol: q.symbol,
    name: q.name,
    condition,
    targetPrice,
    currency: q.currency,
    currentPrice: q.price,
    distancePct: Math.round(((targetPrice - q.price) / q.price) * 10_000) / 100,
  };
}

export async function deleteAlert(userId: string, id: string) {
  const { count } = await prisma.priceAlert.deleteMany({ where: { id, userId } });
  if (count) await audit(userId, "alert_deleted", { id });
  return count > 0;
}

export async function listAlerts(userId: string) {
  const alerts = await prisma.priceAlert.findMany({ where: { userId }, orderBy: [{ active: "desc" }, { createdAt: "desc" }], take: 100 });
  const quotes = await getQuotes([...new Set(alerts.filter((a) => a.active).map((a) => a.symbol))]);
  return alerts.map((a) => {
    const price = quotes.get(a.symbol)?.price ?? null;
    const target = Number(a.targetPrice);
    return {
      id: a.id,
      symbol: a.symbol,
      condition: a.condition,
      targetPrice: target,
      currency: a.currency,
      note: a.note,
      active: a.active,
      createdAt: a.createdAt.toISOString(),
      triggeredAt: a.triggeredAt?.toISOString() ?? null,
      triggeredPrice: a.triggeredPrice === null ? null : Number(a.triggeredPrice),
      currentPrice: price,
      distancePct: price ? Math.round(((target - price) / price) * 10_000) / 100 : null,
    };
  });
}
export type AlertRow = Awaited<ReturnType<typeof listAlerts>>[number];

/**
 * Fires every active alert whose condition is met: turns it off, adds a notification, emails the user
 * (if they allow "Price alerts" emails) and records it in the audit log. Safe to call concurrently.
 */
let running = false;
export async function checkAlerts() {
  if (running) return { checked: 0, fired: 0, skipped: true };
  running = true;
  try {
    const alerts = await prisma.priceAlert.findMany({
      where: { active: true },
      include: { user: { select: { name: true, email: true, suspended: true } } },
      take: 2000,
    });
    if (!alerts.length) return { checked: 0, fired: 0 };
    const quotes = await getQuotes([...new Set(alerts.map((a) => a.symbol))]);
    let fired = 0;

    for (const a of alerts) {
      const q = quotes.get(a.symbol);
      if (!q || a.user.suspended) continue;
      const target = Number(a.targetPrice);
      const hit = a.condition === "ABOVE" ? q.price >= target : q.price <= target;
      if (!hit) continue;

      // Only one checker may fire a given alert.
      const { count } = await prisma.priceAlert.updateMany({
        where: { id: a.id, active: true },
        data: { active: false, triggeredAt: new Date(), triggeredPrice: q.price, lastCheckedAt: new Date() },
      });
      if (!count) continue;
      fired++;

      const verb = a.condition === "ABOVE" ? "rose above" : "fell below";
      const targetLabel = money(target, a.currency);
      const priceLabel = money(q.price, q.currency);
      const link = `/stock/${encodeURIComponent(a.symbol)}`;
      await prisma.notification.create({
        data: { userId: a.userId, kind: "alert_triggered", title: `${a.symbol} ${verb} ${targetLabel}`, body: `Now ${priceLabel}${a.note ? ` · ${a.note}` : ""}`, link },
      });
      await audit(a.userId, "alert_triggered", { symbol: a.symbol, condition: a.condition, target, price: q.price });
      if (await wantsEmail(a.userId, "alerts")) {
        const mail = priceAlertEmail({ name: a.user.name, symbol: a.symbol, condition: a.condition, target: targetLabel, price: priceLabel, note: a.note, link: `${appUrl()}${link}` });
        await sendEmail({ to: a.user.email, kind: "price_alert", userId: a.userId, ...mail });
      }
    }
    await prisma.priceAlert.updateMany({ where: { id: { in: alerts.map((a) => a.id) }, active: true }, data: { lastCheckedAt: new Date() } });
    return { checked: alerts.length, fired };
  } finally {
    running = false;
  }
}
