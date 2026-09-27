import "server-only";
import { prisma } from "@/lib/prisma";
import { LOCAL_ADMIN_EMAIL, localLoginEnabled } from "@/lib/local-admin";
import type { AppRole } from "@/lib/rbac";

/** Current role from the database (null if the user is suspended or gone). */
export async function roleOf(userId: string): Promise<AppRole | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, suspended: true } });
  if (!u || u.suspended) return null;
  return u.role as AppRole;
}

/** Emails that are always admins (comma-separated ADMIN_EMAILS env var); bootstraps the first admin. */
export function isBootstrapAdmin(email: string | null | undefined) {
  const list = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (email && localLoginEnabled() && email.toLowerCase() === LOCAL_ADMIN_EMAIL) return true;
  return !!email && list.includes(email.toLowerCase());
}
