import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { prisma } from "@/lib/prisma";

/**
 * Transactional email. Every message is written to the EmailOutbox table first, then sent over SMTP
 * (Gmail app password by default). If SMTP isn't configured the row is kept as SKIPPED, so the app
 * works on machines without email setup and admins can still see what would have been sent.
 */

export type EmailCategory = "orders" | "alerts";
export const EMAIL_CATEGORIES: { id: EmailCategory; label: string; description: string }[] = [
  { id: "orders", label: "Orders", description: "Confirmation when a trade is filled, cancelled or expires." },
  { id: "alerts", label: "Price alerts", description: "When one of your price or condition alerts fires." },
];
// Security notices (invitations, role and access changes, removal) are always sent and have no switch.

export function emailConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD);
}

let transporter: Transporter | null = null;
function getTransport(): Transporter | null {
  if (!emailConfigured()) return null;
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT || 465);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      // Gmail shows app passwords as "abcd efgh ijkl mnop"; the spaces aren't part of it.
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_HOST?.includes("gmail") ? process.env.SMTP_PASSWORD?.replace(/\s+/g, "") : process.env.SMTP_PASSWORD },
      // Never let a slow mail server hang a send forever.
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
  }
  return transporter;
}

const appUrl = () => (process.env.APP_URL || process.env.AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
// Addresses that can never receive mail (local admin, test accounts).
const undeliverable = (to: string) => /@(localhost|example\.(com|org|net|invalid)|[^@]+\.(invalid|test|local))$/i.test(to);

/** Whether a user wants emails of this category (default: yes). */
export async function wantsEmail(userId: string, category: EmailCategory) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { emailPrefs: true, suspended: true } });
  if (!u) return false;
  const prefs = (u.emailPrefs ?? {}) as Partial<Record<EmailCategory, boolean>>;
  return prefs[category] !== false;
}

async function deliver(id: string) {
  const row = await prisma.emailOutbox.findUnique({ where: { id } });
  if (!row || row.status === "SENT") return;
  const transport = getTransport();
  if (!transport) {
    await prisma.emailOutbox.update({ where: { id }, data: { status: "SKIPPED", error: "Email is not configured (SMTP_* settings are empty)." } });
    return;
  }
  if (undeliverable(row.to)) {
    await prisma.emailOutbox.update({ where: { id }, data: { status: "SKIPPED", error: "Address can't receive email." } });
    return;
  }
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const info = await transport.sendMail({
        from: process.env.EMAIL_FROM || process.env.SMTP_USER,
        replyTo: process.env.EMAIL_REPLY_TO || process.env.SMTP_USER,
        to: row.to,
        subject: row.subject,
        html: row.html,
        text: row.text,
        headers: {
          "List-Unsubscribe": `<${appUrl()}/settings#notifications>`,
          "X-Entity-Ref-ID": row.id, // stops Gmail threading unrelated emails together
        },
      });
      const accepted = (info.accepted ?? []).map(String).includes(row.to);
      await prisma.emailOutbox.update({
        where: { id },
        data: accepted
          ? { status: "SENT", sentAt: new Date(), attempts: row.attempts + attempt, error: null, messageId: info.messageId ?? null, response: String(info.response ?? "").slice(0, 300) }
          : { status: "FAILED", attempts: row.attempts + attempt, error: `Rejected by mail server: ${String(info.response ?? "")}`.slice(0, 500), response: String(info.response ?? "").slice(0, 300) },
      });
      return;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn(`email attempt ${attempt} failed`, row.kind, row.to, lastError);
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1500));
    }
  }
  console.error("email failed", row.kind, row.to, lastError);
  await prisma.emailOutbox.update({ where: { id }, data: { status: "FAILED", attempts: row.attempts + 3, error: lastError.slice(0, 500) } });
}

