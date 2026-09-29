import { BellRing, BellPlus, History } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertDeleteButton } from "@/components/AlertDeleteButton";
import { AlertForm } from "@/components/AlertForm";
import { Card, PageHeader } from "@/components/ui";
import { listAlerts } from "@/lib/alerts";
import { currentActor } from "@/lib/authz";
import { money } from "@/lib/format";

export default async function AlertsPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  const alerts = await listAlerts(actor.id);
  const active = alerts.filter((a) => a.active);
  const fired = alerts.filter((a) => !a.active);

  return (
    <div className="space-y-6">
      <PageHeader title="Price alerts" subtitle="Get notified when a stock crosses your target price" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="New alert" subtitle="Any US or Indian stock" icon={BellPlus} tone="amber">
          <AlertForm />
        </Card>

        <Card className="lg:col-span-2" title={`Active alerts (${active.length})`} subtitle="Distance shows how far the price must move to fire" icon={BellRing} tone="emerald">
          {active.length === 0 ? (
            <p className="text-sm text-slate-400">No active alerts. Create one here, from any stock page, or ask the AI: “alert me when TSLA drops below 200”.</p>
          ) : (
            <ul className="divide-y divide-ink/5">
              {active.map((a) => {
                const up = a.condition === "ABOVE";
                // How close the price is to the target (100% = there).
                const progress = a.currentPrice ? Math.max(4, Math.min(100, 100 - Math.abs(a.distancePct ?? 0) * 5)) : 0;
                return (
                  <li key={a.id} className="flex items-center gap-4 py-3">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm ${up ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300"}`}>{up ? "▲" : "▼"}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                        <Link href={`/stock/${encodeURIComponent(a.symbol)}`} className="font-semibold hover:underline">{a.symbol}</Link>
                        <span className="text-slate-400">{up ? "above" : "below"}</span>
                        <span className="font-medium tabular-nums">{money(a.targetPrice, a.currency)}</span>
                        {a.note && <span className="truncate text-xs text-slate-500">· {a.note}</span>}
                      </div>
                      <div className="mt-1.5 flex items-center gap-3 text-xs text-slate-500">
                        <span className="h-1.5 w-28 overflow-hidden rounded-full bg-ink/5">
                          <span className={`block h-full rounded-full ${up ? "bg-emerald-400" : "bg-red-400"}`} style={{ width: `${progress}%` }} />
                        </span>
                        {a.currentPrice !== null ? (
                          <span className="tabular-nums">
                            Now {money(a.currentPrice, a.currency)} · {Math.abs(a.distancePct ?? 0).toFixed(2)}% to go
                          </span>
                        ) : (
                          <span>Price unavailable</span>
                        )}
                      </div>
                    </div>
                    <AlertDeleteButton id={a.id} label={a.symbol} />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {fired.length > 0 && (
        <Card title="Triggered" subtitle="Alerts fire once, then turn off" icon={History} tone="slate">
          <ul className="divide-y divide-ink/5">
            {fired.map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="text-amber-300">🔔</span>
                <span className="min-w-0 flex-1">
                  <Link href={`/stock/${encodeURIComponent(a.symbol)}`} className="font-medium hover:underline">{a.symbol}</Link>{" "}
                  <span className="text-slate-400">{a.condition === "ABOVE" ? "rose above" : "fell below"}</span> {money(a.targetPrice, a.currency)}
                  {a.triggeredPrice !== null && <span className="text-slate-500"> at {money(a.triggeredPrice, a.currency)}</span>}
                </span>
                <span className="text-xs text-slate-500">{a.triggeredAt ? new Date(a.triggeredAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}</span>
                <AlertDeleteButton id={a.id} label={a.symbol} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
