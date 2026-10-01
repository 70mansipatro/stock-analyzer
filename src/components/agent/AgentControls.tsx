"use client";

import { Check, Loader2, Play, Power, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { decideSuggestion, runAgentNow, saveAgentConfig, setAgentEnabled, type AgentActionResult } from "@/app/(app)/agent/actions";
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
      className="flex items-center gap-2 rounded-xl border border-ink/15 px-4 py-2 text-sm font-medium transition hover:bg-ink/5 disabled:opacity-50"
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
      {pending ? "Scanning stocks…" : "Run now"}
    </button>
  );
}

/** Start / Stop switch for the Auto-Trader. */
export function StartStopButton({ enabled, disabled }: { enabled: boolean; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      disabled={pending || disabled}
      onClick={() =>
        start(async () => {
          const r = await setAgentEnabled(!enabled);
          if (r) toast(r.ok ? "success" : "error", r.ok ? (enabled ? "Auto-Trader stopped" : "Auto-Trader started") : "Not changed", r.message);
          router.refresh();
        })
      }
      className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white shadow-lg transition hover:brightness-110 disabled:opacity-50 ${enabled ? "bg-red-600 shadow-red-500/20" : "bg-gradient-to-r from-emerald-500 to-sky-500 shadow-emerald-500/20"}`}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
      {enabled ? "Stop Auto-Trader" : "Start Auto-Trader"}
    </button>
  );
}

/** Refreshes the page data on an interval while the Auto-Trader is running, so the activity stays live. */
export function AutoRefresh({ active, seconds = 30 }: { active: boolean; seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [active, seconds, router]);
  return null;
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

type Mode = "FULL_AUTO" | "SUGGEST" | "DRY_RUN";

type Cfg = {
  mode: Mode;
  risk: "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";
  budget: number;
  maxPositionPct: number;
  maxTradesPerDay: number;
  stopLossPct: number;
  takeProfitPct: number;
  trailingStopEnabled: boolean;
  trailingStopPct: number;
  useAiReview: boolean;
  marketHoursOnly: boolean;
  dailyEmail: boolean;
  tradeEmails: boolean;
  summaryHour: number;
  demoSpeed: boolean;
};

function Toggle({ name, label, hint, defaultChecked, onChange }: { name: string; label: string; hint: string; defaultChecked: boolean; onChange?: (on: boolean) => void }) {
  const [on, setOn] = useState(defaultChecked);
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-ink/10 p-3 hover:border-ink/20">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-slate-400">{hint}</span>
      </span>
      <input
        type="checkbox"
        name={name}
        checked={on}
        onChange={(e) => {
          setOn(e.target.checked);
          onChange?.(e.target.checked);
        }}
        className="peer sr-only"
      />
      <span aria-hidden className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-emerald-500" : "bg-slate-600"} peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-400`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
      </span>
    </label>
  );
}

const MODES = [
  { id: "FULL_AUTO", label: "Full auto", hint: "Buys & sells by itself" },
  { id: "SUGGEST", label: "Suggest", hint: "You approve each trade" },
  { id: "DRY_RUN", label: "Dry run", hint: "Only records decisions" },
] as const;
const RISKS = [
  { id: "CONSERVATIVE", label: "Conservative", hint: "Buys at score ≥ 45" },
  { id: "BALANCED", label: "Balanced", hint: "Buys at score ≥ 35" },
  { id: "AGGRESSIVE", label: "Aggressive", hint: "Buys at score ≥ 25" },
] as const;

const MODE_HELP: Record<Mode, string> = {
  FULL_AUTO: "FULL AUTO means the bot automatically monitors your selected stocks and executes virtual BUY/SELL trades according to the strategy and risk rules. No approval is required.",
  SUGGEST: "The bot proposes trades and waits: nothing is bought or sold until you approve it.",
  DRY_RUN: "The bot scans and records what it would do, but never places an order.",
};

