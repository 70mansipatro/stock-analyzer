"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useTransition } from "react";
import { CURRENCY_COOKIE, inCcy, signedInCcy, USD, type DisplayCode, type DisplayCurrency } from "@/lib/display-currency";

const Ctx = createContext<DisplayCurrency>(USD);

function saveCurrency(code: DisplayCode) {
  document.cookie = `${CURRENCY_COOKIE}=${code}; path=/; max-age=31536000; samesite=lax`;
}

export function CurrencyProvider({ value, children }: { value: DisplayCurrency; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Display currency in client components, with formatters for USD amounts. */
export function useCurrency() {
  const c = useContext(Ctx);
  return { ...c, fmt: (usd: number | null | undefined, digits = 2) => inCcy(usd, c, digits), signed: (usd: number | null | undefined) => signedInCcy(usd, c) };
}

/** USD / INR switch. Saves the choice in a cookie and re-renders the page with converted values. */
export function CurrencyToggle({ size = "sm" }: { size?: "sm" | "lg" }) {
  const { code } = useContext(Ctx);
  const router = useRouter();
  const [pending, start] = useTransition();
  const set = (next: DisplayCode) => {
    if (next === code) return;
    saveCurrency(next);
    start(() => router.refresh());
  };
  const lg = size === "lg";
  return (
    <div role="radiogroup" aria-label="Display currency" className={`glass flex shrink-0 items-center gap-0.5 rounded-xl p-1 ${pending ? "opacity-60" : ""}`}>
      {(["USD", "INR"] as DisplayCode[]).map((c) => (
        <button
          key={c}
          role="radio"
          aria-checked={code === c}
          onClick={() => set(c)}
          className={`rounded-lg font-medium transition ${lg ? "px-4 py-2 text-sm" : "px-2.5 py-1 text-xs"} ${code === c ? "bg-surface-1 text-slate-50 shadow-sm" : "text-slate-400 hover:text-slate-100"}`}
        >
          {c === "USD" ? "$ USD" : "₹ INR"}
        </button>
      ))}
    </div>
  );
}
