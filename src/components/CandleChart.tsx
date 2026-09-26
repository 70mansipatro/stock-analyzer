"use client";

import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  type CandlestickData,
  type IChartApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { macdSeries, rsiSeries, sma } from "@/lib/indicators";
import { cssVar, useTheme } from "@/lib/theme";

type Candle = { time: number | string; open: number; high: number; low: number; close: number; volume: number };
type Range = "1D" | "5D" | "1M" | "6M" | "1Y" | "5Y";
const RANGES: Range[] = ["1D", "5D", "1M", "6M", "1Y", "5Y"];

// Candles use the conventional green/red; overlays use validated categorical slots (orange, violet).
const UP = "#22a55c";
const DOWN = "#e5484d";
const SMA20 = "#d95926";
const SMA50 = "#9085e9";
const RSI_C = "#3987e5";

type Readout = { o: number; h: number; l: number; c: number; v: number; change: number };

export function CandleChart({ symbol, currency }: { symbol: string; currency: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [range, setRange] = useState<Range>("6M");
  const [show, setShow] = useState({ sma20: true, sma50: true, rsi: true, macd: false });
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [intraday, setIntraday] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readout, setReadout] = useState<Readout | null>(null);
  const theme = useTheme();

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/chart?symbol=${encodeURIComponent(symbol)}&range=${range}`)
      .then(async (r) => {
        const body = await r.json();
        if (cancelled) return;
        if (!r.ok) throw new Error(body.error ?? "Chart data unavailable.");
        setError(null);
        setCandles(body.candles);
        setIntraday(body.intraday);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [symbol, range]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || !candles?.length) return;

    // Intraday bars are UTC seconds; shift them so the axis shows the viewer's local clock.
    const tz = -new Date().getTimezoneOffset() * 60;
    const t = (c: Candle) => (intraday ? ((c.time as number) + tz) as UTCTimestamp : (c.time as string)) as Time;

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: cssVar("--chart-text", "#94a3b8"),
        fontSize: 11,
        panes: { separatorColor: cssVar("--chart-grid", "#1e293b"), separatorHoverColor: cssVar("--chart-axis", "#334155"), enableResize: true },
      },
      grid: { vertLines: { color: cssVar("--chart-grid", "#111a2e") }, horzLines: { color: cssVar("--chart-grid", "#111a2e") } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: cssVar("--chart-grid", "#1e293b") },
      timeScale: { borderColor: cssVar("--chart-grid", "#1e293b"), timeVisible: intraday, secondsVisible: false },
    });
    chartRef.current = chart;

    const closes = candles.map((c) => c.close);
    const main = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      borderVisible: false,
    });
    main.setData(candles.map((c) => ({ time: t(c), open: c.open, high: c.high, low: c.low, close: c.close })));

    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volume.setData(candles.map((c) => ({ time: t(c), value: c.volume, color: c.close >= c.open ? "rgba(34,165,92,0.35)" : "rgba(229,72,77,0.35)" })));

    const line = (values: (number | null)[]) =>
      candles.flatMap((c, i) => (values[i] === null || values[i] === undefined ? [] : [{ time: t(c), value: values[i] as number }]));
    const overlay = { lineWidth: 2 as const, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false };
    if (show.sma20) chart.addSeries(LineSeries, { ...overlay, color: SMA20 }).setData(line(sma(closes, 20)));
    if (show.sma50) chart.addSeries(LineSeries, { ...overlay, color: SMA50 }).setData(line(sma(closes, 50)));

    let pane = 1;
    if (show.rsi) {
      const rsi = chart.addSeries(LineSeries, { ...overlay, color: RSI_C, lastValueVisible: true }, pane);
      rsi.setData(line(rsiSeries(closes)));
      rsi.createPriceLine({ price: 70, color: cssVar("--chart-axis", "#64748b"), lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "70" });
      rsi.createPriceLine({ price: 30, color: cssVar("--chart-axis", "#64748b"), lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "30" });
      pane++;
    }
    if (show.macd) {
      const m = macdSeries(closes);
      chart.addSeries(HistogramSeries, { lastValueVisible: false, priceLineVisible: false }, pane).setData(
        candles.map((c, i) => ({ time: t(c), value: m[i].histogram, color: m[i].histogram >= 0 ? "rgba(34,165,92,0.6)" : "rgba(229,72,77,0.6)" })),
      );
      chart.addSeries(LineSeries, { ...overlay, lineWidth: 1, color: RSI_C }, pane).setData(candles.map((c, i) => ({ time: t(c), value: m[i].macd })));
      chart.addSeries(LineSeries, { ...overlay, lineWidth: 1, color: SMA20 }, pane).setData(candles.map((c, i) => ({ time: t(c), value: m[i].signal })));
    }
    const panes = chart.panes();
    panes[0]?.setStretchFactor(3);
    panes.slice(1).forEach((p) => p.setStretchFactor(1));
    chart.timeScale().fitContent();

    const last = candles[candles.length - 1];
    const first = candles[0];
    const base = (c: Candle): Readout => ({ o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume, change: ((c.close - first.open) / first.open) * 100 });
    setReadout(base(last));
    const volumeByTime = new Map(candles.map((c) => [String(t(c)), c.volume]));
    chart.subscribeCrosshairMove((param) => {
      const bar = param.seriesData.get(main) as CandlestickData<Time> | undefined;
      if (!bar || param.time === undefined) return setReadout(base(last));
      setReadout({ o: bar.open, h: bar.high, l: bar.low, c: bar.close, v: volumeByTime.get(String(param.time)) ?? 0, change: ((bar.close - first.open) / first.open) * 100 });
    });

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, intraday, show, theme]);

  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  const toggles: { key: keyof typeof show; label: string; color: string }[] = [
    { key: "sma20", label: "SMA 20", color: SMA20 },
    { key: "sma50", label: "SMA 50", color: SMA50 },
    { key: "rsi", label: "RSI", color: RSI_C },
    { key: "macd", label: "MACD", color: "#94a3b8" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg bg-slate-800 p-1" role="tablist" aria-label="Chart range">
          {RANGES.map((r) => (
            <button
              key={r}
              role="tab"
              aria-selected={r === range}
              onClick={() => {
                if (r === range) return;
                setCandles(null);
                setError(null);
                setRange(r);
              }}
              className={`rounded-md px-2.5 py-1 text-xs ${r === range ? "bg-surface-1 text-slate-50 shadow-sm" : "text-slate-400 hover:text-slate-200"}`}
            >
              {r}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {toggles.map((tg) => (
            <button
              key={tg.key}
              onClick={() => setShow((s) => ({ ...s, [tg.key]: !s[tg.key] }))}
              aria-pressed={show[tg.key]}
              className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition ${
                show[tg.key] ? "border-slate-600 bg-slate-800 text-slate-100" : "border-slate-800 text-slate-500 hover:text-slate-300"
              }`}
            >
              <span className="inline-block h-0.5 w-3 rounded" style={{ background: show[tg.key] ? tg.color : "#475569" }} />
              {tg.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-h-5 flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-slate-400">
        {readout && (
          <>
            <span>O <b className="font-medium text-slate-200">{fmt(readout.o)}</b></span>
            <span>H <b className="font-medium text-slate-200">{fmt(readout.h)}</b></span>
            <span>L <b className="font-medium text-slate-200">{fmt(readout.l)}</b></span>
            <span>C <b className="font-medium text-slate-200">{fmt(readout.c)}</b></span>
            <span>Vol <b className="font-medium text-slate-200">{Intl.NumberFormat("en-US", { notation: "compact" }).format(readout.v)}</b></span>
            <span className={readout.change >= 0 ? "text-emerald-400" : "text-red-400"}>
              {readout.change >= 0 ? "▲ +" : "▼ −"}
              {Math.abs(readout.change).toFixed(2)}% over {range}
            </span>
            <span className="text-slate-500">{currency}</span>
          </>
        )}
      </div>

      <div className="relative h-[420px] w-full sm:h-[480px]">
        {!candles && !error && <div className="absolute inset-0 animate-pulse rounded-lg bg-slate-800/40" />}
        {error && <div className="absolute inset-0 flex items-center justify-center text-sm text-amber-300">⚠ {error}</div>}
        <div ref={boxRef} className="h-full w-full" />
      </div>
    </div>
  );
}
