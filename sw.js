/**
 * Service worker: caches the app shell (HTML/CSS/JS/segment data/Leaflet)
 * so the map and form work with zero signal after the first successful
 * load, and opportunistically caches OSM basemap tiles as they're viewed
 * so previously-seen areas stay visible offline.
 *
 * NOTE (known limitation, see docs/parknav-segment-survey-webapp-plan.md):
 * only tiles the surveyor has already scrolled past will be available
 * offline - there is no full offline basemap pre-download in this version.
 */
const SHELL_CACHE = "parknav-survey-shell-v1";
const TILE_CACHE = "parknav-survey-tiles-v1";

const SHELL_URLS = [
  "./",
  "index.html",
  "css/style.css",
  "js/config.js",
  "js/idb-queue.js",
  "js/photo.js",
  "js/app.js",
  "manifest.webmanifest",
  "data/segments.json",
  "vendor/leaflet/leaflet.js",
  "vendor/leaflet/leaflet.css",
  "vendor/leaflet/images/marker-icon.png",
  "vendor/leaflet/images/marker-icon-2x.png",
  "vendor/leaflet/images/marker-shadow.png",
  "vendor/leaflet/images/layers.png",
  "vendor/leaflet/images/layers-2x.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((n) => n !== SHELL_CACHE && n !== TILE_CACHE)
            .map((n) => caches.delete(n))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isTileRequest(url) {
  return /tile\.openstreetmap\.org/.test(url);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Never intercept non-GET requests (e.g. the Apps Script sync POSTs).
  if (req.method !== "GET") return;

  const url = req.url;

  if (isTileRequest(url)) {
    event.respondWith(
      caches.open(TILE_CACHE).then((cache) =>
        cache.match(req).then(
          (cached) =>
            cached ||
            fetch(req)
              .then((res) => {
                cache.put(req, res.clone());
                return res;
              })
              .catch(() => cached)
        )
      )
    );
    return;
  }

  if (url.startsWith(self.location.origin)) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            const resClone = res.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(req, resClone));
            return res;
          })
      )
    );
  }
});