/** Queues an email and sends it in the background. Never throws: email must not break the action that triggered it. */
export async function sendEmail(msg: { to: string; kind: string; subject: string; html: string; text: string; userId?: string | null }) {
  try {
    const row = await prisma.emailOutbox.create({ data: { ...msg, to: msg.to.toLowerCase(), userId: msg.userId ?? null } });
    void deliver(row.id).catch((err) => console.error("email deliver crashed", err));
    void retryStuck();
    return row.id;
  } catch (err) {
    console.error("email queue failed", err);
    return null;
  }
}

/** Safety net: emails still PENDING after 2 minutes (e.g. the server restarted mid-send) are tried again. */
let lastSweep = 0;
async function retryStuck() {
  if (Date.now() - lastSweep < 60_000) return;
  lastSweep = Date.now();
  try {
    const stuck = await prisma.emailOutbox.findMany({
      where: { status: "PENDING", createdAt: { lt: new Date(Date.now() - 2 * 60_000) }, attempts: { lt: 6 } },
      select: { id: true },
      take: 20,
    });
    for (const s of stuck) await deliver(s.id);
  } catch (err) {
    console.error("email sweep failed", err);
  }
}

/** Re-sends a FAILED or SKIPPED email (admin action). */
export async function resendEmail(id: string) {
  await prisma.emailOutbox.update({ where: { id }, data: { status: "PENDING", error: null } });
  await deliver(id);
  return prisma.emailOutbox.findUniqueOrThrow({ where: { id } });
}

// ---------- Templates ----------

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

type Row = [label: string, value: string];

/** One branded, mobile-friendly layout for every email (inline styles: mail apps ignore stylesheets). */
export type ReportTable = { columns: { label: string; align?: "left" | "right" }[]; rows: { cells: string[]; tone?: ("up" | "down" | null)[] }[] };
export type ReportStat = { label: string; value: string; tone?: "up" | "down" | null };

function statsHtml(stats: ReportStat[]) {
  const color = (t?: "up" | "down" | null) => (t === "up" ? "#059669" : t === "down" ? "#dc2626" : "#0f172a");
  const cells = stats
    .map((st) => `<td style="padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;vertical-align:top"><div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#64748b">${esc(st.label)}</div><div style="margin-top:4px;font-size:18px;font-weight:700;color:${color(st.tone)}">${esc(st.value)}</div></td>`)
    .join('<td style="width:8px"></td>');
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate"><tr>${cells}</tr></table>`;
}

