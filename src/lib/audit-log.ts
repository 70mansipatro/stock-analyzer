import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/** Audit log browsing for the admin console: filters, per-day chart, and CSV export share this query. */

export const AUDIT_CATEGORIES = {
  auth: { label: "Sign-in", tone: "sky", match: (e: string) => e.startsWith("otp_") || e.startsWith("local_login") || e.startsWith("login") },
  admin: { label: "Admin actions", tone: "violet", match: (e: string) => e.startsWith("admin_") },
  trading: { label: "Trading & alerts", tone: "emerald", match: (e: string) => e.startsWith("trade_") || e.startsWith("alert_") },
  ai: { label: "AI usage", tone: "amber", match: (e: string) => ["chat_message", "portfolio_review", "report_emailed"].includes(e) },
  security: { label: "Security", tone: "rose", match: (e: string) => ["input_blocked", "output_filtered", "approval_forged", "rate_limited", "guardrail_error"].includes(e) || e.endsWith("_failed") },
} as const;
export type AuditCategory = keyof typeof AUDIT_CATEGORIES;
export const CATEGORY_KEYS = Object.keys(AUDIT_CATEGORIES) as AuditCategory[];

export function categoryOf(event: string): AuditCategory | "other" {
  // Security first so e.g. otp_failed counts as a security signal.
  if (AUDIT_CATEGORIES.security.match(event)) return "security";
  for (const k of CATEGORY_KEYS) if (AUDIT_CATEGORIES[k].match(event)) return k;
  return "other";
}

export const RANGES = [
  { id: "1", label: "24 hours" },
  { id: "7", label: "7 days" },
  { id: "30", label: "30 days" },
  { id: "90", label: "90 days" },
] as const;

export type AuditFilters = { range: string; event?: string; category?: AuditCategory; user?: string; page: number };

export function parseFilters(sp: Record<string, string | undefined>): AuditFilters {
  const range = RANGES.some((r) => r.id === sp.range) ? sp.range! : "7";
  const category = CATEGORY_KEYS.includes(sp.cat as AuditCategory) ? (sp.cat as AuditCategory) : undefined;
  const event = sp.event && /^[a-z_]{1,60}$/.test(sp.event) ? sp.event : undefined;
  const user = sp.user?.trim().slice(0, 80) || undefined;
  const page = Math.max(1, Math.min(1000, Number(sp.page) || 1));
  return { range, event, category, user, page };
}

async function where(f: AuditFilters, allEvents: string[]): Promise<Prisma.AuditLogWhereInput> {
  const w: Prisma.AuditLogWhereInput = { createdAt: { gte: new Date(Date.now() - Number(f.range) * 86_400_000) } };
  if (f.event) w.event = f.event;
  else if (f.category) w.event = { in: allEvents.filter((e) => categoryOf(e) === f.category) };
  if (f.user) {
    // Match the account, or an email recorded in the event (e.g. a failed sign-in with no account yet).
    w.OR = [
      { user: { OR: [{ email: { contains: f.user, mode: "insensitive" } }, { name: { contains: f.user, mode: "insensitive" } }] } },
      { detail: { path: ["email"], string_contains: f.user.toLowerCase() } },
    ];
  }
  return w;
}

export const PAGE_SIZE = 50;

export async function auditLogPage(f: AuditFilters) {
  const distinct = await prisma.auditLog.groupBy({ by: ["event"], _count: true, orderBy: { _count: { event: "desc" } } });
  const allEvents = distinct.map((d) => d.event);
  const w = await where(f, allEvents);

  const [rows, total, inRange, users] = await Promise.all([
    prisma.auditLog.findMany({
      where: w,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { user: { select: { name: true, email: true } } },
    }),
    prisma.auditLog.count({ where: w }),
    // Chart + stats use every matching row's event and day only (cheap columns).
    prisma.auditLog.findMany({ where: w, select: { event: true, createdAt: true, userId: true }, take: 50_000 }),
    prisma.auditLog.groupBy({ by: ["userId"], where: w }),
  ]);

  const days = Math.max(1, Number(f.range));
  const buckets = new Map<string, Record<string, number | string>>();
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    buckets.set(date, { date, ...Object.fromEntries(CATEGORY_KEYS.map((k) => [k, 0])) });
  }
  const perEvent = new Map<string, number>();
  let security = 0;
  for (const r of inRange) {
    const cat = categoryOf(r.event);
    if (cat === "security") security++;
    perEvent.set(r.event, (perEvent.get(r.event) ?? 0) + 1);
    const b = buckets.get(r.createdAt.toISOString().slice(0, 10));
    if (b && cat !== "other") b[cat] = (b[cat] as number) + 1;
  }

  return {
    rows: rows.map((r) => ({
      id: r.id,
      at: r.createdAt.toISOString(),
      event: r.event,
      category: categoryOf(r.event),
      user: r.user?.name ?? null,
      email: r.user?.email ?? ((r.detail as { email?: string } | null)?.email ?? null),
      detail: r.detail as Record<string, unknown> | null,
    })),
    total,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    series: [...buckets.values()],
    topEvents: [...perEvent.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([event, count]) => ({ event, count, category: categoryOf(event) })),
    stats: {
      events: inRange.length,
      users: users.filter((u) => u.userId).length,
      security,
      failedSignIns: inRange.filter((r) => r.event.endsWith("login_failed") || r.event === "otp_failed").length,
    },
    events: allEvents,
  };
}

export async function auditLogCsv(f: AuditFilters) {
  const distinct = await prisma.auditLog.groupBy({ by: ["event"] });
  const rows = await prisma.auditLog.findMany({
    where: await where(f, distinct.map((d) => d.event)),
    orderBy: { createdAt: "desc" },
    take: 10_000,
    include: { user: { select: { name: true, email: true } } },
  });
  // Quote every cell; a leading = + - @ is neutralised so spreadsheets don't run it as a formula.
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [["time_utc", "event", "category", "user", "email", "detail"].join(",")];
  for (const r of rows) {
    lines.push([r.createdAt.toISOString(), r.event, categoryOf(r.event), r.user?.name, r.user?.email ?? (r.detail as { email?: string } | null)?.email, r.detail].map(cell).join(","));
  }
  return { csv: lines.join("\n"), count: rows.length };
}
