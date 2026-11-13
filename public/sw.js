// Offline support (see src/lib/offline.ts). Keeps a copy of the app's page and files
// so it opens with no internet. Always asks the network first, so updates show up
// right away when online; the copy is only used when the network can't answer.
// Never touches sign-in or data requests (/api/, server functions): those must be live.
const CACHE = "timeclock-v1";
const PAGE = "/";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

function cacheable(url) {
  const fonts = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (fonts) return true;
  if (url.origin !== self.location.origin) return false;
  const p = url.pathname;
  return !(p.startsWith("/api/") || p.includes("/_serverFn") || p === "/sw.js");
}

async function fetchWithin(request, ms) {
  const ctl = new AbortController();
  const id = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(request, { signal: ctl.signal });
  } finally {
    clearTimeout(id);
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (!cacheable(url)) return;
  const isPage = req.mode === "navigate";
  // Only the clock page works offline; sign-in links and password resets need the internet.
  if (isPage && url.pathname !== PAGE) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const key = isPage ? PAGE : req;
      try {
        // A dead connection can hang instead of failing, so give up after a few seconds.
        const res = await fetchWithin(req, isPage ? 4000 : 8000);
        if (res.ok || res.type === "opaque") await cache.put(key, res.clone());
        return res;
      } catch (e) {
        const hit = await cache.match(key);
        if (hit) return hit;
        throw e;
      }
    })(),
  );
});

// The page lists the files it already loaded before this worker took over, so the very
// first visit is enough to work offline next time.
self.addEventListener("message", (event) => {
  const urls = event.data && event.data.type === "cache-urls" ? event.data.urls : null;
  if (!Array.isArray(urls)) return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const u of urls) {
        try {
          const url = new URL(u, self.location.origin);
          if (!cacheable(url)) continue;
          const key = url.origin === self.location.origin && url.pathname === PAGE ? PAGE : url.href;
          if (await cache.match(key)) continue;
          const res = await fetch(url.href, url.origin === self.location.origin ? {} : { mode: "no-cors" });
          if (res.ok || res.type === "opaque") await cache.put(key, res);
        } catch {
          /* offline or blocked: try again next visit */
        }
      }
    })(),
  );
});
