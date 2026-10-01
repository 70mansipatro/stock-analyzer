import Link from "next/link";
import type { ActivityFilter, ActivityItem, OpenPosition } from "@/lib/agent/activity";
import type { Reason } from "@/lib/agent/strategy";
import { inCcy, signedInCcy, type DisplayCurrency } from "@/lib/display-currency";
import { money } from "@/lib/format";
import type { MarketSession } from "@/lib/market-hours";

// Server-rendered Auto-Trader dashboard panels.

export const ago = (iso: string | Date) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};

export const until = (d: Date) => {
  const m = Math.round((d.getTime() - Date.now()) / 60_000);
  if (m <= 0) return "any moment";
  if (m < 60) return `in ${m}m`;
  if (m < 48 * 60) return `in ${Math.floor(m / 60)}h ${m % 60}m`;
  return `in ${Math.round(m / 1440)}d`;
};

const clock = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export const STATUS: Record<string, { label: string; cls: string }> = {
  executed: { label: "Placed", cls: "bg-emerald-500/15 text-emerald-300" },
  approved: { label: "Approved", cls: "bg-emerald-500/15 text-emerald-300" },
  executing: { label: "Placing…", cls: "bg-sky-500/15 text-sky-300" },
  suggested: { label: "Waiting for you", cls: "bg-amber-500/15 text-amber-300" },
  dry_run: { label: "Dry run", cls: "bg-sky-500/15 text-sky-300" },
  skipped: { label: "Skipped", cls: "bg-slate-500/15 text-slate-300" },
  blocked: { label: "Risk limit", cls: "bg-amber-500/15 text-amber-300" },
  market_closed: { label: "Market closed", cls: "bg-slate-500/15 text-slate-300" },
  rejected: { label: "Dismissed", cls: "bg-slate-500/15 text-slate-400" },
  failed: { label: "Failed", cls: "bg-red-500/15 text-red-400" },
  hold: { label: "Hold", cls: "bg-slate-500/10 text-slate-400" },
};

const AI: Record<string, { label: string; cls: string }> = {
  approved: { label: "AI: approved", cls: "text-emerald-300" },
  vetoed: { label: "AI: vetoed", cls: "text-amber-300" },
  unavailable: { label: "AI: unavailable (rules used)", cls: "text-slate-400" },
  off: { label: "AI: off", cls: "text-slate-500" },
  not_reviewed: { label: "AI: not reviewed", cls: "text-slate-500" },
  not_required: { label: "AI: not required (sell)", cls: "text-slate-500" },
};

const ACTION_CLS: Record<string, string> = { BUY: "bg-emerald-500/15 text-emerald-300", SELL: "bg-red-500/15 text-red-400", HOLD: "bg-slate-500/15 text-slate-300" };

export function ActionBadge({ action }: { action: string }) {
  return <span className={`inline-block w-11 rounded px-1.5 py-0.5 text-center text-[11px] font-semibold ${ACTION_CLS[action] ?? ""}`}>{action}</span>;
}

export function ScoreBar({ score }: { score: number }) {
  const w = Math.min(Math.abs(score), 100) / 2;
  return (
    <span className="relative inline-block h-1.5 w-20 overflow-hidden rounded-full bg-ink/10" aria-label={`score ${score}`}>
      <span className="absolute inset-y-0 left-1/2 w-px bg-ink/30" />
      <span className={`absolute inset-y-0 ${score >= 0 ? "left-1/2 bg-emerald-500" : "right-1/2 bg-red-500"}`} style={{ width: `${w}%` }} />
    </span>
  );
}

export function Reasons({ reasons }: { reasons: Reason[] }) {
  return (
    <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
      {reasons
        .filter((r) => r.factor !== "Decision")
        .map((r, i) => (
          <li key={i} className="flex gap-2">
            <span className={`w-9 shrink-0 text-right font-medium tabular-nums ${r.points > 0 ? "text-emerald-400" : r.points < 0 ? "text-red-400" : "text-slate-500"}`}>
              {r.points > 0 ? "+" : ""}
              {r.points}
            </span>
            <span className="text-slate-400">
              <b className="font-medium text-slate-300">{r.factor}:</b> {r.detail}
            </span>
          </li>
        ))}
    </ul>
  );
}

const pnlCls = (n: number | null) => (n === null ? "text-slate-500" : n >= 0 ? "text-emerald-400" : "text-red-400");
const pct = (n: number | null) => (n === null ? "—" : `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}%`);

