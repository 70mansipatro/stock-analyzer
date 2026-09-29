import "server-only";
import { prisma } from "@/lib/prisma";
import type { Reason } from "./strategy";
import { DEFAULT_UNIVERSE } from "./strategy";

/** Read-only summary of the auto-trader for the AI assistant. */
export async function getAgentActivity(userId: string, runs = 3) {
  const cfg = await prisma.agentConfig.findUnique({ where: { userId } });
  if (!cfg) return { configured: false, note: "The auto-trader hasn't been set up yet. It's on the Auto-Trader page (/agent)." };
  const recent = await prisma.agentRun.findMany({
    where: { userId },
    orderBy: { startedAt: "desc" },
    take: runs,
    include: { decisions: { where: { action: { not: "HOLD" } }, orderBy: { score: "desc" } } },
  });
  return {
    configured: true,
    settings: {
      enabled: cfg.enabled,
      mode: cfg.mode,
      risk: cfg.risk,
      budgetUsd: Number(cfg.budget),
      maxPositionPct: cfg.maxPositionPct,
      maxTradesPerDay: cfg.maxTradesPerDay,
      stopLossPct: Number(cfg.stopLossPct),
      takeProfitPct: Number(cfg.takeProfitPct),
      stocksWatched: (cfg.universe.length ? cfg.universe : DEFAULT_UNIVERSE).length,
      aiReview: cfg.useAiReview,
      lastRunAt: cfg.lastRunAt?.toISOString() ?? null,
    },
    runs: recent.map((r) => ({
      at: r.startedAt.toISOString(),
      trigger: r.trigger,
      status: r.status,
      summary: r.summary,
      aiReview: r.aiNote,
      decisions: r.decisions.map((d) => ({
        symbol: d.symbol,
        action: d.action,
        quantity: d.quantity,
        score: d.score,
        status: d.status,
        aiNote: d.aiNote,
        error: d.error,
        reasons: (d.reasons as Reason[]).filter((x) => x.points !== 0).map((x) => `${x.factor} (${x.points > 0 ? "+" : ""}${x.points}): ${x.detail}`),
      })),
    })),
  };
}
