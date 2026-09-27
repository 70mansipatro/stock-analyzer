"use client";

import { KeyRound, LogIn } from "lucide-react";
import { useActionState, useState } from "react";
import { localLogin, type LoginState } from "@/app/login/actions";

export function LocalLoginForm({ callbackUrl }: { callbackUrl?: string }) {
  const [open, setOpen] = useState(false);
  // Controlled so the username survives React's form reset after a failed attempt.
  const [username, setUsername] = useState("");
  const [state, action, pending] = useActionState<LoginState, FormData>(localLogin, null);

  if (!open) {
    return (
      <div className="w-full max-w-md">
        <div className="mb-4 flex items-center gap-3 text-xs uppercase tracking-[0.18em] text-slate-500">
          <span className="h-px flex-1 bg-ink/10" /> or <span className="h-px flex-1 bg-ink/10" />
        </div>
        <button
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-center gap-3 rounded-xl border border-ink/15 bg-ink/[0.06] px-6 py-3.5 text-base font-medium text-slate-50 shadow-lg transition hover:border-emerald-400/50 hover:bg-ink/10 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        >
          <KeyRound className="h-5 w-5 text-emerald-300" /> Sign in with username &amp; password
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="glass w-full max-w-md space-y-3 rounded-2xl border-emerald-400/30 p-5">
      <input type="hidden" name="callbackUrl" value={callbackUrl ?? "/"} />
      <div className="flex items-center gap-2 text-base font-semibold text-slate-50">
        <KeyRound className="h-5 w-5 text-emerald-300" /> Sign in with username
      </div>
      <input
        name="username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        autoComplete="username"
        required
        autoFocus
        placeholder="Username"
        className="w-full rounded-xl border border-ink/10 bg-ink/[0.06] px-4 py-3 text-base placeholder:text-slate-400 text-slate-50 focus:border-emerald-400/60 focus:outline-none"
      />
      <input
        name="password"
        type="password"
        autoComplete="current-password"
        required
        placeholder="Password"
        className="w-full rounded-xl border border-ink/10 bg-ink/[0.06] px-4 py-3 text-base placeholder:text-slate-400 text-slate-50 focus:border-emerald-400/60 focus:outline-none"
      />
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      <div className="flex items-center gap-2">
        <button
          disabled={pending}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-sky-500 px-4 py-3 text-base font-medium text-white shadow-lg transition hover:brightness-110 disabled:opacity-50"
        >
          <LogIn className="h-4 w-4" /> {pending ? "Signing in…" : "Sign in"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-ink/15 px-4 py-2.5 text-sm text-slate-200 hover:bg-ink/5">
          Cancel
        </button>
      </div>
    </form>
  );
}
