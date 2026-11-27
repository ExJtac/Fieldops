/* Opt-in app shell only. Operational API responses and evidence are never cached here. */
const SCOPE = new URL(self.registration.scope).pathname;
const CACHE = "fieldops-shell-v1-" + SCOPE;
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE),
        response = await fetch(SCOPE, { cache: "reload" });
      if (!response.ok) throw new Error("Cannot cache app shell");
      const html = await response.clone().text();
      await cache.put(SCOPE, response);
      const paths = [
        ...html.matchAll(/(?:src|href)="([^"]*\/(?:assets)\/[^"?]+)"/g),
      ].map((m) => new URL(m[1], self.location.origin).href);
      for (const path of paths) {
        const url = new URL(path);
        if (
          url.origin !== self.location.origin ||
          !url.pathname.startsWith(SCOPE + "assets/")
        )
          continue;
        const res = await fetch(path);
        if (!res.ok) throw new Error("Cannot cache required app asset");
        await cache.put(path, res.clone());
        if (url.pathname.endsWith(".css")) {
          const css = await res.text();
          for (const match of css.matchAll(
            /url\((?:["']?)([^)"']+)(?:["']?)\)/g,
          )) {
            const font = new URL(match[1], path);
            if (
              font.origin === self.location.origin &&
              font.pathname.startsWith(SCOPE + "assets/")
            ) {
              const f = await fetch(font);
              if (f.ok) await cache.put(font.href, f);
            }
          }
        }
      }
      await self.skipWaiting();
    })(),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("fetch", (event) => {
  const u = new URL(event.request.url);
  if (event.request.method !== "GET" || u.origin !== self.location.origin)
    return;
  if (u.pathname === SCOPE && event.request.mode === "navigate")
    event.respondWith(
      fetch(event.request)
        .then(async (response) => {
          if (response.ok)
            await (await caches.open(CACHE)).put(SCOPE, response.clone());
          return response;
        })
        .catch(async () => {
          const response = await caches.match(SCOPE);
          return response || Response.error();
        }),
    );
  else if (u.pathname.startsWith(SCOPE + "assets/"))
    event.respondWith(
      (async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response.ok)
          (await caches.open(CACHE)).put(event.request, response.clone());
        return response;
      })(),
    );
});
