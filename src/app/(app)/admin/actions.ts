"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";
import { audit } from "@/lib/audit";
import { AccessError, isBootstrapAdmin, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { ROLE_INFO, ROLES } from "@/lib/rbac";
import { clearSettingsCache, getSettings } from "@/lib/settings";

export type ActionResult = { ok: boolean; message: string } | null;

async function guard<T>(fn: (actorId: string, actorEmail: string) => Promise<T>): Promise<ActionResult> {
  try {
    const actor = await requirePermission("admin.manage");
    await fn(actor.id, actor.email);
    revalidatePath("/", "layout");
    return null;
  } catch (err) {
    if (err instanceof AccessError || err instanceof AdminRuleError) return { ok: false, message: err.message };
    console.error("admin action failed", err);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

class AdminRuleError extends Error {}

const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.");
const roleSchema = z.enum(ROLES as [Role, ...Role[]]);

/** Give a role to an email. Applies now if they have an account, otherwise on their first sign-in. */
export async function assignRole(_: ActionResult, form: FormData): Promise<ActionResult> {
  const email = emailSchema.safeParse(form.get("email"));
  const role = roleSchema.safeParse(form.get("role"));
  if (!email.success) return { ok: false, message: email.error.issues[0].message };
  if (!role.success) return { ok: false, message: "Choose a role." };
  let message = "";
  const res = await guard(async (actorId, actorEmail) => {
    if (email.data === actorEmail.toLowerCase()) throw new AdminRuleError("You can't change your own role.");
    if (isBootstrapAdmin(email.data) && role.data !== "ADMIN") throw new AdminRuleError("This email is a permanent admin (ADMIN_EMAILS) and can't be demoted.");
    const existing = await prisma.user.findUnique({ where: { email: email.data } });
    if (existing?.role === "ADMIN" && role.data !== "ADMIN") {
      const admins = await prisma.user.count({ where: { role: "ADMIN", suspended: false } });
      if (admins <= 1) throw new AdminRuleError("There must be at least one admin.");
    }
    await prisma.roleAssignment.upsert({
      where: { email: email.data },
      create: { email: email.data, role: role.data, assignedById: actorId, note: String(form.get("note") ?? "").slice(0, 120) || null },
      update: { role: role.data, assignedById: actorId, note: String(form.get("note") ?? "").slice(0, 120) || null },
    });
    if (existing) await prisma.user.update({ where: { id: existing.id }, data: { role: role.data } });
    await audit(actorId, "admin_role_assigned", { email: email.data, role: role.data, from: existing?.role ?? null });
    message = existing
      ? `${email.data} is now ${ROLE_INFO[role.data].label}.`
      : `${email.data} will become ${ROLE_INFO[role.data].label} when they first sign in.`;
  });
  return res ?? { ok: true, message };
}

export async function removeAssignment(email: string): Promise<ActionResult> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { ok: false, message: "Invalid email." };
  const res = await guard(async (actorId) => {
    await prisma.roleAssignment.deleteMany({ where: { email: parsed.data } });
    await audit(actorId, "admin_assignment_removed", { email: parsed.data });
  });
  return res ?? { ok: true, message: `Removed the pending role for ${parsed.data}.` };
}

export async function setSuspended(userId: string, suspended: boolean): Promise<ActionResult> {
  let email = "";
  const res = await guard(async (actorId) => {
    if (userId === actorId) throw new AdminRuleError("You can't suspend yourself.");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (suspended && isBootstrapAdmin(user.email)) throw new AdminRuleError("Permanent admins can't be suspended.");
    email = user.email;
    await prisma.user.update({ where: { id: userId }, data: { suspended } });
    if (suspended) await prisma.session.deleteMany({ where: { userId } }); // signs them out everywhere
    await audit(actorId, suspended ? "admin_user_suspended" : "admin_user_restored", { email: user.email });
  });
  return res ?? { ok: true, message: suspended ? `${email} is suspended and signed out.` : `${email} can sign in again.` };
}

/** Clears holdings and trades and gives the account the current starting cash. */
export async function resetAccount(userId: string): Promise<ActionResult> {
  let email = "";
  let amount = 0;
  const res = await guard(async (actorId) => {
    const settings = await getSettings();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    email = user.email;
    amount = settings.startingCash;
    const cash = new Prisma.Decimal(settings.startingCash);
    await prisma.$transaction([
      prisma.holding.deleteMany({ where: { userId } }),
      prisma.trade.deleteMany({ where: { userId } }),
      prisma.user.update({ where: { id: userId }, data: { cashBalance: cash, startingCash: cash } }),
    ]);
    await audit(actorId, "admin_account_reset", { email: user.email, startingCash: settings.startingCash });
  });
  return res ?? { ok: true, message: `Reset ${email} to $${amount.toLocaleString()} of virtual cash.` };
}

const settingsSchema = z.object({
  maxOrderValue: z.coerce.number().min(100).max(10_000_000),
  maxSharesPerOrder: z.coerce.number().int().min(1).max(1_000_000),
  startingCash: z.coerce.number().min(1_000).max(100_000_000),
  tradingEnabled: z.boolean(),
  aiEnabled: z.boolean(),
});

export async function updateSettings(_: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = settingsSchema.safeParse({
    maxOrderValue: form.get("maxOrderValue"),
    maxSharesPerOrder: form.get("maxSharesPerOrder"),
    startingCash: form.get("startingCash"),
    tradingEnabled: form.get("tradingEnabled") === "on",
    aiEnabled: form.get("aiEnabled") === "on",
  });
  if (!parsed.success) return { ok: false, message: "Check the values: " + parsed.error.issues.map((i) => i.path.join(".")).join(", ") };
  const res = await guard(async (actorId) => {
    const d = parsed.data;
    const data = {
      maxOrderValue: new Prisma.Decimal(d.maxOrderValue),
      maxSharesPerOrder: d.maxSharesPerOrder,
      startingCash: new Prisma.Decimal(d.startingCash),
      tradingEnabled: d.tradingEnabled,
      aiEnabled: d.aiEnabled,
      updatedById: actorId,
    };
    await prisma.appSettings.upsert({ where: { id: "global" }, create: { id: "global", ...data }, update: data });
    clearSettingsCache();
    await audit(actorId, "admin_settings_updated", d);
  });
  return res ?? { ok: true, message: "Platform settings saved. They apply immediately." };
}
