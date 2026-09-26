"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { MarketError } from "@/lib/market";
import { executeOrder, TradeError } from "@/lib/trading";

export type TradeState = { ok: boolean; message: string } | null;

export async function placeOrderAction(_prev: TradeState, formData: FormData): Promise<TradeState> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, message: "Please sign in again." };

  const symbol = String(formData.get("symbol") ?? "");
  const side = formData.get("side") === "SELL" ? "SELL" : "BUY";
  const quantity = Number(formData.get("quantity"));

  try {
    const t = await executeOrder(session.user.id, { symbol, side, quantity }, "UI");
    revalidatePath("/", "layout");
    const pnl = t.realizedPnl !== null ? ` Realized P&L: ${t.realizedPnl >= 0 ? "+" : "−"}$${Math.abs(t.realizedPnl).toLocaleString()}.` : "";
    return {
      ok: true,
      message: `${side === "BUY" ? "Bought" : "Sold"} ${t.quantity} ${t.symbol} at $${t.price.toFixed(2)} ($${t.total.toLocaleString()}).${pnl}`,
    };
  } catch (err) {
    if (err instanceof TradeError || err instanceof MarketError) return { ok: false, message: err.message };
    console.error("trade failed", err);
    return { ok: false, message: "The trade could not be completed. Please try again." };
  }
}
