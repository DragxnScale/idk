/** Device-local prefs for offline PDF caching (`localStorage` + Cache API), mirrored in `public/sw.js`. */

const ENABLED_KEY = "bowlbeacon-pdf-cache-enabled";

export function readPdfCacheEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(ENABLED_KEY) !== "false";
  } catch {
    return true;
  }
}

/**
 * Remove all `bowlbeacon-pdf-*` caches from the page (backup if SW message is missed).
 * Call when the user turns off offline PDF caching.
 */
export async function clearAllPdfCachesClient(): Promise<void> {
  if (typeof window === "undefined" || !("caches" in window)) return;
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith("bowlbeacon-pdf-")).map((k) => caches.delete(k))
    );
  } catch {
    /* ignore */
  }
}
