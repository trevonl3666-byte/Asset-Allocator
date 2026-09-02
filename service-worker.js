const CACHE_NAME = "asset-allocator-v18-video-flip-pwa-20260902-1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  event.respondWith(
    caches.match(req).then(cached => {
      const networkFetch = fetch(req).then(res => {
        const cloned = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, cloned)).catch(() => {});
        return res;
      }).catch(() => cached);

      return cached || networkFetch;
    })
  );
});
