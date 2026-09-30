/* ===========================================================
   public/sw.js - offline cache for the Next.js build

   Registered by components/providers.tsx (production only).

   A service worker is a cache in front of the app, so it has to obey
   the same rules Next.js documents for a CDN (see
   node_modules/next/dist/docs/01-app/02-guides/cdn-caching.md): an App
   Router URL is not one resource. The same path yields HTML for a
   navigation and a React Flight payload for a soft navigation, and the
   two are told apart only by the RSC / Next-Router-* headers and the
   `_rsc` search parameter. Cache Storage's `Vary` matching is not
   reliable enough to keep them apart, so handing a cached HTML document
   to the router's Flight parser is what produces

       chunk.reason.enqueueModel is not a function

   at resolveModelChunk in the React client. Therefore:

   1. RSC traffic, Server Actions, HMR and reload / no-cache asks are
      never intercepted - return without respondWith and let the browser
      talk to the network itself. Bundled offline content (/data/,
      /templates/) IS intercepted even for no-store fetches: it is
      precached and served network-first, so online users still get a
      fresh copy and offline users get the cached one.
   2. Content-addressed assets (/_next/static/, /icons/) are
      cache-first: a given URL can never be the wrong version.
   3. Everything the app needs offline (question bank, syllabus,
      templates, documents) is network-first with a cached fallback, so
      an online user never gets a stale copy - only an offline one.

   VERSION must be bumped whenever the caching rules change: activate
   deletes every cache that is not the current pair, which is how a
   previously poisoned cache is cleared.
   =========================================================== */

const VERSION = "supertet-v4";
const PRECACHE = `${VERSION}-precache`;
const RUNTIME = `${VERSION}-runtime`;

/* Hashed filenames, so the cached copy is always the copy the HTML
   asked for. */
const IMMUTABLE_PREFIXES = ["/_next/static/", "/icons/"];

/* Mutable but needed offline. */
const DYNAMIC_PREFIXES = ["/data/", "/templates/", "/manifest.webmanifest"];

/* Read-only API calls the app genuinely needs with no network. Everything
   else under /api/ stays uncached on purpose: it is per-user, short-lived
   (session, access, status) or a write, and a stale copy of those is worse
   than no copy at all.

   /api/questions is the shared question bank and /api/subjects the syllabus
   the admin published. Both are the same for every visitor, both are what
   the offline test page needs, and both are served network-first: online a
   fresh copy is always returned and the cache refreshed, offline the copy
   this device downloaded earlier is used. */
const API_CACHE_PATHS = ["/api/questions", "/api/subjects"];

/** Headers Next.js uses to ask for a Flight payload instead of HTML. */
const RSC_HEADERS = [
  "RSC",
  "Next-Action",
  "Next-Router-Prefetch",
  "Next-Router-State-Tree",
  "Next-URL",
];

/* Offline shell + seed data, so a cold start with no network still
   works. The documents listed here are only ever served as a fallback
   when the network is unreachable - navigations try the network first. */
