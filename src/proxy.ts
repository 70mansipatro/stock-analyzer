export { auth as proxy } from "@/auth";

export const config = {
  // Protect everything except auth endpoints, Next internals and static files.
  matcher: ["/((?!api/auth|api/alerts/check|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)"],
};
