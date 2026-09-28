"use server";

import { revalidatePath } from "next/cache";
import { currentActor } from "@/lib/authz";
import { EMAIL_CATEGORIES, type EmailCategory } from "@/lib/email";
import { prisma } from "@/lib/prisma";

export async function setEmailPref(category: EmailCategory, on: boolean) {
  const actor = await currentActor();
  if (!actor || !EMAIL_CATEGORIES.some((c) => c.id === category)) return { ok: false };
  const u = await prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: { emailPrefs: true } });
  const prefs = { ...((u.emailPrefs ?? {}) as Record<string, boolean>), [category]: on };
  await prisma.user.update({ where: { id: actor.id }, data: { emailPrefs: prefs } });
  revalidatePath("/settings");
  return { ok: true };
}
