const CACHE_NAME = 'samy-fidabel-v1';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/manifest.json',
    '/icon-192.png',
    '/icon-512.png',
    '/icon-maskable.png',
    '/styles.css'
];

// Install: cachear assets
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS_TO_CACHE))
            .then(() => self.skipWaiting())
    );
});

// Activate: limpiar caches viejos
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => {
                        if (cacheName !== CACHE_NAME) {
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
            .then(() => self.clients.claim())
    );
});

// Fetch: estrategia "network-first" para datos, "cache-first" para assets
self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);
    
    // Para Firebase/API calls: network-first (intentar red, fallback a caché)
    if (url.includes('firebase') || url.includes('/api')) {
        e.respondWith(
            fetch(e.request)
                .then(response => {
                    // Cachear respuestas exitosas
                    if (response.ok) {
                        const cache_copy = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(e.request, cache_copy));
                    }
                    return response;
                })
                .catch(() => caches.match(e.request))
        );
    } 
    // Para assets: cache-first (usar caché, fallback a red)
    else {
        e.respondWith(
            caches.match(e.request)
                .then(response => response || fetch(e.request))
                .catch(() => new Response('Offline', { status: 503 }))
        );
    }
});

// Background sync (opcional: sincronizar datos cuando hay conexión)
self.addEventListener('sync', (e) => {
    if (e.tag === 'sync-voters') {
        e.waitUntil(syncVotersWithFirebase());
    }
});

async function syncVotersWithFirebase() {
    try {
        const db = indexedDB.open('electoral_db');
        // Aquí iría la lógica de sincronización
        console.log('Sincronizando votantes con Firebase...');
    } catch (err) {
        console.error('Error sincronizando:', err);
    }
}
