"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "@/lib/chat-tools";
import { compact, money, pct, signedMoney } from "@/lib/format";
import { Change } from "@/components/Change";
import { ForecastChart, PriceChart } from "@/components/charts";

type Part = ChatMessage["parts"][number];

const SUGGESTIONS = [
  "What are today's top gainers?",
  "Analyze Tesla",
  "Forecast NVDA for the next 60 days",
  "How is my portfolio doing?",
  "Buy 3 shares of AAPL",
];

const TOOL_LABELS: Record<string, string> = {
  getTopStocks: "Fetching top stocks",
  searchStocks: "Searching tickers",
  getQuote: "Getting live quote",
  analyzeStock: "Running technical analysis",
  predictStock: "Building forecast",
  getPortfolio: "Loading your portfolio",
  placeTrade: "Preparing order",
};

export function Chat({ initialQuestion }: { initialQuestion?: string }) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const { messages, sendMessage, addToolApprovalResponse, status, stop, error, regenerate } = useChat<ChatMessage>({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    // After the user approves or rejects a trade, continue automatically so the model reports the result.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: () => router.refresh(),
  });
  const busy = status === "submitted" || status === "streaming";
  const bottomRef = useRef<HTMLDivElement>(null);
  const sentInitial = useRef(false);

  useEffect(() => {
    if (initialQuestion && !sentInitial.current) {
      sentInitial.current = true;
      sendMessage({ text: initialQuestion });
    }
  }, [initialQuestion, sendMessage]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const submit = (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    sendMessage({ text: t });
    setInput("");
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-11rem)] max-w-4xl flex-col">
      <div className="flex-1 space-y-6 overflow-y-auto pb-4 pr-1">
        {messages.length === 0 && (
          <div className="pt-10 text-center">
            <h1 className="text-2xl font-semibold">AI stock assistant</h1>
            <p className="mt-2 text-sm text-slate-400">
              Ask about top stocks, analysis, forecasts, your portfolio, or place a paper trade.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => submit(s)} className="rounded-full border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-emerald-600/90 px-4 py-2 text-sm text-white">
                {m.parts.map((p) => (p.type === "text" ? p.text : "")).join("")}
              </div>
            </div>
          ) : (
            <div key={m.id} className="space-y-3">
              {m.parts.map((part, i) => (
                <AssistantPart key={i} part={part} onApproval={addToolApprovalResponse} />
              ))}
            </div>
          ),
        )}

        {status === "submitted" && <div className="text-sm text-slate-500">Thinking…</div>}
        {error && (
          <div className="flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            Something went wrong. <button onClick={() => regenerate()} className="underline">Retry</button>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className="border-t border-slate-800 pt-4"
      >
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={2000}
            placeholder="Ask about a stock, or say “buy 10 shares of MSFT”"
            className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
          />
          {busy ? (
            <button type="button" onClick={() => stop()} className="rounded-xl border border-slate-600 px-4 text-sm hover:bg-slate-800">
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()} className="rounded-xl bg-emerald-600 px-5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40">
              Send
            </button>
          )}
        </div>
        <p className="mt-2 text-center text-xs text-slate-500">
          AI can make mistakes. Paper trading only, no real money. Not financial advice.
        </p>
      </form>
    </div>
  );
}

type ApprovalFn = ReturnType<typeof useChat<ChatMessage>>["addToolApprovalResponse"];

