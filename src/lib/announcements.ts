import "server-only";
import { z } from "zod";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/authz";
import { announcementEmail, sendEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { can, type AppRole } from "@/lib/rbac";

/** Admin broadcast emails ("email all members"). Admin-only, confirmed in the UI first, and audited. */

export class AnnouncementError extends Error {}

export const AUDIENCES = ["all", "ADMIN", "AUDITOR", "USER", "VIEWER"] as const;
export type Audience = (typeof AUDIENCES)[number];

export const announcementInput = z.object({
  subject: z.string().trim().min(3, "Subject is too short.").max(120),
  message: z.string().trim().min(10, "Message is too short.").max(4000),
  audience: z.enum(AUDIENCES).default("all"),
});
export type AnnouncementInput = z.input<typeof announcementInput>;

const MAX_PER_HOUR = 3;
// Addresses that can never receive mail (same rule as the outbox).
const undeliverable = (to: string) => /@(localhost|example\.(com|org|net|invalid)|[^@]+\.(invalid|test|local))$/i.test(to);

/** Active users who'd receive it: not suspended, deliverable, and haven't turned announcements off. */
export async function recipients(audience: Audience) {
  const users = await prisma.user.findMany({
    where: { suspended: false, ...(audience === "all" ? {} : { role: audience as AppRole }) },
    select: { id: true, email: true, emailPrefs: true },
  });
  const deliverable = users.filter((u) => !undeliverable(u.email));
  const optedIn = deliverable.filter((u) => (u.emailPrefs as Record<string, boolean> | null)?.announcements !== false);
  return { users: optedIn, optedOut: deliverable.length - optedIn.length };
}

export async function previewAnnouncement(raw: AnnouncementInput) {
  const input = announcementInput.parse(raw);
  const r = await recipients(input.audience);
  return { ...input, count: r.users.length, optedOut: r.optedOut };
}

export async function sendAnnouncement(actor: Actor, raw: AnnouncementInput) {
  if (!can(actor.role, "admin.manage")) throw new AnnouncementError("Only admins can email all users.");
  const parsed = announcementInput.safeParse(raw);
  if (!parsed.success) throw new AnnouncementError(parsed.error.issues[0].message);
  const input = parsed.data;

  const recent = await prisma.auditLog.count({ where: { userId: actor.id, event: "admin_announcement_sent", createdAt: { gt: new Date(Date.now() - 3_600_000) } } });
  if (recent >= MAX_PER_HOUR) throw new AnnouncementError(`You can send up to ${MAX_PER_HOUR} announcements per hour. Try again later.`);

  const { users, optedOut } = await recipients(input.audience);
  if (!users.length) throw new AnnouncementError("No one would receive this: there are no active users with a deliverable email in that group.");

  const mail = announcementEmail({ subject: input.subject, message: input.message, from: actor.name ?? actor.email });
  // One email per person (never a shared To/CC list), queued through the outbox with retries.
  for (const u of users) await sendEmail({ to: u.email, kind: "announcement", userId: u.id, ...mail });

  await audit(actor.id, "admin_announcement_sent", { subject: input.subject, audience: input.audience, recipients: users.length, optedOut });
  return { subject: input.subject, audience: input.audience, sent: users.length, optedOut };
}
