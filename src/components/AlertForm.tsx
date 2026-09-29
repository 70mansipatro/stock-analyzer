"use client";

import { BellPlus } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { createAlertAction, type AlertFormState } from "@/app/(app)/alerts/actions";
import { toast } from "@/lib/toast";

const input =
  "w-full rounded-xl border border-ink/10 bg-ink/[0.04] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/20";

/** Create a price alert. On a stock page the symbol is fixed and quick "±5%" targets are offered. */
export function AlertForm({ symbol, price, currency, compact = false }: { symbol?: string; price?: number; currency?: string; compact?: boolean }) {
  const [state, action, pending] = useActionState<AlertFormState, FormData>(createAlertAction, null);
  const [target, setTarget] = useState("");
  const [condition, setCondition] = useState<"" | "ABOVE" | "BELOW">("");

  const [handled, setHandled] = useState(state);
  if (handled !== state) {
    setHandled(state);
    if (state?.ok) setTarget("");
  }
  useEffect(() => {
    if (state?.ok) toast("success", "Price alert created", state.ok);
  }, [state]);

  const quick = price
    ? [-10, -5, 5, 10].map((p) => ({ p, value: +(price * (1 + p / 100)).toFixed(price < 10 ? 3 : 2) }))
    : [];

  return (
    <form action={action} className="space-y-3">
      {symbol ? (
        <input type="hidden" name="symbol" value={symbol} />
      ) : (
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Stock</span>
          <input name="symbol" required placeholder="AAPL, RELIANCE.NS, Tesla…" className={input} autoComplete="off" />
        </label>
      )}
      <div className={`grid gap-3 ${compact ? "grid-cols-2" : "sm:grid-cols-[auto_1fr]"}`}>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">When price goes</span>
          <select name="condition" value={condition} onChange={(e) => setCondition(e.target.value as typeof condition)} className={input}>
            <option value="">Auto</option>
            <option value="ABOVE">Above ▲</option>
            <option value="BELOW">Below ▼</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Target price{currency ? ` (${currency})` : ""}</span>
          <input name="targetPrice" type="number" step="any" min="0" required value={target} onChange={(e) => setTarget(e.target.value)} placeholder={price ? String(price) : "250"} className={`${input} tabular-nums`} />
        </label>
      </div>
      {quick.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {quick.map((q) => (
            <button
              key={q.p}
              type="button"
              onClick={() => {
                setTarget(String(q.value));
                setCondition(q.p > 0 ? "ABOVE" : "BELOW");
              }}
              className={`rounded-lg px-2 py-1 text-xs tabular-nums transition ${q.p > 0 ? "bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20" : "bg-red-500/10 text-red-300 hover:bg-red-500/20"}`}
            >
              {q.p > 0 ? "+" : ""}
              {q.p}%
            </button>
          ))}
        </div>
      )}
      {!compact && (
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Note (optional)</span>
          <input name="note" maxLength={140} placeholder="e.g. Buy zone, take profit" className={input} />
        </label>
      )}
      {state?.error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{state.error}</p>}
      <button disabled={pending} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-amber-500/20 transition hover:brightness-110 disabled:opacity-60">
        <BellPlus className="h-4 w-4" /> {pending ? "Creating…" : "Create alert"}
      </button>
      <p className="text-center text-[11px] text-slate-500">Checked every minute. You get a notification{compact ? "" : " and an email (if on in Settings)"}.</p>
    </form>
  );
}
