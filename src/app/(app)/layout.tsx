import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { NavLinks } from "@/components/NavLinks";
import { SearchBox } from "@/components/SearchBox";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user;

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 17l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M14 7h7v7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            Stock Analyzer
          </Link>
          <NavLinks />
          <div className="ml-auto flex flex-1 items-center justify-end gap-3 sm:flex-none">
            <SearchBox />
            {user.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.image} alt="" className="h-8 w-8 rounded-full" referrerPolicy="no-referrer" />
            )}
            <div className="hidden whitespace-nowrap text-right leading-tight lg:block">
              <div className="text-sm">{user.name}</div>
              <div className="text-xs text-slate-500">{user.role}</div>
            </div>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button className="whitespace-nowrap rounded-lg border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>
      <footer className="border-t border-slate-800 px-4 py-4 text-center text-xs text-slate-500">
        Paper trading only. No real money is used. Market data from Yahoo Finance, may be delayed. Not financial advice.
      </footer>
    </div>
  );
}
