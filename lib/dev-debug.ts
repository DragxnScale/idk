/**
 * Owner-only: POSTs to `/api/debug/dev-log` when the signed-in account is the super-owner.
 * No-op if not in browser or not owner (server returns 403 — caller can ignore).
 */
export async function reportDevDebug(message: string, extra?: unknown): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await fetch("/api/debug/dev-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        extra,
        url: window.location.href,
      }),
      keepalive: true,
    });
  } catch {
    /* ignore */
  }
}
