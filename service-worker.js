const CACHE_NAME = "asset-allocator-v20-pie-module-only-single-organic-depth-54-20260904";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./asset-pie-motion-model.js",
  "./asset-pie-view.js",
  "./assets/usd-background.png",
  "./assets/gold-background.jpeg",
  "./assets/cny-background.jpeg",
  "./assets/hkd-background.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL.map(url => new Request(url, { cache: "reload" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => key === CACHE_NAME ? Promise.resolve() : caches.delete(key)));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (_) {}
    }
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  // For page navigations, prefer fresh network HTML so an installed iPhone PWA doesn't stay on stale UI.
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const preload = await event.preloadResponse;
        const res = preload || await fetch(req, { cache: "no-store" });
        const cache = await caches.open(CACHE_NAME);
        cache.put("./index.html", res.clone()).catch(() => {});
        return res;
      } catch (_) {
        return (await caches.match("./index.html")) || (await caches.match("./"));
      }
    })());
    return;
  }

  // Static shell: stale-while-revalidate, but force validation against the network.
  event.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req, { cache: "no-store" }).then(async res => {
      if (res && res.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    }).catch(() => null);
    return cached || await network || Response.error();
  })());
});
