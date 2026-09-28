import "server-only";
import { analyzeStock } from "@/lib/analysis";
import { audit } from "@/lib/audit";
import { inCcy, signedInCcy, type DisplayCurrency } from "@/lib/display-currency";
import { appUrl, reportEmail, sendEmail, type ReportStat, type ReportTable } from "@/lib/email";
import { compact, money, pct } from "@/lib/format";
import { rewriteClaims } from "@/lib/guardrails";
import { getNewsInsight } from "@/lib/insights";
import { getTopStocks, TOP_CATEGORY_LABELS, type TopCategory } from "@/lib/market";
import { predictStock } from "@/lib/prediction";
import { prisma } from "@/lib/prisma";
import { getPortfolio } from "@/lib/trading";

/**
 * Reports the AI assistant can email to the signed-in user. The content is built from live data here
 * (not written by the model), and the recipient is always the user's own account email.
 */
export const REPORT_TYPES = ["top_gainers", "top_losers", "most_active", "portfolio", "stock_analysis", "forecast", "news"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export class ReportError extends Error {}

const LIMIT_PER_HOUR = 10;
const sent = new Map<string, number[]>();
const tone = (n: number | null | undefined) => (n === null || n === undefined ? null : n >= 0 ? ("up" as const) : ("down" as const));

type Built = { eyebrow: string; title: string; intro: string; stats?: ReportStat[]; table?: ReportTable; highlights?: string[]; button: { label: string; href: string } };

async function build(userId: string, type: ReportType, ccy: DisplayCurrency, symbol?: string, horizonDays?: number, count = 10): Promise<Built> {
  const base = appUrl();
  if (type === "top_gainers" || type === "top_losers" || type === "most_active") {
    const cat: TopCategory = type === "top_gainers" ? "day_gainers" : type === "top_losers" ? "day_losers" : "most_actives";
    const rows = await getTopStocks(cat, Math.min(Math.max(count, 3), 15));
    if (!rows.length) throw new ReportError("Market data is unavailable right now.");
    const up = rows.filter((r) => r.changePercent >= 0).length;
    const avg = rows.reduce((a, r) => a + r.changePercent, 0) / rows.length;
    const top = type === "top_losers" ? [...rows].sort((a, b) => a.changePercent - b.changePercent)[0] : type === "most_active" ? rows[0] : [...rows].sort((a, b) => b.changePercent - a.changePercent)[0];
    return {
      eyebrow: "Market report · US stocks",
      title: `Today's ${TOP_CATEGORY_LABELS[cat].toLowerCase()}`,
      intro: `here are today's ${rows.length} ${TOP_CATEGORY_LABELS[cat].toLowerCase()} in US markets.`,
      stats: [
        { label: type === "most_active" ? "Most traded" : "Biggest move", value: `${top.symbol} ${pct(top.changePercent)}`, tone: tone(top.changePercent) },
        { label: "Average change", value: pct(avg), tone: tone(avg) },
        { label: "Up / down", value: `${up} / ${rows.length - up}` },
      ],
      table: {
        columns: [{ label: "Stock" }, { label: "Company" }, { label: "Price", align: "right" }, { label: "Change", align: "right" }, { label: "Volume", align: "right" }],
        rows: rows.map((r) => ({ cells: [r.symbol, r.name.length > 26 ? r.name.slice(0, 25) + "…" : r.name, money(r.price), pct(r.changePercent), compact(r.volume)], tone: [null, null, null, tone(r.changePercent), null] })),
      },
      highlights: rows.slice(0, 3).map((r) => `${r.name} (${r.symbol}) at ${money(r.price)}, ${pct(r.changePercent)} today on ${compact(r.volume)} shares traded.`),
      button: { label: "Open markets", href: `${base}/markets` },
    };
  }

  if (type === "portfolio") {
    const p = await getPortfolio(userId);
    return {
      eyebrow: "Portfolio summary",
      title: `Your portfolio: ${inCcy(p.totalValue, ccy)}`,
      intro: `here's where your virtual portfolio stands right now.`,
      stats: [
        { label: "Total value", value: inCcy(p.totalValue, ccy) },
        { label: "Total return", value: pct(p.totalReturnPct), tone: tone(p.totalReturnPct) },
        { label: "Unrealized P&L", value: signedInCcy(p.unrealizedPnl, ccy), tone: tone(p.unrealizedPnl) },
      ],
      table: p.positions.length
        ? {
            columns: [{ label: "Stock" }, { label: "Shares", align: "right" }, { label: "Value", align: "right" }, { label: "P&L", align: "right" }, { label: "Weight", align: "right" }],
            rows: p.positions.map((x) => ({ cells: [x.symbol, String(x.quantity), inCcy(x.marketValue, ccy), pct(x.unrealizedPnlPct), `${x.weightPct ?? 0}%`], tone: [null, null, null, tone(x.unrealizedPnlPct), null] })),
          }
        : undefined,
      highlights: [
        `Cash available: ${inCcy(p.cash, ccy)} (${((p.cash / (p.totalValue || 1)) * 100).toFixed(1)}% of the portfolio).`,
        `Realized profit/loss so far: ${signedInCcy(p.realizedPnl, ccy)}.`,
        ...(p.positions.length ? [] : ["You don't own any stocks yet."]),
      ],
      button: { label: "View portfolio", href: `${base}/portfolio` },
    };
  }

  if (!symbol) throw new ReportError("Tell me which stock the report is for.");

  if (type === "stock_analysis") {
    const a = await analyzeStock(symbol);
    const q = a.quote;
    const i = a.indicators;
    return {
      eyebrow: `Stock analysis · ${q.exchange}`,
      title: `${q.name} (${q.symbol})`,
      intro: `here's the technical picture for ${q.name}.`,
      stats: [
        { label: "Price", value: money(q.price, q.currency) },
        { label: "Today", value: pct(q.changePercent), tone: tone(q.changePercent) },
        { label: "Overall signal", value: a.overall[0].toUpperCase() + a.overall.slice(1), tone: a.overall === "bullish" ? "up" : a.overall === "bearish" ? "down" : null },
      ],
      table: {
        columns: [{ label: "Indicator" }, { label: "Value", align: "right" }],
        rows: [
          ["50-day average", money(i.sma50, q.currency)],
          ["200-day average", money(i.sma200, q.currency)],
          ["RSI (14)", i.rsi14 === null ? "—" : i.rsi14.toFixed(1)],
          ["1-month return", pct(i.return1mPct)],
          ["1-year return", pct(i.return1yPct)],
          ["Volatility (1y)", i.annualizedVolatilityPct === null ? "—" : `${i.annualizedVolatilityPct}%`],
          ["From 52-week high", pct(i.percentFrom52wHigh)],
          ["Market cap", compact(q.marketCap)],
        ].map(([k, v]) => ({ cells: [k, v] })),
      },
      highlights: a.signals.map((s) => `${s.label}: ${s.detail}`),
      button: { label: `Open ${q.symbol}`, href: `${base}/stock/${encodeURIComponent(q.symbol)}` },
    };
  }

  if (type === "forecast") {
    const f = await predictStock(symbol, horizonDays ?? 30);
    const step = Math.max(1, Math.floor(f.forecast.length / 6));
    const points = f.forecast.filter((_, idx) => idx % step === step - 1 || idx === f.forecast.length - 1).slice(-6);
    return {
      eyebrow: `Forecast · ${f.horizonDays} trading days`,
      title: `${f.symbol} forecast`,
      intro: `here's the statistical outlook for ${f.symbol} over the next ${f.horizonDays} trading days.`,
      stats: [
        { label: "Current", value: money(f.currentPrice, f.currency) },
        { label: "Trend estimate", value: `${money(f.expectedPrice, f.currency)} (${pct(f.expectedReturnPct)})`, tone: tone(f.expectedReturnPct) },
        { label: "90% range", value: `${money(f.low90, f.currency)} – ${money(f.high90, f.currency)}` },
      ],
      table: {
        columns: [{ label: "Date" }, { label: "Low", align: "right" }, { label: "Estimate", align: "right" }, { label: "High", align: "right" }],
        rows: points.map((p) => ({ cells: [new Date(p.date + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }), money(p.low, f.currency), money(p.expected, f.currency), money(p.high, f.currency)] })),
      },
      highlights: [
        f.backtest ? `Backtest: a forecast made ${f.backtest.days} days ago was off by ${f.backtest.errorPct}% (${f.backtest.withinBand ? "inside" : "outside"} its range).` : "No backtest available.",
        `Daily volatility: ${f.dailyVolatilityPct}%.`,
        f.disclaimer,
      ],
      button: { label: `Open ${f.symbol}`, href: `${base}/stock/${encodeURIComponent(f.symbol)}?h=${f.horizonDays}` },
    };
  }

  // news
  const n = await getNewsInsight(symbol);
  const counts = { positive: 0, neutral: 0, negative: 0 };
  n.items.forEach((x) => counts[x.sentiment]++);
  return {
    eyebrow: "News digest",
    title: `${symbol.toUpperCase()} news: ${n.label} tone`,
    intro: `here are the latest headlines for ${symbol.toUpperCase()}, rated by AI.`,
    stats: [
      { label: "Overall tone", value: n.label[0].toUpperCase() + n.label.slice(1), tone: n.label === "positive" ? "up" : n.label === "negative" ? "down" : null },
      { label: "Positive / neutral / negative", value: `${counts.positive} / ${counts.neutral} / ${counts.negative}` },
    ],
    table: {
      columns: [{ label: "Headline" }, { label: "Source" }, { label: "Tone", align: "right" }],
      rows: n.items.slice(0, 8).map((x) => ({ cells: [x.title.length > 70 ? x.title.slice(0, 69) + "…" : x.title, x.publisher, x.sentiment], tone: [null, null, x.sentiment === "positive" ? "up" : x.sentiment === "negative" ? "down" : null] })),
    },
    highlights: [n.summary],
    button: { label: `Open ${symbol.toUpperCase()}`, href: `${base}/stock/${encodeURIComponent(symbol.toUpperCase())}` },
  };
}

export async function emailReport(userId: string, o: { type: ReportType; symbol?: string; horizonDays?: number; count?: number; summary?: string }, ccy: DisplayCurrency) {
  const now = Date.now();
  const recent = (sent.get(userId) ?? []).filter((t) => now - t < 3600_000);
  if (recent.length >= LIMIT_PER_HOUR) throw new ReportError(`You can email up to ${LIMIT_PER_HOUR} reports an hour. Try again later.`);

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
  if (!user) throw new ReportError("Account not found.");
  const built = await build(userId, o.type, ccy, o.symbol, o.horizonDays, o.count);
  const note = o.summary?.trim() ? rewriteClaims(o.summary.trim().slice(0, 500)) : undefined;
  const mail = reportEmail({ name: user.name, ...built, note: note ? `AI summary: ${note}` : undefined, asOf: new Date() });
  const id = await sendEmail({ to: user.email, kind: `report_${o.type}`, userId, ...mail });
  if (!id) throw new ReportError("The email couldn't be queued. Please try again.");
  sent.set(userId, [...recent, now]);
  await audit(userId, "report_emailed", { type: o.type, symbol: o.symbol ?? null });
  return { to: user.email, subject: mail.subject, type: o.type };
}
