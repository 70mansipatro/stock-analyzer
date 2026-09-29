"use client";

import { Bell, BellRing, CheckCheck, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/lib/toast";

type Item = { id: string; kind: string; title: string; body: string | null; link: string | null; read: boolean; createdAt: string };

const POLL_MS = 30_000;

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};

/** Bell with unread count. Polls every 30s and pops a toast when a new alert fires. */
export function NotificationBell() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const seen = useRef<Set<string> | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { unread: number; items: Item[] };
      // Toast only items that arrived after the first load.
      if (seen.current) {
        const fresh = data.items.filter((i) => !i.read && !seen.current!.has(i.id));
        fresh.slice(0, 3).forEach((i) => toast("info", `🔔 ${i.title}`, i.body ?? undefined));
        if (fresh.length) router.refresh();
      }
      seen.current = new Set(data.items.map((i) => i.id));
      setItems(data.items);
      setUnread(data.unread);
    } catch {}
  }, [router]);

  useEffect(() => {
    // Deferred so the first fetch isn't a synchronous setState inside the effect.
    const first = setTimeout(load, 0);
    const t = setInterval(() => document.visibilityState === "visible" && load(), POLL_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(first);
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const mark = async (body: { ids?: string[]; all?: boolean }) => {
    setItems((xs) => xs.map((x) => (body.all || body.ids?.includes(x.id) ? { ...x, read: true } : x)));
    setUnread((u) => (body.all ? 0 : Math.max(0, u - (body.ids?.length ?? 0))));
    await fetch("/api/notifications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
  };

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        className="glass relative flex h-8 w-8 items-center justify-center rounded-full text-slate-300 transition hover:text-slate-50"
      >
        {unread ? <BellRing className="h-4 w-4 animate-[wiggle_1s_ease-in-out_2]" /> : <Bell className="h-4 w-4" />}
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">{unread > 9 ? "9+" : unread}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-80 overflow-hidden rounded-2xl border border-ink/10 bg-surface-2 shadow-2xl">
          <div className="flex items-center justify-between border-b border-ink/5 px-3 py-2">
            <span className="text-sm font-medium">Notifications</span>
            <span className="flex items-center gap-1">
              {unread > 0 && (
                <button onClick={() => mark({ all: true })} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-ink/5 hover:text-slate-100">
                  <CheckCheck className="h-3.5 w-3.5" /> Mark all read
                </button>
              )}
              <button onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1 text-slate-400 hover:bg-ink/5">
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">No notifications yet. Price alerts you set will show up here.</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto py-1">
              {items.map((n) => (
                <li key={n.id}>
                  <Link
                    href={n.link ?? "/alerts"}
                    onClick={() => {
                      if (!n.read) mark({ ids: [n.id] });
                      setOpen(false);
                    }}
                    className="flex gap-3 px-3 py-2.5 transition hover:bg-ink/5"
                  >
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-emerald-400"}`} />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm ${n.read ? "text-slate-400" : "text-slate-100"}`}>{n.title}</span>
                      {n.body && <span className="block truncate text-xs text-slate-500">{n.body}</span>}
                      <span className="block text-[11px] text-slate-600">{ago(n.createdAt)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link href="/alerts" onClick={() => setOpen(false)} className="block border-t border-ink/5 px-3 py-2 text-center text-xs text-emerald-400 hover:bg-ink/5">
            Manage price alerts →
          </Link>
        </div>
      )}
    </div>
  );
}
