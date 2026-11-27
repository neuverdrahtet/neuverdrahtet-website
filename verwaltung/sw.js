import { initializeApp } from './js/vendor/firebase/firebase-app.js';
import { getMessaging, onBackgroundMessage } from './js/vendor/firebase/firebase-messaging-sw.js';
import { firebaseConfig } from './js/firebase-config.js';
import { selfhostConfig } from './js/selfhost-config.js';

const CACHE_NAME = 'nv-verwaltung-v3';

// Dritte-Parteien-Bibliotheken unter js/vendor/ (Firebase-SDK, jsPDF, xlsx,
// ZXing, Leaflet - zusammen mehrere MB) ändern sich nur, wenn jemand die
// Datei im Projekt austauscht, nie durch normale App-Updates. Sie trotzdem
// bei JEDEM Seitenaufruf per "cache: no-store" komplett neu herunterzuladen
// (wie unten für den restlichen Code) macht besonders auf mobilen
// Baustellen-Verbindungen jeden App-Start spürbar langsam. Für genau diesen
// Ordner daher cache-first: bekannt langsame, aber praktisch unveränderliche
// Dateien kommen aus dem Cache, alles andere bleibt network-first.
const VENDOR_PATH = '/js/vendor/';

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

  if (url.pathname.includes(VENDOR_PATH)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const res = await fetch(event.request);
        cache.put(event.request, res.clone());
        return res;
      })
    );
    return;
  }

  // cache: 'no-store' erzwingt eine echte Netzwerkanfrage statt einer
  // stillen Auslieferung aus dem normalen HTTP-Cache des Browsers - sonst
  // kann trotz "network-first" hier eine veraltete JS-Datei durchrutschen,
  // wenn der Hoster für statische Dateien Cache-Control-Header mit
  // Gültigkeitsdauer setzt (gemeldeter Fall: Update kam nicht an, obwohl
  // schon live).
  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});

// notificationclick gilt für beide Push-Wege (Firebase UND Selfhost/Web-Push)
// gleichermaßen - deshalb hier außerhalb der beiden Blöcke unten, unabhängig
// davon registriert, welcher der beiden Wege die Benachrichtigung erzeugt hat.
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

// Push-Benachrichtigungen: entweder über Firebase Cloud Messaging oder über
// Standard-Web-Push gegen den eigenen Selfhost-Server (siehe
// selfhost-server/lib/push.js) - im lokalen IndexedDB-Fallback-Modus gibt es
// keinen von beiden.
if (firebaseConfig.projectId && firebaseConfig.messagingSenderId) {
  const app = initializeApp(firebaseConfig);
  const messaging = getMessaging(app);

  onBackgroundMessage(messaging, (payload) => {
    const data = payload.notification || payload.data || {};
    self.registration.showNotification(data.title || 'Werkora', {
      body: data.body || '',
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      data: { url: payload.data?.url || './index.html' },
    });
  });
}

if (selfhostConfig.enabled) {
  // Standard-Web-Push liefert die Nachricht als verschlüsselten Payload an
  // GENAU dieses "push"-Event - es gibt (anders als Firebase Messaging)
  // keinen separaten Vordergrund/Hintergrund-Unterschied auf Protokollebene;
  // ob ein Tab offen ist, wird hier selbst per postMessage an die Clients
  // weitergereicht (siehe initForegroundListener() in js/push.js).
  self.addEventListener('push', (event) => {
    let data = {};
    try { data = event.data?.json() || {}; } catch { /* kein gültiges JSON - leere Benachrichtigung */ }
    event.waitUntil((async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const vordergrundOffen = clients.some((c) => c.visibilityState === 'visible');
      if (vordergrundOffen) {
        for (const c of clients) c.postMessage({ type: 'nv-push', title: data.title, body: data.body, url: data.url });
      } else {
        await self.registration.showNotification(data.title || 'Werkora', {
          body: data.body || '',
          icon: './icons/icon-192.png',
          badge: './icons/icon-192.png',
          data: { url: data.url || './index.html' },
        });
      }
    })());
  });
}
