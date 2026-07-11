const CACHE_NAME = 'samy-v2';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (!res || res.status !== 200) return res;
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        return res;
      })
      // BUG (encontrado en vivo): `caches.match(...)` devuelve una Promise,
      // que siempre es truthy — así que `caches.match(e.request) ||
      // new Response(...)` nunca usaba el fallback y, si no había nada en
      // caché (típico en dev: Vite agrega `?t=<timestamp>` distinto en
      // cada import() dinámico, así que casi nunca hay hit), el SW
      // devolvía `undefined` a respondWith() → "Failed to convert value
      // to 'Response'" → el import() dinámico de esa pestaña fallaba
      // entero. Encadenar con .then() en vez de `||` resuelve el valor
      // real antes de decidir el fallback.
      .catch(() => caches.match(e.request).then(cached => cached || new Response('Offline', { status: 503 })))
  );
});
