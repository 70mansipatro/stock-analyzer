"use client";

import { ArrowRight, Mail, MailCheck, PencilLine, RotateCw, UserRound } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { otpAction, type OtpState } from "@/app/login/actions";

const field =
  "w-full rounded-xl border border-ink/15 bg-ink/[0.05] py-2.5 pl-11 pr-4 text-base text-slate-50 placeholder:text-slate-400 transition focus:border-emerald-400/70 focus:bg-ink/[0.08] focus:outline-none focus:ring-4 focus:ring-emerald-500/15";
const primary =
  "group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 via-teal-500 to-sky-500 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-emerald-500/25 transition hover:brightness-110 focus:outline-none focus:ring-4 focus:ring-emerald-500/30 disabled:opacity-60";

const RESEND_AFTER = 30;

/** Passwordless sign-in: email → 6-digit code (plus name for a new account). */
export function OtpLoginForm({ callbackUrl }: { callbackUrl?: string }) {
  const [state, action, pending] = useActionState<OtpState, FormData>(otpAction, { step: "email" });
  const [email, setEmail] = useState(state.email ?? "");

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="callbackUrl" value={callbackUrl ?? "/"} />
      {state.step === "email" ? (
        <>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-200">Email</span>
            <span className="relative block">
              <Mail className="pointer-events-none absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400" />
              <input
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                inputMode="email"
                required
                autoFocus
                placeholder="you@example.com"
                className={field}
              />
            </span>
          </label>
          <ErrorLine error={state.error} />
          <button name="intent" value="send" disabled={pending} className={primary}>
            {pending ? "Sending code…" : "Email me a code"}
            {!pending && <ArrowRight className="h-4.5 w-4.5 transition group-hover:translate-x-0.5" />}
          </button>
          <p className="text-center text-xs text-slate-500">No password needed. New here? We&apos;ll create your account.</p>
        </>
      ) : (
        <CodeStep state={state} pending={pending} />
      )}
    </form>
  );
}

function CodeStep({ state, pending }: { state: Extract<OtpState, { step: "code" }>; pending: boolean }) {
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const [name, setName] = useState("");
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const verifyBtn = useRef<HTMLButtonElement>(null);
  const [now, setNow] = useState(() => Date.now());
  const code = digits.join("");

  // Tick the resend countdown.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const wait = Math.max(0, RESEND_AFTER - Math.floor((now - state.sentAt) / 1000));

  // A wrong code clears the boxes so the next attempt starts fresh.
  const [handled, setHandled] = useState(state);
  if (handled !== state) {
    setHandled(state);
    if (state.error) setDigits(Array(6).fill(""));
  }
  useEffect(() => {
    if (state.error) boxes.current[0]?.focus();
  }, [state]);

  // Returning users are signed in as soon as the 6th digit is typed or pasted.
  useEffect(() => {
    if (code.length === 6 && !state.isNew && !pending) verifyBtn.current?.click();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const put = (start: number, text: string) => {
    const chars = text.replace(/\D/g, "").slice(0, 6 - start).split("");
    if (!chars.length) return;
    setDigits((d) => {
      const next = [...d];
      chars.forEach((c, i) => (next[start + i] = c));
      return next;
    });
    boxes.current[Math.min(start + chars.length, 5)]?.focus();
  };

  return (
    <>
      <input type="hidden" name="code" value={code} />
      <div className="flex items-start gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] px-3.5 py-3 text-sm">
        <MailCheck className="mt-0.5 h-4.5 w-4.5 shrink-0 text-emerald-300" />
        <div className="min-w-0 flex-1">
          <p className="text-slate-200">
            We sent a 6-digit code to <b className="break-all">{state.email}</b>
          </p>
          <p className="text-xs text-slate-400">It expires in 10 minutes. Check Spam if it isn&apos;t there.</p>
        </div>
        <button name="intent" value="change" formNoValidate className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-ink/10 hover:text-slate-100" aria-label="Use a different email" title="Use a different email">
          <PencilLine className="h-4 w-4" />
        </button>
      </div>

      <fieldset>
        <legend className="mb-1.5 block text-sm font-medium text-slate-200">Code</legend>
        <div className="flex justify-between gap-2" onPaste={(e) => (e.preventDefault(), put(0, e.clipboardData.getData("text")))}>
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => {
                boxes.current[i] = el;
              }}
              value={d}
              autoFocus={i === 0}
              inputMode="numeric"
              autoComplete={i === 0 ? "one-time-code" : "off"}
              aria-label={`Digit ${i + 1}`}
              maxLength={6}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "");
                if (!v) setDigits((ds) => ds.map((x, j) => (j === i ? "" : x)));
                else put(i, v.length > 1 ? v : v);
              }}
              onKeyDown={(e) => {
                if (e.key === "Backspace" && !d && i > 0) boxes.current[i - 1]?.focus();
                if (e.key === "ArrowLeft" && i > 0) boxes.current[i - 1]?.focus();
                if (e.key === "ArrowRight" && i < 5) boxes.current[i + 1]?.focus();
              }}
              className="h-13 w-full min-w-0 rounded-xl border border-ink/15 bg-ink/[0.05] text-center text-xl font-semibold tabular-nums text-slate-50 transition focus:border-emerald-400/70 focus:outline-none focus:ring-4 focus:ring-emerald-500/15"
            />
          ))}
        </div>
      </fieldset>

      {state.isNew && (
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-200">Your name</span>
          <span className="relative block">
            <UserRound className="pointer-events-none absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400" />
            <input name="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={60} placeholder="e.g. Priya Sharma" className={field} />
          </span>
          <span className="mt-1 block text-xs text-slate-500">New account: this is how we&apos;ll greet you.</span>
        </label>
      )}

      <ErrorLine error={state.error} />

      <button ref={verifyBtn} name="intent" value="verify" disabled={pending || code.length !== 6 || (state.isNew && name.trim().length < 2)} className={primary}>
        {pending ? "Checking…" : state.isNew ? "Create account" : "Verify & sign in"}
        {!pending && <ArrowRight className="h-4.5 w-4.5 transition group-hover:translate-x-0.5" />}
      </button>
      <button
        name="intent"
        value="resend"
        formNoValidate
        disabled={pending || wait > 0}
        className="mx-auto flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-slate-400 transition hover:text-slate-100 disabled:opacity-50 disabled:hover:text-slate-400"
      >
        <RotateCw className="h-3.5 w-3.5" /> {wait > 0 ? `Resend code in ${wait}s` : "Resend code"}
      </button>
    </>
  );
}

function ErrorLine({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
      {error}
    </p>
  );
}
