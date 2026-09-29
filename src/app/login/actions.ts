"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { OtpError, requestOtp, verifyOtp } from "@/lib/otp";
import { startSession } from "@/lib/session";

export type OtpState =
  | { step: "email"; error?: string; email?: string }
  | { step: "code"; email: string; isNew: boolean; error?: string; sentAt: number };

async function clientIp() {
  return (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

/** Step 1 (and "resend"): email a 6-digit code. */
async function sendCode(_: OtpState, form: FormData): Promise<OtpState> {
  const email = String(form.get("email") ?? "");
  try {
    const r = await requestOtp(email, await clientIp());
    return { step: "code", email: r.email, isNew: r.isNew, sentAt: Date.now() };
  } catch (err) {
    const error = err instanceof OtpError ? err.message : "Couldn't send the code. Please try again.";
    if (!(err instanceof OtpError)) console.error("otp request failed", err);
    // A resend that fails keeps the user on the code screen.
    if (form.get("resend")) return { step: "code", email, isNew: form.get("isNew") === "1", error, sentAt: Number(form.get("sentAt")) || Date.now() };
    return { step: "email", email, error };
  }
}

/** Step 2: check the code (plus name for new accounts) and sign in. */
async function verifyCode(prev: OtpState, form: FormData): Promise<OtpState> {
  if (prev.step !== "code") return prev;
  let userId: string;
  try {
    const user = await verifyOtp({ email: prev.email, code: form.get("code"), name: form.get("name") }, await clientIp());
    userId = user.id;
  } catch (err) {
    if (!(err instanceof OtpError)) console.error("otp verify failed", err);
    return { ...prev, error: err instanceof OtpError ? err.message : "Sign-in failed. Please try again." };
  }
  await startSession(userId);
  const next = String(form.get("callbackUrl") ?? "/");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

/** One action for the whole flow; the submit button's "intent" picks the step. */
export async function otpAction(prev: OtpState, form: FormData): Promise<OtpState> {
  const intent = form.get("intent");
  if (intent === "change") return { step: "email", email: prev.step === "code" ? prev.email : undefined };
  if (intent === "resend" && prev.step === "code") {
    form.set("email", prev.email);
    form.set("resend", "1");
    form.set("isNew", prev.isNew ? "1" : "0");
    form.set("sentAt", String(prev.sentAt));
    return sendCode(prev, form);
  }
  if (intent === "verify") return verifyCode(prev, form);
  return sendCode(prev, form);
}
