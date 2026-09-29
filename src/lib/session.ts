import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

const SESSION_DAYS = 30;

/**
 * Signs a user in by creating a database session and the same cookie Auth.js uses,
 * so roles, suspension, "sign out everywhere" and auth() work unchanged.
 */
export async function startSession(userId: string) {
  const sessionToken = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await prisma.session.create({ data: { sessionToken, userId, expires } });

  const secure = (process.env.AUTH_URL ?? "").startsWith("https://");
  (await cookies()).set(secure ? "__Secure-authjs.session-token" : "authjs.session-token", sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    expires,
  });
}
