/*
 * Shanon – záloha kasy pro práci bez připojení (registruje src/lib/pos-offline.ts, rozsah /kasa).
 * Stránky a data: nejdřív síť, při výpadku poslední uložená verze. Skripty a styly aplikace (/_next/static,
 * neměnné podle verze): nejdřív záloha. Zápisy (POST) a rozhraní pokladny / stanice / zdraví jdou vždy na server.
 */
const PAGES = "shanon-pos-pages-v1";
const STATIC = "shanon-pos-static-v1";
const SKIP = /^\/api\/(pos|station|health|v1)\b/;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("shanon-pos-") && k !== PAGES && k !== STATIC).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** síť do `ms`, jinak záloha (je-li); bez zálohy se čeká na síť */
async function networkFirst(req, ms) {
  const cache = await caches.open(PAGES);
  const net = fetch(req).then((res) => {
    // přesměrování na přihlášení ani chyby se neukládají
    if (res.ok && res.type === "basic" && !res.redirected) cache.put(req, res.clone()).catch(() => undefined);
    return res;
  });
  const cached = await cache.match(req, { ignoreVary: true });
  if (!cached) return net;
  return Promise.race([net.catch(() => cached), new Promise((r) => setTimeout(() => r(cached), ms))]);
}

async function cacheFirst(req) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone()).catch(() => undefined);
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || SKIP.test(url.pathname)) return;
  if (url.pathname.startsWith("/_next/static/")) return e.respondWith(cacheFirst(req));
  e.respondWith(networkFirst(req, req.mode === "navigate" ? 8000 : 6000));
});

/** odhlášení: smazat zálohu stránek (data firmy) */
self.addEventListener("message", (e) => {
  if (e.data === "clear") e.waitUntil(caches.delete(PAGES));
});