function AssistantPart({ part, onApproval }: { part: Part; onApproval: ApprovalFn }) {
  if (part.type === "text") {
    return (
      <div className="prose-chat text-sm leading-relaxed text-slate-200">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
      </div>
    );
  }
  if (part.type === "data-guardrail") {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300">
        🛡 Blocked by guardrail: {part.data.reason.replace(/_/g, " ")}
      </div>
    );
  }
  if (!part.type.startsWith("tool-")) return null;

  const toolName = part.type.slice(5);
  const p = part as Extract<Part, { type: `tool-${string}` }>;

  if (toolName === "placeTrade") return <TradePart part={p as Extract<Part, { type: "tool-placeTrade" }>} onApproval={onApproval} />;

  if (p.state === "input-streaming" || p.state === "input-available") {
    return <ToolPending label={TOOL_LABELS[toolName] ?? toolName} />;
  }
  if (p.state === "output-error") return <ToolError text={p.errorText} />;
  if (p.state !== "output-available") return null;

  const output = p.output as unknown;
  if (output && typeof output === "object" && "error" in output) return <ToolError text={String((output as { error: string }).error)} />;

  switch (part.type) {
    case "tool-getTopStocks": {
      const o = part.output as Exclude<typeof part.output, { error: string }> | undefined;
      if (!o) return null;
      return (
        <ToolCard title={o.label}>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-800">
              {o.stocks.map((s) => (
                <tr key={s.symbol}>
                  <td className="py-1.5">
                    <Link href={`/stock/${encodeURIComponent(s.symbol)}`} className="font-medium hover:underline">{s.symbol}</Link>
                    <span className="ml-2 hidden text-xs text-slate-500 sm:inline">{s.name}</span>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{money(s.price)}</td>
                  <td className="py-1.5 text-right tabular-nums"><Change percent={s.changePercent} /></td>
                  <td className="hidden py-1.5 text-right tabular-nums text-slate-500 sm:table-cell">{compact(s.volume)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ToolCard>
      );
    }
    case "tool-getQuote": {
      const q = part.output as Exclude<typeof part.output, { error: string }> | undefined;
      if (!q) return null;
      return (
        <ToolCard title={`${q.symbol} · ${q.name}`} link={`/stock/${encodeURIComponent(q.symbol)}`}>
          <div className="flex items-baseline gap-3">
            <span className="text-xl font-semibold tabular-nums">{money(q.price, q.currency)}</span>
            <Change value={q.change} percent={q.changePercent} currency={q.currency} />
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Market cap {compact(q.marketCap)} · 52w {money(q.fiftyTwoWeekLow)}–{money(q.fiftyTwoWeekHigh)}
          </div>
        </ToolCard>
      );
    }
    case "tool-analyzeStock": {
      const a = part.output as Exclude<typeof part.output, { error: string }> | undefined;
      if (!a) return null;
      return (
        <ToolCard title={`${a.quote.symbol} technical analysis · ${a.overall}`} link={`/stock/${encodeURIComponent(a.quote.symbol)}`}>
          <PriceChart data={a.chart} />
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {a.signals.map((s) => (
              <span key={s.label} className={`rounded px-2 py-0.5 ${s.stance === "bullish" ? "bg-emerald-500/10 text-emerald-400" : s.stance === "bearish" ? "bg-red-500/10 text-red-400" : "bg-slate-500/10 text-slate-300"}`}>
                {s.stance === "bullish" ? "▲" : s.stance === "bearish" ? "▼" : "●"} {s.label}
              </span>
            ))}
          </div>
        </ToolCard>
      );
    }
    case "tool-predictStock": {
      const f = part.output as Exclude<typeof part.output, { error: string }> | undefined;
      if (!f) return null;
      return (
        <ToolCard title={`${f.symbol} forecast · ${f.horizonDays} trading days`} link={`/stock/${encodeURIComponent(f.symbol)}?h=${f.horizonDays}`}>
          <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>Trend: <b className="tabular-nums">{money(f.expectedPrice)}</b> <Change percent={f.expectedReturnPct} /></span>
            <span>90% range: <b className="tabular-nums">{money(f.low90)} – {money(f.high90)}</b></span>
          </div>
          <ForecastChart history={f.history} forecast={f.forecast} compactHeight />
          <p className="mt-2 text-xs text-slate-500">{f.disclaimer}</p>
        </ToolCard>
      );
    }
    case "tool-getPortfolio": {
      const pf = part.output as Exclude<typeof part.output, { error: string }> | undefined;
      if (!pf) return null;
      return (
        <ToolCard title={`Portfolio · ${money(pf.totalValue)} (${pct(pf.totalReturnPct)})`} link="/portfolio">
          <div className="mb-2 text-xs text-slate-400">
            Cash {money(pf.cash)} · Invested {money(pf.investedValue)} · Unrealized {signedMoney(pf.unrealizedPnl)}
          </div>
          {pf.positions.length === 0 ? (
            <p className="text-sm text-slate-400">No holdings yet.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-800">
                {pf.positions.map((pos) => (
                  <tr key={pos.symbol}>
                    <td className="py-1.5 font-medium">{pos.symbol}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-400">{pos.quantity} sh</td>
                    <td className="py-1.5 text-right tabular-nums">{money(pos.marketValue)}</td>
                    <td className="py-1.5 text-right tabular-nums"><Change value={pos.unrealizedPnl} percent={pos.unrealizedPnlPct} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ToolCard>
      );
    }
    default:
      return null;
  }
}

function TradePart({ part, onApproval }: { part: Extract<Part, { type: "tool-placeTrade" }>; onApproval: ApprovalFn }) {
  const input = part.input;
  const label = input ? `${input.side === "BUY" ? "Buy" : "Sell"} ${input.quantity} ${input.symbol}` : "Order";

  switch (part.state) {
    case "input-streaming":
    case "input-available":
      return <ToolPending label="Checking order" />;
    case "approval-requested":
      if (part.approval.isAutomatic) return <ToolPending label="Checking order" />;
      return (
        <div className="max-w-md rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-amber-300">Confirm paper trade</div>
          <div className="mt-1 text-lg font-semibold">{label}</div>
          {part.approval.requestReason && <p className="mt-1 text-sm text-slate-300">{part.approval.requestReason}</p>}
          <p className="mt-1 text-xs text-slate-500">Executes at the live price when you confirm. No real money.</p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => onApproval({ id: part.approval.id, approved: true })}
              className={`flex-1 rounded-lg py-2 text-sm font-medium text-white ${input?.side === "SELL" ? "bg-red-600 hover:bg-red-500" : "bg-emerald-600 hover:bg-emerald-500"}`}
            >
              Confirm
            </button>
            <button
              onClick={() => onApproval({ id: part.approval.id, approved: false, reason: "User cancelled the order." })}
              className="flex-1 rounded-lg border border-slate-600 py-2 text-sm hover:bg-slate-800"
            >
              Cancel
            </button>
          </div>
        </div>
      );
    case "approval-responded":
      return <ToolPending label={part.approval.approved ? "Placing order" : "Cancelling"} />;
    case "output-denied":
      return (
        <div className="max-w-md rounded-xl border border-slate-700 bg-slate-900/60 p-3 text-sm">
          <span className="text-slate-400">✕ {label} not placed.</span>
          {part.approval.reason && <span className="block text-amber-300">{part.approval.reason}</span>}
        </div>
      );
    case "output-error":
      return <ToolError text={part.errorText} />;
    case "output-available": {
      const o = part.output;
      if ("error" in o) return <ToolError text={`${label} failed: ${o.error}`} />;
      return (
        <div className="max-w-md rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
          <div className="font-medium text-emerald-300">✓ {o.side === "BUY" ? "Bought" : "Sold"} {o.quantity} {o.symbol} at {money(o.price)}</div>
          <div className="text-slate-400">
            Total {money(o.total)} · Cash now {money(o.cashAfter)}
            {o.realizedPnl !== null && <> · Realized <Change value={o.realizedPnl} /></>}
          </div>
        </div>
      );
    }
  }
}

function ToolCard({ title, link, children }: { title: string; link?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-sm font-medium capitalize-first text-slate-200">{title}</div>
        {link && <Link href={link} className="shrink-0 text-xs text-emerald-400 hover:underline">Open →</Link>}
      </div>
      {children}
    </div>
  );
}

function ToolPending({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-400">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-600 border-t-emerald-400" />
      {label}…
    </div>
  );
}

function ToolError({ text }: { text: string }) {
  return <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">⚠ {text}</div>;
}
