import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
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
  // Google verifies email ownership, so a Google sign-in may join an account first created with an email code.
  providers: [Google({ allowDangerousEmailAccountLinking: true })],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    // Suspended accounts can't sign in.
    async signIn({ user }) {
      if (!user.email) return false;
      const blocked = await prisma.blockedEmail.findUnique({ where: { email: user.email.toLowerCase() } });
      if (blocked && !bootstrapAdmin(user.email)) return "/login?error=Removed";
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
    // New account: pre-assigned role, starting cash and welcome email (shared with email-code sign-in).
    async createUser({ user }) {
      if (!user.id || !user.email) return;
      const { onboardUser } = await import("@/lib/onboarding");
      await onboardUser({ id: user.id, email: user.email, name: user.name });
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
