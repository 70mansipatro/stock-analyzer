"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { ACTIVITY_FILTERS, agentNotifications, listAutoTrades, listDecisions, openPositions, type ActivityFilter } from "@/lib/agent/activity";
import { runBacktest, type BacktestResult } from "@/lib/agent/backtest";
import { AgentError, approveDecision, getAgentConfig, planConfig, rejectDecision, runAgent } from "@/lib/agent/engine";
import { notifyAgentEvent } from "@/lib/agent/notifications";
import { audit } from "@/lib/audit";
import { AccessError, requirePermission } from "@/lib/authz";
import { getQuote, MarketError, normalizeSymbol } from "@/lib/market";
import { isSupportedSymbol } from "@/lib/market-hours";
import { prisma } from "@/lib/prisma";

// Every action re-checks the session on the server: signed in, not suspended, and allowed to trade.

export type AgentActionResult = { ok: boolean; message: string } | null;

const MAX_STOCKS = 40;
const MODE_LABEL = { FULL_AUTO: "Full auto", SUGGEST: "Suggest", DRY_RUN: "Dry run" } as const;

const bool = (v: FormDataEntryValue | null) => v === "on" || v === "true";

function fail(err: unknown, fallback: string): { ok: false; message: string } {
  if (err instanceof AccessError || err instanceof AgentError || err instanceof MarketError) return { ok: false, message: err.message };
  console.error(fallback, err);
  return { ok: false, message: fallback };
}

function refresh() {
  revalidatePath("/agent");
  revalidatePath("/", "layout");
}

const configSchema = z.object({
  mode: z.enum(["FULL_AUTO", "SUGGEST", "DRY_RUN"]),
  risk: z.enum(["CONSERVATIVE", "BALANCED", "AGGRESSIVE"]),
  budget: z.coerce.number().min(500).max(1_000_000),
  maxPositionPct: z.coerce.number().int().min(5).max(50),
  maxTradesPerDay: z.coerce.number().int().min(1).max(50),
  stopLossPct: z.coerce.number().min(1).max(50),
  // 0 switches the profit target off (e.g. to let a trailing stop run).
  takeProfitPct: z.coerce.number().min(0).max(200).refine((n) => n === 0 || n >= 2, "Use 0 (off) or at least 2%"),
  trailingStopPct: z.coerce.number().min(1).max(50),
  summaryHour: z.coerce.number().int().min(0).max(23),
});

/** Update Auto-Trader settings (not the on/off switch or the stock list, which have their own actions). */
export async function saveAgentConfig(_: AgentActionResult, form: FormData): Promise<AgentActionResult> {
  try {
    const actor = await requirePermission("trade");
    const parsed = configSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { ok: false, message: "Check the values: " + parsed.error.issues.map((i) => `${i.path.join(".")}${i.message ? ` (${i.message})` : ""}`).join(", ") };
    const d = parsed.data;
    const before = await getAgentConfig(actor.id);
    const data = {
      mode: d.mode,
      risk: d.risk,
      budget: new Prisma.Decimal(d.budget),
      maxPositionPct: d.maxPositionPct,
      maxTradesPerDay: d.maxTradesPerDay,
      stopLossPct: new Prisma.Decimal(d.stopLossPct),
      takeProfitPct: new Prisma.Decimal(d.takeProfitPct),
      trailingStopEnabled: bool(form.get("trailingStopEnabled")),
      trailingStopPct: new Prisma.Decimal(d.trailingStopPct),
      useAiReview: bool(form.get("useAiReview")),
      marketHoursOnly: bool(form.get("marketHoursOnly")),
      dailyEmail: bool(form.get("dailyEmail")),
      tradeEmails: bool(form.get("tradeEmails")),
      summaryHour: d.summaryHour,
      demoSpeed: bool(form.get("demoSpeed")),
    };
    await prisma.agentConfig.update({ where: { userId: actor.id }, data });
    // Leaving Suggest mode: pending suggestions are withdrawn so nothing old can be approved later.
    if (before.mode === "SUGGEST" && d.mode !== "SUGGEST") await prisma.agentDecision.updateMany({ where: { userId: actor.id, status: "suggested" }, data: { status: "rejected", error: "Withdrawn: mode changed." } });
    await audit(actor.id, "agent_config_updated", {
      before: { mode: before.mode, risk: before.risk, budget: Number(before.budget), maxPositionPct: before.maxPositionPct, maxTradesPerDay: before.maxTradesPerDay, maxLossPct: Number(before.stopLossPct), profitTargetPct: Number(before.takeProfitPct), trailingStop: before.trailingStopEnabled ? Number(before.trailingStopPct) : null, aiReview: before.useAiReview, marketHoursOnly: before.marketHoursOnly, demoSpeed: before.demoSpeed },
      after: { mode: d.mode, risk: d.risk, budget: d.budget, maxPositionPct: d.maxPositionPct, maxTradesPerDay: d.maxTradesPerDay, maxLossPct: d.stopLossPct, profitTargetPct: d.takeProfitPct, trailingStop: data.trailingStopEnabled ? d.trailingStopPct : null, aiReview: data.useAiReview, marketHoursOnly: data.marketHoursOnly, demoSpeed: data.demoSpeed },
    });
    refresh();
    return { ok: true, message: `Saved. Mode: ${MODE_LABEL[d.mode]}${before.enabled ? "" : " (the auto-trader is stopped; press Start to run it)"}.` };
  } catch (err) {
    return fail(err, "Couldn't save the settings.");
  }
}

