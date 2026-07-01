// Service Worker for 智能食谱 PWA
const CACHE = 'mealplan-v3';

self.addEventListener('install', e => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
      const clone = resp.clone();
      caches.open(CACHE).then(cache => cache.put(e.request, clone));
      return resp;
    }).catch(() => caches.match(e.request)))
  );
});
