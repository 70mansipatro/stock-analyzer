import "server-only";
import { tool, type InferUITools, type ToolApprovalConfiguration, type UIMessage } from "ai";
import { z } from "zod";
import { analyzeStock } from "@/lib/analysis";
import { getQuote, getTopStocks, MarketError, searchSymbols, TOP_CATEGORY_LABELS, type TopCategory } from "@/lib/market";
import { getNewsInsight } from "@/lib/insights";
import { predictStock } from "@/lib/prediction";
import { getAgentActivity } from "@/lib/agent/activity";
import { emailReport, ReportError, REPORT_TYPES } from "@/lib/reports";
import { can, type AppRole } from "@/lib/rbac";
import type { PlatformSettings } from "@/lib/settings";
import { inCcy, USD, type DisplayCurrency } from "@/lib/display-currency";
import { money } from "@/lib/format";
import { executeOrder, getPortfolio, TradeError, validateOrder } from "@/lib/trading";
import { audit } from "@/lib/audit";
import { AlertError, createAlert } from "@/lib/alerts";
import { searchVideos, VideoError } from "@/lib/youtube";
import { AnnouncementError, AUDIENCES, previewAnnouncement, sendAnnouncement } from "@/lib/announcements";
import type { Actor } from "@/lib/authz";

const symbolField = z
  .string()
  .min(1)
  .max(15)
  .regex(/^[A-Za-z0-9.\-^=&]+$/, "Ticker symbols only contain letters, digits, '.', '-', '^', '=' or '&'")
  .describe("Ticker symbol, e.g. AAPL. Use searchStocks first if you only know the company name.");

/** Turns expected errors into a result the model can explain instead of crashing the stream. */
async function safe<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof MarketError || err instanceof TradeError || err instanceof ReportError || err instanceof AlertError || err instanceof VideoError || err instanceof AnnouncementError) return { error: err.message };
    console.error("tool failed", err);
    return { error: "Market data is unavailable right now. Please try again shortly." };
  }
}

/**
 * Tools are built per request so `userId` comes from the verified session, never from model output.
 */
