import "server-only";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { can, type AppRole, type Permission } from "@/lib/rbac";

export class AccessError extends Error {}

export type Actor = { id: string; email: string; name: string | null; role: AppRole };

/** Current user from the session, re-read from the database so role and suspension changes apply instantly. */
export async function currentActor(): Promise<Actor | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, email: true, name: true, role: true, suspended: true } });
  if (!user || user.suspended) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role as AppRole };
}

/** Throws AccessError unless the signed-in user has the permission. */
export async function requirePermission(permission: Permission): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) throw new AccessError("Please sign in again.");
  if (!can(actor.role, permission)) throw new AccessError(`Your role doesn't allow this (${permission}).`);
  return actor;
}

export { isBootstrapAdmin, roleOf } from "@/lib/roles";
