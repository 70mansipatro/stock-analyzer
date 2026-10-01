"use client";

import { Loader2, Plus, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { addAgentStock, removeAgentStock } from "@/app/(app)/agent/actions";
import { toast } from "@/lib/toast";

type Hit = { symbol: string; name: string; exchange: string; type: string };

const isIndian = (s: string) => /\.(NS|BO)$/i.test(s);
// Same rule as the server: US tickers (no suffix) or NSE/BSE.
const supported = (s: string) => !/[\^=]/.test(s) && (!/\.[A-Z]+$/i.test(s) || isIndian(s));

/** Search, add and remove the stocks the Auto-Trader watches. Changes are saved immediately. */
export function StockSelector({ symbols, disabled }: { symbols: string[]; disabled?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const query = q.trim();
    if (!query) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal });
        if (res.ok) {
          setHits(((await res.json()) as Hit[]).filter((h) => supported(h.symbol)));
          setOpen(true);
        }
      } catch {}
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const add = (symbol: string) =>
    start(async () => {
      setBusy(symbol);
      const r = await addAgentStock(symbol);
      setBusy(null);
      toast(r.ok ? "success" : "error", r.ok ? "Stock added" : "Not added", r.message);
      if (r.ok) {
        setQ("");
        setHits([]);
        setOpen(false);
      }
      router.refresh();
    });

  const remove = (symbol: string) =>
    start(async () => {
      setBusy(symbol);
      const r = await removeAgentStock(symbol);
      setBusy(null);
      if (r && !r.ok) toast("error", "Not removed", r.message);
      router.refresh();
    });

  const us = symbols.filter((s) => !isIndian(s));
  const india = symbols.filter(isIndian);

  return (
    <div className="space-y-3">
      <div ref={box} className="relative">
        <div className="flex items-center gap-2 rounded-xl border border-ink/10 bg-ink/[0.03] px-3 focus-within:border-emerald-400/50">
          <Search className="h-4 w-4 text-slate-500" />
          <input
            value={q}
            disabled={disabled}
            onChange={(e) => {
              setQ(e.target.value);
              if (!e.target.value.trim()) {
                setHits([]);
                setOpen(false);
              }
            }}
            onFocus={() => hits.length && setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (hits[0]) add(hits[0].symbol);
                else if (q.trim()) add(q.trim());
              } else if (e.key === "Escape") setOpen(false);
            }}
            placeholder="Search to add, e.g. NVDA or Reliance"
            aria-label="Search stocks to add"
            className="w-full bg-transparent py-2 text-sm focus:outline-none"
          />
          {pending && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
        </div>
        {open && (
          <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-xl">
            {hits.length === 0 && <li className="px-3 py-2 text-xs text-slate-400">No US or Indian (NSE/BSE) stocks match. Press Enter to try the ticker as typed.</li>}
            {hits.map((h) => {
              const added = symbols.includes(h.symbol);
              return (
                <li key={h.symbol}>
                  <button type="button" disabled={added || pending} onClick={() => add(h.symbol)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-slate-800 disabled:opacity-50">
                    <span className="w-28 shrink-0 font-semibold text-slate-100">{h.symbol}</span>
                    <span className="min-w-0 flex-1 truncate text-slate-400">{h.name}</span>
                    <span className="shrink-0 text-[11px] text-slate-500">{h.exchange}</span>
                    {added ? <span className="text-[11px] text-emerald-400">Added</span> : <Plus className="h-3.5 w-3.5 text-slate-400" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {symbols.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink/15 p-4 text-center text-sm text-slate-400">No stocks selected. Search and add stocks to start Auto-Trader.</p>
      ) : (
        [
          { label: "US · NYSE / Nasdaq", list: us },
          { label: "India · NSE / BSE", list: india },
        ]
          .filter((g) => g.list.length)
          .map((g) => (
            <div key={g.label}>
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                {g.label} ({g.list.length})
              </div>
              <ul className="flex flex-wrap gap-1.5">
                {g.list.map((s) => (
                  <li key={s} className="flex items-center gap-1 rounded-lg border border-ink/10 bg-ink/[0.03] py-1 pl-2.5 pr-1 text-xs font-medium">
                    {s}
                    <button type="button" disabled={disabled || pending} onClick={() => remove(s)} aria-label={`Remove ${s}`} className="rounded p-0.5 text-slate-500 hover:bg-ink/10 hover:text-red-400 disabled:opacity-40">
                      {busy === s ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
      )}
    </div>
  );
}
