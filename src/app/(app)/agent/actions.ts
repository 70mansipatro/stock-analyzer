"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { runBacktest, type BacktestResult } from "@/lib/agent/backtest";
import { AgentError, approveDecision, getAgentConfig, planConfig, rejectDecision, runAgent } from "@/lib/agent/engine";
import { DEFAULT_UNIVERSE } from "@/lib/agent/strategy";
import { audit } from "@/lib/audit";
import { AccessError, requirePermission } from "@/lib/authz";
import { MarketError, normalizeSymbol } from "@/lib/market";
import { prisma } from "@/lib/prisma";

export type AgentActionResult = { ok: boolean; message: string } | null;

const bool = (v: FormDataEntryValue | null) => v === "on" || v === "true";

const configSchema = z.object({
  mode: z.enum(["AUTO", "SUGGEST", "DRY_RUN"]),
  risk: z.enum(["CONSERVATIVE", "BALANCED", "AGGRESSIVE"]),
  budget: z.coerce.number().min(500).max(1_000_000),
  maxPositionPct: z.coerce.number().int().min(5).max(50),
  maxTradesPerDay: z.coerce.number().int().min(1).max(50),
  stopLossPct: z.coerce.number().min(1).max(50),
  takeProfitPct: z.coerce.number().min(2).max(200),
});

export async function saveAgentConfig(_: AgentActionResult, form: FormData): Promise<AgentActionResult> {
  try {
    const actor = await requirePermission("trade");
    const parsed = configSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { ok: false, message: "Check the values: " + parsed.error.issues.map((i) => i.path.join(".")).join(", ") };
    const raw = String(form.get("universe") ?? "").split(/[\s,]+/).filter(Boolean);
    const universe: string[] = [];
    for (const s of raw.length ? raw : DEFAULT_UNIVERSE) {
      try {
        const sym = normalizeSymbol(s);
        if (!universe.includes(sym)) universe.push(sym);
      } catch {
        return { ok: false, message: `"${s}" isn't a valid ticker.` };
      }
    }
    if (universe.length > 40) return { ok: false, message: "Track at most 40 stocks." };
    const d = parsed.data;
    const data = {
      enabled: bool(form.get("enabled")),
      mode: d.mode,
      risk: d.risk,
      budget: new Prisma.Decimal(d.budget),
      maxPositionPct: d.maxPositionPct,
      maxTradesPerDay: d.maxTradesPerDay,
      stopLossPct: new Prisma.Decimal(d.stopLossPct),
      takeProfitPct: new Prisma.Decimal(d.takeProfitPct),
      universe,
      useAiReview: bool(form.get("useAiReview")),
      dailyEmail: bool(form.get("dailyEmail")),
      demoSpeed: bool(form.get("demoSpeed")),
    };
    await prisma.agentConfig.upsert({ where: { userId: actor.id }, create: { userId: actor.id, ...data }, update: data });
    await audit(actor.id, "agent_config_updated", { ...d, enabled: data.enabled, stocks: universe.length, demoSpeed: data.demoSpeed });
    revalidatePath("/agent");
    return { ok: true, message: data.enabled ? `Auto-trader is on (${d.mode === "AUTO" ? "Auto" : d.mode === "SUGGEST" ? "Suggest" : "Dry run"}), watching ${universe.length} stocks.` : "Settings saved. The auto-trader is off." };
  } catch (err) {
    if (err instanceof AccessError) return { ok: false, message: err.message };
    if (err instanceof MarketError) return { ok: false, message: err.message };
    console.error("save agent config failed", err);
    return { ok: false, message: "Couldn't save the settings." };
  }
}

export async function runAgentNow(): Promise<AgentActionResult> {
  try {
    const actor = await requirePermission("trade");
    const r = await runAgent(actor.id, "manual");
    revalidatePath("/agent");
    revalidatePath("/", "layout");
    return { ok: r.status === "completed", message: r.summary };
  } catch (err) {
    if (err instanceof AccessError || err instanceof AgentError) return { ok: false, message: err.message };
    console.error("agent run failed", err);
    return { ok: false, message: "The run failed. Please try again." };
  }
}

const lastBacktest = new Map<string, number>();

export async function backtestAgent(days: number): Promise<{ ok: true; result: BacktestResult } | { ok: false; message: string }> {
  try {
    const actor = await requirePermission("trade");
    const since = Date.now() - (lastBacktest.get(actor.id) ?? 0);
    if (since < 5_000) return { ok: false, message: "Please wait a few seconds between backtests." };
    lastBacktest.set(actor.id, Date.now());
    const cfg = await getAgentConfig(actor.id);
    const span = [63, 126, 252].includes(days) ? days : 126;
    const result = await runBacktest(cfg.universe.length ? cfg.universe : DEFAULT_UNIVERSE, planConfig(cfg), span);
    await audit(actor.id, "agent_backtest", { days: span, returnPct: result.returnPct, trades: result.trades });
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
      revalidatePath("/agent");
      revalidatePath("/", "layout");
      return { ok: true, message: `${t.side === "BUY" ? "Bought" : "Sold"} ${t.quantity} ${t.symbol}.` };
    }
    await rejectDecision(actor.id, id);
    revalidatePath("/agent");
    return { ok: true, message: "Suggestion dismissed." };
  } catch (err) {
    if (err instanceof AccessError || err instanceof AgentError) return { ok: false, message: err.message };
    return { ok: false, message: "Couldn't complete that. Please try again." };
  }
}
