export type ToastKind = "success" | "error" | "info";
export type ToastEvent = { kind: ToastKind; title: string; body?: string };

/** Fire a toast from any client component; <Toaster /> in the app layout shows it. */
export function toast(kind: ToastKind, title: string, body?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ToastEvent>("app:toast", { detail: { kind, title, body } }));
}
