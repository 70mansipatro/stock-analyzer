import "server-only";
import { prisma } from "@/lib/prisma";
import { getHistory, getQuotes, getSector } from "@/lib/market";
import { getPortfolio, STARTING_CASH, type Portfolio } from "@/lib/trading";

export type PerformancePoint = { date: string; portfolio: number; benchmark: number | null };

export type Performance = {
  points: PerformancePoint[];
  benchmarkLabel: string;
  portfolioReturnPct: number;
  benchmarkReturnPct: number | null;
};

/**
 * Rebuilds the account value for every trading day since the first trade:
 * cash after that day's trades + shares held × that day's close (in USD).
 * The benchmark is the S&P 500 scaled to the same $100,000 start.
 * Non-USD holdings use today's exchange rate for the whole history (a simplification).
 */
export async function getPerformance(userId: string, portfolio?: Portfolio): Promise<Performance> {
  const trades = await prisma.trade.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  const current = portfolio ?? (await getPortfolio(userId));
  const benchmarkLabel = "S&P 500";
  if (trades.length === 0) {
    return { points: [], benchmarkLabel, portfolioReturnPct: current.totalReturnPct, benchmarkReturnPct: null };
  }

  const start = new Date(trades[0].createdAt);
  start.setUTCDate(start.getUTCDate() - 1);
  const startDay = start.toISOString().slice(0, 10);
  const days = Math.max(30, Math.ceil((Date.now() - start.getTime()) / 86_400_000) + 10);

  const symbols = [...new Set(trades.map((t) => t.symbol))];
  const [histories, benchmark, quotes] = await Promise.all([
    Promise.all(symbols.map((s) => getHistory(s, days).catch(() => []))),
    getHistory("^GSPC", days).catch(() => []),
    getQuotes(symbols),
  ]);
  const closeBySymbol = new Map(
    symbols.map((s, i) => [s, new Map(histories[i].map((b) => [b.date, b.close * (quotes.get(s)?.usdRate ?? 1)]))]),
  );

  // Trading days come from the benchmark; if it's unavailable, from the holdings' own price history.
  const tradingDays = benchmark.length ? benchmark.map((b) => b.date) : [...new Set(histories.flat().map((b) => b.date))].sort();
  const calendar = tradingDays.filter((d) => d >= startDay);
  const benchByDate = new Map(benchmark.map((b) => [b.date, b.close]));
  const benchStart = benchByDate.get(calendar[0]) ?? null;

  const qty = new Map<string, number>();
  const lastClose = new Map<string, number>();
  let cash = STARTING_CASH;
  let t = 0;
  const points: PerformancePoint[] = [];

  for (const day of calendar) {
    while (t < trades.length && trades[t].createdAt.toISOString().slice(0, 10) <= day) {
      const tr = trades[t++];
      const sign = tr.side === "BUY" ? 1 : -1;
      qty.set(tr.symbol, (qty.get(tr.symbol) ?? 0) + sign * tr.quantity);
      cash -= sign * Number(tr.total);
      lastClose.set(tr.symbol, Number(tr.price));
    }
    let invested = 0;
    for (const [s, q] of qty) {
      const close = closeBySymbol.get(s)?.get(day);
      if (close !== undefined) lastClose.set(s, close);
      invested += q * (lastClose.get(s) ?? 0);
    }
    const b = benchByDate.get(day);
    points.push({
      date: day,
      portfolio: Number((cash + invested).toFixed(2)),
      benchmark: benchStart && b ? Number(((b / benchStart) * STARTING_CASH).toFixed(2)) : null,
    });
  }

  // Today's point uses live prices so the line ends at the value shown on the page.
  const today = new Date().toISOString().slice(0, 10);
  const lastPoint = points[points.length - 1];
  if (lastPoint && lastPoint.date === today) lastPoint.portfolio = current.totalValue;
  else points.push({ date: today, portfolio: current.totalValue, benchmark: lastPoint?.benchmark ?? null });

  const lastBench = [...points].reverse().find((p) => p.benchmark !== null)?.benchmark ?? null;
  return {
    points,
    benchmarkLabel,
    portfolioReturnPct: current.totalReturnPct,
    benchmarkReturnPct: lastBench ? Number((((lastBench - STARTING_CASH) / STARTING_CASH) * 100).toFixed(2)) : null,
  };
}

export type AllocationSlice = { name: string; value: number; pct: number };

/** Value split by holding and by sector (cash included as its own slice). */
export async function getAllocation(portfolio: Portfolio): Promise<{ byHolding: AllocationSlice[]; bySector: AllocationSlice[] }> {
  const total = portfolio.totalValue || 1;
  const slice = (name: string, value: number) => ({ name, value: Number(value.toFixed(2)), pct: Number(((value / total) * 100).toFixed(1)) });

  const holdings = portfolio.positions
    .map((p) => ({ symbol: p.symbol, value: p.marketValue ?? p.costBasis }))
    .sort((a, b) => b.value - a.value);
  const top = holdings.slice(0, 6);
  const rest = holdings.slice(6).reduce((a, h) => a + h.value, 0);
  const byHolding = [
    ...top.map((h) => slice(h.symbol, h.value)),
    ...(rest > 0 ? [slice("Other", rest)] : []),
    ...(portfolio.cash > 0 ? [slice("Cash", portfolio.cash)] : []),
  ];

  const sectors = await Promise.all(holdings.map((h) => getSector(h.symbol)));
  const sectorTotals = new Map<string, number>();
  holdings.forEach((h, i) => sectorTotals.set(sectors[i], (sectorTotals.get(sectors[i]) ?? 0) + h.value));
  const bySector = [
    ...[...sectorTotals.entries()].sort((a, b) => b[1] - a[1]).map(([n, v]) => slice(n, v)),
    ...(portfolio.cash > 0 ? [slice("Cash", portfolio.cash)] : []),
  ];
  return { byHolding, bySector };
}