/** Summary panel: running state, mode, stocks, risk rules, markets. */
export function StatusPanel(o: {
  running: boolean;
  statusText: string;
  modeLabel: string;
  stocks: string[];
  risk: string;
  profitTargetPct: number;
  maxLossPct: number;
  trailingStopPct: number | null;
  aiReview: boolean;
  marketHoursOnly: boolean;
  demoSpeed: boolean;
  sessions: MarketSession[];
  lastScan: string | null;
  nextScan: Date | null;
}) {
  const row = (k: string, v: React.ReactNode) => (
    <div className="flex items-start justify-between gap-4 border-b border-ink/5 py-2 last:border-0">
      <dt className="text-xs text-slate-500">{k}</dt>
      <dd className="text-right text-sm font-medium">{v}</dd>
    </div>
  );
  return (
    <dl>
      {row("Status", <span className={o.running ? "text-emerald-300" : "text-slate-300"}>{o.running ? "🟢" : "🔴"} {o.statusText}</span>)}
      {row("Mode", o.modeLabel)}
      {row("Selected stocks", o.stocks.length ? <span className="block max-w-56 truncate" title={o.stocks.join(", ")}>{o.stocks.length} · {o.stocks.slice(0, 4).join(", ")}{o.stocks.length > 4 ? "…" : ""}</span> : <span className="text-amber-300">None</span>)}
      {row("Risk", o.risk[0] + o.risk.slice(1).toLowerCase())}
      {row("Profit target", o.profitTargetPct > 0 ? `${o.profitTargetPct}%` : "Off")}
      {row("Maximum loss", `${o.maxLossPct}%`)}
      {row("Trailing stop", o.trailingStopPct ? `${o.trailingStopPct}%` : "Off")}
      {row("AI review", o.aiReview ? "On" : "Off")}
      {row("Market hours", o.demoSpeed ? <span className="text-amber-300">Ignored (demo speed)</span> : o.marketHoursOnly ? "Enforced" : <span className="text-amber-300">Not enforced</span>)}
      {row(
        "Markets",
        <span className="flex flex-col items-end gap-0.5">
          {o.sessions.map((s) => (
            <span key={s.market} className="text-xs">
              <span className={s.open ? "text-emerald-300" : "text-slate-400"}>
                {s.market === "US" ? "US" : "India"} · {s.exchanges}: {s.open ? "open" : s.reason.replace(/^Closed: /, "closed, ").toLowerCase()}
              </span>
              <span className="text-slate-500"> ({s.localTime} local{!s.open && s.nextOpen ? `, opens ${until(s.nextOpen)}` : ""})</span>
            </span>
          ))}
        </span>,
      )}
      {row("Last scan", o.lastScan ? ago(o.lastScan) : "Never")}
      {row("Next scan", o.nextScan ? until(o.nextScan) : "—")}
    </dl>
  );
}

/** The most recent scan: one line per stock with its decision and reason. */
export function CurrentActivity({ items }: { items: ActivityItem[] }) {
  if (!items.length) return <p className="text-sm text-slate-400">No scan yet.</p>;
  const order = { BUY: 0, SELL: 1, HOLD: 2 } as Record<string, number>;
  const sorted = [...items].sort((a, b) => (order[a.action] ?? 3) - (order[b.action] ?? 3) || b.score - a.score);
  return (
    <ul className="divide-y divide-ink/5">
      {sorted.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
          <ActionBadge action={d.action} />
          <Link href={`/stock/${encodeURIComponent(d.symbol)}`} className="w-28 truncate font-semibold hover:underline">
            {d.symbol}
          </Link>
          <span className="w-24 tabular-nums text-slate-400">{d.price === null ? "—" : money(d.price, d.currency)}</span>
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <ScoreBar score={d.score} /> {d.score}
          </span>
          <span className="min-w-0 flex-1 basis-60 text-xs text-slate-400">{d.error && d.status !== "hold" ? `${d.reason} · ${d.error}` : d.reason}</span>
          {d.status !== "hold" && <span className={`rounded px-1.5 py-0.5 text-[11px] ${STATUS[d.status]?.cls ?? ""}`}>{STATUS[d.status]?.label ?? d.status}</span>}
        </li>
      ))}
    </ul>
  );
}

const FILTERS: { id: ActivityFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "buy", label: "BUY" },
  { id: "sell", label: "SELL" },
  { id: "hold", label: "HOLD" },
  { id: "errors", label: "Errors" },
];

