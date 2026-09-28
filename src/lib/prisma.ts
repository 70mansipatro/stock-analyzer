import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@/generated/prisma/client";

// Reuse one client across hot reloads in dev so we don't exhaust connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const create = () => new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

// After a migration adds a model, a client cached from before it would lack that model
// ("Cannot read properties of undefined (reading 'findMany')"). Recreate it when that happens.
const lowerFirst = (s: string) => s[0].toLowerCase() + s.slice(1);
const isCurrent = (c: PrismaClient) => Object.values(Prisma.ModelName).every((m) => lowerFirst(m) in c);

let client = globalForPrisma.prisma;
if (client && !isCurrent(client)) {
  void client.$disconnect().catch(() => {});
  client = undefined;
}

export const prisma = client ?? create();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
