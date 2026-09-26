import { Check, Palette, ShieldCheck, SlidersHorizontal, UserRound, X } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PlatformSettingsForm, ReadOnlyBanner, RoleBadge } from "@/components/admin/AdminControls";
import { ThemePicker } from "@/components/ThemeToggle";
import { Card, PageHeader } from "@/components/ui";
import { currentActor } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { can, ROLE_INFO, type Permission } from "@/lib/rbac";
import { getSettings } from "@/lib/settings";

const PERMS: { id: Permission; label: string }[] = [
  { id: "trade", label: "Place paper trades" },
  { id: "ai.chat", label: "Use the AI assistant" },
  { id: "ai.review", label: "Run AI portfolio reviews" },
  { id: "admin.view", label: "Open the admin console (read-only)" },
  { id: "admin.manage", label: "Manage roles, users and platform settings" },
];

export default async function SettingsPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  const [user, settings] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: { image: true, createdAt: true, lastLoginAt: true } }),
    getSettings(),
  ]);
  const showPlatform = can(actor.role, "admin.view");
  const readOnly = !can(actor.role, "admin.manage");

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle="Appearance, your account and platform controls" />

      <Card title="Appearance" subtitle="Choose how Stock Analyzer looks on this device" icon={Palette} tone="violet">
        <ThemePicker />
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Account" icon={UserRound} tone="emerald">
          <div className="flex items-center gap-4">
            {user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.image} alt="" className="h-14 w-14 rounded-2xl ring-2 ring-ink/10" referrerPolicy="no-referrer" />
            ) : (
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-ink/10 text-xl">{(actor.name ?? actor.email)[0]}</span>
            )}
            <div className="min-w-0">
              <div className="truncate text-lg font-semibold">{actor.name}</div>
              <div className="truncate text-sm text-slate-400">{actor.email}</div>
              <div className="mt-1.5">
                <RoleBadge role={actor.role} />
              </div>
            </div>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl border border-ink/10 p-3">
              <dt className="text-xs text-slate-500">Member since</dt>
              <dd className="mt-0.5">{user.createdAt.toLocaleDateString("en-US", { dateStyle: "medium" })}</dd>
            </div>
            <div className="rounded-xl border border-ink/10 p-3">
              <dt className="text-xs text-slate-500">Signed in with</dt>
              <dd className="mt-0.5">Google SSO</dd>
            </div>
          </dl>
        </Card>

        <Card title={`Your role: ${ROLE_INFO[actor.role].label}`} subtitle={ROLE_INFO[actor.role].description} icon={ShieldCheck} tone="sky">
          <ul className="space-y-2">
            {PERMS.map((p) => {
              const ok = can(actor.role, p.id);
              return (
                <li key={p.id} className="flex items-center gap-3 text-sm">
                  <span className={`flex h-6 w-6 items-center justify-center rounded-lg ${ok ? "bg-emerald-500/15 text-emerald-300" : "bg-ink/5 text-slate-500"}`}>
                    {ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                  </span>
                  <span className={ok ? "" : "text-slate-500"}>{p.label}</span>
                </li>
              );
            })}
          </ul>
          {showPlatform ? (
            <Link href="/admin" className="mt-5 inline-block text-sm text-sky-300 hover:underline">
              Open the admin console →
            </Link>
          ) : (
            <p className="mt-5 text-xs text-slate-500">Roles are managed by an admin. Ask one if you need more access.</p>
          )}
        </Card>
      </div>

      {showPlatform && (
        <div id="platform" className="scroll-mt-24 space-y-4">
          {readOnly && <ReadOnlyBanner />}
          <Card
            title="Platform settings"
            subtitle={settings.updatedAt ? `Applies to every user · last changed ${new Date(settings.updatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}` : "Applies to every user · using defaults"}
            icon={SlidersHorizontal}
            tone="amber"
          >
            <PlatformSettingsForm settings={settings} readOnly={readOnly} />
          </Card>
        </div>
      )}
    </div>
  );
}
