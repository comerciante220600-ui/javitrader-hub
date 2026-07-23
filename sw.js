/* JaviTrader — Service Worker de avisos (Web Push)
   Recibe las notificaciones y las muestra aunque la web esté cerrada.
   No cachea nada: su único cometido son las notificaciones. */

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'JaviTrader', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'JaviTrader';
  const options = {
    body: data.body || '',
    icon: data.icon || 'https://javitrader.net/logo.png',
    badge: data.badge || 'https://javitrader.net/logo.png',
    tag: data.tag || undefined,        // si se repite el tag, sustituye la anterior
    renotify: !!data.tag,
    data: {
      url: data.url || 'https://javitrader.net/',
      topic: data.topic || null
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || 'https://javitrader.net/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Si ya hay una pestaña de javitrader abierta, la enfoca
      for (const client of clients) {
        if (client.url.startsWith('https://javitrader.net') && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
