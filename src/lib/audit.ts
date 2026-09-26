import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

/** Records a guardrail decision or sensitive action. Never throws: logging must not break a request. */
export async function audit(userId: string | null, event: string, detail?: Prisma.InputJsonValue) {
  try {
    await prisma.auditLog.create({ data: { userId, event, detail } });
  } catch (err) {
    console.error("audit log failed", event, err);
  }
}
