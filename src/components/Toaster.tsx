"use client";

import { useEffect, useState } from "react";
import type { ToastEvent } from "@/lib/toast";

type Item = ToastEvent & { id: number; leaving?: boolean };

const STYLE = {
  success: { ring: "border-emerald-500/40", icon: "✓", iconCls: "bg-emerald-500/15 text-emerald-400" },
  error: { ring: "border-red-500/40", icon: "✕", iconCls: "bg-red-500/15 text-red-400" },
  info: { ring: "border-sky-500/40", icon: "i", iconCls: "bg-sky-500/15 text-sky-400" },
};

export function Toaster() {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    let next = 1;
    const onToast = (e: Event) => {
      const id = next++;
      setItems((list) => [...list.slice(-3), { ...(e as CustomEvent<ToastEvent>).detail, id }]);
      setTimeout(() => setItems((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t))), 4200);
      setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 4600);
    };
    window.addEventListener("app:toast", onToast);
    return () => window.removeEventListener("app:toast", onToast);
  }, []);

  return (
    <div aria-live="polite" className="pointer-events-none fixed right-4 top-4 z-[60] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2">
      {items.map((t) => {
        const s = STYLE[t.kind];
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex gap-3 rounded-xl border ${s.ring} bg-slate-900/95 p-3 shadow-2xl backdrop-blur transition-all duration-300 ${
              t.leaving ? "translate-x-4 opacity-0" : "animate-toast-in"
            }`}
          >
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${s.iconCls}`}>{s.icon}</span>
            <div className="min-w-0 text-sm">
              <div className="font-medium text-slate-100">{t.title}</div>
              {t.body && <div className="text-slate-400">{t.body}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
