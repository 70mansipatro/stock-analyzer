import { z } from "zod";
import { currentActor } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

/** Latest notifications for the bell in the top bar. */
export async function GET() {
  const actor = await currentActor();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId: actor.id }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.notification.count({ where: { userId: actor.id, readAt: null } }),
  ]);
  return Response.json({
    unread,
    items: items.map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link, read: !!n.readAt, createdAt: n.createdAt.toISOString() })),
  });
}

const markSchema = z.object({ ids: z.array(z.string().max(40)).max(50).optional(), all: z.boolean().optional() });

/** Mark some (or all) as read. */
export async function POST(req: Request) {
  const actor = await currentActor();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  const body = markSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return new Response("Bad request", { status: 400 });
  await prisma.notification.updateMany({
    where: { userId: actor.id, readAt: null, ...(body.data.all ? {} : { id: { in: body.data.ids ?? [] } }) },
    data: { readAt: new Date() },
  });
  return Response.json({ ok: true });
}