function tableHtml(t: ReportTable) {
  const head = t.columns.map((c) => `<th style="padding:10px 8px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#64748b;font-weight:600;text-align:${c.align ?? "left"};border-bottom:1px solid #e2e8f0">${esc(c.label)}</th>`).join("");
  const body = t.rows
    .map((r, i) =>
      `<tr style="background:${i % 2 ? "#f8fafc" : "#ffffff"}">${r.cells
        .map((cell, j) => {
          const tone = r.tone?.[j];
          const color = tone === "up" ? "#059669" : tone === "down" ? "#dc2626" : "#0f172a";
          return `<td style="padding:10px 8px;font-size:14px;color:${color};${j === 0 ? "font-weight:600;" : ""}text-align:${t.columns[j]?.align ?? "left"};border-bottom:1px solid #f1f5f9">${esc(cell)}</td>`;
        })
        .join("")}</tr>`,
    )
    .join("");
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function layout(o: {
  preheader: string;
  title: string;
  intro: string;
  eyebrow?: string;
  stats?: ReportStat[];
  table?: ReportTable;
  highlights?: string[];
  rows?: Row[];
  button?: { label: string; href: string };
  note?: string;
  footer?: string;
}) {
  const rows = (o.rows ?? [])
    .map(([k, v]) => `<tr><td style="padding:8px 0;color:#64748b;font-size:14px">${esc(k)}</td><td style="padding:8px 0;text-align:right;color:#0f172a;font-size:14px;font-weight:600">${esc(v)}</td></tr>`)
    .join("");
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif">
<span style="display:none;max-height:0;overflow:hidden">${esc(o.preheader)}</span>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:32px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden">
<tr><td style="background:linear-gradient(90deg,#10b981,#0ea5e9,#8b5cf6);height:4px"></td></tr>
<tr><td style="padding:28px 28px 8px">
  <div style="font-size:14px;font-weight:700;color:#0f172a">📈 Stock Analyzer</div>
  ${o.eyebrow ? `<div style="margin-top:18px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#10b981;font-weight:700">${esc(o.eyebrow)}</div>` : ""}
  <h1 style="margin:${o.eyebrow ? "6px" : "18px"} 0 8px;font-size:22px;line-height:1.3;color:#0f172a">${esc(o.title)}</h1>
  <p style="margin:0;color:#334155;font-size:15px;line-height:1.6">${esc(o.intro)}</p>
</td></tr>
${o.stats?.length ? `<tr><td style="padding:18px 28px 0">${statsHtml(o.stats)}</td></tr>` : ""}
${o.table ? `<tr><td style="padding:18px 28px 0">${tableHtml(o.table)}</td></tr>` : ""}
${o.highlights?.length ? `<tr><td style="padding:18px 28px 0"><div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#64748b;font-weight:600;margin-bottom:6px">Highlights</div><ul style="margin:0;padding-left:18px;color:#334155;font-size:14px;line-height:1.7">${o.highlights.map((h) => `<li>${esc(h)}</li>`).join("")}</ul></td></tr>` : ""}
${rows ? `<tr><td style="padding:12px 28px 0"><table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0">${rows}</table></td></tr>` : ""}
${o.note ? `<tr><td style="padding:16px 28px 0"><div style="background:#f1f5f9;border-radius:10px;padding:12px 14px;color:#334155;font-size:14px">${esc(o.note)}</div></td></tr>` : ""}
${o.button ? `<tr><td style="padding:24px 28px 4px"><a href="${esc(o.button.href)}" style="display:inline-block;background:#10b981;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px">${esc(o.button.label)}</a></td></tr>` : ""}
<tr><td style="padding:24px 28px 28px;color:#94a3b8;font-size:12px;line-height:1.6">${esc(o.footer ?? "Virtual trading only, no real money. Not financial advice.")}<br><a href="${appUrl()}/settings#notifications" style="color:#64748b">Manage email settings</a></td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    o.title,
    "",
    o.intro,
    ...(o.stats ?? []).map((st) => `${st.label}: ${st.value}`),
    ...(o.table ? ["", o.table.columns.map((c) => c.label).join(" | "), ...o.table.rows.map((r) => r.cells.join(" | "))] : []),
    ...(o.highlights?.length ? ["", "Highlights:", ...o.highlights.map((h) => `- ${h}`)] : []),
    ...(o.rows ?? []).map(([k, v]) => `${k}: ${v}`), o.note ? `\n${o.note}` : "", o.button ? `\n${o.button.label}: ${o.button.href}` : "", "", `Manage email settings: ${appUrl()}/settings`].join("\n");
  return { html, text };
}

export function invitationEmail(o: { to: string; roleLabel: string; roleDescription: string; invitedBy: string; note?: string | null }) {
  const subject = `You're invited to Stock Analyzer as ${o.roleLabel}`;
  return {
    subject,
    ...layout({
      preheader: `${o.invitedBy} gave you ${o.roleLabel} access.`,
      title: `You're invited as ${o.roleLabel}`,
      intro: `${o.invitedBy} invited you to Stock Analyzer, an AI-powered app to research, forecast and practise trading stocks with virtual money.`,
      rows: [["Your role", o.roleLabel], ["Access", o.roleDescription], ["Sign in with", `Google account ${o.to}`]],
      note: o.note ? `Note from ${o.invitedBy}: ${o.note}` : undefined,
      button: { label: "Accept & sign in", href: `${appUrl()}/login` },
      footer: "Sign in with the Google account this email was sent to. If you weren't expecting this, you can ignore it.",
    }),
  };
}

