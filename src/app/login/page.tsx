import { signIn } from "@/auth";
import { LocalLoginForm } from "@/components/LocalLoginForm";
import { MarketTicker } from "@/components/MarketTicker";
import { localLoginEnabled } from "@/lib/local-admin";
import { getMarketOverview } from "@/lib/market";

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied:
    "Access denied. While the app is in Testing mode, your Google account must be added as a test user.",
  Configuration: "Sign-in is misconfigured. Check the Google client ID and secret.",
  Suspended: "This account has been suspended by an administrator.",
};

function GoogleButton({ callbackUrl, large = false }: { callbackUrl?: string; large?: boolean }) {
  return (
    <form
      action={async () => {
        "use server";
        await signIn("google", { redirectTo: callbackUrl || "/" });
      }}
    >
      <button
        type="submit"
        className={`flex items-center justify-center gap-3 rounded-xl border border-[#dadce0] bg-[#ffffff] font-medium text-[#1f1f1f] shadow-lg shadow-emerald-500/10 transition hover:bg-[#f8fafd] focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-slate-950 ${
          large ? "w-full px-6 py-3.5 text-base" : "px-4 py-2 text-sm"
        }`}
      >
        <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
        </svg>
        {large ? "Continue with Google" : "Sign in"}
      </button>
    </form>
  );
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string; error?: string }> }) {
  const { callbackUrl, error } = await searchParams;
  const errorMessage = error ? (ERROR_MESSAGES[error] ?? "Sign-in failed. Please try again.") : null;
  const overview = await getMarketOverview().catch(() => []);

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-slate-950 text-slate-100 lg:h-dvh">
      {/* Background glow */}
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-[36rem] w-[60rem] -translate-x-1/2 rounded-full bg-gradient-to-r from-emerald-500/15 via-sky-500/10 to-violet-500/15 blur-3xl" />

      <header className="relative z-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2 font-semibold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 17l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M14 7h7v7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            Stock Analyzer
          </div>
          <GoogleButton callbackUrl={callbackUrl} />
        </div>
        <MarketTicker initial={overview} />
      </header>

      {/* First screen: pitch on the left, sign-in on the right — fits without scrolling on laptop screens */}
      <section className="relative z-10 mx-auto grid w-full max-w-6xl flex-1 items-center gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:gap-12 lg:py-4">
        <div className="animate-fade-up">
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> Live market data · AI-powered insights
          </span>
          <h1 className="mt-4 text-4xl font-bold leading-[1.1] tracking-tight xl:text-5xl">
            Research, forecast and trade stocks <span className="text-gradient">with an AI copilot</span>
          </h1>
          <p className="mt-4 max-w-xl text-base text-slate-400 xl:text-lg">
            Heatmaps, pro charts, news sentiment and forecasts for US and Indian stocks. Practise with $100,000 of virtual cash, and ask the AI anything in plain English.
          </p>
          <ul className="mt-6 grid max-w-xl gap-2.5 text-sm text-slate-300 sm:grid-cols-2">
            {["Live heatmap & candlestick charts", "AI assistant that researches for you", "News sentiment & 90-day forecasts", "Practice trading with $100k virtual cash"].map((f) => (
              <li key={f} className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-[11px] text-emerald-300">✓</span>
                {f}
              </li>
            ))}
          </ul>
        </div>

        <div className="animate-fade-up w-full lg:justify-self-end [animation-delay:120ms]">
          <div className="glass mx-auto w-full max-w-md rounded-3xl p-6">
            <h2 className="text-xl font-semibold text-slate-50">Sign in</h2>
            <p className="mt-1 text-sm text-slate-400">Start with $100,000 of virtual cash. No real money.</p>
            {errorMessage && <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{errorMessage}</div>}
            <div className="mt-5">
              <GoogleButton callbackUrl={callbackUrl} large />
            </div>
            {localLoginEnabled() && (
              <>
                <div className="my-4 flex items-center gap-3 text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                  <span className="h-px flex-1 bg-ink/15" /> or use your account <span className="h-px flex-1 bg-ink/15" />
                </div>
                <LocalLoginForm callbackUrl={callbackUrl} />
              </>
            )}
            <p className="mt-4 text-center text-xs text-slate-500">Free · Virtual money only · Not financial advice</p>
          </div>
        </div>
      </section>

      <footer className="relative z-10 px-4 pb-4 text-center text-xs text-slate-500">
        Virtual trading only, no real money. Market data may be delayed. Not financial advice.
      </footer>
    </main>
  );
}
