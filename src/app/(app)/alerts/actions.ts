"use server";

import { revalidatePath } from "next/cache";
import { AlertError, createAlert, deleteAlert } from "@/lib/alerts";
import { currentActor } from "@/lib/authz";

export type AlertFormState = { ok?: string; error?: string } | null;

export async function createAlertAction(_: AlertFormState, form: FormData): Promise<AlertFormState> {
  const actor = await currentActor();
  if (!actor) return { error: "Please sign in again." };
  try {
    const a = await createAlert(actor.id, {
      symbol: String(form.get("symbol") ?? ""),
      targetPrice: String(form.get("targetPrice") ?? ""),
      condition: (form.get("condition") || undefined) as "ABOVE" | "BELOW" | undefined,
      note: String(form.get("note") ?? "") || undefined,
    });
    revalidatePath("/alerts");
    return { ok: `Alert set: ${a.symbol} ${a.condition === "ABOVE" ? "above" : "below"} ${a.targetPrice} ${a.currency}` };
  } catch (err) {
    if (err instanceof AlertError) return { error: err.message };
    console.error("create alert failed", err);
    return { error: "Couldn't create the alert. Please try again." };
  }
}

export async function deleteAlertAction(id: string) {
  const actor = await currentActor();
  if (!actor) return;
  await deleteAlert(actor.id, id);
  revalidatePath("/alerts");
}
