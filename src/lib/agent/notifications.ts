import "server-only";
import type { AgentConfig } from "@/generated/prisma/client";
import { autoTradeEmail, autoTraderSummaryEmail } from "@/lib/email";
import { money } from "@/lib/format";
import { notify } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import type { ExecutedTrade } from "@/lib/trading";
import { TRIGGER_LABEL, type AiStatus } from "./rules";
import type { PlannedAction } from "./strategy";

/**
 * Auto-Trader notifications, all sent through the central notification service (src/lib/notify.ts).
 * Called only after the trade has committed; nothing here can throw back into the trade path.
 */

const AI_LABEL: Record<AiStatus, string> = {
  approved: "Approved",
  vetoed: "Vetoed",
  unavailable: "Unavailable (rules used)",
  off: "Off",
  not_reviewed: "Not reviewed",
  not_required: "Not required (sell)",
};

const signedUsd = (n: number) => `${n >= 0 ? "+" : "−"}${money(Math.abs(n))}`;
const signedPct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}%`;

function tradeReason(a: Pick<PlannedAction, "action" | "trigger" | "score" | "reasons">) {
  if (a.action === "SELL") return a.trigger === "signal" ? `Strategy sell signal (score ${a.score})` : TRIGGER_LABEL[a.trigger];
  const top = a.reasons.filter((r) => r.points > 0).sort((x, y) => y.points - x.points).slice(0, 2).map((r) => r.factor.toLowerCase());
  return `Strategy score ${a.score}${top.length ? ` + ${top.join(" + ")}` : ""}`;
}

export async function sendTradeNotifications(
  userId: string,
  cfg: Pick<AgentConfig, "tradeEmails">,
  o: { action: Pick<PlannedAction, "symbol" | "action" | "quantity" | "score" | "trigger" | "reasons">; trade: ExecutedTrade; aiStatus: AiStatus; aiNote: string | null; pnl: number | null; pnlPct: number | null; entryUsd: number | null; approved?: boolean },
) {
  try {
    const { action: a, trade: t } = o;
    const at = new Date();
    const time = at.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    const priceLabel = t.currency !== "USD" ? `${money(t.localPrice, t.currency)} (≈ ${money(t.price)})` : money(t.price);
    const reason = tradeReason(a);
    const user = cfg.tradeEmails ? await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } }) : null;
    const buy = a.action === "BUY";
    const body = buy
      ? `${a.quantity} shares at ${priceLabel} · ${reason} · AI: ${AI_LABEL[o.aiStatus]} · ${time}`
      : `${a.quantity} shares · entry ${o.entryUsd === null ? "—" : money(o.entryUsd)} → exit ${money(t.price)} · P/L ${o.pnl === null ? "—" : `${signedUsd(o.pnl)} (${signedPct(o.pnlPct ?? 0)})`} · ${reason} · ${time}`;
    const mail = user
      ? autoTradeEmail({
          name: user.name,
          side: a.action,
          symbol: t.symbol,
          quantity: a.quantity,
          priceLabel,
          score: a.score,
          reason,
          aiLabel: `${AI_LABEL[o.aiStatus]}${o.aiNote ? `: ${o.aiNote}` : ""}`,
          at,
          entryLabel: o.entryUsd === null ? undefined : money(o.entryUsd),
          pnlLabel: o.pnl === null ? undefined : signedUsd(o.pnl),
          pnlPctLabel: o.pnlPct === null ? undefined : signedPct(o.pnlPct),
          pnlUp: (o.pnl ?? 0) >= 0,
          exitReason: buy ? undefined : reason,
        })
      : null;
    await notify({
      inApp: { userId, kind: "agent_trade", title: `Auto-Trader ${a.action}${o.approved ? " (approved)" : ""}: ${t.symbol}`, body, link: "/agent" },
      email: mail && user ? { to: user.email, kind: buy ? "agent_trade_buy" : "agent_trade_sell", userId, ...mail } : null,
      message: `Auto-Trader ${a.action} ${a.quantity} ${t.symbol} — ${body} (virtual money)`,
    });
  } catch (err) {
    console.error("trade notifications failed", err);
  }
}

/** In-app (+ message) notification for an Auto-Trader event: start/stop, veto, limits, market closed, failures. */
export async function notifyAgentEvent(userId: string, n: { kind: string; title: string; body?: string; link?: string; dedupeMs?: number }) {
  try {
    await notify({ inApp: { userId, ...n }, message: `${n.title}${n.body ? ` — ${n.body}` : ""}` });
  } catch (err) {
    console.error("agent notification failed", err);
  }
}

export async function notifyAgentError(userId: string, err: unknown) {
  await notifyAgentEvent(userId, { kind: "agent_error", title: "Auto-Trader run failed", body: (err instanceof Error ? err.message : String(err)).slice(0, 300), link: "/agent?filter=errors", dedupeMs: 3600_000 });
}

const startOfToday = () => new Date(new Date().setHours(0, 0, 0, 0));

/** One email per user per day (after their summary hour, server time) with the day's Auto-Trader activity. */
export async function sendDailySummaries() {
  const now = new Date();
  const day = now.toLocaleDateString("en-CA");
  const configs = await prisma.agentConfig.findMany({
    where: { enabled: true, dailyEmail: true, summaryHour: { lte: now.getHours() }, OR: [{ lastSummaryDate: null }, { lastSummaryDate: { not: day } }] },
    include: { user: { select: { email: true, name: true } } },
  });
  for (const c of configs) {
    try {
      await prisma.agentConfig.update({ where: { userId: c.userId }, data: { lastSummaryDate: day } });
      const since = startOfToday();
      const [runs, decisions, positions] = await Promise.all([
        prisma.agentRun.count({ where: { userId: c.userId, startedAt: { gte: since } } }),
        prisma.agentDecision.findMany({ where: { userId: c.userId, createdAt: { gte: since } }, orderBy: { createdAt: "asc" } }),
        prisma.agentPosition.findMany({ where: { userId: c.userId }, orderBy: { openedAt: "asc" } }),
      ]);
      if (!runs) continue;
      const traded = decisions.filter((d) => ["executed", "approved"].includes(d.status));
      const buys = traded.filter((d) => d.action === "BUY");
      const sells = traded.filter((d) => d.action === "SELL");
      const holds = decisions.filter((d) => d.action === "HOLD" && d.status === "hold").length;
      const errors = decisions.filter((d) => ["failed", "blocked", "market_closed"].includes(d.status) || d.error === "Vetoed by AI review.").length;
      const pnl = sells.reduce((a, d) => a + Number(d.realizedPnl ?? 0), 0);
      const wins = sells.filter((d) => Number(d.realizedPnl ?? 0) > 0).length;
      const losses = sells.filter((d) => Number(d.realizedPnl ?? 0) < 0).length;
      const pending = decisions.filter((d) => ["suggested", "dry_run"].includes(d.status));
      const rows = [...traded, ...pending];
      const label: Record<string, string> = { executed: "Placed", approved: "Approved", suggested: "Waiting", dry_run: "Dry run" };
      const mail = autoTraderSummaryEmail({
        name: c.user.name,
        date: now,
        title: traded.length ? `${buys.length} buy${buys.length === 1 ? "" : "s"}, ${sells.length} sell${sells.length === 1 ? "" : "s"} today` : "No trades today",
        intro: traded.length ? "here's what your Auto-Trader did today with virtual money." : `your Auto-Trader scanned ${runs} time${runs === 1 ? "" : "s"} today and found nothing to trade under your rules.`,
        stats: [
          { label: "Scans", value: String(runs) },
          { label: "Buys", value: String(buys.length) },
          { label: "Sells", value: String(sells.length) },
          { label: "Holds", value: String(holds) },
          { label: "Realized P/L", value: signedUsd(pnl), tone: pnl > 0 ? "up" : pnl < 0 ? "down" : null },
          { label: "Wins / losses", value: `${wins} / ${losses}` },
          { label: "Open positions", value: String(positions.length) },
          { label: "Errors / rejections", value: String(errors) },
          { label: "Mode", value: c.mode === "FULL_AUTO" ? "Full auto" : c.mode === "SUGGEST" ? "Suggest" : "Dry run" },
        ],
        table: rows.length
          ? {
              columns: [{ label: "Stock" }, { label: "Action" }, { label: "Shares", align: "right" }, { label: "P/L", align: "right" }, { label: "Status", align: "right" }],
              rows: rows.map((d) => ({ cells: [d.symbol, d.action, String(d.quantity), d.realizedPnl === null ? "—" : signedUsd(Number(d.realizedPnl)), label[d.status] ?? d.status], tone: [null, d.action === "BUY" ? "up" : "down", null, d.realizedPnl === null ? null : Number(d.realizedPnl) >= 0 ? "up" : "down", null] })),
            }
          : undefined,
        highlights: [
          ...(positions.length ? [`Open positions: ${positions.map((p) => p.symbol).join(", ")}`] : []),
          ...sells.slice(0, 3).map((d) => `SELL ${d.symbol}: ${TRIGGER_LABEL[d.trigger ?? "signal"] ?? "Sell"}${d.realizedPnlPct === null ? "" : ` (${signedPct(Number(d.realizedPnlPct))})`}`),
          ...buys.slice(0, 3).map((d) => `BUY ${d.symbol}: score ${d.score}`),
        ],
      });
      await notify({ email: { to: c.user.email, kind: "agent_daily_summary", userId: c.userId, ...mail } });
    } catch (err) {
      console.error("daily summary failed", c.userId, err);
    }
  }
}
