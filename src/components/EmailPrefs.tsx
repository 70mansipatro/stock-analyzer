"use client";

import { useOptimistic, useTransition } from "react";
import { setEmailPref } from "@/app/(app)/settings/actions";
import { toast } from "@/lib/toast";

type Cat = { id: "orders" | "alerts" | "announcements"; label: string; description: string };

export function EmailPrefs({ categories, prefs, email, configured }: { categories: Cat[]; prefs: Record<string, boolean>; email: string; configured: boolean }) {
  const [state, setOptimistic] = useOptimistic(prefs, (cur, [id, on]: [string, boolean]) => ({ ...cur, [id]: on }));
  const [, start] = useTransition();
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-400">
        Emails go to <b className="text-slate-200">{email}</b>.
        {!configured && <span className="text-amber-300"> Email sending isn&apos;t set up on this server yet, so nothing will be delivered.</span>}
      </p>
      <p className="text-xs text-slate-500">Security emails (invitations, role and access changes, account removal) and reports you request from the AI assistant are always sent.</p>
      {categories.map((c) => {
        const on = state[c.id] !== false;
        return (
          <label key={c.id} className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-ink/10 p-4 hover:border-ink/20">
            <span>
              <span className="block text-sm font-medium">{c.label}</span>
              <span className="block text-xs text-slate-400">{c.description}</span>
            </span>
            <input
              type="checkbox"
              className="peer sr-only"
              checked={on}
              onChange={(e) => {
                const next = e.target.checked;
                start(async () => {
                  setOptimistic([c.id, next]);
                  const r = await setEmailPref(c.id, next);
                  toast(r.ok ? "success" : "error", r.ok ? `${c.label} emails ${next ? "on" : "off"}` : "Couldn't save");
                });
              }}
            />
            <span aria-hidden className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-emerald-500" : "bg-slate-600"} peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-400`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
            </span>
          </label>
        );
      })}
    </div>
  );
}