export function ActivityFilters({ active }: { active: ActivityFilter }) {
  return (
    <div className="flex gap-1 rounded-xl bg-ink/[0.04] p-1">
      {FILTERS.map((f) => (
        <Link key={f.id} href={f.id === "all" ? "/agent#activity" : `/agent?filter=${f.id}#activity`} scroll={false} className={`rounded-lg px-3 py-1.5 text-xs transition ${active === f.id ? "bg-surface-1 text-slate-50 shadow-sm" : "text-slate-400 hover:text-slate-100"}`}>
          {f.label}
        </Link>
      ))}
    </div>
  );
}

/** Every decision of every scan, newest first. */
export function ActivityLog({ items, cur }: { items: ActivityItem[]; cur: DisplayCurrency }) {
  if (!items.length) return <p className="rounded-xl border border-dashed border-ink/15 p-6 text-center text-sm text-slate-400">Nothing here yet.</p>;
  return (
    <ol className="divide-y divide-ink/5">
      {items.map((d) => (
        <li key={d.id} id={`d-${d.id}`} className="py-2.5">
          <details>
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="w-24 shrink-0 text-xs tabular-nums text-slate-500">{clock(d.at)}</span>
              <ActionBadge action={d.action} />
              <span className="w-28 truncate font-semibold">
                {d.quantity > 0 ? `${d.quantity} × ` : ""}
                {d.symbol}
              </span>
              <span className="text-xs text-slate-500">score {d.score}</span>
              <span className="min-w-0 flex-1 basis-48 truncate text-xs text-slate-400">{d.reason}</span>
              {d.realizedPnl !== null && (
                <span className={`text-xs tabular-nums ${pnlCls(d.realizedPnl)}`}>
                  {signedInCcy(d.realizedPnl, cur)} ({pct(d.realizedPnlPct)})
                </span>
              )}
              <span className={`rounded px-1.5 py-0.5 text-[11px] ${STATUS[d.status]?.cls ?? ""}`}>{STATUS[d.status]?.label ?? d.status}</span>
            </summary>
            <div className="ml-0 mt-2 space-y-1 rounded-lg bg-ink/[0.03] p-3 text-xs sm:ml-28">
              {d.price !== null && <p className="text-slate-400">Price: {money(d.price, d.currency)}{d.entryPriceUsd !== null && d.exitPriceUsd !== null ? ` · entry ${inCcy(d.entryPriceUsd, cur)} → exit ${inCcy(d.exitPriceUsd, cur)}` : ""}</p>}
              {d.aiStatus && <p className={AI[d.aiStatus]?.cls}>{AI[d.aiStatus]?.label ?? d.aiStatus}{d.aiNote ? ` — ${d.aiNote}` : ""}</p>}
              {d.error && <p className="text-amber-300">{d.error}</p>}
              <Reasons reasons={d.reasons} />
            </div>
          </details>
        </li>
      ))}
    </ol>
  );
}

type AutoTrade = { id: string; at: string; symbol: string; side: "BUY" | "SELL"; quantity: number; price: number | null; currency: string; priceUsd: number | null; reason: string; aiStatus: string | null; approved: boolean; entryPriceUsd: number | null; realizedPnl: number | null; realizedPnlPct: number | null };

