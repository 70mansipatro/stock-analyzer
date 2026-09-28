import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@/generated/prisma/client";

// Signature of the generated schema (every model and field). It changes whenever a migration
// adds a table or column and `prisma generate` rewrites the client.
const SCHEMA_SIGNATURE = JSON.stringify(
  Object.entries(Prisma)
    .filter(([k]) => k.endsWith("ScalarFieldEnum"))
    .map(([k, v]) => [k, Object.keys(v as object)])
    .sort(),
);

// Reuse one client across hot reloads in dev so we don't exhaust connections, but only while it
// matches the current schema; otherwise a stale client rejects new fields ("Unknown argument ...").
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; prismaSignature?: string };

if (globalForPrisma.prisma && globalForPrisma.prismaSignature !== SCHEMA_SIGNATURE) {
  void globalForPrisma.prisma.$disconnect().catch(() => {});
  globalForPrisma.prisma = undefined;
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaSignature = SCHEMA_SIGNATURE;
}
