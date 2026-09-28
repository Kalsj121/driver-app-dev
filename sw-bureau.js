// LCA Bureau — Service Worker (v1.36)
// - Rend le dashboard installable comme PWA sur iOS et Android
// - Reçoit les push notifications (nouveau message d'un chauffeur) même quand
//   l'app est killée / en arrière-plan.

const SW_VERSION = '1.36';
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
self.addEventListener('fetch', (event) => { /* laisser le browser gérer */ });

// ============================================================
// PUSH NOTIFICATIONS — v1.36
// Reçues quand un chauffeur envoie un message au bureau
// ============================================================
self.addEventListener('push', (event) => {
  let payload = {
    title: 'LCA Bureau',
    body:  'Nouveau message',
    url:   './dashboard.html'
  };
  try {
    if (event.data) {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
    }
  } catch (e) {
    try { payload.body = event.data ? event.data.text() : payload.body; } catch(_) {}
  }
  const title = payload.title || '🚛 LCA Bureau';
  const options = {
    body:    payload.body || '',
    icon:    './icons/bureau/icon-192.png',
    badge:   './icons/bureau/icon-192.png',
    tag:     payload.tag || 'lca-bureau-msg',
    renotify: true,
    requireInteraction: false,
    silent: false,
    vibrate: [300, 100, 300, 100, 300],
    data: {
      url:    payload.url || './dashboard.html',
      msgId:  payload.msgId || null,
      sentAt: Date.now()
    }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Click sur la notif → focus / ouverture du dashboard
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './dashboard.html';
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if (client.url.includes('dashboard.html')) {
        try {
          await client.focus();
          client.postMessage({
            type: 'BUREAU_NOTIF_CLICK',
            msgId: event.notification.data ? event.notification.data.msgId : null
          });
          return;
        } catch(e) {}
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
  })());
});

self.addEventListener('notificationclose', (event) => {
  console.log('[SW-Bureau] notif fermée sans clic:', event.notification.tag);
});
