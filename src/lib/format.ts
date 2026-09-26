// Yahoo quotes some markets in minor units (London in pence); show them in the major currency.
const MINOR_UNITS: Record<string, string> = { GBp: "GBP", GBX: "GBP", ZAc: "ZAR", ILA: "ILS" };

export function money(n: number | null | undefined, currency = "USD") {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const major = MINOR_UNITS[currency];
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: major ?? currency, maximumFractionDigits: 2 }).format(
      major ? n / 100 : n,
    );
  } catch {
    return `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency}`;
  }
}

export function signedMoney(n: number | null | undefined, currency = "USD") {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : "−"}${money(Math.abs(n), currency)}`;
}

export function pct(n: number | null | undefined, digits = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(digits)}%`;
}

export function compact(n: number | null | undefined) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);
}

export function num(n: number | null | undefined, digits = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
