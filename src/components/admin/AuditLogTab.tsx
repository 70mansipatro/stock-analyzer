import { Download, Filter, ScrollText, ShieldAlert, Activity, Users, KeyRound, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { StackedBars } from "@/components/admin/AdminCharts";
import { Card, Stat } from "@/components/ui";
import { AUDIT_CATEGORIES, auditLogPage, CATEGORY_KEYS, RANGES, type AuditCategory, type AuditFilters } from "@/lib/audit-log";

const CAT_STYLE: Record<AuditCategory | "other", string> = {
  auth: "bg-sky-500/10 text-sky-300",
  admin: "bg-violet-500/10 text-violet-300",
  trading: "bg-emerald-500/10 text-emerald-300",
  ai: "bg-amber-500/10 text-amber-300",
  security: "bg-rose-500/10 text-rose-300",
  other: "bg-slate-500/10 text-slate-300",
};

const input = "rounded-xl border border-ink/10 bg-ink/[0.04] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-400/60 focus:outline-none";

function qs(f: AuditFilters, patch: Partial<AuditFilters>) {
  const n = { ...f, ...patch };
  const p = new URLSearchParams({ tab: "audit", range: n.range });
  if (n.category) p.set("cat", n.category);
  if (n.event) p.set("event", n.event);
  if (n.user) p.set("user", n.user);
  if (n.page > 1) p.set("page", String(n.page));
  return `?${p}`;
}

/** One-line summary of an event's detail, e.g. "symbol: AAPL · side: BUY · quantity: 3". */
function summary(detail: Record<string, unknown> | null) {
  if (!detail) return "";
  return Object.entries(detail)
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
    .slice(0, 5)
    .map(([k, v]) => `${k}: ${String(v).slice(0, 60)}`)
    .join(" · ");
}

export async function AuditLogTab({ filters }: { filters: AuditFilters }) {
  const d = await auditLogPage(filters);
  const exportHref = `/api/admin/audit${qs(filters, { page: 1 }).replace("tab=audit&", "")}`;

  return (
    <>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat label={`Events (${RANGES.find((r) => r.id === filters.range)?.label})`} icon={Activity} tone="violet" value={d.stats.events.toLocaleString()} />
        <Stat label="Users involved" icon={Users} tone="sky" value={d.stats.users} />
        <Stat label="Security events" icon={ShieldAlert} tone="rose" value={d.stats.security} sub={<span className="text-slate-500">Blocks, forged approvals, failures</span>} />
        <Stat label="Failed sign-ins" icon={KeyRound} tone="amber" value={d.stats.failedSignIns} sub={<span className="text-slate-500">Wrong email codes</span>} />
      </div>

      <Card title="Filters" icon={Filter} tone="violet">
        <form method="get" action="/admin" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="tab" value="audit" />
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Period
            <select name="range" defaultValue={filters.range} className={input}>
              {RANGES.map((r) => (
                <option key={r.id} value={r.id}>Last {r.label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Category
            <select name="cat" defaultValue={filters.category ?? ""} className={input}>
              <option value="">All categories</option>
              {CATEGORY_KEYS.map((k) => (
                <option key={k} value={k}>{AUDIT_CATEGORIES[k].label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Event
            <select name="event" defaultValue={filters.event ?? ""} className={input}>
              <option value="">All events</option>
              {d.events.map((e) => (
                <option key={e} value={e}>{e.replace(/_/g, " ")}</option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-xs text-slate-400">
            User
            <input name="user" defaultValue={filters.user ?? ""} placeholder="Name or email" className={input} />
          </label>
          <button className="rounded-xl bg-violet-500/90 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500">Apply</button>
          <Link href="/admin?tab=audit" className="rounded-xl px-3 py-2 text-sm text-slate-400 hover:text-slate-100">Reset</Link>
          <a href={exportHref} className="ml-auto flex items-center gap-2 rounded-xl border border-ink/10 px-3 py-2 text-sm text-slate-300 hover:border-ink/25 hover:text-slate-50">
            <Download className="h-4 w-4" /> Export CSV
          </a>
        </form>
      </Card>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Activity per day" subtitle="Events by category" icon={Activity} tone="violet">
          <StackedBars data={d.series} series={CATEGORY_KEYS.map((k) => ({ key: k, label: AUDIT_CATEGORIES[k].label }))} height={260} />
        </Card>
        <Card title="Most frequent events" icon={ScrollText} tone="sky">
          {d.topEvents.length === 0 ? (
            <p className="text-sm text-slate-400">No events in this period.</p>
          ) : (
            <ul className="space-y-3">
              {d.topEvents.map((t) => (
                <li key={t.event}>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <Link href={qs(filters, { event: t.event, category: undefined, page: 1 })} className="truncate hover:underline">
                      {t.event.replace(/_/g, " ")}
                    </Link>
                    <span className="tabular-nums text-slate-400">{t.count}</span>
                  </div>
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-ink/5">
                    <span className="block h-full rounded-full bg-gradient-to-r from-violet-500 to-sky-500" style={{ width: `${(t.count / d.topEvents[0].count) * 100}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={`Events (${d.total.toLocaleString()})`} subtitle="Newest first. Click a row to see the full record." icon={ScrollText} tone="slate">
        {d.rows.length === 0 ? (
          <p className="text-sm text-slate-400">No events match these filters.</p>
        ) : (
          <ul className="divide-y divide-ink/5">
            {d.rows.map((r) => (
              <li key={r.id}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm hover:bg-ink/[0.02]">
                    <time dateTime={r.at} className="w-36 shrink-0 tabular-nums text-xs text-slate-500" title={r.at}>
                      {new Date(r.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </time>
                    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${CAT_STYLE[r.category]}`}>{r.event.replace(/_/g, " ")}</span>
                    <span className="min-w-0 max-w-[16rem] truncate">
                      {r.user ?? <span className="text-slate-500">{r.email ? "" : "System / anonymous"}</span>}
                      {r.email && <span className="ml-1 text-xs text-slate-500">{r.email}</span>}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{summary(r.detail)}</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-600 transition group-open:rotate-90" />
                  </summary>
                  <pre className="mb-3 overflow-x-auto rounded-xl bg-ink/[0.04] p-3 text-xs leading-relaxed text-slate-300">
                    {JSON.stringify({ id: r.id, time: r.at, event: r.event, user: r.email, detail: r.detail }, null, 2)}
                  </pre>
                </details>
              </li>
            ))}
          </ul>
        )}
        {d.pages > 1 && (
          <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
            {filters.page > 1 ? (
              <Link href={qs(filters, { page: filters.page - 1 })} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-slate-300 hover:bg-ink/5">
                <ChevronLeft className="h-4 w-4" /> Newer
              </Link>
            ) : (
              <span />
            )}
            <span className="text-xs text-slate-500">
              Page {filters.page} of {d.pages}
            </span>
            {filters.page < d.pages ? (
              <Link href={qs(filters, { page: filters.page + 1 })} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-slate-300 hover:bg-ink/5">
                Older <ChevronRight className="h-4 w-4" />
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </Card>
    </>
  );
}
