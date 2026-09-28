"use client";

import { Ban, Check, Lock, RotateCcw, Send, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { assignRole, removeAssignment, resendInvitation, resetAccount, retryEmail, setSuspended, updateSettings, type ActionResult } from "@/app/(app)/admin/actions";
import { ROLE_INFO, ROLES, type AppRole } from "@/lib/rbac";
import { toast } from "@/lib/toast";

const report = (res: ActionResult, okTitle = "Saved") => {
  if (!res) return;
  toast(res.ok ? "success" : "error", res.ok ? okTitle : "Not changed", res.message);
};

export function ReadOnlyBanner() {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-300">
      <Lock className="h-4 w-4 shrink-0" />
      <span>
        <b>Read-only access.</b> As an Auditor you can see everything here, but only Admins can change roles, suspend users or edit settings.
      </span>
    </div>
  );
}

export const ROLE_BADGE: Record<AppRole, string> = {
  ADMIN: "bg-violet-500/15 text-violet-300 ring-violet-400/30",
  AUDITOR: "bg-sky-500/15 text-sky-300 ring-sky-400/30",
  USER: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30",
  VIEWER: "bg-slate-500/15 text-slate-300 ring-slate-400/30",
};

export function RoleBadge({ role }: { role: AppRole }) {
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ${ROLE_BADGE[role]}`}>{ROLE_INFO[role].label}</span>;
}

/** Assign a role to any email, including people who haven't signed in yet. */
export function AssignRoleForm({ readOnly }: { readOnly: boolean }) {
  const [role, setRole] = useState<AppRole>("AUDITOR");
  const [state, action, pending] = useActionState(async (prev: ActionResult, fd: FormData) => {
    const res = await assignRole(prev, fd);
    report(res, "Role assigned");
    return res;
  }, null);

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
        <input
          name="email"
          type="email"
          required
          disabled={readOnly}
          placeholder="teammate@gmail.com"
          className="glass rounded-xl px-3.5 py-2.5 text-sm placeholder:text-slate-500 focus:border-emerald-400/50 focus:outline-none disabled:opacity-50"
        />
        <input type="hidden" name="role" value={role} />
        <button
          disabled={readOnly || pending}
          className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-sky-500 px-4 py-2.5 text-sm font-medium text-white shadow-lg transition hover:brightness-110 disabled:opacity-40"
        >
          <UserPlus className="h-4 w-4" /> {pending ? "Assigning…" : "Assign role"}
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" role="radiogroup" aria-label="Role">
        {ROLES.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={role === r}
            disabled={readOnly}
            onClick={() => setRole(r)}
            className={`rounded-xl border p-3 text-left transition disabled:opacity-50 ${role === r ? "border-violet-400/60 bg-violet-500/10 ring-1 ring-violet-400/30" : "border-ink/10 hover:border-ink/20"}`}
          >
            <div className="flex items-center justify-between">
              <RoleBadge role={r} />
              {role === r && <Check className="h-4 w-4 text-violet-300" />}
            </div>
            <p className="mt-2 text-xs text-slate-400">{ROLE_INFO[r].description}</p>
          </button>
        ))}
      </div>
      <input name="note" maxLength={120} disabled={readOnly} placeholder="Note (optional), e.g. interview reviewer" className="glass w-full rounded-xl px-3.5 py-2 text-sm placeholder:text-slate-500 focus:outline-none disabled:opacity-50" />
      {state && !state.ok && <p className="text-sm text-red-400">{state.message}</p>}
    </form>
  );
}

/** Role dropdown + suspend + reset for one user row. */
export function UserActions({ userId, email, role, suspended, isSelf, readOnly }: { userId: string; email: string; role: AppRole; suspended: boolean; isSelf: boolean; readOnly: boolean }) {
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState<null | "reset" | "suspend">(null);
  const locked = readOnly || isSelf;

  const changeRole = (next: AppRole) =>
    start(async () => {
      const fd = new FormData();
      fd.set("email", email);
      fd.set("role", next);
      report(await assignRole(null, fd), "Role updated");
    });

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <select
        value={role}
        disabled={locked || pending}
        onChange={(e) => changeRole(e.target.value as AppRole)}
        aria-label={`Role for ${email}`}
        className="glass rounded-lg px-2 py-1.5 text-xs focus:outline-none disabled:opacity-50"
        title={isSelf ? "You can't change your own role" : undefined}
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_INFO[r].label}
          </option>
        ))}
      </select>

      {confirm ? (
        <span className="flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
          {confirm === "reset" ? "Reset holdings & cash?" : suspended ? "Restore access?" : "Suspend & sign out?"}
          <button
            disabled={pending}
            onClick={() =>
              start(async () => {
                report(confirm === "reset" ? await resetAccount(userId) : await setSuspended(userId, !suspended), "Done");
                setConfirm(null);
              })
            }
            className="rounded px-1.5 py-0.5 font-medium text-amber-200 hover:bg-amber-500/20"
          >
            Yes
          </button>
          <button onClick={() => setConfirm(null)} className="rounded px-1.5 py-0.5 hover:bg-amber-500/20">
            No
          </button>
        </span>
      ) : (
        <>
          <button
            disabled={locked || pending}
            onClick={() => setConfirm("suspend")}
            title={suspended ? "Restore access" : "Suspend"}
            aria-label={suspended ? `Restore ${email}` : `Suspend ${email}`}
            className={`rounded-lg p-1.5 transition disabled:opacity-30 ${suspended ? "text-emerald-300 hover:bg-emerald-500/10" : "text-slate-400 hover:bg-red-500/10 hover:text-red-400"}`}
          >
            {suspended ? <ShieldCheck className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
          </button>
          <button
            disabled={readOnly || pending}
            onClick={() => setConfirm("reset")}
            title="Reset account"
            aria-label={`Reset ${email}`}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-amber-500/10 hover:text-amber-300 disabled:opacity-30"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  );
}

export function RemoveAssignmentButton({ email, readOnly }: { email: string; readOnly: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button
      disabled={readOnly || pending}
      onClick={() => start(async () => report(await removeAssignment(email), "Removed"))}
      aria-label={`Remove pending role for ${email}`}
      className="rounded-lg p-1.5 text-slate-500 transition hover:bg-red-500/10 hover:text-red-400 disabled:opacity-30"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

type Settings = { maxOrderValue: number; maxSharesPerOrder: number; startingCash: number; tradingEnabled: boolean; aiEnabled: boolean };

function Switch({ name, defaultChecked, disabled, label, hint }: { name: string; defaultChecked: boolean; disabled: boolean; label: string; hint: string }) {
  const [on, setOn] = useState(defaultChecked);
  return (
    <label className={`flex items-start justify-between gap-4 rounded-xl border border-ink/10 p-4 ${disabled ? "opacity-60" : "cursor-pointer hover:border-ink/20"}`}>
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-slate-400">{hint}</span>
      </span>
      <input type="checkbox" name={name} checked={on} disabled={disabled} onChange={(e) => setOn(e.target.checked)} className="peer sr-only" />
      <span aria-hidden className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-emerald-500" : "bg-slate-600"} peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-400`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
      </span>
    </label>
  );
}

