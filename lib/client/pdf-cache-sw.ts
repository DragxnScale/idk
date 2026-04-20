import { readPdfCacheEnabled } from "@/lib/client/pdf-cache-prefs";
import { reportPdfCacheTelemetry } from "@/lib/client/pdf-cache-diagnostics";

/** Ask the service worker how many distinct cached PDF URLs exist (proxy + blob). */

export function fetchPdfCacheEntryCount(): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined") {
      void reportPdfCacheTelemetry({
        step: "fetchPdfCacheEntryCount",
        reason: "no-navigator",
        result: null,
      });
      resolve(null);
      return;
    }
    if (!readPdfCacheEnabled()) {
      void reportPdfCacheTelemetry({
        step: "fetchPdfCacheEntryCount",
        reason: "pref-off",
        result: 0,
      });
      resolve(0);
      return;
    }
    if (!navigator.serviceWorker?.controller) {
      void reportPdfCacheTelemetry({
        step: "fetchPdfCacheEntryCount",
        reason: "no-sw-controller",
        result: null,
        hasServiceWorker: !!navigator.serviceWorker,
      });
      resolve(null);
      return;
    }
    const ch = new MessageChannel();
    let settled = false;
    const finish = (result: number | null, reason: string, extra?: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      void reportPdfCacheTelemetry({
        step: "fetchPdfCacheEntryCount",
        reason,
        result,
        ...extra,
      });
      resolve(result);
    };

    const t = setTimeout(() => finish(null, "sw-reply-timeout-4s"), 4000);
    ch.port1.onmessage = (ev: MessageEvent) => {
      if (ev.data?.type === "pdfCacheStats") {
        const count = typeof ev.data.count === "number" ? ev.data.count : 0;
        const entries = typeof ev.data.entries === "number" ? ev.data.entries : undefined;
        finish(count, "ok", { rawEntries: entries });
      }
    };
    try {
      navigator.serviceWorker.controller.postMessage({ type: "getPdfCacheStats" }, [ch.port2]);
    } catch (e) {
      finish(null, "postMessage-threw", { err: String(e) });
    }
  });
}