export function AgentSettingsForm({ cfg }: { cfg: Cfg }) {
  const [mode, setMode] = useState<Mode>(cfg.mode);
  const [risk, setRisk] = useState(cfg.risk);
  const [trailing, setTrailing] = useState(cfg.trailingStopEnabled);
  const router = useRouter();
  const [state, action, pending] = useActionState<AgentActionResult, FormData>(async (prev, fd) => {
    const r = await saveAgentConfig(prev, fd);
    if (r) toast(r.ok ? "success" : "error", r.ok ? "Auto-trader saved" : "Not saved", r.message);
    router.refresh();
    return r;
  }, null);

  const num = (name: keyof Cfg, label: string, hint: string, o: { prefix?: string; suffix?: string; min?: number; max?: number } = {}) => (
    <label className="block">
      <span className="text-xs font-medium text-slate-300">{label}</span>
      <span className="mt-1 flex items-center rounded-xl border border-ink/10 bg-ink/[0.03] focus-within:border-emerald-400/50">
        {o.prefix && <span className="pl-3 text-sm text-slate-500">{o.prefix}</span>}
        <input name={name} type="number" step="any" min={o.min} max={o.max} required defaultValue={cfg[name] as number} className="w-full bg-transparent px-3 py-2 text-sm tabular-nums focus:outline-none" />
        {o.suffix && <span className="pr-3 text-sm text-slate-500">{o.suffix}</span>}
      </span>
      <span className="mt-0.5 block text-[11px] text-slate-500">{hint}</span>
    </label>
  );

  return (
    <form action={action} className="space-y-5">
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
        <p className="mt-2 text-xs text-slate-400">{MODE_HELP[mode]}</p>
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
        {num("budget", "Budget", "Max the agent keeps invested", { prefix: "$", min: 500 })}
        {num("maxPositionPct", "Max per stock", "Share of the budget", { suffix: "%", min: 5, max: 50 })}
        {num("takeProfitPct", "Profit target", "Sell when up this much (0 = off)", { suffix: "%", min: 0, max: 200 })}
        {num("stopLossPct", "Maximum loss", "Sell when down this much", { suffix: "%", min: 1, max: 50 })}
        {num("maxTradesPerDay", "Max trades a day", "Buys + signal sells", { min: 1, max: 50 })}
      </div>

      <div className="space-y-2">
        <Toggle name="trailingStopEnabled" label="Trailing stop" hint="Sell if the price falls this far below its highest point since the buy." defaultChecked={cfg.trailingStopEnabled} onChange={setTrailing} />
        <div className={trailing ? "" : "hidden"}>{num("trailingStopPct", "Trailing stop", "E.g. bought at $100, peaked at $130, 10% trail → sells near $117. With a trailing stop, a higher profit target (or 0) lets winners run.", { suffix: "%", min: 1, max: 50 })}</div>
      </div>

      <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200/90">
        Auto-Trader uses configurable profit targets and risk protection, but market returns are not guaranteed. Prices can gap past a limit, so a sale may happen below the maximum-loss level.
      </p>

      <div className="space-y-2">
        <Toggle name="useAiReview" label="AI review" hint="Gemini double-checks each buy and can veto it. It never adds, resizes or blocks a sell." defaultChecked={cfg.useAiReview} />
        <Toggle name="marketHoursOnly" label="Market hours only" hint="Trade a stock only while its exchange (NYSE/Nasdaq or NSE/BSE) is open. Recommended." defaultChecked={cfg.marketHoursOnly} />
        <Toggle name="tradeEmails" label="Trade emails" hint="An email after every automatic buy and sell." defaultChecked={cfg.tradeEmails} />
        <Toggle name="dailyEmail" label="Daily summary email" hint="Scans, trades, P/L and open positions once a day." defaultChecked={cfg.dailyEmail} />
        {num("summaryHour", "Daily summary after", "Hour of the day, 0–23 (server time)", { suffix: ":00", min: 0, max: 23 })}
        <Toggle name="demoSpeed" label="Demo speed" hint="Runs every minute and ignores market hours (for demos and testing)." defaultChecked={cfg.demoSpeed} />
      </div>

      <button disabled={pending} className="w-full rounded-xl bg-gradient-to-r from-emerald-500 to-sky-500 px-4 py-2.5 text-sm font-medium text-white shadow-lg transition hover:brightness-110 disabled:opacity-50">
        {pending ? "Saving…" : "Save settings"}
      </button>
      {state && !state.ok && <p className="text-sm text-red-400">{state.message}</p>}
    </form>
  );
}
