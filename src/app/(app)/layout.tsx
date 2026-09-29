import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { ChatWidget } from "@/components/ChatWidget";
import { MarketTicker } from "@/components/MarketTicker";
import { NotificationBell } from "@/components/NotificationBell";
import { SearchBox } from "@/components/SearchBox";
import { Logo, MobileNav, Sidebar } from "@/components/Sidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Toaster } from "@/components/Toaster";
import { CurrencyProvider, CurrencyToggle } from "@/components/CurrencyProvider";
import { inCcy } from "@/lib/display-currency";
import { getDisplayCurrency } from "@/lib/display-currency-server";
import { getMarketOverview } from "@/lib/market";
import { marketStatus } from "@/lib/market-hours";
import { prisma } from "@/lib/prisma";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user;
  const [overview, account, currency] = await Promise.all([
    getMarketOverview().catch(() => []),
    prisma.user.findUnique({ where: { id: user.id }, select: { cashBalance: true } }),
    getDisplayCurrency(),
  ]);
  const markets = marketStatus();

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <CurrencyProvider value={currency}>
    <div className="flex min-h-dvh text-slate-100">
      <div className="app-backdrop" aria-hidden />
      <Sidebar user={user} signOutAction={signOutAction} cashLabel={inCcy(Number(account?.cashBalance ?? 0), currency)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-ink/5 bg-surface-0/75 backdrop-blur-xl">
          <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
            <div className="lg:hidden">
              <Logo compact />
            </div>
            <div className="min-w-0 flex-1">
              <SearchBox />
            </div>
            <div className="hidden items-center gap-2 md:flex">
              {markets.map((m) => (
                <span key={m.id} className="glass flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-slate-300">
                  <span className={`h-1.5 w-1.5 rounded-full ${m.open ? "animate-pulse bg-emerald-400" : "bg-slate-500"}`} />
                  {m.label} {m.open ? "open" : "closed"}
                </span>
              ))}
            </div>
            <CurrencyToggle />
            <NotificationBell />
            <ThemeToggle />
            {user.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.image} alt="" className="h-8 w-8 rounded-full ring-2 ring-ink/10 lg:hidden" referrerPolicy="no-referrer" />
            )}
          </div>
          <MarketTicker initial={overview} />
        </header>

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-28 pt-6 sm:px-6 lg:pb-10">{children}</main>

        <footer className="hidden border-t border-ink/5 px-6 py-4 text-center text-xs text-slate-600 lg:block">
          Virtual trading only, no real money. Market data may be delayed. Not financial advice.
        </footer>
      </div>

      <MobileNav />
      <ChatWidget />
      <Toaster />
    </div>
    </CurrencyProvider>
  );
}