export function buildTools(userId: string, settings: PlatformSettings, role: AppRole, ccy: DisplayCurrency = USD, actor?: Actor) {
  const tools = {
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

    getNews: tool({
      description: "Latest news headlines for a stock, each labelled positive, negative or neutral by AI, with an overall tone.",
      inputSchema: z.object({ symbol: symbolField }),
      execute: ({ symbol }) => safe(() => getNewsInsight(symbol)),
    }),

    emailReport: tool({
      description:
        "Email the user a professional report built from live data. Always sent to the user's own account email (you can't choose a recipient). " +
        "Types: top_gainers, top_losers, most_active (US market movers), portfolio (their holdings), stock_analysis / forecast / news (need a symbol; use searchStocks first). " +
        "Optionally add a 1-3 sentence plain summary of the key point.",
      inputSchema: z.object({
        type: z.enum(REPORT_TYPES),
        symbol: symbolField.optional(),
        horizonDays: z.number().int().min(5).max(90).optional(),
        count: z.number().int().min(3).max(15).optional(),
        summary: z.string().max(500).optional().describe("Short plain-English summary to include; numbers must come from tool results."),
      }),
      execute: (input) => safe(() => emailReport(userId, input, ccy)),
    }),

    findVideos: tool({
      description:
        "Find YouTube videos that teach a stock-market or investing topic (e.g. how buying and selling shares works, candlestick charts, what is a P/E ratio). " +
        "They are shown to the user as playable embedded videos. Use when the user asks for videos, tutorials, or to 'learn' / 'watch' something.",
      inputSchema: z.object({
        query: z.string().min(3).max(100).describe("A focused YouTube search in English, e.g. 'how to buy and sell stocks for beginners in English'. Only use another language (e.g. Hindi) if the user asks for it."),
        count: z.number().int().min(1).max(6).default(4),
      }),
      execute: ({ query, count }) => safe(async () => ({ query, videos: await searchVideos(query, count) })),
      // The model only needs titles to write its intro, not thumbnails.
      toModelOutput: ({ output }) => ({
        type: "json",
        value: "error" in output ? output : { query: output.query, videos: output.videos.map((v) => ({ title: v.title, channel: v.channel, duration: v.duration })) },
      }),
    }),

    createPriceAlert: tool({
      description:
        "Create a price alert for the user: they get an in-app notification (and an email if enabled) when the stock goes above or below a target price. " +
        "Target is in the stock's own currency. Omit condition to infer it from the current price.",
      inputSchema: z.object({
        symbol: symbolField,
        targetPrice: z.number().positive(),
        condition: z.enum(["ABOVE", "BELOW"]).optional(),
        note: z.string().max(140).optional(),
      }),
      execute: (input) => safe(() => createAlert(userId, input)),
    }),

    emailAllUsers: tool({
      description:
        "ADMIN ONLY. Email an announcement to every active user of the app (or one role group). Write a clear subject and a friendly plain-text message " +
        "(paragraphs separated by blank lines, no markdown, no placeholders like [Name]). The admin sees a preview with the recipient count and must confirm before anything is sent.",
      inputSchema: z.object({
        subject: z.string().min(3).max(120),
        message: z.string().min(10).max(4000),
        audience: z.enum(AUDIENCES).default("all").describe("all = everyone; or only one role: ADMIN, AUDITOR, USER (traders), VIEWER."),
      }),
      // Runs only after the admin confirms the preview card.
      execute: (input) =>
        safe(async () => {
          if (!actor) throw new AnnouncementError("Please sign in again.");
          return sendAnnouncement(actor, input);
        }),
    }),

    getAgentActivity: tool({
      description:
        "What the user's AI auto-trader is set to and what it did recently: settings, recent runs, trades and suggestions with the reasons behind each decision. Read-only.",
      inputSchema: z.object({ runs: z.number().int().min(1).max(10).default(3) }),
      execute: ({ runs }) => safe(() => getAgentActivity(userId, runs)),
    }),

    getPortfolio: tool({
      description: "The user's paper-trading portfolio: cash, holdings with live value, and profit/loss.",
      inputSchema: z.object({}),
      execute: () => safe(() => getPortfolio(userId)),
    }),

    placeTrade: tool({
      description: `Place a simulated (paper) buy or sell order at the current market price. The user must confirm it in the app before it runs. Max ${settings.maxSharesPerOrder.toLocaleString()} shares and $${settings.maxOrderValue.toLocaleString()} per order.`,
      inputSchema: z.object({
        symbol: symbolField,
        side: z.enum(["BUY", "SELL"]),
        quantity: z.number().int().positive().max(settings.maxSharesPerOrder),
      }),
      // Runs only after the user approves; re-validates against the latest price, cash and holdings.
      execute: (input) => safe(() => executeOrder(userId, input, "CHAT")),
    }),
  };
  // Tools a role can't use are removed, so the model can't even try:
  // trading needs the trade permission, announcements need admin.manage.
  const out: Partial<typeof tools> = { ...tools };
  if (!can(role, "trade") || !settings.tradingEnabled) delete out.placeTrade;
  if (!can(role, "admin.manage")) delete out.emailAllUsers;
  return out as typeof tools;
}

export type ChatTools = ReturnType<typeof buildTools>;
export type ChatMessage = UIMessage<never, { guardrail: { reason: string } }, InferUITools<ChatTools>>;

/**
 * Tool rail for trades: check the order before asking the user.
 * Invalid orders are denied automatically with the reason; valid ones show a confirmation card.
 */
export function buildToolApproval(userId: string, ccy: DisplayCurrency = USD): ToolApprovalConfiguration<ChatTools, unknown> {
  return {
    emailAllUsers: async (input) => {
      try {
        const p = await previewAnnouncement(input);
        if (!p.count) return { type: "denied", reason: "No one would receive this: no active users with a deliverable email in that group." };
        const group = p.audience === "all" ? "all active users" : `${p.audience.toLowerCase()} accounts`;
        return {
          type: "user-approval",
          reason: `Send to ${p.count} ${p.count === 1 ? "person" : "people"} (${group})${p.optedOut ? `; ${p.optedOut} turned announcements off and won't get it` : ""}.`,
        };
      } catch {
        return { type: "denied", reason: "The announcement is missing a subject or message." };
      }
    },
    placeTrade: async (input) => {
      try {
        const p = await validateOrder(userId, input);
        return {
          type: "user-approval",
          reason: `${p.side === "BUY" ? "Buy" : "Sell"} ${p.quantity} ${p.symbol} at ${p.currency !== "USD" ? money(p.localPrice, p.currency) : money(p.price)} each = ${inCcy(p.total, ccy)}. Cash after: ${inCcy(p.cashAfter, ccy)}.`,
        };
      } catch (err) {
        const reason = err instanceof TradeError || err instanceof MarketError ? err.message : "Order could not be checked.";
        await audit(userId, "trade_denied", { ...input, source: "CHAT", stage: "pre_approval", reason });
        return { type: "denied", reason };
      }
    },
  };
}
