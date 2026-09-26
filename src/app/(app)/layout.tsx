import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { ChatWidget } from "@/components/ChatWidget";
import { MarketTicker } from "@/components/MarketTicker";
import { SearchBox } from "@/components/SearchBox";
import { Logo, MobileNav, Sidebar } from "@/components/Sidebar";
import { Toaster } from "@/components/Toaster";
import { money } from "@/lib/format";
import { getMarketOverview } from "@/lib/market";
import { marketStatus } from "@/lib/market-hours";
import { prisma } from "@/lib/prisma";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user;
  const [overview, account] = await Promise.all([
    getMarketOverview().catch(() => []),
    prisma.user.findUnique({ where: { id: user.id }, select: { cashBalance: true } }),
  ]);
  const markets = marketStatus();

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="flex min-h-dvh text-slate-100">
      <div className="app-backdrop" aria-hidden />
      <Sidebar user={user} signOutAction={signOutAction} cashLabel={money(Number(account?.cashBalance ?? 0))} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-white/5 bg-[#04060d]/75 backdrop-blur-xl">
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
            {user.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.image} alt="" className="h-8 w-8 rounded-full ring-2 ring-white/10 lg:hidden" referrerPolicy="no-referrer" />
            )}
          </div>
          <MarketTicker initial={overview} />
        </header>

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-28 pt-6 sm:px-6 lg:pb-10">{children}</main>

        <footer className="hidden border-t border-white/5 px-6 py-4 text-center text-xs text-slate-600 lg:block">
          Paper trading only. No real money is used. Market data from Yahoo Finance, may be delayed. Not financial advice.
        </footer>
      </div>

      <MobileNav />
      <ChatWidget />
      <Toaster />
    </div>
  );
}
