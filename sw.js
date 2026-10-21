// Offline support: the app shell is network-first (so updates show up), data
// files are cache-first (their URLs carry ?v=<build date>, so a rebuild uses
// new URLs and old entries are dropped on activate).
const SHELL = "shell-v1";
const DATA = "data";
const SHELL_FILES = ["./", "index.html", "style.css", "app.js", "data.js", "deinflect.js", "manifest.webmanifest", "icons/icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name !== SHELL && name !== DATA) await caches.delete(name);
      self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  if (url.pathname.includes("/data/") && url.searchParams.has("v") && !url.pathname.endsWith("meta.json")) {
    e.respondWith(
      (async () => {
        const cache = await caches.open(DATA);
        const hit = await cache.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok) {
          cache.put(e.request, res.clone());
          pruneOldVersions(cache, url.searchParams.get("v"));
        }
        return res;
      })()
    );
    return;
  }

  e.respondWith(
    (async () => {
      try {
        const res = await fetch(e.request);
        if (res.ok && !url.pathname.includes("/data/")) {
          const cache = await caches.open(SHELL);
          cache.put(e.request, res.clone());
        }
        return res;
      } catch (err) {
        const hit = await caches.match(e.request, { ignoreSearch: true });
        if (hit) return hit;
        throw err;
      }
    })()
  );
});

// After a rebuild, drop cached data from older builds (once per worker lifetime).
let pruned = null;
function pruneOldVersions(cache, current) {
  if (pruned === current) return;
  pruned = current;
  cache.keys().then((reqs) => {
    for (const r of reqs) if (new URL(r.url).searchParams.get("v") !== current) cache.delete(r);
  });
}
