import { ImageResponse } from "next/og";
import { currentActor } from "@/lib/authz";
import { inCcy } from "@/lib/display-currency";
import { getDisplayCurrency } from "@/lib/display-currency-server";
import { getPerformance } from "@/lib/performance";
import { prisma } from "@/lib/prisma";
import { getPortfolio } from "@/lib/trading";

/**
 * Shareable PNG of the user's virtual portfolio.
 * ?format=square (1080×1080, WhatsApp/Instagram) | wide (1200×627, LinkedIn/X)
 * ?amounts=1 shows money values (off by default: percentages only), ?holdings=0 hides top holdings.
 */
const C = { bg: "#070b16", card: "#0f172a", line: "#1e293b", text: "#f1f5f9", dim: "#94a3b8", mute: "#64748b", up: "#34d399", down: "#f87171", sky: "#38bdf8", violet: "#a78bfa" };
const pct = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}%`);
const tone = (n: number | null | undefined) => ((n ?? 0) >= 0 ? C.up : C.down);

// Inter (regular + bold) from Google Fonts, cached; without it the built-in font is used (no bold).
let fonts: Promise<{ name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" }[]> | null = null;
function loadFonts() {
  fonts ??= (async () => {
    const css = await fetch("https://fonts.googleapis.com/css2?family=Inter:wght@400;700", { signal: AbortSignal.timeout(4000) }).then((r) => r.text());
    const faces = [...css.matchAll(/font-weight:\s*(\d+);[\s\S]*?src:\s*url\(([^)]+)\)/g)].filter((m) => m[1] === "400" || m[1] === "700");
    return Promise.all(
      faces.map(async (m) => ({ name: "Inter", data: await fetch(m[2], { signal: AbortSignal.timeout(4000) }).then((r) => r.arrayBuffer()), weight: Number(m[1]) as 400 | 700, style: "normal" as const })),
    );
  })().catch((err) => {
    console.warn("share card font unavailable, using default", err);
    fonts = null; // retry next time
    return [];
  });
  return fonts;
}

function linePath(values: number[], w: number, h: number, min: number, max: number) {
  const span = max - min || 1;
  return values.map((v, i) => `${i ? "L" : "M"}${((i / Math.max(1, values.length - 1)) * w).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`).join(" ");
}

export async function GET(req: Request) {
  const actor = await currentActor();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  const url = new URL(req.url);
  const wide = url.searchParams.get("format") === "wide";
  const showAmounts = url.searchParams.get("amounts") === "1";
  const showHoldings = url.searchParams.get("holdings") !== "0";

  const [p, cur, trades] = await Promise.all([getPortfolio(actor.id), getDisplayCurrency(), prisma.trade.count({ where: { userId: actor.id } })]);
  const perf = await getPerformance(actor.id, p).catch(() => null);
  // Rupee sign isn't in the built-in font, so INR amounts are written as "INR 1,23,456".
  const money = (usd: number) => inCcy(usd, cur, 0).replace("₹", "INR ");

  const W = wide ? 1200 : 1080;
  const H = wide ? 627 : 1080;
  const first = actor.name?.split(" ")[0] ?? "My";
  const ret = p.totalReturnPct;
  const top = [...p.positions].filter((x) => x.unrealizedPnlPct !== null).sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0)).slice(0, 3);

  // Mini chart: portfolio vs benchmark, both rebased to 100.
  const pts = (perf?.points ?? []).slice(-120);
  const base = pts[0]?.portfolio || 1;
  const bBase = pts.find((x) => x.benchmark)?.benchmark || 1;
  const pv = pts.map((x) => (x.portfolio / base) * 100);
  const bv = pts.map((x) => (x.benchmark ? (x.benchmark / bBase) * 100 : null)).filter((x): x is number => x !== null);
  const all = [...pv, ...bv];
  const [min, max] = [Math.min(...all, 99), Math.max(...all, 101)];
  const cw = wide ? 540 : 952;
  const ch = wide ? 300 : 190;

  const stat = (label: string, value: string, color: string = C.text) => (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, background: C.card, border: `1px solid ${C.line}`, borderRadius: 20, padding: wide ? "14px 16px" : "18px 22px" }}>
      <div style={{ fontSize: wide ? 15 : 19, color: C.mute, textTransform: "uppercase", letterSpacing: wide ? 1 : 2, whiteSpace: "nowrap" }}>{label}</div>
      <div style={{ fontSize: wide ? 30 : 36, fontWeight: 700, color, marginTop: 6 }}>{value}</div>
    </div>
  );

  const chart =
    pv.length > 1 ? (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <svg width={cw} height={ch} viewBox={`0 0 ${cw} ${ch}`}>
          <defs>
            <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={tone(ret)} stopOpacity="0.35" />
              <stop offset="100%" stopColor={tone(ret)} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${linePath(pv, cw, ch, min, max)} L${cw},${ch} L0,${ch} Z`} fill="url(#fill)" />
          {bv.length > 1 && <path d={linePath(bv, cw, ch, min, max)} fill="none" stroke={C.mute} strokeWidth="3" strokeDasharray="8 8" />}
          <path d={linePath(pv, cw, ch, min, max)} fill="none" stroke={tone(ret)} strokeWidth="5" strokeLinejoin="round" />
        </svg>
        <div style={{ display: "flex", gap: 28, marginTop: 12, fontSize: 20, color: C.dim }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 22, height: 5, background: tone(ret), borderRadius: 3 }} /> My portfolio
          </div>
          {bv.length > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 22, height: 5, background: C.mute, borderRadius: 3 }} /> {perf?.benchmarkLabel ?? "S&P 500"}
            </div>
          )}
        </div>
      </div>
    ) : (
      <div style={{ display: "flex", width: cw, height: ch, alignItems: "center", justifyContent: "center", color: C.mute, fontSize: 24, border: `1px dashed ${C.line}`, borderRadius: 20 }}>
        Chart appears after the first trade day
      </div>
    );

  const holdings = showHoldings && top.length > 0 && (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 20, color: C.mute, textTransform: "uppercase", letterSpacing: 2 }}>Top holdings</div>
      {top.map((h) => (
        <div key={h.symbol} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: "10px 20px", fontSize: 25 }}>
          <div style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
            <div style={{ fontWeight: 700, color: C.text }}>{h.symbol.replace(/\.(NS|BO)$/, "")}</div>
            <div style={{ fontSize: 20, color: C.mute }}>{`${h.weightPct ?? 0}%`}</div>
          </div>
          <div style={{ fontWeight: 700, color: tone(h.unrealizedPnlPct) }}>{pct(h.unrealizedPnlPct)}</div>
        </div>
      ))}
    </div>
  );

  const header = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ display: "flex", width: 52, height: 52, borderRadius: 14, background: "linear-gradient(135deg,#34d399,#0ea5e9,#8b5cf6)", alignItems: "center", justifyContent: "center" }}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 17l6-6 4 4 8-8" />
            <path d="M14 7h7v7" />
          </svg>
        </div>
        <div style={{ fontSize: 30, fontWeight: 700, color: C.text }}>Stock Analyzer</div>
      </div>
      <div style={{ display: "flex", fontSize: 20, color: C.violet, border: `1px solid ${C.violet}55`, borderRadius: 999, padding: "6px 16px" }}>Virtual portfolio</div>
    </div>
  );

  const headline = (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ fontSize: 28, color: C.dim }}>{`${first}'s total return`}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 20 }}>
        <div style={{ fontSize: wide ? 96 : 116, fontWeight: 700, color: tone(ret), letterSpacing: -3, lineHeight: 1.05 }}>{pct(ret)}</div>
        {showAmounts && <div style={{ fontSize: 34, color: C.dim }}>{money(p.totalValue)}</div>}
      </div>
    </div>
  );

  const vsBench = perf?.benchmarkReturnPct ?? null;
  const stats = (
    <div style={{ display: "flex", gap: 16 }}>
      {vsBench !== null && stat(`vs ${perf?.benchmarkLabel ?? "S&P 500"}`, pct(perf!.portfolioReturnPct - vsBench), tone(perf!.portfolioReturnPct - vsBench))}
      {showAmounts ? stat("Profit / loss", `${p.totalValue >= p.startingCash ? "+" : "−"}${money(Math.abs(p.totalValue - p.startingCash))}`, tone(p.totalValue - p.startingCash)) : stat("Holdings", String(p.positions.length))}
      {stat("Trades", String(trades))}
    </div>
  );

  const footer = (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 19, color: C.mute }}>
      <div>Practice trading with virtual money · not financial advice</div>
      <div>{new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
    </div>
  );

  const body = wide ? (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", padding: 44, gap: 22 }}>
      {header}
      <div style={{ display: "flex", gap: 36, flex: 1 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 20, width: 540 }}>
          {headline}
          {stats}
          {showHoldings && top.length > 0 && (
            <div style={{ display: "flex", gap: 8 }}>
              {top.map((h) => (
                <div key={h.symbol} style={{ display: "flex", gap: 8, alignItems: "baseline", background: C.card, border: `1px solid ${C.line}`, borderRadius: 999, padding: "7px 13px", fontSize: 18 }}>
                  <div style={{ fontWeight: 700, color: C.text }}>{h.symbol.replace(/\.(NS|BO)$/, "")}</div>
                  <div style={{ color: tone(h.unrealizedPnlPct) }}>{pct(h.unrealizedPnlPct)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, flex: 1 }}>
          {chart}
        </div>
      </div>
      {footer}
    </div>
  ) : (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", padding: 56, gap: 24 }}>
      {header}
      {headline}
      {chart}
      {stats}
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>{holdings}</div>
      {footer}
    </div>
  );

  // Render fully before responding, so a layout error becomes a clean 500 instead of a broken stream.
  try {
    const png = await new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: C.bg, fontFamily: "Inter, sans-serif", position: "relative" }}>
        <div style={{ position: "absolute", top: -200, left: -100, width: 700, height: 700, borderRadius: 999, background: `radial-gradient(circle, ${tone(ret)}33, transparent 70%)` }} />
        <div style={{ position: "absolute", bottom: -250, right: -150, width: 700, height: 700, borderRadius: 999, background: "radial-gradient(circle, #8b5cf633, transparent 70%)" }} />
        {body}
      </div>
    ),
    { width: W, height: H, fonts: await loadFonts() },
    ).arrayBuffer();
    return new Response(png, { headers: { "content-type": "image/png", "cache-control": "private, no-store" } });
  } catch (err) {
    console.error("share card failed", err);
    return new Response("Couldn't create the image.", { status: 500 });
  }
}
