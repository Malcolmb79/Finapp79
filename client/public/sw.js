/**
 * The service worker: what makes this installable, and what it must never do.
 *
 * The manifest and icons were already here, so the app could be added to a
 * home screen — but a browser will not offer to install a site that has no
 * service worker, and without one it opens to a blank page the moment there
 * is no signal.
 *
 * The caching rule that matters is a prohibition: **nothing under /api is
 * ever cached**. Every other kind of app can serve a stale response and call
 * it resilience. A balance from last Tuesday rendered as today's, with no
 * indication it is old, is worse than an error — the error is visibly wrong
 * and the stale figure is invisibly wrong, and someone makes a decision on
 * it. So API requests are network-only, and when the network is gone they
 * fail and the app shows the error state it already has.
 *
 * What is cached is the shell: the HTML, the script and the stylesheet. Those
 * are the same bytes whether you are online or not, and caching them is what
 * makes the app open at all.
 */

// Bumping this discards everything cached under the old name on activate.
const CACHE = "finance-shell-v1";

self.addEventListener("install", (event) => {
  // The shell is cached as it is fetched rather than from a hard-coded list:
  // the build hashes its filenames, so a list written here would name files
  // that stopped existing at the next deploy.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })()
  );
});

/** Whether this is a request for data rather than for the app itself. */
function isApi(url) {
  return url.pathname.startsWith("/api/");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Anything that changes something on the server is never served from, or
  // written to, a cache.
  if (request.method !== "GET") return;
  // Another origin's response is not ours to keep.
  if (url.origin !== self.location.origin) return;
  // The prohibition. Left to the network entirely — not even a fallback,
  // because a fallback is exactly how a stale balance reaches a screen.
  if (isApi(url)) return;

  // A navigation: try the network so a deploy is picked up, and fall back to
  // the cached shell so the app opens with no signal.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const cache = await caches.open(CACHE);
          cache.put("/index.html", response.clone());
          return response;
        } catch {
          const cached = await caches.match("/index.html");
          return cached ?? Response.error();
        }
      })()
    );
    return;
  }

  // Static assets. Served from cache when present — the build gives them
  // hashed names, so a cached one is never the wrong version — and refreshed
  // in the background for the ones that are not hashed.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      const network = fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(CACHE);
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => null);

      return cached ?? (await network) ?? Response.error();
    })()
  );
});
