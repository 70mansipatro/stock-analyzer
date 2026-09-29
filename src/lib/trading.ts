import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getQuote, getQuotes, normalizeSymbol } from "@/lib/market";
import { audit } from "@/lib/audit";
import { orderFilledEmail, sendEmail, wantsEmail } from "@/lib/email";
import { money } from "@/lib/format";
import { roleOf } from "@/lib/roles";
import { can, ROLE_INFO } from "@/lib/rbac";
import { getSettings } from "@/lib/settings";

/**
 * Paper trading only: no broker is called and no real money moves.
 * Cash, trade prices, cost basis and P&L are all kept in USD. Stocks quoted in other currencies
 * (e.g. RRKABEL.NS in INR) are converted at the live exchange rate when the order is placed.
 * Every trade from the UI or the chatbot goes through validateOrder + executeOrder here,
 * so these checks can't be skipped by the LLM or by a modified client.
 */

/** Hard ceiling for schema validation; the live per-order limits come from admin settings. */
const MAX_SHARES_CEILING = 1_000_000;

export const orderSchema = z.object({
  symbol: z.string().min(1).max(20),
  side: z.enum(["BUY", "SELL"]),
  quantity: z.number().int().positive().max(MAX_SHARES_CEILING),
});
export type OrderInput = z.infer<typeof orderSchema>;

export class TradeError extends Error {}

export type OrderPreview = {
  symbol: string;
  name: string;
  side: "BUY" | "SELL";
  quantity: number;
  /** Price per share in USD (what the trade is booked at). */
  price: number;
  /** Price per share in the stock's own currency, for display. */
  localPrice: number;
  currency: string;
  total: number;
  cashBefore: number;
  cashAfter: number;
  sharesOwned: number;
};

/** Checks an order against live price, limits, cash and holdings. Does not change anything. */
export async function validateOrder(userId: string, input: OrderInput): Promise<OrderPreview> {
  const [settings, role] = await Promise.all([getSettings(), roleOf(userId)]);
  if (!role) throw new TradeError("Your account is suspended or no longer exists.");
  if (!can(role, "trade")) throw new TradeError(`Your role (${ROLE_INFO[role].label}) can view markets but can't place trades.`);
  if (!settings.tradingEnabled) throw new TradeError("Trading is paused by an administrator. Please try again later.");

  const parsed = orderSchema.safeParse(input);
  if (!parsed.success || parsed.data.quantity > settings.maxSharesPerOrder) {
    throw new TradeError(`Quantity must be a whole number between 1 and ${settings.maxSharesPerOrder.toLocaleString()}.`);
  }
  const { side, quantity } = parsed.data;
  const symbol = normalizeSymbol(parsed.data.symbol);

  // Price always comes from the market data feed, never from the client or the LLM.
  const quote = await getQuote(symbol);
  const price = quote.priceUsd;
  const total = Number((price * quantity).toFixed(2));

  if (total > settings.maxOrderValue) {
    throw new TradeError(
      `Order value $${total.toLocaleString()} is over the $${settings.maxOrderValue.toLocaleString()} per-order limit.`,
    );
  }

  const [user, holding] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { cashBalance: true } }),
    prisma.holding.findUnique({ where: { userId_symbol: { userId, symbol: quote.symbol } } }),
  ]);
  const cash = Number(user.cashBalance);
  const owned = holding?.quantity ?? 0;

  if (side === "BUY" && total > cash) {
    throw new TradeError(`Not enough cash: this order costs $${total.toLocaleString()} but you have $${cash.toLocaleString()}.`);
  }
  if (side === "SELL" && quantity > owned) {
    throw new TradeError(`You can't sell ${quantity} ${quote.symbol}: you own ${owned} shares.`);
  }

  return {
    symbol: quote.symbol,
    name: quote.name,
    side,
    quantity,
    price,
    localPrice: quote.price,
    currency: quote.currency,
    total,
    cashBefore: cash,
    cashAfter: Number((side === "BUY" ? cash - total : cash + total).toFixed(2)),
    sharesOwned: owned,
  };
}