export function roleChangedEmail(o: { name?: string | null; roleLabel: string; roleDescription: string; changedBy: string }) {
  return {
    subject: `Your Stock Analyzer role is now ${o.roleLabel}`,
    ...layout({
      preheader: `${o.changedBy} changed your role.`,
      title: `Your role is now ${o.roleLabel}`,
      intro: `Hi ${o.name?.split(" ")[0] ?? "there"}, ${o.changedBy} updated your access.`,
      rows: [["New role", o.roleLabel], ["Access", o.roleDescription]],
      button: { label: "Open Stock Analyzer", href: appUrl() },
    }),
  };
}

export function accessEmail(o: { name?: string | null; suspended: boolean; changedBy: string }) {
  return o.suspended
    ? {
        subject: "Your Stock Analyzer access has been paused",
        ...layout({ preheader: "An admin paused your account.", title: "Your access has been paused", intro: `Hi ${o.name?.split(" ")[0] ?? "there"}, ${o.changedBy} paused your account and signed you out. Contact them if you think this is a mistake.` }),
      }
    : {
        subject: "Your Stock Analyzer access is restored",
        ...layout({ preheader: "You can sign in again.", title: "Welcome back", intro: `Hi ${o.name?.split(" ")[0] ?? "there"}, ${o.changedBy} restored your access. You can sign in again.`, button: { label: "Sign in", href: `${appUrl()}/login` } }),
      };
}

export function orderFilledEmail(o: {
  name?: string | null;
  side: "BUY" | "SELL";
  quantity: number;
  symbol: string;
  company: string;
  priceLabel: string;
  totalLabel: string;
  cashAfterLabel: string;
  pnlLabel?: string | null;
  via: string;
  at: Date;
}) {
  const verb = o.side === "BUY" ? "Bought" : "Sold";
  return {
    subject: `${verb} ${o.quantity} ${o.symbol} at ${o.priceLabel}`,
    ...layout({
      preheader: `Order filled: ${verb.toLowerCase()} ${o.quantity} ${o.symbol}, total ${o.totalLabel}.`,
      title: `Order filled: ${verb} ${o.quantity} ${o.symbol}`,
      intro: `Hi ${o.name?.split(" ")[0] ?? "there"}, your ${o.side === "BUY" ? "buy" : "sell"} order for ${o.company} was executed.`,
      rows: [
        ["Order", `${o.side} · Market`],
        ["Shares", String(o.quantity)],
        ["Price", o.priceLabel],
        ["Total", o.totalLabel],
        ...(o.pnlLabel ? ([["Realized P&L", o.pnlLabel]] as Row[]) : []),
        ["Cash available", o.cashAfterLabel],
        ["Placed via", o.via],
        ["Time", o.at.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })],
      ],
      button: { label: "View portfolio", href: `${appUrl()}/portfolio` },
    }),
  };
}

export function accountResetEmail(o: { name?: string | null; cashLabel: string; changedBy: string }) {
  return {
    subject: "Your Stock Analyzer account was reset",
    ...layout({
      preheader: `Your virtual account was reset to ${o.cashLabel}.`,
      title: "Your account was reset",
      intro: `Hi ${o.name?.split(" ")[0] ?? "there"}, ${o.changedBy} reset your virtual trading account. Your holdings and trade history were cleared.`,
      rows: [["New cash balance", o.cashLabel]],
      button: { label: "Open Stock Analyzer", href: appUrl() },
    }),
  };
}

export function accountRemovedEmail(o: { name?: string | null; changedBy: string; reason?: string | null }) {
  return {
    subject: "Your Stock Analyzer account has been removed",
    ...layout({
      preheader: "Your account and its data were removed.",
      title: "Your account has been removed",
      intro: `Hi ${o.name?.split(" ")[0] ?? "there"}, ${o.changedBy} removed your Stock Analyzer account. Your portfolio, trades and settings have been deleted and you can no longer sign in.`,
      note: o.reason ? `Reason: ${o.reason}` : undefined,
      footer: "If you think this is a mistake, reply to this email or contact the administrator who manages your access.",
    }),
  };
}