const PRECACHE_URLS = [
  "/",
  "/offline",
  "/library",
  "/flashcards",
  "/test",
  "/progress",
  "/questions",
  "/subjects",
  "/data/index.json",
  "/data/gk-gs.json",
  "/data/child.json",
  "/data/geography.json",
  "/data/science.json",
  "/data/hindi.json",
  "/data/reasoning.json",
  "/data/subjects.json",
  "/templates/questions-template.xlsx",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PRECACHE)
      // addAll fails the whole install if any single request fails, so
      // cache each entry on its own and ignore the misses.
      .then((cache) => Promise.all(PRECACHE_URLS.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== PRECACHE && k !== RUNTIME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

function startsWithAny(pathname, prefixes) {
  return prefixes.some((p) => pathname.startsWith(p));
}

/** One of the few read-only API paths listed in API_CACHE_PATHS. */
function isCacheableApi(pathname) {
  return API_CACHE_PATHS.indexOf(pathname.replace(/\/+$/, "")) !== -1;
}

/** Cached even when the caller asked for no-store (see shouldBypass). */
function isCachedWhenNoStore(pathname) {
  return startsWithAny(pathname, DYNAMIC_PREFIXES) || isCacheableApi(pathname);
}

/**
 * True when the service worker must keep its hands off this request.
 * Every true here is a request the browser answers itself, straight
 * from the network.
 */
function shouldBypass(req, url) {
  if (req.method !== "GET") return true;
  if (url.origin !== self.location.origin) return true;

  // API responses are per-user and short-lived - a cached one is worse
  // than no cache at all. Only the two read-only paths the app needs
  // offline (the shared bank and the published syllabus) are allowed
  // through; they are still served network-first.
  if (url.pathname.startsWith("/api/") && !isCacheableApi(url.pathname)) return true;

  // The App Router addressing scheme: HTML vs Flight for one URL.
  if (url.searchParams.has("_rsc")) return true;
  if (RSC_HEADERS.some((h) => req.headers.get(h))) return true;

  // Dev/HMR and Next.js internals must always reach the server.
  if (url.pathname.startsWith("/_next/webpack-hmr")) return true;
  if (url.pathname.startsWith("/_next/turbopack-hmr")) return true;
  if (url.pathname.startsWith("/__nextjs")) return true;

  // The page explicitly asked for a fresh copy. Honour that everywhere
  // except the bundled offline bank (/data/, /templates/) and the two
  // read-only API paths: those URLs are precached / already cached and
  // served network-first by the handler below, so a fresh fetch still
  // hits the network when online and only falls back to the cache when
  // the network is unreachable. Without this exception every no-store
  // fetch for the question bank bypasses the SW and fails offline
  // even though the file is cached.
  if (req.cache === "reload" || req.cache === "no-cache") return true;
  if (req.cache === "no-store" && !isCachedWhenNoStore(url.pathname)) return true;

  // A ranged request would be stored truncated.
  if (req.headers.get("range")) return true;

  return false;
}

/** A readable last resort, better than a rejected fetch. */
function offlineResponse() {
  return new Response("You are offline and this page has not been cached yet.", {
    status: 503,
    statusText: "Offline",
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

/**
 * Keep a copy of a successful response. Never rejects, and never stores
 * anything the server marked uncacheable or private.
 */
function remember(req, res) {
  if (!res || res.status !== 200 || res.type === "opaque") return Promise.resolve();
  const cc = res.headers.get("cache-control") || "";
  // The two allowlisted API paths carry public, identical-for-everyone data
  // that the app needs offline, so a "private" marker on them - which is what
  // a force-dynamic route gets - must not stop the copy being kept. Every
  // other response is still left alone, so nothing per-user is ever stored.
  if (cc.includes("private") && !isCacheableApi(new URL(req.url).pathname)) {
    return Promise.resolve();
  }
  let copy;
  try {
    copy = res.clone();
  } catch {
    return Promise.resolve();
  }
  // cache.put() rejects when the request itself is no-store, so store a
  // cacheable twin of the key. The fallback lookup tries both keys.
  const key = (req.cache === "no-store") ? new Request(req.url) : req;
  return caches
    .open(RUNTIME)
    .then((cache) => cache.put(key, copy))
    .catch(() => {});
}

/** Hashed asset: the cached copy can never be the wrong version. */
function serveCacheFirst(req, event) {
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          event.waitUntil(remember(req, res));
          return res;
        })
        .catch(() => offlineFallback(req));
    })
  );
}

/** Dynamic resource: the network wins whenever it is reachable. */
function serveNetworkFirst(req, event, fallbackUrl) {
  event.respondWith(
    fetch(req)
      .then((res) => {
        event.waitUntil(remember(req, res));
        return res;
      })
      .catch(() => offlineFallback(req, fallbackUrl))
  );
}

/**
 * Offline: the copy this session downloaded beats the copy baked in at
 * install time, and the install copy beats the app shell. caches.match()
 * only walks the caches in creation order, so the runtime cache has to
 * be asked first.
 */
function offlineFallback(req, fallbackUrl) {
  const twin = (req.cache === "no-store") ? new Request(req.url) : null;
  const matchBoth = (hit) => hit || (twin ? caches.match(twin) : Promise.resolve(undefined));
  return caches
    .open(RUNTIME)
    .then((cache) => cache.match(req).then((hit) => hit || (twin ? cache.match(twin) : undefined)))
    .then((hit) => hit || caches.match(req))
    .then(matchBoth)
    .then((hit) => hit || (fallbackUrl ? caches.match(fallbackUrl) : Promise.resolve(undefined)))
    .then((hit) => hit || offlineResponse());
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (shouldBypass(req, url)) return;

  // Documents: fresh while online, cached shell when offline. The last
  // resort is the dedicated offline page (precached above), which links
  // back into the routes that fully work without a network.
  if (req.mode === "navigate") {
    serveNetworkFirst(req, event, "/offline");
    return;
  }

  if (startsWithAny(url.pathname, IMMUTABLE_PREFIXES)) {
    serveCacheFirst(req, event);
    return;
  }

  if (startsWithAny(url.pathname, DYNAMIC_PREFIXES)) {
    serveNetworkFirst(req, event);
    return;
  }

  // The shared question bank and the published syllabus, when they are on
  // this origin. Network first, so an online user always gets fresh data
  // and the cache is refreshed for the next offline session.
  if (isCacheableApi(url.pathname)) {
    serveNetworkFirst(req, event);
    return;
  }

  // Anything else - leave it to the browser rather than guessing
  // whether a cached copy is still valid for the current build.
});