export type ExecutedTrade = OrderPreview & { tradeId: string; realizedPnl: number | null };

export async function executeOrder(
  userId: string,
  input: OrderInput,
  source: "UI" | "CHAT" | "AGENT",
): Promise<ExecutedTrade> {
  const preview = await validateOrder(userId, input);
  const { symbol, side, quantity, price, total } = preview;
  const totalDec = new Prisma.Decimal(total);

  try {
    const result = await prisma.$transaction(async (tx) => {
      let realizedPnl: number | null = null;

      if (side === "BUY") {
        // Conditional update: fails if cash dropped since validation (e.g. two orders at once).
        const paid = await tx.user.updateMany({
          where: { id: userId, cashBalance: { gte: totalDec } },
          data: { cashBalance: { decrement: totalDec } },
        });
        if (paid.count !== 1) throw new TradeError("Not enough cash for this order.");

        const existing = await tx.holding.findUnique({ where: { userId_symbol: { userId, symbol } } });
        if (existing) {
          const newQty = existing.quantity + quantity;
          const newAvg = (Number(existing.avgCost) * existing.quantity + total) / newQty;
          await tx.holding.update({
            where: { id: existing.id },
            data: { quantity: newQty, avgCost: new Prisma.Decimal(newAvg.toFixed(4)) },
          });
        } else {
          await tx.holding.create({
            data: { userId, symbol, quantity, avgCost: new Prisma.Decimal(price.toFixed(4)) },
          });
        }
      } else {
        const holding = await tx.holding.findUnique({ where: { userId_symbol: { userId, symbol } } });
        if (!holding) throw new TradeError(`You don't own any ${symbol}.`);
        const sold = await tx.holding.updateMany({
          where: { id: holding.id, quantity: { gte: quantity } },
          data: { quantity: { decrement: quantity } },
        });
        if (sold.count !== 1) throw new TradeError(`You don't own enough ${symbol}.`);
        await tx.holding.deleteMany({ where: { id: holding.id, quantity: 0 } });
        await tx.user.update({ where: { id: userId }, data: { cashBalance: { increment: totalDec } } });
        realizedPnl = Number(((price - Number(holding.avgCost)) * quantity).toFixed(2));
      }

      const trade = await tx.trade.create({
        data: {
          userId,
          symbol,
          side,
          quantity,
          price: new Prisma.Decimal(price.toFixed(4)),
          total: totalDec,
          realizedPnl: realizedPnl === null ? null : new Prisma.Decimal(realizedPnl),
          source,
        },
      });
      return { tradeId: trade.id, realizedPnl };
    });

    await audit(userId, "trade_executed", { symbol, side, quantity, price, total, source });
    void sendOrderEmail(userId, preview, result.realizedPnl, source);
    return { ...preview, ...result };
  } catch (err) {
    if (err instanceof TradeError) await audit(userId, "trade_denied", { symbol, side, quantity, source, reason: err.message });
    throw err;
  }
}

export type PortfolioPosition = {
  symbol: string;
  name: string;
  quantity: number;
  /** USD */
  avgCost: number;
  /** Live price in USD */
  price: number | null;
  /** Live price in the stock's own currency */
  localPrice: number | null;
  currency: string;
  dayChangePercent: number | null;
  marketValue: number | null;
  costBasis: number;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
  weightPct: number | null;
};

export type Portfolio = {
  cash: number;
  investedValue: number;
  totalValue: number;
  costBasis: number;
  unrealizedPnl: number;
  realizedPnl: number;
  startingCash: number;
  totalReturnPct: number;
  positions: PortfolioPosition[];
};


