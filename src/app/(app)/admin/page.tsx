import { Activity, Bot, Coins, LayoutDashboard, ShieldAlert, ShieldCheck, Sparkles, UserCog, Users } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AssignRoleForm, ReadOnlyBanner, RemoveAssignmentButton, RoleBadge, UserActions } from "@/components/admin/AdminControls";
import { StackedBars } from "@/components/admin/AdminCharts";
import { Change } from "@/components/Change";
import { Card, PageHeader, Stat } from "@/components/ui";
import { aiUsageStats, guardrailStats, listAssignments, listUsers, tradingStats } from "@/lib/admin";
import { currentActor } from "@/lib/authz";
import { money } from "@/lib/format";
import { can, ROLE_INFO, ROLES, type AppRole } from "@/lib/rbac";

const TABS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "users", label: "Users & roles", icon: Users },
  { id: "guardrails", label: "Guardrails", icon: ShieldAlert },
  { id: "trading", label: "Trading", icon: Coins },
  { id: "ai", label: "AI usage", icon: Bot },
] as const;
type Tab = (typeof TABS)[number]["id"];

const GUARD_LABEL: Record<string, string> = {
  prompt_injection: "Prompt injection",
  off_topic: "Off-topic",
  harmful: "Harmful",
  rate_limited: "Rate limited",
  too_long: "Too long",
  approval_forged: "Forged approval",
  output_filtered: "Output rewritten",
  trade_denied: "Trade denied",
};

