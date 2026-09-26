"use client";

import { useState } from "react";
import type { PortfolioReview as Review } from "@/lib/insights";
import { toast } from "@/lib/toast";

const RISK_COLOR: Record<Review["riskLabel"], string> = {
  Low: "text-emerald-400",
  Moderate: "text-sky-400",
  High: "text-amber-400",
  "Very high": "text-red-400",
};

export function PortfolioReview({ hasHoldings }: { hasHoldings: boolean }) {
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/portfolio-review", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Review failed.");
      setReview(body);
      toast("success", "AI review ready", `Risk score ${body.riskScore}/10`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (!review) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-slate-400">
          Gemini checks your holdings, sector mix, volatility and cash, then scores your risk and suggests what to think about.
        </p>
        <button
          onClick={run}
          disabled={loading || !hasHoldings}
          className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-emerald-600 to-sky-600 px-4 py-2 text-sm font-medium text-white shadow-lg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? (
            <>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> Analyzing your portfolio…
            </>
          ) : (
            <>✦ Run AI portfolio review</>
          )}
        </button>
        {!hasHoldings && <p className="text-xs text-slate-500">Buy at least one stock to enable the review.</p>}
        {error && <p className="text-sm text-amber-300">⚠ {error}</p>}
      </div>
    );
  }

  const pct = (review.riskScore / 10) * 100;
  return (
    <div className="animate-fade-up space-y-4">
      <div className="flex items-center gap-4">
        <div className="relative h-20 w-20 shrink-0" role="img" aria-label={`Risk score ${review.riskScore} out of 10`}>
          <svg viewBox="0 0 36 36" className="h-20 w-20 -rotate-90">
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="#1e293b" strokeWidth="3.5" />
            <circle
              cx="18"
              cy="18"
              r="15.5"
              fill="none"
              stroke="url(#risk-grad)"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeDasharray={`${(pct * 97.4) / 100} 97.4`}
            />
            <defs>
              <linearGradient id="risk-grad">
                <stop offset="0%" stopColor="#22a55c" />
                <stop offset="60%" stopColor="#c98500" />
                <stop offset="100%" stopColor="#e5484d" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-bold tabular-nums">{review.riskScore}</span>
            <span className="text-[9px] uppercase text-slate-500">of 10</span>
          </div>
        </div>
        <div>
          <div className={`text-sm font-semibold ${RISK_COLOR[review.riskLabel]}`}>{review.riskLabel} risk</div>
          <p className="text-sm text-slate-200">{review.headline}</p>
        </div>
      </div>
      <p className="text-sm text-slate-300">{review.diversification}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { title: "Strengths", items: review.strengths, icon: "▲", cls: "text-emerald-400" },
          { title: "Risks", items: review.risks, icon: "▼", cls: "text-red-400" },
          { title: "Things to consider", items: review.ideas, icon: "✦", cls: "text-sky-400" },
        ].map((col) => (
          <div key={col.title} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">{col.title}</div>
            <ul className="space-y-1.5 text-sm text-slate-300">
              {col.items.map((it) => (
                <li key={it} className="flex gap-2">
                  <span className={`${col.cls} shrink-0`} aria-hidden>{col.icon}</span>
                  {it}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>{review.disclaimer}</span>
        <button onClick={run} disabled={loading} className="text-emerald-400 hover:underline disabled:opacity-50">
          {loading ? "Refreshing…" : "Refresh review"}
        </button>
      </div>
    </div>
  );
}
