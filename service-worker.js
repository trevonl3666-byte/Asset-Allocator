const CACHE_NAME = "asset-allocator-v66";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./assets/usd-background.png",
  "./assets/cny-background.jpeg",
  "./assets/gold-background.jpeg",
  "./manifest.json",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(async response => {
          if (response && response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put("./", response.clone());
            await cache.put("./index.html", response.clone());
          }
          return response;
        })
        .catch(async () => {
          return (await caches.match("./")) ||
                 (await caches.match("./index.html")) ||
                 new Response("Asset Allocator is unavailable offline until it has been opened online once.", {
                   status: 503,
                   headers: { "Content-Type": "text/plain; charset=utf-8" }
                 });
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      const networkFetch = fetch(request).then(async response => {
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, response.clone());
        }
        return response;
      });
      return cached || networkFetch;
    })
  );
});
