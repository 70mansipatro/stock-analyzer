"use client";

import { useActionState, useState } from "react";
import { placeOrderAction, type TradeState } from "@/app/actions";
import { money } from "@/lib/format";

export function TradeForm({
  symbol,
  price,
  localPrice,
  currency,
  cash,
  owned,
  maxOrderValue,
}: {
  symbol: string;
  /** USD per share (what the trade is booked at) */
  price: number;
  localPrice: number;
  currency: string;
  cash: number;
  owned: number;
  maxOrderValue: number;
}) {
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [qty, setQty] = useState("1");
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState<TradeState, FormData>(async (prev, fd) => {
    const res = await placeOrderAction(prev, fd);
    setConfirming(false);
    return res;
  }, null);

  const quantity = Math.floor(Number(qty));
  const valid = Number.isFinite(quantity) && quantity > 0;
  const total = valid ? quantity * price : 0;
  const problem = !valid
    ? "Enter a whole number of shares."
    : total > maxOrderValue
      ? `Over the $${maxOrderValue.toLocaleString()} per-order limit.`
      : side === "BUY" && total > cash
        ? "Not enough cash."
        : side === "SELL" && quantity > owned
          ? `You own ${owned} shares.`
          : null;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="symbol" value={symbol} />
      <input type="hidden" name="side" value={side} />
      <input type="hidden" name="quantity" value={valid ? quantity : ""} />

      <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-800 p-1">
        {(["BUY", "SELL"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setSide(s);
              setConfirming(false);
            }}
            className={`rounded-md py-1.5 text-sm font-medium transition ${
              side === s ? (s === "BUY" ? "bg-emerald-600 text-white" : "bg-red-600 text-white") : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {s === "BUY" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>

      <label className="block text-sm">
        <span className="text-slate-400">Shares</span>
        <input
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          value={qty}
          onChange={(e) => {
            setQty(e.target.value);
            setConfirming(false);
          }}
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 tabular-nums focus:border-emerald-500 focus:outline-none"
        />
      </label>

      <dl className="space-y-1 text-sm">
        <div className="flex justify-between"><dt className="text-slate-400">Market price</dt><dd className="text-right tabular-nums">
          {currency !== "USD" && (
            <span className="text-slate-400">
              {money(localPrice, currency)} ≈{" "}
            </span>
          )}
          ${price.toFixed(2)}
        </dd></div>
        <div className="flex justify-between"><dt className="text-slate-400">Estimated total</dt><dd className="tabular-nums font-medium">${total.toLocaleString("en-US", { maximumFractionDigits: 2 })}</dd></div>
        <div className="flex justify-between"><dt className="text-slate-400">Cash available</dt><dd className="tabular-nums">${cash.toLocaleString("en-US", { maximumFractionDigits: 2 })}</dd></div>
        <div className="flex justify-between"><dt className="text-slate-400">Shares owned</dt><dd className="tabular-nums">{owned}</dd></div>
      </dl>

      {problem && <p className="text-sm text-amber-400">⚠ {problem}</p>}

      {!confirming ? (
        <button
          type="button"
          disabled={!!problem}
          onClick={() => setConfirming(true)}
          className="w-full rounded-lg bg-slate-100 py-2 text-sm font-medium text-slate-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Review order
        </button>
      ) : (
        <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-800/60 p-3">
          <p className="text-sm">
            {side === "BUY" ? "Buy" : "Sell"} <b>{quantity}</b> {symbol} for about <b>${total.toLocaleString("en-US", { maximumFractionDigits: 2 })}</b>?
            <span className="block text-xs text-slate-400">
              Executed at the live price when you confirm{currency !== "USD" ? `, converted from ${currency} to USD` : ""}. Paper trade, no real money.
            </span>
          </p>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className={`flex-1 rounded-lg py-2 text-sm font-medium text-white disabled:opacity-60 ${side === "BUY" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-red-600 hover:bg-red-500"}`}
            >
              {pending ? "Placing…" : "Confirm"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="flex-1 rounded-lg border border-slate-600 py-2 text-sm hover:bg-slate-800">
              Cancel
            </button>
          </div>
        </div>
      )}

      {state && (
        <p role="status" className={`rounded-lg px-3 py-2 text-sm ${state.ok ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300"}`}>
          {state.ok ? "✓ " : "✕ "}
          {state.message}
        </p>
      )}
    </form>
  );
}
