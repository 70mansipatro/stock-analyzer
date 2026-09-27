"use server";

import { randomBytes, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { LOCAL_ADMIN_EMAIL, localLoginEnabled } from "@/lib/local-admin";
import { prisma } from "@/lib/prisma";

export type LoginState = { error: string } | null;

const SESSION_DAYS = 30;
const attempts = new Map<string, number[]>();

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Username/password sign-in for the local admin defined in .env.local.
 * Creates a normal database session (same cookie Auth.js uses), so roles, suspension and sign-out work unchanged.
 */
export async function localLogin(_: LoginState, form: FormData): Promise<LoginState> {
  if (!localLoginEnabled()) return { error: "Local sign-in is disabled." };

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter((t) => now - t < 5 * 60_000);
  if (recent.length >= 5) return { error: "Too many attempts. Wait 5 minutes and try again." };

  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const ok = same(username.toLowerCase(), process.env.LOCAL_ADMIN_USERNAME!.trim().toLowerCase()) && same(password, process.env.LOCAL_ADMIN_PASSWORD!);
  if (!ok) {
    attempts.set(ip, [...recent, now]);
    await audit(null, "local_login_failed", { username: username.slice(0, 40), ip });
    return { error: "Wrong username or password." };
  }
  attempts.delete(ip);

  const user = await prisma.user.upsert({
    where: { email: LOCAL_ADMIN_EMAIL },
    create: { email: LOCAL_ADMIN_EMAIL, name: "Local Admin", role: "ADMIN", lastLoginAt: new Date() },
    update: { role: "ADMIN", lastLoginAt: new Date() },
  });
  if (user.suspended) return { error: "This account is suspended." };

  const sessionToken = randomBytes(32).toString("hex");
  const expires = new Date(now + SESSION_DAYS * 86_400_000);
  await prisma.session.create({ data: { sessionToken, userId: user.id, expires } });

  const secure = (process.env.AUTH_URL ?? "").startsWith("https://");
  (await cookies()).set(secure ? "__Secure-authjs.session-token" : "authjs.session-token", sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    expires,
  });
  await audit(user.id, "local_login", { ip });

  const next = String(form.get("callbackUrl") ?? "/");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}
