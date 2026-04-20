// Bowl Beacon Service Worker — v4 offline-capable
// v4: PDF eviction groups by logical URL (range requests = one PDF), not raw cache entry count.
const CACHE_VERSION = "v4";
const SHELL_CACHE = `bowlbeacon-shell-${CACHE_VERSION}`;
const API_CACHE = `bowlbeacon-api-${CACHE_VERSION}`;
const PDF_CACHE = `bowlbeacon-pdf-${CACHE_VERSION}`;

// PDF cache limits — updated at runtime via postMessage from the page.
// pdfMaxCount = max distinct PDF URLs (proxy or blob), not raw Cache API entries.
// Defaults: keep at most 2 PDFs, and at most 500 MB total.
let pdfMaxCount = 2;
let pdfMaxBytes = 500 * 1024 * 1024; // 500 MB
let pdfCacheEnabled = true; // can be disabled by user

// API GET routes to cache with stale-while-revalidate so the app loads offline
const CACHED_API_PREFIXES = [
  "/api/auth/session",
  "/api/study/stats",
  "/api/textbooks",
  "/api/user/drive",
  "/api/user/settings",
  "/api/user/textbook-progress",
  "/api/study/sessions",
];

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !k.endsWith(CACHE_VERSION))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // PDF proxy: cache-first (PDFs are immutable once loaded, large files)
  if (url.pathname.startsWith("/api/proxy/pdf")) {
    event.respondWith(cacheFirst(request, PDF_CACHE));
    return;
  }

  // Public Vercel Blob PDFs: cache-first
  if (url.hostname.endsWith("blob.vercel-storage.com") && url.pathname.endsWith(".pdf")) {
    event.respondWith(cacheFirst(request, PDF_CACHE));
    return;
  }

  // Whitelisted API GETs: stale-while-revalidate
  if (CACHED_API_PREFIXES.some((p) => url.pathname.startsWith(p))) {
    event.respondWith(staleWhileRevalidate(request, API_CACHE));
    return;
  }

  // Skip other API / auth routes
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;

  // App shell: network-first with cache fallback
  event.respondWith(networkFirstWithFallback(request));
});

// Cache-first: serve from cache, fetch and cache on miss
async function cacheFirst(request, cacheName) {
  // If PDF caching is disabled by the user, just fetch directly
  if (cacheName === PDF_CACHE && !pdfCacheEnabled) {
    try {
      return await fetch(request);
    } catch {
      return new Response("Offline — PDF caching is disabled in Settings", { status: 503 });
    }
  }
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    // 200 full / 206 ranges (pdf.js) — both cacheable
    if (response.ok || response.status === 206) {
      const cache = await caches.open(cacheName);
      try {
        await cache.put(request, response.clone());
      } catch {
        /* Some browsers are picky; PDF still works from network */
      }
      if (cacheName === PDF_CACHE) {
        evictPdfCache().catch(() => {});
      }
    }
    return response;
  } catch {
    return new Response("Offline — PDF not yet cached", { status: 503 });
  }
}

/**
 * Evict least-recently cached logical PDFs (same URL = one book, many Range requests).
 */
async function evictPdfCache() {
  const cache = await caches.open(PDF_CACHE);

  for (let safety = 0; safety < 32; safety++) {
    const keys = await cache.keys();
    if (keys.length === 0) return;

    const groups = new Map();
    for (const req of keys) {
      const logical = req.url;
      const res = await cache.match(req);
      const size = Number(res?.headers?.get("content-length") ?? 0);
      const dateStr = res?.headers?.get("date");
      const date = dateStr ? new Date(dateStr).getTime() : 0;
      if (!groups.has(logical)) {
        groups.set(logical, { reqs: [], bytes: 0, date: Infinity });
      }
      const g = groups.get(logical);
      g.reqs.push(req);
      g.bytes += size;
      g.date = Math.min(g.date, date || 0);
    }

    const list = [...groups.values()].sort((a, b) => a.date - b.date);
    let totalBytes = list.reduce((s, g) => s + g.bytes, 0);
    let logicalCount = list.length;

    if (logicalCount <= pdfMaxCount && totalBytes <= pdfMaxBytes) return;

    const victim = list[0];
    for (const req of victim.reqs) {
      await cache.delete(req);
    }
  }
}

// Stale-while-revalidate: return cache immediately, update in background
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    fetchPromise.catch(() => {});
    return cached;
  }

  const fresh = await fetchPromise;
  return (
    fresh ??
    new Response(JSON.stringify({ offline: true }), {
      headers: { "Content-Type": "application/json" },
      status: 503,
    })
  );
}

// Network-first: try network, fall back to cache
async function networkFirstWithFallback(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return (
      cached ??
      new Response("You are offline and this page has not been cached yet.", {
        status: 503,
      })
    );
  }
}

self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
  if (event.data?.type === "getPdfCacheStats" && event.ports?.[0]) {
    const port = event.ports[0];
    caches
      .open(PDF_CACHE)
      .then(async (cache) => {
        const keys = await cache.keys();
        const logical = new Set(keys.map((r) => r.url));
        port.postMessage({
          type: "pdfCacheStats",
          count: logical.size,
          entries: keys.length,
        });
      })
      .catch(() => {
        port.postMessage({ type: "pdfCacheStats", count: 0, entries: 0 });
      });
  }
  if (event.data?.type === "setPdfCacheLimits") {
    if (typeof event.data.maxCount === "number") pdfMaxCount = event.data.maxCount;
    if (typeof event.data.maxBytes === "number") pdfMaxBytes = event.data.maxBytes;
    evictPdfCache().catch(() => {});
  }
  if (event.data?.type === "setPdfCacheEnabled") {
    pdfCacheEnabled = !!event.data.enabled;
    if (!pdfCacheEnabled) caches.delete(PDF_CACHE).catch(() => {});
  }
});