/** Start or stop the Auto-Trader. */
export async function setAgentEnabled(enabled: boolean): Promise<AgentActionResult> {
  try {
    const actor = await requirePermission("trade");
    const cfg = await getAgentConfig(actor.id);
    if (enabled && !cfg.universe.length) return { ok: false, message: "Select at least one stock first." };
    if (cfg.enabled === enabled) return { ok: true, message: enabled ? "The auto-trader is already running." : "The auto-trader is already stopped." };
    await prisma.agentConfig.update({ where: { userId: actor.id }, data: { enabled } });
    await audit(actor.id, enabled ? "agent_started" : "agent_stopped", { mode: cfg.mode, stocks: cfg.universe.length });
    await notifyAgentEvent(actor.id, {
      kind: enabled ? "agent_started" : "agent_stopped",
      title: enabled ? `Auto-Trader started (${MODE_LABEL[cfg.mode]})` : "Auto-Trader stopped",
      body: enabled ? `Watching ${cfg.universe.length} stock${cfg.universe.length === 1 ? "" : "s"}. Virtual money only.` : "No new automatic trades will be placed.",
      link: "/agent",
    });
    refresh();
    return { ok: true, message: enabled ? `Started in ${MODE_LABEL[cfg.mode]} mode, watching ${cfg.universe.length} stocks.` : "Stopped. No new trades will be placed." };
  } catch (err) {
    return fail(err, "Couldn't change the auto-trader.");
  }
}

/** Add a US or Indian (NSE/BSE) stock to the Auto-Trader's list. */
export async function addAgentStock(raw: string): Promise<AgentActionResult & { symbol?: string }> {
  try {
    const actor = await requirePermission("trade");
    const symbol = normalizeSymbol(String(raw ?? "").slice(0, 30));
    if (!isSupportedSymbol(symbol)) return { ok: false, message: `${symbol}: the auto-trader supports US stocks and Indian stocks on NSE (.NS) or BSE (.BO).` };
    const cfg = await getAgentConfig(actor.id);
    if (cfg.universe.includes(symbol)) return { ok: true, message: `${symbol} is already selected.`, symbol };
    if (cfg.universe.length >= MAX_STOCKS) return { ok: false, message: `Select at most ${MAX_STOCKS} stocks.` };
    const quote = await getQuote(symbol).catch(() => null);
    if (!quote) return { ok: false, message: `Couldn't find market data for ${symbol}.` };
    // Re-read inside the update so two quick adds don't overwrite each other.
    await prisma.$transaction(async (tx) => {
      const row = await tx.agentConfig.findUniqueOrThrow({ where: { userId: actor.id }, select: { universe: true } });
      if (!row.universe.includes(quote.symbol)) await tx.agentConfig.update({ where: { userId: actor.id }, data: { universe: [...row.universe, quote.symbol] } });
    });
    await audit(actor.id, "agent_stock_added", { symbol: quote.symbol });
    refresh();
    return { ok: true, message: `Added ${quote.symbol}.`, symbol: quote.symbol };
  } catch (err) {
    return fail(err, "Couldn't add that stock.");
  }
}

/** Remove a stock from the list. An open agent position in it stays protected by the exit rules until sold. */
export async function removeAgentStock(symbol: string): Promise<AgentActionResult> {
  try {
    const actor = await requirePermission("trade");
    const sym = String(symbol ?? "").toUpperCase();
    await prisma.$transaction(async (tx) => {
      const row = await tx.agentConfig.findUniqueOrThrow({ where: { userId: actor.id }, select: { universe: true } });
      await tx.agentConfig.update({ where: { userId: actor.id }, data: { universe: row.universe.filter((s) => s !== sym) } });
    });
    await audit(actor.id, "agent_stock_removed", { symbol: sym });
    refresh();
    return { ok: true, message: `Removed ${sym}.` };
  } catch (err) {
    return fail(err, "Couldn't remove that stock.");
  }
}

