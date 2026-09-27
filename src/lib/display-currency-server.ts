import "server-only";
import { cookies } from "next/headers";
import { CURRENCY_COOKIE, USD, type DisplayCurrency } from "@/lib/display-currency";
import { getUsdRate } from "@/lib/market";

/** The viewer's chosen display currency (cookie) with today's USD→INR rate. */
export async function getDisplayCurrency(): Promise<DisplayCurrency> {
  const code = (await cookies()).get(CURRENCY_COOKIE)?.value === "INR" ? "INR" : "USD";
  if (code === "USD") return USD;
  const usdPerInr = await getUsdRate("INR").catch(() => null);
  return usdPerInr ? { code: "INR", rate: 1 / usdPerInr } : USD;
}
