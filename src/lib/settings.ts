import "server-only";
import { prisma } from "@/lib/prisma";

export type PlatformSettings = {
  maxOrderValue: number;
  maxSharesPerOrder: number;
  startingCash: number;
  tradingEnabled: boolean;
  aiEnabled: boolean;
  updatedAt: string | null;
};

const DEFAULTS: PlatformSettings = {
  maxOrderValue: 50_000,
  maxSharesPerOrder: 10_000,
  startingCash: 100_000,
  tradingEnabled: true,
  aiEnabled: true,
  updatedAt: null,
};

let cache: { at: number; value: PlatformSettings } | null = null;

/** Admin-editable platform settings (cached for 5 seconds). */
export async function getSettings(): Promise<PlatformSettings> {
  if (cache && Date.now() - cache.at < 5_000) return cache.value;
  const row = await prisma.appSettings.findUnique({ where: { id: "global" } }).catch(() => null);
  const value: PlatformSettings = row
    ? {
        maxOrderValue: Number(row.maxOrderValue),
        maxSharesPerOrder: row.maxSharesPerOrder,
        startingCash: Number(row.startingCash),
        tradingEnabled: row.tradingEnabled,
        aiEnabled: row.aiEnabled,
        updatedAt: row.updatedAt.toISOString(),
      }
    : DEFAULTS;
  cache = { at: Date.now(), value };
  return value;
}

export function clearSettingsCache() {
  cache = null;
}