export async function runAgentNow(): Promise<AgentActionResult> {
  try {
    const actor = await requirePermission("trade");
    const r = await runAgent(actor.id, "manual");
    refresh();
    return { ok: r.status === "completed", message: r.summary };
  } catch (err) {
    return fail(err, "The run failed. Please try again.");
  }
}

const lastBacktest = new Map<string, number>();

/** Historical simulation of the saved settings on the selected stocks. */
export async function backtestAgent(days: number): Promise<{ ok: true; result: BacktestResult } | { ok: false; message: string }> {
  try {
    const actor = await requirePermission("trade");
    const since = Date.now() - (lastBacktest.get(actor.id) ?? 0);
    if (since < 5_000) return { ok: false, message: "Please wait a few seconds between backtests." };
    lastBacktest.set(actor.id, Date.now());
    const cfg = await getAgentConfig(actor.id);
    if (!cfg.universe.length) return { ok: false, message: "Select at least one stock to backtest." };
    const span = [63, 126, 252].includes(days) ? days : 126;
    const result = await runBacktest(cfg.universe, planConfig(cfg), span);
    await audit(actor.id, "agent_backtest", { days: span, returnPct: result.returnPct, trades: result.trades, settings: result.settings });
    return { ok: true, result };
  } catch (err) {
    if (err instanceof AccessError) return { ok: false, message: err.message };
    console.error("backtest failed", err);
    return { ok: false, message: err instanceof Error ? err.message : "Backtest failed." };
  }
}

export async function decideSuggestion(id: string, approve: boolean): Promise<AgentActionResult> {
  try {
    const actor = await requirePermission("trade");
    if (approve) {
      const t = await approveDecision(actor.id, id);
      refresh();
      return { ok: true, message: `${t.side === "BUY" ? "Bought" : "Sold"} ${t.quantity} ${t.symbol}.` };
    }
    await rejectDecision(actor.id, id);
    revalidatePath("/agent");
    return { ok: true, message: "Suggestion dismissed." };
  } catch (err) {
    return fail(err, "Couldn't complete that. Please try again.");
  }
}

// ---------- Read actions (for client components and integrations) ----------

export async function getAutoTraderConfig() {
  const actor = await requirePermission("trade");
  const c = await getAgentConfig(actor.id);
  return {
    enabled: c.enabled,
    mode: c.mode,
    risk: c.risk,
    budget: Number(c.budget),
    maxPositionPct: c.maxPositionPct,
    maxTradesPerDay: c.maxTradesPerDay,
    profitTargetPct: Number(c.takeProfitPct),
    maxLossPct: Number(c.stopLossPct),
    trailingStopEnabled: c.trailingStopEnabled,
    trailingStopPct: Number(c.trailingStopPct),
    aiReview: c.useAiReview,
    marketHoursOnly: c.marketHoursOnly,
    demoSpeed: c.demoSpeed,
    dailyEmail: c.dailyEmail,
    tradeEmails: c.tradeEmails,
    summaryHour: c.summaryHour,
    stocks: c.universe,
    lastRunAt: c.lastRunAt?.toISOString() ?? null,
  };
}

export async function getAgentActivityLog(filter: string = "all", take = 60) {
  const actor = await requirePermission("trade");
  const f = (ACTIVITY_FILTERS as readonly string[]).includes(filter) ? (filter as ActivityFilter) : "all";
  return listDecisions(actor.id, f, take);
}

export async function getAutoTrades(take = 30) {
  const actor = await requirePermission("trade");
  return listAutoTrades(actor.id, take);
}

export async function getAgentOpenPositions() {
  const actor = await requirePermission("trade");
  return openPositions(actor.id, await getAgentConfig(actor.id));
}

export async function getAgentNotifications(take = 10) {
  const actor = await requirePermission("trade");
  return agentNotifications(actor.id, Math.min(take, 50));
}

export async function markAgentNotificationsRead(ids?: string[]): Promise<AgentActionResult> {
  try {
    const actor = await requirePermission("trade");
    const list = (ids ?? []).filter((x) => typeof x === "string").slice(0, 50);
    await prisma.notification.updateMany({ where: { userId: actor.id, readAt: null, kind: { startsWith: "agent_" }, ...(ids ? { id: { in: list } } : {}) }, data: { readAt: new Date() } });
    revalidatePath("/agent");
    return { ok: true, message: "Marked as read." };
  } catch (err) {
    return fail(err, "Couldn't update notifications.");
  }
}
