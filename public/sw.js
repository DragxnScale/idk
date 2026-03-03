// Bowl Beacon Service Worker — network-first with auto-update
const CACHE_NAME = "bowlbeacon-v1";

// Install: activate immediately
self.addEventListener("install", () => self.skipWaiting());

// Activate: claim all clients and clear old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-first strategy — always try fresh content, fall back to cache
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Skip non-GET and API/auth requests
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/auth/")) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cache the fresh response
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// Listen for update messages from the app
self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
});
