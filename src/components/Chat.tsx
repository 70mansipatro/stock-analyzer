"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import { ArrowUp, ArrowUpRight, History, MessageSquarePlus, Square, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "@/lib/chat-tools";
import { compact, money, pct } from "@/lib/format";
import { Change } from "@/components/Change";
import { AssistantMark } from "@/components/AssistantMark";
import { ForecastChart, PriceChart } from "@/components/charts";
import { toast } from "@/lib/toast";
import { useCurrency } from "@/components/CurrencyProvider";
import { clearAllChats, deleteChat, getChat, newChatId, saveChat, useChatHistory } from "@/lib/chat-history";

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
  getNews: "Reading the latest headlines",
  getPortfolio: "Loading your portfolio",
  placeTrade: "Preparing order",
};

export function Chat({ initialQuestion, variant = "page" }: { initialQuestion?: string; variant?: "page" | "widget" }) {
  const router = useRouter();
  const [input, setInput] = useState("");
  // Each conversation has its own id; changing it starts (or reopens) a conversation.
  const [conversation, setConversation] = useState<{ id: string; messages?: ChatMessage[] }>(() => ({ id: newChatId() }));
  const chatId = conversation.id;
  const { messages, sendMessage, addToolApprovalResponse, status, stop, error, regenerate } = useChat<ChatMessage>({
    id: conversation.id,
    messages: conversation.messages,
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    // After the user approves or rejects a trade, continue automatically so the model reports the result.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: () => router.refresh(),
  });
  const busy = status === "submitted" || status === "streaming";

  // Save the conversation to this browser's history whenever a reply finishes.
  useEffect(() => {
    if (status === "ready" || status === "error") saveChat(chatId, messages);
  }, [status, messages, chatId]);

  const openChat = (id: string | null) => {
    stop();
    setInput("");
    setConversation(id ? { id, messages: getChat(id)?.messages } : { id: newChatId() });
  };
  const clearChat = () => {
    deleteChat(chatId);
    openChat(null);
    toast("info", "Chat cleared");
  };
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

  // Toast once for each trade the assistant completes.
  const toasted = useRef(new Set<string>());
  useEffect(() => {
    for (const m of messages) {
      for (const p of m.parts) {
        if (p.type !== "tool-placeTrade" || p.state !== "output-available" || toasted.current.has(p.toolCallId)) continue;
        toasted.current.add(p.toolCallId);
        const o = p.output;
        if ("error" in o) toast("error", "Order not placed", o.error);
        else toast("success", "Order filled", `${o.side === "BUY" ? "Bought" : "Sold"} ${o.quantity} ${o.symbol} at ${money(o.price)}`);
      }
    }
  }, [messages]);

  const submit = (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    sendMessage({ text: t });
    setInput("");
  };

  const widget = variant === "widget";
  const suggestions = widget ? SUGGESTIONS.slice(0, 4) : SUGGESTIONS;

  return (
    <div className={widget ? "flex h-full flex-col" : "mx-auto flex h-[calc(100dvh-10rem)] max-w-4xl flex-col"}>
      <ChatToolbar
        widget={widget}
        currentId={chatId}
        hasMessages={messages.length > 0}
        onNew={() => openChat(null)}
        onOpen={(id) => openChat(id)}
        onClear={clearChat}
      />
      <div className={`flex-1 space-y-5 overflow-y-auto ${widget ? "px-4 py-4" : "pb-4 pr-1"}`}>
        {messages.length === 0 && (
          <div className={`text-center ${widget ? "pt-4" : "pt-12"}`}>
            <span className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-surface-3 text-emerald-300 shadow-lg shadow-sky-500/20 ring-1 ring-ink/10">
              <AssistantMark className="h-9 w-9" animated />
            </span>
            <h2 className={`mt-4 font-semibold ${widget ? "text-lg" : "text-2xl"}`}>
              How can I help with the markets<span className="text-gradient"> today?</span>
            </h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">
              Top stocks, analysis, forecasts, news, your portfolio, or a practice trade.
            </p>
            <div className={`mx-auto mt-6 grid gap-2 text-left ${widget ? "grid-cols-1" : "max-w-2xl sm:grid-cols-2"}`}>
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => submit(s)}
                  className="glass flex items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-sm text-slate-200 transition hover:border-emerald-400/40 hover:text-slate-50"
                >
                  {s}
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-slate-500" />
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-gradient-to-br from-emerald-500 to-teal-600 px-4 py-2 text-sm text-white shadow-lg shadow-emerald-900/30">
                {m.parts.map((p) => (p.type === "text" ? p.text : "")).join("")}
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-emerald-300 ring-1 ring-ink/10">
                <AssistantMark className="h-4.5 w-4.5" />
              </span>
              <div className="min-w-0 flex-1 space-y-3">
                {m.parts.map((part, i) => (
                  <AssistantPart key={i} part={part} onApproval={addToolApprovalResponse} />
                ))}
              </div>
            </div>
          ),
        )}

        {status === "submitted" && (
          <div className="flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-3 text-emerald-300 ring-1 ring-ink/10">
              <AssistantMark className="h-4.5 w-4.5" animated />
            </span>
            <span className="flex gap-1" aria-label="Thinking">
              {[0, 150, 300].map((d) => (
                <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: `${d}ms` }} />
              ))}
            </span>
          </div>
        )}
        {error && (
          <div className="flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            <span>{error.message || "Something went wrong."}</span>
            <button onClick={() => regenerate()} className="shrink-0 underline">Retry</button>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className={widget ? "border-t border-ink/5 p-3" : "pt-3"}
      >
        <div className="glass flex items-center gap-2 rounded-2xl p-1.5 pl-4 focus-within:border-emerald-400/50">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={2000}
            placeholder={widget ? "Ask anything…" : "Ask about a stock, or say “buy 10 shares of MSFT”"}
            className="min-w-0 flex-1 bg-transparent py-2 text-sm placeholder:text-slate-500 focus:outline-none"
            aria-label="Message the AI assistant"
          />
          {busy ? (
            <button type="button" onClick={() => stop()} aria-label="Stop" className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-600 text-slate-50 hover:bg-slate-600">
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              aria-label="Send"
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-sky-500 text-white shadow-lg transition hover:brightness-110 disabled:opacity-30"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>
        <p className="mt-2 text-center text-[11px] text-slate-500">AI can make mistakes. Virtual money only. Not financial advice.</p>
      </form>
    </div>
  );
}

function ChatToolbar({
  widget,
  currentId,
  hasMessages,
  onNew,
  onOpen,
  onClear,
}: {
  widget: boolean;
  currentId: string;
  hasMessages: boolean;
  onNew: () => void;
  onOpen: (id: string) => void;
  onClear: () => void;
}) {
  const history = useChatHistory();
  const [open, setOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const btn = "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-slate-400 transition hover:bg-ink/5 hover:text-slate-50 disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <div className={`relative flex items-center gap-1 ${widget ? "border-b border-ink/5 px-3 py-1.5" : "mb-2"}`}>
      {!widget && <span className="mr-auto text-sm font-semibold">AI Assistant</span>}
      <button onClick={onNew} disabled={!hasMessages} className={btn} title="Start a new conversation">
        <MessageSquarePlus className="h-3.5 w-3.5" /> New chat
      </button>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className={btn} title="Recent conversations">
        <History className="h-3.5 w-3.5" /> History{history.length ? ` (${history.length})` : ""}
      </button>
      {confirmClear ? (
        <span className="flex items-center gap-1 rounded-lg bg-red-500/10 px-2 py-1 text-xs text-red-400">
          Delete this chat?
          <button
            onClick={() => {
              onClear();
              setConfirmClear(false);
            }}
            className="rounded px-1.5 py-0.5 font-medium hover:bg-red-500/20"
          >
            Yes
          </button>
          <button onClick={() => setConfirmClear(false)} className="rounded px-1.5 py-0.5 hover:bg-red-500/20">
            No
          </button>
        </span>
      ) : (
        <button onClick={() => setConfirmClear(true)} disabled={!hasMessages} className={`${btn} ${widget ? "" : ""}`} title="Delete this conversation">
          <Trash2 className="h-3.5 w-3.5" /> Clear chat
        </button>
      )}

      {open && (
        <div className="absolute right-2 top-full z-30 mt-1 w-72 overflow-hidden rounded-2xl border border-ink/10 bg-surface-2 shadow-2xl">
          <div className="flex items-center justify-between border-b border-ink/5 px-3 py-2 text-xs font-medium text-slate-400">
            Recent conversations
            <button onClick={() => setOpen(false)} aria-label="Close history" className="rounded p-1 hover:bg-ink/5">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {history.length === 0 ? (
            <p className="px-3 py-4 text-sm text-slate-500">No saved conversations yet.</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto py-1">
              {history.map((c) => (
                <li key={c.id} className="group flex items-center">
                  <button
                    onClick={() => {
                      onOpen(c.id);
                      setOpen(false);
                    }}
                    className={`min-w-0 flex-1 px-3 py-2 text-left text-sm transition hover:bg-ink/5 ${c.id === currentId ? "text-emerald-300" : "text-slate-200"}`}
                  >
                    <span className="block truncate">{c.title}</span>
                    <span className="block text-[11px] text-slate-500">
                      {new Date(c.updatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {c.messages.length} messages
                    </span>
                  </button>
                  <button onClick={() => deleteChat(c.id)} aria-label={`Delete ${c.title}`} className="mr-2 rounded p-1.5 text-slate-500 opacity-0 transition hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100 focus:opacity-100">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {history.length > 0 && (
            <button onClick={() => clearAllChats()} className="w-full border-t border-ink/5 px-3 py-2 text-left text-xs text-red-400 hover:bg-red-500/10">
              Delete all history
            </button>
          )}
        </div>
      )}
    </div>
  );
}

type ApprovalFn = ReturnType<typeof useChat<ChatMessage>>["addToolApprovalResponse"];

function AssistantPart({ part, onApproval }: { part: Part; onApproval: ApprovalFn }) {
  const ccy = useCurrency();
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
            Market cap {compact(q.marketCap)} · 52w {money(q.fiftyTwoWeekLow, q.currency)}–{money(q.fiftyTwoWeekHigh, q.currency)}
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
            <span>Trend: <b className="tabular-nums">{money(f.expectedPrice, f.currency)}</b> <Change percent={f.expectedReturnPct} /></span>
            <span>90% range: <b className="tabular-nums">{money(f.low90, f.currency)} – {money(f.high90, f.currency)}</b></span>
          </div>
          <ForecastChart history={f.history} forecast={f.forecast} compactHeight />
          <p className="mt-2 text-xs text-slate-500">{f.disclaimer}</p>
        </ToolCard>
      );
    }
    case "tool-getNews": {
      const n = part.output as Exclude<typeof part.output, { error: string }> | undefined;
      if (!n) return null;
      const tone = { positive: "text-emerald-400", negative: "text-red-400", neutral: "text-slate-300" } as const;
      const icon = { positive: "▲", negative: "▼", neutral: "●" } as const;
      return (
        <ToolCard title={`News tone: ${n.label}`}>
          <ul className="space-y-2 text-sm">
            {n.items.slice(0, 6).map((it) => (
              <li key={it.id} className="flex gap-2">
                <span className={`${tone[it.sentiment]} shrink-0`} aria-label={it.sentiment}>{icon[it.sentiment]}</span>
                <a href={it.link} target="_blank" rel="noopener noreferrer" className="text-slate-200 hover:text-emerald-300">
                  {it.title} <span className="text-xs text-slate-500">· {it.publisher}</span>
                </a>
              </li>
            ))}
          </ul>
        </ToolCard>
      );
    }
    case "tool-getPortfolio": {
      const pf = part.output as Exclude<typeof part.output, { error: string }> | undefined;
      if (!pf) return null;
      return (
        <ToolCard title={`Portfolio · ${ccy.fmt(pf.totalValue)} (${pct(pf.totalReturnPct)})`} link="/portfolio">
          <div className="mb-2 text-xs text-slate-400">
            Cash {ccy.fmt(pf.cash)} · Invested {ccy.fmt(pf.investedValue)} · Unrealized {ccy.signed(pf.unrealizedPnl)}
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
                    <td className="py-1.5 text-right tabular-nums">{ccy.fmt(pos.marketValue)}</td>
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
  const ccy = useCurrency();
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
          <div className="text-xs font-medium uppercase tracking-wide text-amber-300">Confirm trade</div>
          <div className="mt-1 text-lg font-semibold">{label}</div>
          {part.approval.requestReason && <p className="mt-1 text-sm text-slate-300">{part.approval.requestReason}</p>}
          <p className="mt-1 text-xs text-slate-500">Runs at the live price when you confirm. Virtual money only.</p>
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
          <div className="font-medium text-emerald-300">✓ {o.side === "BUY" ? "Bought" : "Sold"} {o.quantity} {o.symbol} at {o.currency && o.currency !== "USD" ? money(o.localPrice, o.currency) : money(o.price)}</div>
          <div className="text-slate-400">
            Total {ccy.fmt(o.total)} · Cash now {ccy.fmt(o.cashAfter)}
            {o.realizedPnl !== null && <> · Realized <Change value={o.realizedPnl} /></>}
          </div>
        </div>
      );
    }
  }
}

function ToolCard({ title, link, children }: { title: string; link?: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-xl p-4">
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
