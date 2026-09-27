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
      <button onClick={() => setOpen(true)} className="flex items-center gap-2 text-sm text-slate-400 transition hover:text-slate-100">
        <KeyRound className="h-4 w-4" /> Sign in with username and password
      </button>
    );
  }

  return (
    <form action={action} className="glass w-full max-w-md space-y-3 rounded-2xl p-4">
      <input type="hidden" name="callbackUrl" value={callbackUrl ?? "/"} />
      <div className="flex items-center gap-2 text-sm font-medium">
        <KeyRound className="h-4 w-4 text-emerald-300" /> Local account
      </div>
      <input
        name="username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        autoComplete="username"
        required
        autoFocus
        placeholder="Username"
        className="w-full rounded-xl border border-ink/10 bg-ink/[0.03] px-3.5 py-2.5 text-sm placeholder:text-slate-500 focus:border-emerald-400/50 focus:outline-none"
      />
      <input
        name="password"
        type="password"
        autoComplete="current-password"
        required
        placeholder="Password"
        className="w-full rounded-xl border border-ink/10 bg-ink/[0.03] px-3.5 py-2.5 text-sm placeholder:text-slate-500 focus:border-emerald-400/50 focus:outline-none"
      />
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      <div className="flex items-center gap-2">
        <button
          disabled={pending}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-sky-500 px-4 py-2.5 text-sm font-medium text-white shadow-lg transition hover:brightness-110 disabled:opacity-50"
        >
          <LogIn className="h-4 w-4" /> {pending ? "Signing in…" : "Sign in"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-xl px-3 py-2.5 text-sm text-slate-400 hover:text-slate-100">
          Cancel
        </button>
      </div>
    </form>
  );
}
