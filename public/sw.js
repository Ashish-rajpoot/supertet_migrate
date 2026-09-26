/* ===========================================================
   public/sw.js - offline cache for the Next.js build

   Registered by components/providers.tsx. Pages are server-rendered,
   so they are cached as they are visited (stale-while-revalidate),
   while the bundled question bank, syllabus, icons and template are
   precached on install because the app must work with no network.
   =========================================================== */

const VERSION = "supertet-v1";
const PRECACHE = `${VERSION}-precache`;
const RUNTIME = `${VERSION}-runtime`;

/* Seed data + shell assets: always cache-first, updated in the background. */
const PRECACHE_URLS = [
  "/",
  "/flashcards",
  "/test",
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

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never cache the API or auth traffic - a stale attempt list or a
  // cached token response would be worse than no cache at all.
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: serve the cached page immediately, refresh it in the background.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("/")))
    );
    return;
  }

  // Everything else: cache-first, then fill the cache for next time.
  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(RUNTIME).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    })
  );
});