export async function getPortfolio(userId: string): Promise<Portfolio> {
  const [user, holdings, realized] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { cashBalance: true, startingCash: true } }),
    prisma.holding.findMany({ where: { userId }, orderBy: { symbol: "asc" } }),
    prisma.trade.aggregate({ where: { userId, side: "SELL" }, _sum: { realizedPnl: true } }),
  ]);
  const quotes = await getQuotes(holdings.map((h) => h.symbol));
  const cash = Number(user.cashBalance);
  const startingCash = Number(user.startingCash) || 100_000;

  const positions: PortfolioPosition[] = holdings.map((h) => {
    const q = quotes.get(h.symbol);
    const avgCost = Number(h.avgCost);
    const costBasis = avgCost * h.quantity;
    const marketValue = q ? q.priceUsd * h.quantity : null;
    return {
      symbol: h.symbol,
      name: q?.name ?? h.symbol,
      quantity: h.quantity,
      avgCost: Number(avgCost.toFixed(2)),
      price: q?.priceUsd ?? null,
      localPrice: q?.price ?? null,
      currency: q?.currency ?? "USD",
      dayChangePercent: q?.changePercent ?? null,
      marketValue: marketValue === null ? null : Number(marketValue.toFixed(2)),
      costBasis: Number(costBasis.toFixed(2)),
      unrealizedPnl: marketValue === null ? null : Number((marketValue - costBasis).toFixed(2)),
      unrealizedPnlPct: marketValue === null ? null : Number((((marketValue - costBasis) / costBasis) * 100).toFixed(2)),
      weightPct: null,
    };
  });

  // Positions without a live quote are valued at cost so totals stay meaningful.
  const investedValue = positions.reduce((a, p) => a + (p.marketValue ?? p.costBasis), 0);
  const totalValue = cash + investedValue;
  positions.forEach((p) => {
    p.weightPct = totalValue > 0 ? Number((((p.marketValue ?? p.costBasis) / totalValue) * 100).toFixed(1)) : null;
  });
  const costBasis = positions.reduce((a, p) => a + p.costBasis, 0);

  return {
    cash: Number(cash.toFixed(2)),
    investedValue: Number(investedValue.toFixed(2)),
    totalValue: Number(totalValue.toFixed(2)),
    costBasis: Number(costBasis.toFixed(2)),
    unrealizedPnl: Number((investedValue - costBasis).toFixed(2)),
    realizedPnl: Number(realized._sum.realizedPnl ?? 0),
    startingCash,
    totalReturnPct: Number((((totalValue - startingCash) / startingCash) * 100).toFixed(2)),
    positions,
  };
}

export async function getRecentTrades(userId: string, take = 20) {
  const trades = await prisma.trade.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take });
  return trades.map((t) => ({
    id: t.id,
    symbol: t.symbol,
    side: t.side,
    quantity: t.quantity,
    price: Number(t.price),
    total: Number(t.total),
    realizedPnl: t.realizedPnl === null ? null : Number(t.realizedPnl),
    source: t.source,
    createdAt: t.createdAt.toISOString(),
  }));
}

/** Order confirmation email (respects the user's "Orders" email preference). Never throws. */
async function sendOrderEmail(userId: string, p: OrderPreview, realizedPnl: number | null, source: "UI" | "CHAT" | "AGENT") {
  try {
    if (!(await wantsEmail(userId, "orders"))) return;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
    if (!user) return;
    const local = p.currency !== "USD" ? `${money(p.localPrice, p.currency)} (≈ ${money(p.price)})` : money(p.price);
    const mail = orderFilledEmail({
      name: user.name,
      side: p.side,
      quantity: p.quantity,
      symbol: p.symbol,
      company: p.name,
      priceLabel: local,
      totalLabel: money(p.total),
      cashAfterLabel: money(p.cashAfter),
      pnlLabel: realizedPnl === null ? null : `${realizedPnl >= 0 ? "+" : "−"}${money(Math.abs(realizedPnl))}`,
      via: source === "CHAT" ? "AI assistant" : source === "AGENT" ? "AI auto-trader" : "Trade form",
      at: new Date(),
    });
    await sendEmail({ to: user.email, kind: "order_filled", userId, ...mail });
  } catch (err) {
    console.error("order email failed", err);
  }
}
