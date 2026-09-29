/** Runs once when the server starts. Every minute: checks price alerts and runs due auto-traders. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const g = globalThis as typeof globalThis & { __alertTimer?: ReturnType<typeof setInterval> };
  if (g.__alertTimer) return; // dev hot reload
  const { checkAlerts } = await import("@/lib/alerts");
  const { runDueAgents } = await import("@/lib/agent/engine");
  const tick = () => {
    checkAlerts().catch((err) => console.error("alert check failed", err));
    runDueAgents().catch((err) => console.error("auto-trader tick failed", err));
  };
  g.__alertTimer = setInterval(tick, 60_000);
  setTimeout(tick, 10_000);
}
