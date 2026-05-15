// client/sw.js — cache-first for static assets, network-first for API calls
const CACHE_NAME = 'echoes-v1';
const STATIC_ASSETS = ['/', '/index.html', '/style.css', '/my-echoes.css', '/app.js', '/my-echoes.js', '/achievements.js', '/achievements.css'];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Let API calls, R2 audio, and Leaflet tiles go straight to network
    if (url.hostname !== self.location.hostname) {
        event.respondWith(fetch(event.request));
        return;
    }

    // Cache-first for same-origin static assets
    event.respondWith(
        caches.match(event.request).then(cached => cached || fetch(event.request))
    );
});
