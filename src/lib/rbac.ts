// Role-based access control. Shared by server (enforcement) and client (hiding controls).
// The server is the authority: every route, server action and AI tool checks these permissions.

export type AppRole = "ADMIN" | "AUDITOR" | "USER" | "VIEWER";

export type Permission =
  | "trade" // place paper trades (UI and chat)
  | "ai.chat" // use the AI assistant
  | "ai.review" // run the AI portfolio review
  | "admin.view" // open the admin console (read-only)
  | "admin.manage"; // change roles, suspend users, reset accounts, edit platform settings

const PERMISSIONS: Record<AppRole, Permission[]> = {
  ADMIN: ["trade", "ai.chat", "ai.review", "admin.view", "admin.manage"],
  AUDITOR: ["ai.chat", "ai.review", "admin.view"],
  USER: ["trade", "ai.chat", "ai.review"],
  VIEWER: ["ai.chat"],
};

export const ROLE_INFO: Record<AppRole, { label: string; description: string; tone: string }> = {
  ADMIN: { label: "Admin", description: "Full access, including the admin console, roles and platform settings.", tone: "violet" },
  AUDITOR: { label: "Auditor", description: "Read-only admin: sees every user, trade and guardrail log, but can't change anything or trade.", tone: "sky" },
  USER: { label: "Trader", description: "Standard account: research, AI assistant and virtual trading.", tone: "emerald" },
  VIEWER: { label: "Viewer", description: "Browse markets, charts and chat with the AI, but can't trade.", tone: "slate" },
};

export const ROLES = Object.keys(ROLE_INFO) as AppRole[];

export function can(role: string | null | undefined, permission: Permission): boolean {
  return !!role && (PERMISSIONS[role as AppRole] ?? []).includes(permission);
}
