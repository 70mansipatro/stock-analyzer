"use client";

import { ArrowRight, Eye, EyeOff, Lock, UserRound } from "lucide-react";
import { useActionState, useState } from "react";
import { localLogin, type LoginState } from "@/app/login/actions";

const field =
  "w-full rounded-xl border border-ink/15 bg-ink/[0.05] py-3 pl-11 pr-4 text-base text-slate-50 placeholder:text-slate-400 transition focus:border-emerald-400/70 focus:bg-ink/[0.08] focus:outline-none focus:ring-4 focus:ring-emerald-500/15";

/** Username + password sign-in, always visible inside the sign-in card. */
export function LocalLoginForm({ callbackUrl }: { callbackUrl?: string }) {
  // Controlled so the username survives React's form reset after a failed attempt.
  const [username, setUsername] = useState("");
  const [show, setShow] = useState(false);
  const [state, action, pending] = useActionState<LoginState, FormData>(localLogin, null);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="callbackUrl" value={callbackUrl ?? "/"} />
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-slate-200">Username</span>
        <span className="relative block">
          <UserRound className="pointer-events-none absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400" />
          <input name="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required placeholder="Enter your username" className={field} />
        </span>
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-slate-200">Password</span>
        <span className="relative block">
          <Lock className="pointer-events-none absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400" />
          <input name="password" type={show ? "text" : "password"} autoComplete="current-password" required placeholder="Enter your password" className={`${field} pr-12`} />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Hide password" : "Show password"}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 transition hover:bg-ink/10 hover:text-slate-100"
          >
            {show ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
          </button>
        </span>
      </label>
      {state?.error && (
        <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {state.error}
        </p>
      )}
      <button
        disabled={pending}
        className="group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 via-teal-500 to-sky-500 px-6 py-3.5 text-base font-semibold text-white shadow-lg shadow-emerald-500/25 transition hover:brightness-110 focus:outline-none focus:ring-4 focus:ring-emerald-500/30 disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
        {!pending && <ArrowRight className="h-4.5 w-4.5 transition group-hover:translate-x-0.5" />}
      </button>
    </form>
  );
}