export function invitationWithdrawnEmail(o: { roleLabel: string; changedBy: string }) {
  return {
    subject: "Your Stock Analyzer invitation was withdrawn",
    ...layout({
      preheader: "An admin withdrew your invitation.",
      title: "Your invitation was withdrawn",
      intro: `${o.changedBy} withdrew your invitation to join Stock Analyzer as ${o.roleLabel}. No action is needed.`,
      footer: "If you still need access, contact the administrator who invited you.",
    }),
  };
}

/** A report the user asked the AI assistant to email them. */
export function reportEmail(o: {
  name?: string | null;
  eyebrow: string;
  title: string;
  intro: string;
  stats?: ReportStat[];
  table?: ReportTable;
  highlights?: string[];
  note?: string;
  button: { label: string; href: string };
  asOf: Date;
}) {
  return {
    subject: `${o.title} · ${o.asOf.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
    ...layout({
      preheader: o.intro,
      eyebrow: o.eyebrow,
      title: o.title,
      intro: `Hi ${o.name?.split(" ")[0] ?? "there"}, ${o.intro}`,
      stats: o.stats,
      table: o.table,
      highlights: o.highlights,
      note: o.note,
      button: o.button,
      footer: `Requested from the AI assistant · data as of ${o.asOf.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}. Market data may be delayed. Virtual trading only, not financial advice.`,
    }),
  };
}

export { appUrl };

export function welcomeEmail(o: { name?: string | null; roleLabel: string; roleDescription: string; cashLabel: string; returning: boolean; canTrade: boolean }) {
  const first = o.name?.split(" ")[0] ?? "there";
  return {
    subject: o.returning ? `Welcome back to Stock Analyzer, ${first}` : `Welcome to Stock Analyzer, ${first}`,
    ...layout({
      preheader: o.returning ? "Your account is ready again." : `Your account is ready with ${o.cashLabel} of virtual cash.`,
      eyebrow: o.returning ? "Welcome back" : "Welcome aboard",
      title: o.returning ? `Good to see you again, ${first}` : `Your account is ready, ${first}`,
      intro: o.returning
        ? "Your Stock Analyzer account has been set up again with a fresh start. Everything below is ready for you."
        : "Thanks for joining Stock Analyzer: research stocks, see AI forecasts and practise trading with virtual money, risk-free.",
      stats: [
        { label: "Virtual cash", value: o.canTrade ? o.cashLabel : "—" },
        { label: "Your role", value: o.roleLabel },
        { label: "Markets", value: "US + India" },
      ],
      table: {
        columns: [{ label: "Get started" }, { label: "Where", align: "right" }],
        rows: [
          { cells: ["See today's market heatmap and top movers", "Markets"] },
          { cells: ["Open any stock for charts, AI news and a forecast", "Search bar"] },
          ...(o.canTrade ? [{ cells: ["Place your first practice trade", "Stock page → Trade"] }] : []),
          { cells: ['Ask the AI: "email me today\'s top gainers"', "Ask AI button"] },
        ],
      },
      note: `Your access: ${o.roleDescription}`,
      button: { label: "Start exploring", href: appUrl() },
      footer: "You're receiving this because you signed in to Stock Analyzer for the first time. Virtual trading only, not financial advice.",
    }),
  };
}

export function rejoinAllowedEmail(o: { changedBy: string }) {
  return {
    subject: "You can join Stock Analyzer again",
    ...layout({
      preheader: "Your access was restored.",
      title: "You can sign up again",
      intro: `${o.changedBy} restored your access to Stock Analyzer. Sign in with your Google account to create a fresh account.`,
      button: { label: "Sign in", href: `${appUrl()}/login` },
    }),
  };
}
