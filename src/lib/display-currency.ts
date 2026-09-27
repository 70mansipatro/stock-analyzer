// Display currency for account values. Everything is stored in USD; this only changes what users see.
export type DisplayCode = "USD" | "INR";
export type DisplayCurrency = { code: DisplayCode; rate: number }; // rate = units of `code` per 1 USD
export const CURRENCY_COOKIE = "ccy";
export const USD: DisplayCurrency = { code: "USD", rate: 1 };

const fmtr = (code: string, digits: number) => new Intl.NumberFormat(code === "INR" ? "en-IN" : "en-US", { style: "currency", currency: code, maximumFractionDigits: digits });

/** Formats a USD amount in the display currency. */
export function inCcy(usd: number | null | undefined, c: DisplayCurrency, digits = 2) {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return "—";
  return fmtr(c.code, digits).format(usd * c.rate);
}

export function signedInCcy(usd: number | null | undefined, c: DisplayCurrency) {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return "—";
  return `${usd >= 0 ? "+" : "−"}${inCcy(Math.abs(usd), c)}`;
}
