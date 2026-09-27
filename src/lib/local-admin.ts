/** The local username/password account (development). Enabled only when both env vars are set. */
export const LOCAL_ADMIN_EMAIL = "admin@localhost";

export function localLoginEnabled() {
  return !!process.env.LOCAL_ADMIN_USERNAME?.trim() && !!process.env.LOCAL_ADMIN_PASSWORD;
}
