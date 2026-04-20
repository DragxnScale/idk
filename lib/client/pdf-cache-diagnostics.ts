/**
 * When signed in as the super-owner, sends batched PDF-cache diagnostics to
 * `POST /api/debug/dev-log` so the Owner → Debug log can show why caching failed.
 */

import { readPdfCacheEnabled } from "@/lib/client/pdf-cache-prefs";

type Queued = Record<string, unknown> & { at?: string };

let queue: Queued[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let superOwnerCache: boolean | null = null;
let superOwnerCacheAt = 0;
const SUPER_TTL_MS = 60_000;

async function isSuperOwnerClient(): Promise<boolean> {
  if (Date.now() - superOwnerCacheAt < SUPER_TTL_MS && superOwnerCache !== null) {
    return superOwnerCache;
  }
  try {
    const r = await fetch("/api/user/session-context");
    if (!r.ok) {
      superOwnerCache = false;
      superOwnerCacheAt = Date.now();
      return false;
    }
    const d = (await r.json()) as { isSuperOwner?: boolean };
    superOwnerCache = !!d.isSuperOwner;
    superOwnerCacheAt = Date.now();
    return superOwnerCache;
  } catch {
    superOwnerCache = false;
    superOwnerCacheAt = Date.now();
    return false;
  }
}

async function flushQueue(): Promise<void> {
  flushTimer = null;
  const batch = queue;
  queue = [];
  if (batch.length === 0) return;
  if (!(await isSuperOwnerClient())) return;

  let ua = "";
  try {
    ua = typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : "";
  } catch {
    /* ignore */
  }

  let swSnapshot: Record<string, unknown> = {};
  try {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      swSnapshot = {
        hasController: !!navigator.serviceWorker.controller,
        scope: reg?.scope ?? null,
        activeState: reg?.active?.state ?? null,
        waitingState: reg?.waiting?.state ?? null,
      };
    }
  } catch {
    swSnapshot = { error: "sw-snapshot-failed" };
  }

  let cacheNames: string[] = [];
  try {
    if (typeof caches !== "undefined") {
      cacheNames = await caches.keys();
    }
  } catch {
    cacheNames = [];
  }

  const body = {
    message: `[pdf-cache] batch (${batch.length} events)`,
    extra: {
      events: batch,
      sw: swSnapshot,
      cacheNames: cacheNames.filter((n) => n.includes("bowlbeacon")),
      pdfCacheEnabledPref: readPdfCacheEnabled(),
      ua,
    },
    url: typeof window !== "undefined" ? window.location.href : undefined,
  };

  try {
    await fetch("/api/debug/dev-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    });
  } catch {
    /* ignore */
  }
}

function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void flushQueue(), 1200);
}

/** Owner-only: queues a diagnostic row (flushes batched ~1.2s later). */
export function reportPdfCacheTelemetry(event: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  queue.push({ ...event, at: new Date().toISOString() });
  scheduleFlush();
}

/** Owner-only: one combined snapshot (caller should await sparingly). */
export async function reportPdfCacheSnapshot(
  label: string,
  detail: Record<string, unknown>
): Promise<void> {
  if (typeof window === "undefined") return;
  if (!(await isSuperOwnerClient())) return;
  reportPdfCacheTelemetry({ step: label, ...detail });
}
