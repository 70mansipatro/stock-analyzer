import { describe, expect, it } from "vitest";
import { exchangeOfSymbol, getMarketSession, isSupportedSymbol, marketOfSymbol, marketStatus, zonedTimeToUtc } from "./market-hours";

const at = (iso: string) => new Date(iso);

describe("US market (America/New_York)", () => {
  it("is open 9:30–16:00 New York time on a weekday", () => {
    // 2026-10-01 is a Thursday; New York is on EDT (UTC−4).
    expect(getMarketSession("US", at("2026-10-01T13:29:00Z")).open).toBe(false);
    expect(getMarketSession("US", at("2026-10-01T13:30:00Z")).open).toBe(true);
    expect(getMarketSession("US", at("2026-10-01T19:59:00Z")).open).toBe(true);
    expect(getMarketSession("US", at("2026-10-01T20:00:00Z"))).toMatchObject({ open: false, state: "after_close" });
  });

  it("follows daylight saving time (EST in winter)", () => {
    // 2026-12-01 is a Tuesday on EST (UTC−5): opens 14:30 UTC.
    expect(getMarketSession("US", at("2026-12-01T14:00:00Z")).open).toBe(false);
    expect(getMarketSession("US", at("2026-12-01T14:30:00Z")).open).toBe(true);
  });

  it("is closed at weekends and on exchange holidays", () => {
    expect(getMarketSession("US", at("2026-10-03T15:00:00Z"))).toMatchObject({ open: false, state: "weekend" });
    expect(getMarketSession("US", at("2026-11-26T15:00:00Z"))).toMatchObject({ open: false, state: "holiday" }); // Thanksgiving
  });

  it("closes early on the day after Thanksgiving", () => {
    expect(getMarketSession("US", at("2026-11-27T17:30:00Z")).open).toBe(true); // 12:30 ET
    expect(getMarketSession("US", at("2026-11-27T18:30:00Z")).open).toBe(false); // 13:30 ET
  });

  it("knows when it opens next", () => {
    // Friday after the close → Monday 9:30 ET.
    expect(getMarketSession("US", at("2026-10-02T21:00:00Z")).nextOpen?.toISOString()).toBe("2026-10-05T13:30:00.000Z");
  });
});

describe("Indian market (Asia/Kolkata)", () => {
  it("is open 9:15–15:30 IST on a weekday", () => {
    // IST is UTC+5:30 with no daylight saving.
    expect(getMarketSession("IN", at("2026-10-01T03:44:00Z")).open).toBe(false); // 09:14 IST
    expect(getMarketSession("IN", at("2026-10-01T03:45:00Z")).open).toBe(true); // 09:15 IST
    expect(getMarketSession("IN", at("2026-10-01T09:59:00Z")).open).toBe(true); // 15:29 IST
    expect(getMarketSession("IN", at("2026-10-01T10:00:00Z")).open).toBe(false); // 15:30 IST
  });

  it("is closed on NSE holidays and weekends", () => {
    expect(getMarketSession("IN", at("2026-10-02T05:00:00Z"))).toMatchObject({ state: "holiday" }); // Gandhi Jayanti
    expect(getMarketSession("IN", at("2026-10-04T05:00:00Z"))).toMatchObject({ state: "weekend" });
  });

  it("skips the holiday when finding the next open", () => {
    // Thursday 1 Oct after close → Friday 2 Oct is a holiday → Monday 5 Oct 09:15 IST.
    expect(getMarketSession("IN", at("2026-10-01T12:00:00Z")).nextOpen?.toISOString()).toBe("2026-10-05T03:45:00.000Z");
  });

  it("is independent of the US session", () => {
    const s = marketStatus(at("2026-10-01T15:00:00Z")); // 11:00 New York, 20:30 India
    expect(s.find((m) => m.id === "US")?.open).toBe(true);
    expect(s.find((m) => m.id === "IN")?.open).toBe(false);
  });
});

describe("symbols", () => {
  it("maps symbols to their market and exchange", () => {
    expect(marketOfSymbol("AAPL")).toBe("US");
    expect(marketOfSymbol("RELIANCE.NS")).toBe("IN");
    expect(marketOfSymbol("TCS.BO")).toBe("IN");
    expect(exchangeOfSymbol("TCS.BO")).toBe("BSE");
    expect(exchangeOfSymbol("TCS.NS")).toBe("NSE");
  });

  it("accepts US and NSE/BSE stocks only", () => {
    for (const s of ["AAPL", "BRK-B", "RELIANCE.NS", "M&M.NS", "TCS.BO"]) expect(isSupportedSymbol(s)).toBe(true);
    for (const s of ["VOD.L", "^GSPC", "INR=X", "7203.T"]) expect(isSupportedSymbol(s)).toBe(false);
  });
});

describe("zonedTimeToUtc", () => {
  it("converts wall-clock time in a zone to UTC", () => {
    expect(zonedTimeToUtc(2026, 7, 1, 9 * 60 + 30, "America/New_York").toISOString()).toBe("2026-07-01T13:30:00.000Z");
    expect(zonedTimeToUtc(2026, 1, 15, 9 * 60 + 30, "America/New_York").toISOString()).toBe("2026-01-15T14:30:00.000Z");
    expect(zonedTimeToUtc(2026, 1, 15, 9 * 60 + 15, "Asia/Kolkata").toISOString()).toBe("2026-01-15T03:45:00.000Z");
  });
});
