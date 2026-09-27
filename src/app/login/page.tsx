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

const FEATURES = [
  { icon: "▦", title: "Live market heatmap", body: "US and NIFTY large caps sized by market cap and coloured by today's move." },
  { icon: "⌁", title: "Pro candlestick charts", body: "1D to 5Y candles with volume, moving averages, RSI and MACD panes." },
  { icon: "◔", title: "Statistical forecasts", body: "Trend projection with a 90% range and a built-in backtest of its accuracy." },
  { icon: "✦", title: "AI assistant", body: "Ask in plain English. Gemini calls 8 tools for quotes, analysis, news and trades." },
  { icon: "☍", title: "News with AI sentiment", body: "Every headline tagged positive, negative or neutral, with an overall tone." },
  { icon: "◈", title: "Paper trading", body: "$100,000 virtual cash, any exchange, live FX conversion, performance vs the S&P 500." },
];

const GUARDRAILS = [
  { n: "1", title: "Input", body: "Blocks jailbreaks, off-topic and harmful requests" },
  { n: "2", title: "Model", body: "Numbers only from tools; never promises returns" },
  { n: "3", title: "Tools", body: "Server-side prices, order limits, signed confirmations" },
  { n: "4", title: "Output", body: "Rewrites overconfident claims as they stream" },
];

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
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
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
      <section className="relative z-10 mx-auto grid max-w-6xl items-center gap-8 px-4 py-8 sm:px-6 lg:min-h-[calc(100dvh-7rem)] lg:grid-cols-[1.1fr_0.9fr] lg:gap-12 lg:py-6">
        <div className="animate-fade-up">
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> Live market data · Gemini on Vertex AI
          </span>
          <h1 className="mt-4 text-4xl font-bold leading-[1.1] tracking-tight xl:text-5xl">
            Research, forecast and trade stocks <span className="text-gradient">with an AI copilot</span>
          </h1>
          <p className="mt-4 max-w-xl text-base text-slate-400 xl:text-lg">
            Heatmaps, pro charts, news sentiment and forecasts for US and Indian stocks. Practise with $100,000 of virtual cash, and ask the AI anything in plain English.
          </p>
          <ul className="mt-6 grid max-w-xl gap-2.5 text-sm text-slate-300 sm:grid-cols-2">
            {["Live heatmap & candlestick charts", "AI assistant with 8 market tools", "News sentiment & 90-day forecasts", "Paper trading with 4-layer guardrails"].map((f) => (
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
            <p className="mt-4 text-center text-xs text-slate-500">Free · Paper trading only · Not financial advice</p>
          </div>
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6">
        <h2 className="text-center text-2xl font-semibold">See it in action</h2>
        <p className="mt-1 text-center text-sm text-slate-400">Analysis, forecasts and trades confirmed in one click.</p>
        <div className="mx-auto mt-8 max-w-2xl">
        {/* Product preview */}
          <div className="relative">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-2xl backdrop-blur">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs text-slate-500">NasdaqGS · AAPL</div>
                <div className="text-2xl font-semibold tabular-nums">$341.19</div>
                <div className="text-sm text-emerald-400">▲ +1.57% today</div>
              </div>
              <span className="rounded-lg bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-400">▲ Bullish (+3)</span>
            </div>
            <svg viewBox="0 0 400 150" className="mt-4 h-40 w-full" aria-hidden>
              <defs>
                <linearGradient id="hero-fill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#3987e5" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#3987e5" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[30, 65, 100].map((y) => (
                <line key={y} x1="0" x2="400" y1={y} y2={y} stroke="var(--chart-grid)" />
              ))}
              <path d="M0 120 L30 112 L55 116 L80 98 L105 104 L130 86 L155 92 L180 72 L205 80 L230 62 L255 68 L280 50 L300 56 L320 40 L340 46 L360 30 L400 22 L400 150 L0 150 Z" fill="url(#hero-fill)" />
              <path className="animate-draw" d="M0 120 L30 112 L55 116 L80 98 L105 104 L130 86 L155 92 L180 72 L205 80 L230 62 L255 68 L280 50 L300 56 L320 40 L340 46 L360 30" fill="none" stroke="#3987e5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M360 30 L400 22" fill="none" stroke="#3987e5" strokeWidth="2" strokeDasharray="5 4" />
              <path d="M360 30 L400 4 L400 44 Z" fill="#3987e5" opacity="0.15" />
            </svg>
            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-sm">
              <div className="mb-2 flex justify-end">
                <span className="rounded-2xl rounded-br-sm bg-emerald-600/90 px-3 py-1.5 text-white">Buy 10 shares of RR Kabel</span>
              </div>
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
                <div className="text-[10px] font-medium uppercase tracking-wide text-amber-300">Confirm paper trade</div>
                <div className="font-semibold">Buy 10 RRKABEL.NS</div>
                <div className="text-xs text-slate-400">≈ $26.39 (₹2,528.30) each · $263.91 total</div>
              </div>
            </div>
          </div>
          <div className="absolute -bottom-5 -left-4 hidden rounded-xl border border-slate-800 bg-slate-900/90 px-4 py-3 text-sm shadow-xl sm:block">
            <div className="text-xs text-slate-500">News tone</div>
            <div className="font-medium text-emerald-400">▲ Positive · 5 of 8 headlines</div>
          </div>
        </div>
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <h2 className="text-center text-2xl font-semibold">Everything in one place</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <div
              key={f.title}
              className="animate-fade-up rounded-2xl border border-slate-800 bg-slate-900/50 p-5 transition hover:-translate-y-0.5 hover:border-slate-700"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/20 to-sky-500/20 text-lg text-emerald-300">{f.icon}</span>
              <h3 className="mt-4 font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-slate-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900/80 to-slate-900/30 p-6 sm:p-8">
          <h2 className="text-xl font-semibold">AI you can trust with your (paper) money</h2>
          <p className="mt-1 text-sm text-slate-400">Four layers of guardrails around every chat message and every trade.</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {GUARDRAILS.map((g) => (
              <div key={g.n} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/15 text-xs font-bold text-emerald-400">{g.n}</span>
                  <span className="font-medium">{g.title}</span>
                </div>
                <p className="mt-2 text-sm text-slate-400">{g.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="relative z-10 border-t border-slate-800 px-4 py-6 text-center text-xs text-slate-500">
        Paper trading only. No real money is used. Market data from Yahoo Finance, may be delayed. Not financial advice.
      </footer>
    </main>
  );
}
