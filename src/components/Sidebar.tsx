"use client";

import { BarChart3, BellRing, Bot, Briefcase, LayoutDashboard, LogOut, Settings, ShieldHalf } from "lucide-react";
import { AssistantMark } from "@/components/AssistantMark";
import { can } from "@/lib/rbac";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/markets", label: "Markets", icon: BarChart3 },
  { href: "/portfolio", label: "Portfolio", icon: Briefcase },
  { href: "/assistant", label: "AI Assistant", icon: AssistantMark },
  { href: "/agent", label: "Auto-Trader", icon: Bot },
];

// Desktop only; on mobile the bell in the top bar links to alerts.
const ALERTS_NAV = { href: "/alerts", label: "Price alerts", icon: BellRing };
const ADMIN_NAV = { href: "/admin", label: "Admin", icon: ShieldHalf };
const SETTINGS_NAV = { href: "/settings", label: "Settings", icon: Settings };

export const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 font-semibold">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 via-sky-500 to-violet-500 shadow-lg shadow-emerald-500/20">
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth="2.4">
          <path d="M3 17l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M14 7h7v7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {!compact && (
        <span className="leading-tight">
          Stock Analyzer
          <span className="block text-[10px] font-normal uppercase tracking-[0.18em] text-slate-500">AI trading lab</span>
        </span>
      )}
    </Link>
  );
}

type User = { name?: string | null; email?: string | null; image?: string | null; role?: string };

export function Sidebar({ user, signOutAction, cashLabel }: { user: User; signOutAction: () => Promise<void>; cashLabel: string }) {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-ink/5 bg-surface-1/70 px-4 py-5 backdrop-blur-xl lg:flex">
      <div className="px-2">
        <Logo />
      </div>

      <nav className="mt-8 space-y-1" aria-label="Main">
        <div className="px-3 pb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-600">Menu</div>
        {[...NAV, ALERTS_NAV, ...(can(user.role, "admin.view") ? [ADMIN_NAV] : []), SETTINGS_NAV].map(({ href, label, icon: Icon }, i, all) => {
          const active = isActive(pathname, href);
          const firstAccount = i === NAV.length + 1 && all.length > NAV.length + 1;
          return (
            <div key={href}>
              {firstAccount && <div className="px-3 pb-2 pt-5 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-600">Account</div>}
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
                active ? "bg-ink/[0.06] text-slate-50" : "text-slate-400 hover:bg-ink/[0.03] hover:text-slate-100"
              }`}
            >
              {active && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-gradient-to-b from-emerald-400 to-sky-400" />}
              <Icon className={`h-4.5 w-4.5 ${active ? "text-emerald-300" : "text-slate-500 group-hover:text-slate-300"}`} />
              {label}
              {href === "/agent" && <span className="ml-auto rounded-md bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-300">New</span>}
              {href === "/assistant" && <span className="ml-auto rounded-md bg-gradient-to-r from-emerald-500/20 to-sky-500/20 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">AI</span>}
              {href === "/admin" && user.role === "AUDITOR" && <span className="ml-auto rounded-md bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">Read-only</span>}
            </Link>
            </div>
          );
        })}
      </nav>

      <div className="glass mt-8 rounded-2xl p-4">
        <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">Buying power</div>
        <div className="mt-1 text-lg font-semibold tabular-nums">{cashLabel}</div>
        <p className="mt-1 text-xs text-slate-500">Virtual money for practice</p>
      </div>

      <div className="mt-auto flex items-center gap-3 rounded-2xl border border-ink/5 bg-ink/[0.02] p-3">
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.image} alt="" className="h-9 w-9 rounded-full ring-2 ring-ink/10" referrerPolicy="no-referrer" />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-700 text-sm">{user.name?.[0] ?? "?"}</span>
        )}
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-medium">{user.name}</div>
          <div className="truncate text-[11px] text-slate-500">{user.email}</div>
        </div>
        <form action={signOutAction}>
          <button aria-label="Sign out" title="Sign out" className="rounded-lg p-2 text-slate-500 hover:bg-ink/5 hover:text-slate-50">
            <LogOut className="h-4 w-4" />
          </button>
        </form>
      </div>
    </aside>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-ink/5 bg-surface-1/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
    >
      {[...NAV, SETTINGS_NAV].map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`flex flex-col items-center gap-1 py-2.5 text-[11px] ${active ? "text-emerald-300" : "text-slate-500"}`}>
            <Icon className="h-5 w-5" />
            {label.replace("AI Assistant", "AI").replace("Auto-Trader", "Agent").replace("Dashboard", "Home")}
          </Link>
        );
      })}
    </nav>
  );
}
