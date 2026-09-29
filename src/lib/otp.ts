import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { emailConfigured, otpEmail, sendEmail } from "@/lib/email";
import { onboardUser } from "@/lib/onboarding";
import { prisma } from "@/lib/prisma";
import { isBootstrapAdmin } from "@/lib/roles";

/**
 * Passwordless sign-in: a 6-digit code emailed to the user.
 * Codes expire after 10 minutes, allow 5 guesses, and only an HMAC of each code is stored.
 */
export const OTP_MINUTES = 10;
const MAX_GUESSES = 5;
const MAX_CODES_PER_WINDOW = 5; // per email per 15 minutes
const RESEND_COOLDOWN_S = 30;

export class OtpError extends Error {}

const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);
export const nameSchema = z.string().trim().min(2, "Enter your name (at least 2 characters).").max(60, "Name is too long.");

const hash = (email: string, code: string) => createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(`${email}:${code}`).digest("hex");

// Per-IP limit on top of the per-email one, so one visitor can't spray codes at many addresses.
const ipHits = new Map<string, number[]>();
function ipLimited(ip: string) {
  const now = Date.now();
  const recent = (ipHits.get(ip) ?? []).filter((t) => now - t < 15 * 60_000);
  ipHits.set(ip, [...recent, now]);
  return recent.length >= 15;
}

async function checkAllowed(email: string) {
  if (isBootstrapAdmin(email)) return;
  const blocked = await prisma.blockedEmail.findUnique({ where: { email } });
  if (blocked) throw new OtpError("This account has been removed by an administrator.");
  const u = await prisma.user.findUnique({ where: { email }, select: { suspended: true } });
  if (u?.suspended) throw new OtpError("This account has been suspended by an administrator.");
}

export function parseEmail(raw: unknown) {
  const r = emailSchema.safeParse(raw);
  if (!r.success) throw new OtpError(r.error.issues[0].message);
  return r.data;
}

/** Emails a new code. Returns whether this email already has an account (new ones are asked for their name). */
export async function requestOtp(rawEmail: unknown, ip: string) {
  const email = parseEmail(rawEmail);
  if (ipLimited(ip)) throw new OtpError("Too many code requests from this network. Wait a few minutes and try again.");
  await checkAllowed(email);

  const recent = await prisma.emailOtp.findMany({
    where: { email, createdAt: { gt: new Date(Date.now() - 15 * 60_000) } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (recent[0] && Date.now() - recent[0].createdAt.getTime() < RESEND_COOLDOWN_S * 1000) {
    const wait = Math.ceil(RESEND_COOLDOWN_S - (Date.now() - recent[0].createdAt.getTime()) / 1000);
    throw new OtpError(`Please wait ${wait}s before requesting another code.`);
  }
  if (recent.length >= MAX_CODES_PER_WINDOW) throw new OtpError("Too many codes requested for this email. Try again in 15 minutes.");

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");

  // Only the newest code works.
  await prisma.emailOtp.updateMany({ where: { email, consumedAt: null }, data: { consumedAt: new Date() } });
  await prisma.emailOtp.create({ data: { email, codeHash: hash(email, code), expiresAt: new Date(Date.now() + OTP_MINUTES * 60_000), ip } });

  const mail = otpEmail({ code, minutes: OTP_MINUTES, newAccount: !existing });
  await sendEmail({ to: email, kind: "sign_in_code", userId: existing?.id ?? null, ...mail });
  if (!emailConfigured() && process.env.NODE_ENV !== "production") console.info(`[dev] sign-in code for ${email}: ${code}`);
  await audit(existing?.id ?? null, "otp_requested", { email, ip, newAccount: !existing });

  return { email, isNew: !existing };
}

/** Checks the code and returns the user to sign in, creating the account on first sign-in. */
export async function verifyOtp(input: { email: unknown; code: unknown; name?: unknown }, ip: string) {
  const email = parseEmail(input.email);
  const code = String(input.code ?? "").replace(/\D/g, "");
  if (code.length !== 6) throw new OtpError("Enter the 6-digit code from the email.");

  const otp = await prisma.emailOtp.findFirst({ where: { email, consumedAt: null }, orderBy: { createdAt: "desc" } });
  if (!otp || otp.expiresAt < new Date()) throw new OtpError("This code has expired. Request a new one.");
  if (otp.attempts >= MAX_GUESSES) throw new OtpError("Too many wrong attempts. Request a new code.");

  const a = Buffer.from(hash(email, code));
  const b = Buffer.from(otp.codeHash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    const { attempts } = await prisma.emailOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    await audit(null, "otp_failed", { email, ip, attempt: attempts });
    const left = MAX_GUESSES - attempts;
    throw new OtpError(left > 0 ? `Wrong code. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many wrong attempts. Request a new code.");
  }

  let user = await prisma.user.findUnique({ where: { email } });
  let name: string | null = null;
  if (!user) {
    const r = nameSchema.safeParse(input.name);
    if (!r.success) throw new OtpError(r.error.issues[0].message);
    name = r.data;
  }
  await checkAllowed(email);

  // Consume atomically so the same code can't sign in twice (e.g. a double-submit).
  const { count } = await prisma.emailOtp.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: new Date() } });
  if (count !== 1) throw new OtpError("This code was already used. Request a new one.");

  const now = new Date();
  if (!user) {
    user = await prisma.user.create({ data: { email, name, emailVerified: now, lastLoginAt: now } });
    await onboardUser({ id: user.id, email, name });
    await audit(user.id, "otp_signup", { ip });
  } else {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: now, emailVerified: user.emailVerified ?? now, ...(isBootstrapAdmin(email) ? { role: "ADMIN" } : {}) },
    });
    await audit(user.id, "otp_login", { ip });
  }
  return user;
}
