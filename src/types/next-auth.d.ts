import type { DefaultSession } from "next-auth";
import type { Role } from "@/generated/prisma/enums";

declare module "next-auth" {
  interface Session {
    user: { id: string; role: Role; suspended: boolean } & DefaultSession["user"];
  }
  interface User {
    role?: Role;
    suspended?: boolean;
  }
}
