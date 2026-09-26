import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { Prisma } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";

function bootstrapAdmin(email?: string | null) {
  const list = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return !!email && list.includes(email.toLowerCase());
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  // Sessions are stored in the Session table, so they can be seen and revoked in Prisma Studio.
  session: { strategy: "database" },
  providers: [Google],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    // Suspended accounts can't sign in.
    async signIn({ user }) {
      if (!user.email) return false;
      const existing = await prisma.user.findUnique({ where: { email: user.email }, select: { suspended: true } });
      if (existing?.suspended && !bootstrapAdmin(user.email)) return "/login?error=Suspended";
      return true;
    },
    // Runs in src/proxy.ts for every matched request.
    authorized({ auth, request: { nextUrl } }) {
      const user = auth?.user;
      const isLoggedIn = !!user && !user.suspended;
      const path = nextUrl.pathname;

      if (path.startsWith("/login")) {
        if (isLoggedIn) return Response.redirect(new URL("/", nextUrl));
        return true;
      }
      if (!isLoggedIn) return false; // redirects to pages.signIn with a callbackUrl
      if (path.startsWith("/admin") && !can(user.role, "admin.view")) return Response.redirect(new URL("/", nextUrl));
      return true;
    },
    session({ session, user }) {
      const u = user as typeof user & { suspended?: boolean };
      session.user.id = user.id;
      session.user.role = user.role ?? "USER";
      session.user.suspended = !!u.suspended;
      return session;
    },
  },
  events: {
    // New account: apply a role an admin pre-assigned to this email, and the current starting cash.
    async createUser({ user }) {
      if (!user.id || !user.email) return;
      const [assignment, settings] = await Promise.all([
        prisma.roleAssignment.findUnique({ where: { email: user.email.toLowerCase() } }),
        prisma.appSettings.findUnique({ where: { id: "global" } }),
      ]);
      const role: Role = bootstrapAdmin(user.email) ? "ADMIN" : (assignment?.role ?? "USER");
      const cash = settings?.startingCash ?? new Prisma.Decimal(100000);
      await prisma.user.update({ where: { id: user.id }, data: { role, cashBalance: cash, startingCash: cash } });
    },
    async signIn({ user }) {
      if (!user.id) return;
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date(), ...(bootstrapAdmin(user.email) ? { role: "ADMIN" as Role } : {}) },
      });
    },
  },
});