export function PlatformSettingsForm({ settings, readOnly }: { settings: Settings; readOnly: boolean }) {
  const [, action, pending] = useActionState(async (prev: ActionResult, fd: FormData) => {
    const res = await updateSettings(prev, fd);
    report(res, "Settings saved");
    return res;
  }, null);
  const field = (name: keyof Settings, label: string, hint: string, prefix?: string) => (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <span className="mt-1 flex items-center rounded-xl border border-ink/10 bg-ink/[0.03] focus-within:border-emerald-400/50">
        {prefix && <span className="pl-3 text-sm text-slate-500">{prefix}</span>}
        <input
          name={name}
          type="number"
          min={1}
          step={1}
          required
          disabled={readOnly}
          defaultValue={settings[name] as number}
          className="w-full bg-transparent px-3 py-2.5 text-sm tabular-nums focus:outline-none disabled:opacity-60"
        />
      </span>
      <span className="mt-1 block text-xs text-slate-500">{hint}</span>
    </label>
  );
  return (
    <form action={action} className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        {field("maxOrderValue", "Max order value", "Largest single order allowed.", "$")}
        {field("maxSharesPerOrder", "Max shares per order", "Also limits what the AI can propose.")}
        {field("startingCash", "Starting cash", "For new accounts and account resets.", "$")}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Switch name="tradingEnabled" defaultChecked={settings.tradingEnabled} disabled={readOnly} label="Trading enabled" hint="Off = nobody can place trades (UI or chat)." />
        <Switch name="aiEnabled" defaultChecked={settings.aiEnabled} disabled={readOnly} label="AI features enabled" hint="Off = chat, news sentiment and reviews are paused." />
      </div>
      {!readOnly && (
        <button disabled={pending} className="rounded-xl bg-gradient-to-r from-emerald-500 to-sky-500 px-5 py-2.5 text-sm font-medium text-white shadow-lg transition hover:brightness-110 disabled:opacity-50">
          {pending ? "Saving…" : "Save settings"}
        </button>
      )}
    </form>
  );
}

export function ResendInvitationButton({ email, readOnly }: { email: string; readOnly: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button
      disabled={readOnly || pending}
      onClick={() => start(async () => report(await resendInvitation(email), "Invitation sent"))}
      title="Send the invitation email again"
      className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-400 transition hover:bg-ink/5 hover:text-slate-50 disabled:opacity-30"
    >
      <Send className="h-3.5 w-3.5" /> {pending ? "Sending…" : "Resend"}
    </button>
  );
}

export function RetryEmailButton({ id, readOnly }: { id: string; readOnly: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button
      disabled={readOnly || pending}
      onClick={() => start(async () => report(await retryEmail(id), "Sent"))}
      className="rounded-lg px-2 py-1 text-xs text-sky-300 transition hover:bg-sky-500/10 disabled:opacity-30"
    >
      {pending ? "Sending…" : "Retry"}
    </button>
  );
}
