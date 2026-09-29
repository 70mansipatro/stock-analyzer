"use client";

import { Check, Loader2, Play, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { decideSuggestion, runAgentNow, saveAgentConfig, type AgentActionResult } from "@/app/(app)/agent/actions";
import { toast } from "@/lib/toast";

export function RunNowButton({ disabled }: { disabled?: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      disabled={pending || disabled}
      onClick={() =>
        start(async () => {
          const r = await runAgentNow();
          if (r) toast(r.ok ? "success" : "info", r.ok ? "Auto-trader run finished" : "Auto-trader", r.message);
          router.refresh();
        })
      }
      className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-sky-500 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-emerald-500/20 transition hover:brightness-110 disabled:opacity-50"
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
      {pending ? "Scanning stocks…" : "Run now"}
    </button>
  );
}

export function SuggestionActions({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const act = (approve: boolean) =>
    start(async () => {
      const r = await decideSuggestion(id, approve);
      if (r) toast(r.ok ? "success" : "error", r.ok ? (approve ? "Order filled" : "Dismissed") : "Not done", r.message);
      router.refresh();
    });
  return (
    <div className="flex gap-2">
      <button disabled={pending} onClick={() => act(true)} className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
        <Check className="h-3.5 w-3.5" /> Approve
      </button>
      <button disabled={pending} onClick={() => act(false)} className="flex items-center gap-1.5 rounded-lg border border-ink/15 px-3 py-1.5 text-xs text-slate-300 hover:bg-ink/5 disabled:opacity-50">
        <X className="h-3.5 w-3.5" /> Dismiss
      </button>
    </div>
  );
}

type Cfg = {
  enabled: boolean;
  mode: "AUTO" | "SUGGEST" | "DRY_RUN";
  risk: "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";
  budget: number;
  maxPositionPct: number;
  maxTradesPerDay: number;
  stopLossPct: number;
  takeProfitPct: number;
  universe: string[];
  useAiReview: boolean;
  dailyEmail: boolean;
  demoSpeed: boolean;
};

function Toggle({ name, label, hint, defaultChecked }: { name: string; label: string; hint: string; defaultChecked: boolean }) {
  const [on, setOn] = useState(defaultChecked);
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-ink/10 p-3 hover:border-ink/20">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-slate-400">{hint}</span>
      </span>
      <input type="checkbox" name={name} checked={on} onChange={(e) => setOn(e.target.checked)} className="peer sr-only" />
      <span aria-hidden className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-emerald-500" : "bg-slate-600"} peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-400`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
      </span>
    </label>
  );
}

const MODES = [
  { id: "AUTO", label: "Auto", hint: "Trades by itself" },
  { id: "SUGGEST", label: "Suggest", hint: "You approve each trade" },
  { id: "DRY_RUN", label: "Dry run", hint: "Only records decisions" },
] as const;
const RISKS = [
  { id: "CONSERVATIVE", label: "Conservative", hint: "Buys at score ≥ 45" },
  { id: "BALANCED", label: "Balanced", hint: "Buys at score ≥ 35" },
  { id: "AGGRESSIVE", label: "Aggressive", hint: "Buys at score ≥ 25" },
] as const;

export function AgentSettingsForm({ cfg }: { cfg: Cfg }) {
  const [mode, setMode] = useState(cfg.mode);
  const [risk, setRisk] = useState(cfg.risk);
  const router = useRouter();
  const [state, action, pending] = useActionState<AgentActionResult, FormData>(async (prev, fd) => {
    const r = await saveAgentConfig(prev, fd);
    if (r) toast(r.ok ? "success" : "error", r.ok ? "Auto-trader saved" : "Not saved", r.message);
    router.refresh();
    return r;
  }, null);

  const num = (name: keyof Cfg, label: string, hint: string, prefix?: string, suffix?: string) => (
    <label className="block">
      <span className="text-xs font-medium text-slate-300">{label}</span>
      <span className="mt-1 flex items-center rounded-xl border border-ink/10 bg-ink/[0.03] focus-within:border-emerald-400/50">
        {prefix && <span className="pl-3 text-sm text-slate-500">{prefix}</span>}
        <input name={name} type="number" step="any" required defaultValue={cfg[name] as number} className="w-full bg-transparent px-3 py-2 text-sm tabular-nums focus:outline-none" />
        {suffix && <span className="pr-3 text-sm text-slate-500">{suffix}</span>}
      </span>
      <span className="mt-0.5 block text-[11px] text-slate-500">{hint}</span>
    </label>
  );

  return (
    <form action={action} className="space-y-5">
      <Toggle name="enabled" label="Auto-trader on" hint="Runs every 5 minutes while NSE or NYSE is open." defaultChecked={cfg.enabled} />

      <div>
        <div className="mb-2 text-xs font-medium text-slate-300">Mode</div>
        <input type="hidden" name="mode" value={mode} />
        <div className="grid grid-cols-3 gap-2">
          {MODES.map((m) => (
            <button key={m.id} type="button" onClick={() => setMode(m.id)} className={`rounded-xl border p-2.5 text-left transition ${mode === m.id ? "border-emerald-400/60 bg-emerald-500/10" : "border-ink/10 hover:border-ink/20"}`}>
              <span className="block text-sm font-medium">{m.label}</span>
              <span className="block text-[11px] text-slate-400">{m.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 text-xs font-medium text-slate-300">Risk level</div>
        <input type="hidden" name="risk" value={risk} />
        <div className="grid grid-cols-3 gap-2">
          {RISKS.map((r) => (
            <button key={r.id} type="button" onClick={() => setRisk(r.id)} className={`rounded-xl border p-2.5 text-left transition ${risk === r.id ? "border-sky-400/60 bg-sky-500/10" : "border-ink/10 hover:border-ink/20"}`}>
              <span className="block text-sm font-medium">{r.label}</span>
              <span className="block text-[11px] text-slate-400">{r.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {num("budget", "Budget", "Max the agent keeps invested", "$")}
        {num("maxPositionPct", "Max per stock", "Share of the budget", undefined, "%")}
        {num("stopLossPct", "Stop-loss", "Sell if down this much", undefined, "%")}
        {num("takeProfitPct", "Take-profit", "Sell if up this much", undefined, "%")}
        {num("maxTradesPerDay", "Max trades a day", "Buys + sells")}
      </div>

      <label className="block">
        <span className="text-xs font-medium text-slate-300">Stocks to watch ({cfg.universe.length})</span>
        <textarea name="universe" rows={3} defaultValue={cfg.universe.join(", ")} className="mt-1 w-full rounded-xl border border-ink/10 bg-ink/[0.03] px-3 py-2 font-mono text-xs focus:border-emerald-400/50 focus:outline-none" />
        <span className="mt-0.5 block text-[11px] text-slate-500">Comma-separated tickers. Leave empty for the default 12 US + 12 NIFTY large caps.</span>
      </label>

      <div className="space-y-2">
        <Toggle name="useAiReview" label="AI review" hint="AI double-checks each buy and can veto it." defaultChecked={cfg.useAiReview} />
        <Toggle name="dailyEmail" label="Daily summary email" hint="One email each evening with the day's trades." defaultChecked={cfg.dailyEmail} />
        <Toggle name="demoSpeed" label="Demo speed" hint="Runs every minute and ignores market hours (for demos)." defaultChecked={cfg.demoSpeed} />
      </div>

      <button disabled={pending} className="w-full rounded-xl bg-gradient-to-r from-emerald-500 to-sky-500 px-4 py-2.5 text-sm font-medium text-white shadow-lg transition hover:brightness-110 disabled:opacity-50">
        {pending ? "Saving…" : "Save settings"}
      </button>
      {state && !state.ok && <p className="text-sm text-red-400">{state.message}</p>}
    </form>
  );
}
