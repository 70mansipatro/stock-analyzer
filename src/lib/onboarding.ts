import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { isBootstrapAdmin } from "@/lib/roles";

/**
 * First sign-in of a new account (Google or email code): apply a role an admin pre-assigned to this email,
 * the current starting cash, and send the welcome email.
 */
export async function onboardUser(user: { id: string; email: string; name?: string | null }) {
  const [assignment, settings] = await Promise.all([
    prisma.roleAssignment.findUnique({ where: { email: user.email.toLowerCase() } }),
    prisma.appSettings.findUnique({ where: { id: "global" } }),
  ]);
  const role: Role = isBootstrapAdmin(user.email) ? "ADMIN" : (assignment?.role ?? "USER");
  const cash = settings?.startingCash ?? new Prisma.Decimal(100000);
  await prisma.user.update({ where: { id: user.id }, data: { role, cashBalance: cash, startingCash: cash } });

  // Welcome email (or "welcome back" if this email was removed before and allowed to rejoin).
  try {
    const { sendEmail, welcomeEmail } = await import("@/lib/email");
    const { ROLE_INFO, can } = await import("@/lib/rbac");
    const returning = (await prisma.auditLog.count({ where: { event: "admin_user_removed", detail: { path: ["email"], equals: user.email } } })) > 0;
    const mail = welcomeEmail({
      name: user.name,
      roleLabel: ROLE_INFO[role].label,
      roleDescription: ROLE_INFO[role].description,
      cashLabel: `$${Number(cash).toLocaleString("en-US")}`,
      returning,
      canTrade: can(role, "trade"),
    });
    await sendEmail({ to: user.email, kind: returning ? "welcome_back" : "welcome", userId: user.id, ...mail });
  } catch (err) {
    console.error("welcome email failed", err);
  }
}
