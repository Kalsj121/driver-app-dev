// LCA Pointage — Service Worker
// Permet l'installation comme app native et le fonctionnement hors-ligne de base

const CACHE_NAME = 'lca-v1';
const ASSETS = [
  '/lca_app/',
  '/lca_app/index.html',
  '/lca_app/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // API calls always go to network
  if (e.request.url.includes('/api/')) return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
