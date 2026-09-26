import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Next.js reads .env.local; load the same file for the Prisma CLI.
config({ path: ".env.local" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
