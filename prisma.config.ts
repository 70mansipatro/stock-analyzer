import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Match Next.js: .env.local wins, then .env (values already set are not overwritten).
config({ path: [".env.local", ".env"], quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
