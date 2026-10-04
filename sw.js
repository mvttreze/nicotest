const CACHE_NAME = "nico-shell-v7";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./nico-redesign.css",
  "./nico-ui.js",
  "./script.js",
  "./manifest.json",
  "./icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

// Network-first: you always get your latest files, and the cache is only the offline fallback.
// (The old cache-first version kept serving stale JS/CSS after updates.)
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) return;

  const isApiRoute =
    requestUrl.pathname.startsWith("/chat") ||
    requestUrl.pathname.startsWith("/conversations") ||
    requestUrl.pathname.startsWith("/messages");
  if (isApiRoute) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match("./index.html"))),
  );
});
