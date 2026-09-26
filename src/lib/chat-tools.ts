import "server-only";
import { tool, type InferUITools, type ToolApprovalConfiguration, type UIMessage } from "ai";
import { z } from "zod";
import { analyzeStock } from "@/lib/analysis";
import { getQuote, getTopStocks, MarketError, searchSymbols, TOP_CATEGORY_LABELS, type TopCategory } from "@/lib/market";
import { predictStock } from "@/lib/prediction";
import { executeOrder, getPortfolio, LIMITS, TradeError, validateOrder } from "@/lib/trading";
import { audit } from "@/lib/audit";

const symbolField = z
  .string()
  .min(1)
  .max(15)
  .regex(/^[A-Za-z0-9.\-^=]+$/, "Ticker symbols only contain letters, digits, '.', '-', '^' or '='")
  .describe("Ticker symbol, e.g. AAPL. Use searchStocks first if you only know the company name.");

/** Turns expected errors into a result the model can explain instead of crashing the stream. */
async function safe<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof MarketError || err instanceof TradeError) return { error: err.message };
    console.error("tool failed", err);
    return { error: "Market data is unavailable right now. Please try again shortly." };
  }
}

/**
 * Tools are built per request so `userId` comes from the verified session, never from model output.
 */
export function buildTools(userId: string) {
  return {
    getTopStocks: tool({
      description: "List today's top US stocks: most active, biggest gainers, or biggest losers.",
      inputSchema: z.object({
        category: z.enum(["most_actives", "day_gainers", "day_losers"]).default("most_actives"),
        count: z.number().int().min(1).max(15).default(10),
      }),
      execute: ({ category, count }) =>
        safe(async () => ({
          category,
          label: TOP_CATEGORY_LABELS[category as TopCategory],
          stocks: await getTopStocks(category, count),
        })),
    }),

    searchStocks: tool({
      description:
        "Find ticker symbols by company name, including non-US stocks (e.g. Indian NSE stocks end in .NS, BSE in .BO, London in .L).",
      inputSchema: z.object({ query: z.string().min(1).max(50) }),
      execute: ({ query }) => safe(async () => ({ results: await searchSymbols(query) })),
    }),

    getQuote: tool({
      description: "Get the live price and key stats for one stock.",
      inputSchema: z.object({ symbol: symbolField }),
      execute: ({ symbol }) => safe(() => getQuote(symbol)),
    }),

    analyzeStock: tool({
      description:
        "Technical analysis of a stock: moving averages, RSI, MACD, volatility, returns, and bullish/bearish signals.",
      inputSchema: z.object({ symbol: symbolField }),
      execute: ({ symbol }) => safe(() => analyzeStock(symbol)),
      // The UI gets the chart series; the model only needs the numbers.
      toModelOutput: ({ output }) => ({
        type: "json",
        value: "error" in output ? output : { ...output, chart: undefined },
      }),
    }),

    predictStock: tool({
      description:
        "Statistical price forecast for a stock over 5 to 90 trading days, with a 90% range and a backtest of the model's recent accuracy.",
      inputSchema: z.object({
        symbol: symbolField,
        horizonDays: z.number().int().min(5).max(90).default(30),
      }),
      execute: ({ symbol, horizonDays }) => safe(() => predictStock(symbol, horizonDays)),
      toModelOutput: ({ output }) => ({
        type: "json",
        value: "error" in output ? output : { ...output, history: undefined, forecast: undefined },
      }),
    }),

    getPortfolio: tool({
      description: "The user's paper-trading portfolio: cash, holdings with live value, and profit/loss.",
      inputSchema: z.object({}),
      execute: () => safe(() => getPortfolio(userId)),
    }),

    placeTrade: tool({
      description: `Place a simulated (paper) buy or sell order at the current market price. The user must confirm it in the app before it runs. Max ${LIMITS.maxSharesPerOrder.toLocaleString()} shares and $${LIMITS.maxOrderValue.toLocaleString()} per order.`,
      inputSchema: z.object({
        symbol: symbolField,
        side: z.enum(["BUY", "SELL"]),
        quantity: z.number().int().positive().max(LIMITS.maxSharesPerOrder),
      }),
      // Runs only after the user approves; re-validates against the latest price, cash and holdings.
      execute: (input) => safe(() => executeOrder(userId, input, "CHAT")),
    }),
  };
}

export type ChatTools = ReturnType<typeof buildTools>;
export type ChatMessage = UIMessage<never, { guardrail: { reason: string } }, InferUITools<ChatTools>>;

/**
 * Tool rail for trades: check the order before asking the user.
 * Invalid orders are denied automatically with the reason; valid ones show a confirmation card.
 */
export function buildToolApproval(userId: string): ToolApprovalConfiguration<ChatTools, unknown> {
  return {
    placeTrade: async (input) => {
      try {
        const p = await validateOrder(userId, input);
        return {
          type: "user-approval",
          reason: `${p.side} ${p.quantity} ${p.symbol} at about $${p.price.toFixed(2)}${p.currency !== "USD" ? ` (${p.localPrice.toLocaleString()} ${p.currency})` : ""} = $${p.total.toLocaleString()}. Cash after: $${p.cashAfter.toLocaleString()}.`,
        };
      } catch (err) {
        const reason = err instanceof TradeError || err instanceof MarketError ? err.message : "Order could not be checked.";
        await audit(userId, "trade_denied", { ...input, source: "CHAT", stage: "pre_approval", reason });
        return { type: "denied", reason };
      }
    },
  };
}