export function TradeHistory({ trades, cur }: { trades: AutoTrade[]; cur: DisplayCurrency }) {
  if (!trades.length) return <p className="rounded-xl border border-dashed border-ink/15 p-6 text-center text-sm text-slate-400">No automatic trades yet.</p>;
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="text-left text-xs text-slate-500">
          <tr>
            <th className="px-5 py-2 font-normal">Time</th>
            <th className="py-2 font-normal">Side</th>
            <th className="py-2 font-normal">Stock</th>
            <th className="py-2 text-right font-normal">Qty</th>
            <th className="py-2 text-right font-normal">Price</th>
            <th className="py-2 text-right font-normal">P/L</th>
            <th className="py-2 pl-4 font-normal">Reason</th>
            <th className="px-5 py-2 font-normal">AI review</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/5">
          {trades.map((t) => (
            <tr key={t.id}>
              <td className="px-5 py-2 text-xs text-slate-400">{clock(t.at)}</td>
              <td className="py-2">
                <ActionBadge action={t.side} />
              </td>
              <td className="py-2 font-medium">
                <Link href={`/stock/${encodeURIComponent(t.symbol)}`} className="hover:underline">
                  {t.symbol}
                </Link>
              </td>
              <td className="py-2 text-right tabular-nums">{t.quantity}</td>
              <td className="py-2 text-right tabular-nums">{t.price !== null ? money(t.price, t.currency) : t.priceUsd !== null ? inCcy(t.priceUsd, cur) : "—"}</td>
              <td className={`py-2 text-right tabular-nums ${pnlCls(t.realizedPnl)}`}>
                {t.realizedPnl === null ? "—" : (
                  <>
                    {signedInCcy(t.realizedPnl, cur)}
                    <span className="block text-[11px]">{pct(t.realizedPnlPct)}</span>
                  </>
                )}
              </td>
              <td className="max-w-64 py-2 pl-4 text-xs text-slate-400">
                {t.reason}
                {t.side === "SELL" && t.entryPriceUsd !== null && t.priceUsd !== null && (
                  <span className="block text-slate-500">
                    Entry {inCcy(t.entryPriceUsd, cur)} → exit {inCcy(t.priceUsd, cur)}
                  </span>
                )}
              </td>
              <td className={`px-5 py-2 text-xs ${AI[t.aiStatus ?? ""]?.cls ?? "text-slate-500"}`}>
                {(AI[t.aiStatus ?? ""]?.label ?? "—").replace(/^AI: /, "")}
                {t.approved && <span className="block text-slate-500">You approved</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PositionsTable({ positions, cur }: { positions: OpenPosition[]; cur: DisplayCurrency }) {
  if (!positions.length) return <p className="rounded-xl border border-dashed border-ink/15 p-6 text-center text-sm text-slate-400">No open Auto-Trader positions.</p>;
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="text-left text-xs text-slate-500">
          <tr>
            <th className="px-5 py-2 font-normal">Stock</th>
            <th className="py-2 text-right font-normal">Qty</th>
            <th className="py-2 text-right font-normal">Entry</th>
            <th className="py-2 text-right font-normal">Now</th>
            <th className="py-2 text-right font-normal">P/L</th>
            <th className="py-2 text-right font-normal">Target</th>
            <th className="py-2 text-right font-normal">Max loss at</th>
            <th className="px-5 py-2 text-right font-normal">Trailing stop</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/5">
          {positions.map((p) => (
            <tr key={p.symbol}>
              <td className="px-5 py-2 font-medium">
                <Link href={`/stock/${encodeURIComponent(p.symbol)}`} className="hover:underline">
                  {p.symbol}
                </Link>
                <span className="block text-[11px] font-normal text-slate-500">held {p.heldDays}d</span>
              </td>
              <td className="py-2 text-right tabular-nums">{p.quantity}</td>
              <td className="py-2 text-right tabular-nums">{inCcy(p.avgCostUsd, cur)}</td>
              <td className="py-2 text-right tabular-nums">{p.priceUsd === null ? "—" : inCcy(p.priceUsd, cur)}</td>
              <td className={`py-2 text-right tabular-nums ${pnlCls(p.pnlUsd)}`}>
                {p.pnlUsd === null ? "—" : signedInCcy(p.pnlUsd, cur)}
                <span className="block text-[11px]">{pct(p.pnlPct)}</span>
              </td>
              <td className="py-2 text-right tabular-nums text-slate-400">{p.targetPriceUsd === null ? "Off" : inCcy(p.targetPriceUsd, cur)}</td>
              <td className="py-2 text-right tabular-nums text-slate-400">{inCcy(p.maxLossPriceUsd, cur)}</td>
              <td className="px-5 py-2 text-right tabular-nums text-slate-400">
                {p.trailingStopUsd === null ? "Off" : inCcy(p.trailingStopUsd, cur)}
                {p.trailingStopUsd !== null && p.highWaterUsd !== null && <span className="block text-[11px] text-slate-500">high {inCcy(p.highWaterUsd, cur)}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AgentNotificationList({ items }: { items: { id: string; title: string; body: string | null; read: boolean; at: string; kind: string }[] }) {
  if (!items.length) return <p className="text-sm text-slate-400">No notifications yet.</p>;
  return (
    <ul className="space-y-2">
      {items.map((n) => (
        <li key={n.id} className="rounded-lg bg-ink/[0.03] p-2.5">
          <div className="flex items-start gap-2 text-sm">
            {!n.read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" aria-label="unread" />}
            <span className={`font-medium ${n.kind === "agent_error" || n.kind === "agent_trade_failed" ? "text-red-300" : ""}`}>{n.title}</span>
            <span className="ml-auto shrink-0 text-[11px] text-slate-500">{ago(n.at)}</span>
          </div>
          {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-slate-400">{n.body}</p>}
        </li>
      ))}
    </ul>
  );
}
