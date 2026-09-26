"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Hit = { symbol: string; name: string; exchange: string; type: string };

export function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [searched, setSearched] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const query = q.trim();
    if (!query) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal });
        if (res.ok) {
          setHits(await res.json());
          setSearched(query);
          setActive(0);
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
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const go = (symbol: string) => {
    setOpen(false);
    setQ("");
    setHits([]);
    router.push(`/stock/${encodeURIComponent(symbol)}`);
  };

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          if (!e.target.value.trim()) {
            setHits([]);
            setOpen(false);
          }
        }}
        onFocus={() => hits.length && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, hits.length - 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          else if (e.key === "Enter") {
            e.preventDefault();
            if (hits[active]) go(hits[active].symbol);
            // No suggestion picked: the stock page resolves names like "RR KABEL" to a ticker.
            else if (q.trim()) go(q.trim());
          } else if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Search stocks, e.g. Apple or NVDA"
        className="glass w-full rounded-xl px-3.5 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400/50 focus:outline-none"
        aria-label="Search stocks"
      />
      {open && hits.length === 0 && searched === q.trim() && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-400 shadow-xl">
          No matches for “{searched}”. Try the ticker (e.g. RRKABEL.NS) or fewer words.
        </div>
      )}
      {open && hits.length > 0 && (
        <ul className="absolute z-40 mt-2 w-full overflow-hidden rounded-xl border border-ink/10 bg-surface-2/95 shadow-2xl backdrop-blur-xl">
          {hits.map((h, i) => (
            <li key={h.symbol}>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => go(h.symbol)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${i === active ? "bg-slate-800" : ""}`}
              >
                <span className="font-medium text-slate-100">{h.symbol}</span>
                <span className="truncate text-xs text-slate-400">
                  {h.name} · {h.exchange}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
