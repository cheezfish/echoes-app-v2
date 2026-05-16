// client/sw.js — caching + push notifications
const CACHE_NAME = 'echoes-v3';
const STATIC_ASSETS = ['/', '/index.html', '/style.css', '/my-echoes.css', '/audio-player.js', '/app.js', '/my-echoes.js', '/achievements.js', '/achievements.css'];

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

    // External requests (API, R2, tiles, CDN) — always network
    if (url.hostname !== self.location.hostname) {
        event.respondWith(fetch(event.request));
        return;
    }

    // JS, CSS, HTML — network-first so deploys take effect immediately
    const ext = url.pathname.split('.').pop();
    if (['js', 'css', 'html', ''].includes(ext)) {
        event.respondWith(
            fetch(event.request)
                .then(res => {
                    const clone = res.clone();
                    caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
                    return res;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    // Everything else — cache-first
    event.respondWith(
        caches.match(event.request).then(cached => cached || fetch(event.request))
    );
});

self.addEventListener('push', event => {
    const data = event.data?.json() || {};
    event.waitUntil(
        self.registration.showNotification(data.title || 'Echoes', {
            body: data.body || '',
            icon: '/icons/icon-192.png',
            badge: '/icons/badge-72.png',
            data: { url: data.url || '/' },
            vibrate: [100, 50, 100]
        })
    );
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const url = event.notification.data?.url || '/';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            for (const client of clientList) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    client.navigate(url);
                    return client.focus();
                }
            }
            return clients.openWindow(url);
        })
    );
});
