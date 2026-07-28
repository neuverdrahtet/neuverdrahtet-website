import { initializeApp } from './js/vendor/firebase/firebase-app.js';
import { getMessaging, onBackgroundMessage } from './js/vendor/firebase/firebase-messaging-sw.js';
import { firebaseConfig } from './js/firebase-config.js';

const CACHE_NAME = 'nv-verwaltung-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

/**
 * Network-first mit Cache-Fallback: liefert immer den aktuellen Code, wenn
 * online, damit Updates sofort ankommen (kein "hängt an altem JS fest").
 * Offline greift der zuletzt erfolgreich geladene Stand aus dem Cache.
 */
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});

// Push-Benachrichtigungen: nur wenn ein Firebase-Projekt konfiguriert ist
// (im lokalen IndexedDB-Fallback-Modus gibt es keinen Messaging-Sender).
if (firebaseConfig.projectId && firebaseConfig.messagingSenderId) {
  const app = initializeApp(firebaseConfig);
  const messaging = getMessaging(app);

  onBackgroundMessage(messaging, (payload) => {
    const data = payload.notification || payload.data || {};
    self.registration.showNotification(data.title || 'neuverdrahtet Verwaltung', {
      body: data.body || '',
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      data: { url: payload.data?.url || './index.html' },
    });
  });

  self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = event.notification.data?.url || './index.html';
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        const existing = clients.find((c) => c.url.includes('verwaltung/index.html'));
        if (existing) return existing.focus();
        return self.clients.openWindow(url);
      })
    );
  });
}