const ago = (iso: string | null) => {
  if (!iso) return "Never";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const actor = await currentActor();
  if (!actor || !can(actor.role, "admin.view")) redirect("/");
  const readOnly = !can(actor.role, "admin.manage");
  const { tab: rawTab } = await searchParams;
  const tab: Tab = TABS.some((t) => t.id === rawTab) ? (rawTab as Tab) : "overview";

  const [users, guard, trading, ai, assignments] = await Promise.all([
    listUsers(),
    guardrailStats(),
    tradingStats(),
    aiUsageStats(),
    tab === "users" ? listAssignments() : Promise.resolve([]),
  ]);
  const roleCounts = ROLES.map((r) => ({ role: r, n: users.filter((u) => u.role === r).length }));
  const pending = assignments.filter((a) => !a.joined);

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            Admin console <RoleBadge role={actor.role} />
          </span>
        }
        subtitle="Users, roles, guardrails, trading and AI usage across the whole platform"
      >
        <Link href="/settings#platform" className="glass flex items-center gap-2 rounded-xl px-4 py-2 text-sm transition hover:border-ink/20">
          <UserCog className="h-4 w-4 text-violet-300" /> Platform settings
        </Link>
      </PageHeader>

      {readOnly && <ReadOnlyBanner />}

      <nav className="glass flex gap-1 overflow-x-auto rounded-2xl p-1.5" aria-label="Admin sections">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/admin?tab=${t.id}`}
            aria-current={t.id === tab ? "page" : undefined}
            className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-sm transition ${t.id === tab ? "bg-surface-1 text-slate-50 shadow-sm" : "text-slate-400 hover:text-slate-100"}`}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </Link>
        ))}
      </nav>

      {tab === "overview" && (
        <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Stat label="Users" icon={Users} tone="violet" value={users.length} sub={<span className="text-slate-500">{users.filter((u) => u.suspended).length} suspended</span>} />
            <Stat label="Guardrail blocks (14d)" icon={ShieldAlert} tone="rose" value={guard.blockedTotal} sub={<span className="text-slate-500">{guard.forged} forged approvals</span>} />
            <Stat label="Paper volume (all time)" icon={Coins} tone="emerald" value={money(trading.totalVolume)} sub={<span className="text-slate-500">{trading.totalTrades} trades · {trading.activeTraders} traders</span>} />
            <Stat label="AI chats (14d)" icon={Sparkles} tone="sky" value={ai.chats} sub={<span className="text-slate-500">{ai.reviews} portfolio reviews</span>} />
          </div>
          <div className="grid gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2" title="Guardrail blocks" subtitle="Blocked chat messages per day, by reason" icon={ShieldAlert} tone="rose">
              <StackedBars data={guard.series} series={Object.keys(guard.totals).map((k) => ({ key: k, label: GUARD_LABEL[k] }))} />
            </Card>
            <Card title="Roles" subtitle="Accounts per role" icon={UserCog} tone="violet">
              <ul className="space-y-3">
                {roleCounts.map((r) => (
                  <li key={r.role} className="flex items-center gap-3">
                    <RoleBadge role={r.role} />
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-ink/5">
                      <span className="block h-full rounded-full bg-gradient-to-r from-violet-500 to-sky-500" style={{ width: `${users.length ? (r.n / users.length) * 100 : 0}%` }} />
                    </span>
                    <span className="w-6 text-right text-sm tabular-nums">{r.n}</span>
                  </li>
                ))}
              </ul>
              <Link href="/admin?tab=users" className="mt-5 inline-block text-xs text-violet-300 hover:underline">
                Manage users & roles →
              </Link>
            </Card>
          </div>
          <div className="grid gap-6 xl:grid-cols-2">
            <Card title="Paper trading volume" subtitle="Buys vs sells per day (USD)" icon={Coins} tone="emerald">
              <StackedBars data={trading.series} series={[{ key: "buy", label: "Buys" }, { key: "sell", label: "Sells" }]} money />
            </Card>
            <Card title="AI usage" subtitle="Chat messages and portfolio reviews per day" icon={Bot} tone="sky">
              <StackedBars data={ai.series} series={[{ key: "chats", label: "Chat messages" }, { key: "reviews", label: "Portfolio reviews" }]} />
            </Card>
          </div>
        </>
      )}

      {tab === "users" && (
        <>
          <Card title="Assign a role by email" subtitle="Works for existing users (applies now) and new people (applies on first sign-in)" icon={UserCog} tone="violet">
            <AssignRoleForm readOnly={readOnly} />
          </Card>

          {pending.length > 0 && (
            <Card title={`Pending invitations (${pending.length})`} subtitle="Roles waiting for these people to sign in" icon={Activity} tone="amber">
              <ul className="divide-y divide-ink/5">
                {pending.map((a) => (
                  <li key={a.email} className="flex items-center gap-3 py-2.5 text-sm">
                    <span className="min-w-0 flex-1 truncate">{a.email}</span>
                    {a.note && <span className="hidden truncate text-xs text-slate-500 md:block">{a.note}</span>}
                    <RoleBadge role={a.role as AppRole} />
                    <RemoveAssignmentButton email={a.email} readOnly={readOnly} />
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title={`All users (${users.length})`} icon={Users} tone="emerald">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr>
                    <th className="pb-2 font-normal">User</th>
                    <th className="pb-2 font-normal">Role</th>
                    <th className="pb-2 text-right font-normal">Cash</th>
                    <th className="pb-2 text-right font-normal">Portfolio</th>
                    <th className="pb-2 text-right font-normal">Trades</th>
                    <th className="pb-2 font-normal">Last login</th>
                    <th className="pb-2 text-right font-normal">{readOnly ? "" : "Actions"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/5">
                  {users.map((u) => (
                    <tr key={u.id} className={u.suspended ? "opacity-60" : ""}>
                      <td className="py-3">
                        <div className="flex items-center gap-3">
                          {u.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={u.image} alt="" className="h-8 w-8 rounded-full" referrerPolicy="no-referrer" />
                          ) : (
                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink/10 text-xs">{(u.name ?? u.email)[0].toUpperCase()}</span>
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 font-medium">
                              <span className="truncate">{u.name ?? "—"}</span>
                              {u.id === actor.id && <span className="rounded bg-ink/10 px-1.5 text-[10px] text-slate-400">You</span>}
                              {u.suspended && <span className="rounded bg-red-500/15 px-1.5 text-[10px] text-red-400">Suspended</span>}
                            </div>
                            <div className="truncate text-xs text-slate-500">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3">
                        <RoleBadge role={u.role as AppRole} />
                      </td>
                      <td className="py-3 text-right tabular-nums">{money(u.cash)}</td>
                      <td className="py-3 text-right tabular-nums">
                        {money(u.portfolioValue)}
                        <span className="block text-xs">
                          <Change percent={u.returnPct} />
                        </span>
                      </td>
                      <td className="py-3 text-right tabular-nums">{u.trades}</td>
                      <td className="py-3 text-slate-400">{ago(u.lastLoginAt)}</td>
                      <td className="py-3">
                        <UserActions userId={u.id} email={u.email} role={u.role as AppRole} suspended={u.suspended} isSelf={u.id === actor.id} readOnly={readOnly} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="What each role can do" icon={ShieldCheck} tone="sky">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {ROLES.map((r) => (
                <div key={r} className="rounded-xl border border-ink/10 p-4">
                  <RoleBadge role={r} />
                  <p className="mt-2 text-sm text-slate-400">{ROLE_INFO[r].description}</p>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {tab === "guardrails" && (
        <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Stat label="Blocked messages (14d)" icon={ShieldAlert} tone="rose" value={guard.blockedTotal} />
            <Stat label="Prompt injections" icon={ShieldAlert} tone="amber" value={guard.totals.prompt_injection} />
            <Stat label="Forged approvals" icon={ShieldCheck} tone="violet" value={guard.forged} sub={<span className="text-slate-500">Rejected by signature check</span>} />
            <Stat label="Output rewrites" icon={Sparkles} tone="sky" value={guard.outputRewrites} sub={<span className="text-slate-500">{guard.tradesDenied} trades auto-denied</span>} />
          </div>
          <Card title="Blocks per day by reason" icon={ShieldAlert} tone="rose">
            <StackedBars data={guard.series} series={Object.keys(guard.totals).map((k) => ({ key: k, label: GUARD_LABEL[k] }))} height={280} />
          </Card>
          <Card title="Recent guardrail events" subtitle="Latest 25 across all users" icon={Activity} tone="amber">
            {guard.recent.length === 0 ? (
              <p className="text-sm text-slate-400">No guardrail events yet.</p>
            ) : (
              <ul className="divide-y divide-ink/5">
                {guard.recent.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-3 text-sm">
                    <span className="rounded-md bg-red-500/10 px-2 py-0.5 text-xs text-red-400">{GUARD_LABEL[e.reason] ?? GUARD_LABEL[e.event] ?? e.reason}</span>
                    <span className="min-w-0 flex-1">
                      {e.text ? <span className="text-slate-200">“{e.text.slice(0, 160)}”</span> : <span className="text-slate-500">{e.event.replace(/_/g, " ")}</span>}
                      <span className="block text-xs text-slate-500">
                        {e.email} · {ago(e.at)}
                        {e.layer ? ` · caught by ${e.layer}` : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      {tab === "trading" && (
        <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
            <Stat label="Total paper volume" icon={Coins} tone="emerald" value={money(trading.totalVolume)} />
            <Stat label="Trades" icon={Activity} tone="sky" value={trading.totalTrades} />
            <Stat label="Active traders" icon={Users} tone="violet" value={trading.activeTraders} />
          </div>
          <div className="grid gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2" title="Volume per day" subtitle="Buys vs sells (USD)" icon={Coins} tone="emerald">
              <StackedBars data={trading.series} series={[{ key: "buy", label: "Buys" }, { key: "sell", label: "Sells" }]} money height={280} />
            </Card>
            <Card title="Most traded stocks" icon={Activity} tone="amber">
              {trading.topSymbols.length === 0 ? (
                <p className="text-sm text-slate-400">No trades yet.</p>
              ) : (
                <ul className="space-y-3">
                  {trading.topSymbols.map((t) => (
                    <li key={t.symbol}>
                      <div className="flex justify-between text-sm">
                        <Link href={`/stock/${encodeURIComponent(t.symbol)}`} className="font-medium hover:underline">
                          {t.symbol}
                        </Link>
                        <span className="tabular-nums text-slate-400">
                          {money(t.volume)} · {t.trades}
                        </span>
                      </div>
                      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-ink/5">
                        <span className="block h-full rounded-full bg-gradient-to-r from-emerald-500 to-sky-500" style={{ width: `${(t.volume / (trading.topSymbols[0].volume || 1)) * 100}%` }} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          <Card title="Latest trades (all users)" icon={Coins} tone="sky">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr>
                    <th className="pb-2 font-normal">When</th>
                    <th className="pb-2 font-normal">User</th>
                    <th className="pb-2 font-normal">Side</th>
                    <th className="pb-2 font-normal">Symbol</th>
                    <th className="pb-2 text-right font-normal">Shares</th>
                    <th className="pb-2 text-right font-normal">Total</th>
                    <th className="pb-2 text-right font-normal">Via</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/5">
                  {trading.recent.map((t) => (
                    <tr key={t.id}>
                      <td className="py-2.5 text-slate-400">{ago(t.at)}</td>
                      <td className="py-2.5">
                        {t.user}
                        <span className="block text-xs text-slate-500">{t.email}</span>
                      </td>
                      <td className="py-2.5">
                        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${t.side === "BUY" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>{t.side}</span>
                      </td>
                      <td className="py-2.5 font-medium">{t.symbol}</td>
                      <td className="py-2.5 text-right tabular-nums">{t.quantity}</td>
                      <td className="py-2.5 text-right tabular-nums">{money(t.total)}</td>
                      <td className="py-2.5 text-right text-xs text-slate-500">{t.source === "CHAT" ? "AI chat" : "App"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {tab === "ai" && (
        <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
            <Stat label="Chat messages (14d)" icon={Bot} tone="sky" value={ai.chats} />
            <Stat label="Portfolio reviews (14d)" icon={Sparkles} tone="violet" value={ai.reviews} />
            <Stat label="Active AI users (14d)" icon={Users} tone="emerald" value={ai.perUser.length} />
          </div>
          <Card title="AI requests per day" icon={Bot} tone="sky">
            <StackedBars data={ai.series} series={[{ key: "chats", label: "Chat messages" }, { key: "reviews", label: "Portfolio reviews" }]} height={280} />
          </Card>
          <Card title="Usage by user" subtitle="Chat messages sent to the assistant" icon={Users} tone="emerald">
            {ai.perUser.length === 0 ? (
              <p className="text-sm text-slate-400">No AI usage recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="text-left text-xs text-slate-500">
                    <tr>
                      <th className="pb-2 font-normal">User</th>
                      <th className="pb-2 text-right font-normal">Today</th>
                      <th className="pb-2 text-right font-normal">Last 7 days</th>
                      <th className="pb-2 text-right font-normal">Last 14 days</th>
                      <th className="pb-2 text-right font-normal">Reviews</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink/5">
                    {ai.perUser.map((u) => (
                      <tr key={u.email}>
                        <td className="py-2.5">
                          {u.user}
                          <span className="block text-xs text-slate-500">{u.email}</span>
                        </td>
                        <td className="py-2.5 text-right tabular-nums">{u.today}</td>
                        <td className="py-2.5 text-right tabular-nums">{u.week}</td>
                        <td className="py-2.5 text-right tabular-nums">{u.total}</td>
                        <td className="py-2.5 text-right tabular-nums">{u.reviews}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
