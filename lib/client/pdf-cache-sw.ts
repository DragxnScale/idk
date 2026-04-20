import { readPdfCacheEnabled } from "@/lib/client/pdf-cache-prefs";

/** Ask the service worker how many distinct cached PDF URLs exist (proxy + blob). */

export function fetchPdfCacheEntryCount(): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined") {
      resolve(null);
      return;
    }
    if (!readPdfCacheEnabled()) {
      resolve(0);
      return;
    }
    if (!navigator.serviceWorker?.controller) {
      resolve(null);
      return;
    }
    const ch = new MessageChannel();
    const done = (n: number | null) => {
      clearTimeout(t);
      resolve(n);
    };
    const t = setTimeout(() => done(null), 4000);
    ch.port1.onmessage = (ev: MessageEvent) => {
      if (ev.data?.type === "pdfCacheStats") {
        done(typeof ev.data.count === "number" ? ev.data.count : 0);
      }
    };
    try {
      navigator.serviceWorker.controller.postMessage({ type: "getPdfCacheStats" }, [ch.port2]);
    } catch {
      done(null);
    }
  });
}
