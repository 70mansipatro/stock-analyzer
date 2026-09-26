import { pct, signedMoney } from "@/lib/format";

/** Gain/loss text: sign + arrow + color, so direction never relies on color alone. */
export function Change({ value, percent, currency }: { value?: number | null; percent?: number | null; currency?: string }) {
  const basis = percent ?? value ?? 0;
  const up = basis >= 0;
  return (
    <span className={up ? "text-emerald-400" : "text-red-400"}>
      <span aria-hidden>{up ? "▲" : "▼"}</span>{" "}
      {value !== undefined && value !== null && signedMoney(value, currency)}
      {value !== undefined && value !== null && percent !== undefined && percent !== null && " "}
      {percent !== undefined && percent !== null && (value !== undefined && value !== null ? `(${pct(percent)})` : pct(percent))}
    </span>
  );
}
