// LCA Transfert — Service Worker (v1.29)
// Reçoit les push notifications et les affiche même quand l'app est fermée
// ou que l'écran est verrouillé.

const SW_VERSION = '1.29';
console.log('[SW] chargé — version', SW_VERSION);

self.addEventListener('install', (event) => {
  console.log('[SW] install v' + SW_VERSION);
  // Prend le contrôle immédiatement (utile en dev pour tester des updates)
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW] activate v' + SW_VERSION);
  event.waitUntil(self.clients.claim());
});

// ============================================================
// PUSH NOTIFICATIONS
// ============================================================
self.addEventListener('push', (event) => {
  let payload = {
    title: 'LCA Transfert',
    body:  'Nouveau message du bureau',
    url:   './index.html'
  };
  try {
    if (event.data) {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
    }
  } catch (e) {
    // Payload non-JSON — essai texte simple
    try { payload.body = event.data ? event.data.text() : payload.body; } catch(_) {}
  }

  const title = payload.title || 'LCA Transfert';
  const options = {
    body:    payload.body || '',
    icon:    'https://lca.hevra.app/assets/img/logo.png',
    badge:   'https://lca.hevra.app/assets/img/logo.png',
    tag:     payload.tag || 'lca-msg',
    renotify: true,
    requireInteraction: false,
    vibrate: [200, 100, 200],
    data: {
      url:    payload.url || './index.html',
      msgId:  payload.msgId || null,
      sentAt: Date.now()
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Le chauffeur tape sur la notification → focus/ouverture de l'app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './index.html';

  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });

    // Si une fenêtre LCA est déjà ouverte, on la focus
    for (const client of allClients) {
      if (client.url.includes('driver-app')) {
        try {
          await client.focus();
          client.postMessage({
            type:  'NOTIF_CLICK',
            msgId: event.notification.data ? event.notification.data.msgId : null
          });
        } catch(e) { console.warn('[SW] focus échec', e); }
        return;
      }
    }
    // Sinon on ouvre une nouvelle fenêtre
    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});

self.addEventListener('notificationclose', (event) => {
  console.log('[SW] notification fermée sans clic:', event.notification.tag);
});
