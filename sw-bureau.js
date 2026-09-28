// LCA Bureau — Service Worker minimal (v1.35)
// But : rendre le dashboard installable comme PWA sur iOS et Android.
// Pas de cache offline pour l'instant (le bureau nécessite Supabase en ligne).

const SW_VERSION = '1.35';
console.log('[SW-Bureau] chargé — version', SW_VERSION);

self.addEventListener('install', (event) => {
  console.log('[SW-Bureau] install v' + SW_VERSION);
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW-Bureau] activate v' + SW_VERSION);
  event.waitUntil(self.clients.claim());
});

// Fetch pass-through — pas de cache
self.addEventListener('fetch', (event) => {
  // Laisser le browser gérer normalement
});

// Support des notifications natives (push) pour l'app bureau — utile plus tard
// si on veut envoyer des alertes du chauffeur vers le bureau (déjà implémenté
// via Notification API côté client, pas via Web Push pour l'instant).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if (client.url.includes('dashboard.html')) {
        try { await client.focus(); return; } catch(e) {}
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow('./dashboard.html');
  })());
});
