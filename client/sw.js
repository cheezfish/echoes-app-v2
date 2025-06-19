// client/sw.js
self.addEventListener('install', (event) => {
  self.skipWaiting(); // Force the new service worker to become active
  console.log('Service Worker: Installed');
});
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activated');
});
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});