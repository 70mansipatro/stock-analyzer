import "server-only";
import { prisma } from "@/lib/prisma";
import { sendEmail as queueEmail } from "@/lib/email";

/**
 * Central notification service: in-app (the bell), email (through the EmailOutbox) and an optional
 * message channel (any incoming-webhook URL, e.g. Slack, Discord, Teams or a custom bot).
 * Every channel is best effort and isolated: a failure is logged and never thrown, so a notification
 * problem can't undo or block the action (e.g. a virtual trade) that triggered it.
 *
 * Message channel configuration (optional):
 *   NOTIFY_WEBHOOK_URL   – POSTs JSON {"text": ..., "content": ...} (Slack uses text, Discord content)
 * It is an operator channel: it receives events for every user, so only set it on single-user or team installs.
 */

export type InApp = { userId: string; kind: string; title: string; body?: string | null; link?: string | null };
export type EmailMsg = { to: string; kind: string; subject: string; html: string; text: string; userId?: string | null };

export async function inAppNotification(n: InApp & { dedupeMs?: number }): Promise<boolean> {
  try {
    if (n.dedupeMs) {
      const recent = await prisma.notification.count({ where: { userId: n.userId, kind: n.kind, title: n.title, createdAt: { gte: new Date(Date.now() - n.dedupeMs) } } });
      if (recent) return false;
    }
    await prisma.notification.create({ data: { userId: n.userId, kind: n.kind, title: n.title.slice(0, 200), body: n.body?.slice(0, 1000) ?? null, link: n.link ?? null } });
    return true;
  } catch (err) {
    console.error("in-app notification failed", n.kind, err);
    return false;
  }
}

export async function sendEmail(msg: EmailMsg): Promise<boolean> {
  try {
    return !!(await queueEmail(msg));
  } catch (err) {
    console.error("notification email failed", msg.kind, err);
    return false;
  }
}

export function messageConfigured() {
  return !!process.env.NOTIFY_WEBHOOK_URL;
}

export async function sendMessage(text: string): Promise<boolean> {
  const url = process.env.NOTIFY_WEBHOOK_URL;
  if (!url) return false;
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, content: text.slice(0, 2000) }), signal: AbortSignal.timeout(8_000) });
    if (!res.ok) console.warn("notification webhook returned", res.status);
    return res.ok;
  } catch (err) {
    console.error("notification webhook failed", err);
    return false;
  }
}

/**
 * Sends one event to every requested channel. Never throws; returns what was delivered.
 * With inApp.dedupeMs, a repeat of the same event inside that window is dropped on every channel.
 */
export async function notify(o: { inApp?: InApp & { dedupeMs?: number }; email?: EmailMsg | null; message?: string | null }) {
  const inApp = o.inApp ? await inAppNotification(o.inApp) : false;
  if (o.inApp?.dedupeMs && !inApp) return { inApp, email: false, message: false };
  const [email, message] = await Promise.all([o.email ? sendEmail(o.email) : Promise.resolve(false), o.message ? sendMessage(o.message) : Promise.resolve(false)]);
  return { inApp, email, message };
}
