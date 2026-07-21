const VERSION = "v3";
const STATIC_CACHE = `teachnotes-static-${VERSION}`;
const OFFLINE_SHELL = "/offline.html";

function isAuthOrAdminPath(pathname) {
  return pathname === "/login" || pathname.startsWith("/login/") || pathname === "/signup" || pathname.startsWith("/signup/") || pathname === "/pending" || pathname.startsWith("/pending/") || pathname === "/change-password" || pathname.startsWith("/change-password/") || pathname === "/admin" || pathname.startsWith("/admin/");
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.add(OFFLINE_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("teachnotes-") && key !== STATIC_CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/") || isAuthOrAdminPath(url.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => (await caches.match(OFFLINE_SHELL, { cacheName: STATIC_CACHE })) || Response.error()));
    return;
  }

  if (url.pathname === OFFLINE_SHELL || url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(caches.match(request, { cacheName: STATIC_CACHE }).then((cached) => cached || fetch(request).then(async (response) => { if (response.ok) await (await caches.open(STATIC_CACHE)).put(request, response.clone()); return response; })));
  }
});
