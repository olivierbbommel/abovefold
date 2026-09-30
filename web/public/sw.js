// abovefold service worker, app shell + offline Today view.
//
// Strategy:
//   - Navigations (HTML): network-first, falling back to the cache when
//     offline. The last successful `/` response is kept so a cold, offline
//     load still renders Today.
//   - `/_next/static/*` (hashed build assets): cache-first, they're
//     immutable per build, safe to serve straight from cache.
//   - Everything else falls through to the network untouched.
//
// Hard exclusions, never intercepted, never cached:
//   `/v1/*`       , Miniflux Reader API used by native clients (Reeder, etc).
//   `/googlereader/*`, same Reader API, Google Reader-compatible surface.
//   `/proxy/*`    , Miniflux media proxy (thumbnails); must always hit the network.
//   `/api/*`      , our own routes, including interaction/read writes.
// Caching or intercepting any of these breaks real behavior, see the
// implementation plan (Task 7).

const CACHE_VERSION = "abovefold-v2";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const PAGES_CACHE = `${CACHE_VERSION}-pages`;

const APP_SHELL = ["/manifest.json", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"];

function isExcludedPath(pathname) {
  return (
    pathname.startsWith("/v1/") ||
    pathname === "/v1" ||
    pathname.startsWith("/googlereader/") ||
    pathname === "/googlereader" ||
    pathname.startsWith("/proxy/") ||
    pathname === "/proxy" ||
    pathname.startsWith("/api/") ||
    pathname === "/api"
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("abovefold-") && key !== SHELL_CACHE && key !== PAGES_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isExcludedPath(url.pathname)) return;

  // Next.js hashed static build assets: cache-first, they never change
  // content under a given hash.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Navigations / HTML documents: network-first with cache fallback, so a
  // cold offline load still renders the last-seen Today view.
  if (request.mode === "navigate" || request.headers.get("accept")?.includes("text/html")) {
    event.respondWith(networkFirst(request));
    return;
  }
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(SHELL_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(PAGES_CACHE);
  try {
    const response = await fetch(request);
    // A session that has expired mid-flight gets redirected (307) to
    // /login by middleware.ts, and `fetch` follows that transparently , 
    // `response.ok` is still true, it's just the login page wearing the
    // URL of whatever was requested. Caching that would mean the offline
    // fallback below (`cache.match("/")`) permanently serves the login
    // screen instead of Today once the session comes back. Skip caching
    // any response that was redirected, or that resolved to /login.
    const landedOnLogin = new URL(response.url).pathname === "/login";
    if (response.ok && !response.redirected && !landedOnLogin) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    // No cached copy for this exact page, fall back to the cached Today
    // view so an offline visitor at least sees something.
    const home = await cache.match("/");
    if (home) return home;
    throw err;
  }
}
