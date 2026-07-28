import { getSettings, put, getAll, remove } from './db.js';
import { firebaseConfig } from './firebase-config.js';
import { getSession } from './auth.js';
import { sendPushNotification } from './ai.js';

// Push-Benachrichtigungen laufen über Firebase Cloud Messaging (Web Push) und
// setzen daher ein konfiguriertes Firebase-Projekt voraus - im lokalen
// IndexedDB-Fallback-Modus (kein firebaseConfig.projectId) ist die Funktion
// grundsätzlich nicht verfügbar.
export const FIREBASE_ENABLED = !!firebaseConfig.projectId;

export function isBrowserCapable() {
  return FIREBASE_ENABLED && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
}

export function permissionState() {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

async function getMessagingInstance() {
  const { getMessaging } = await import('./vendor/firebase/firebase-messaging.js');
  return getMessaging();
}

/** Fordert die Berechtigung an und meldet dieses Gerät für Push-Benachrichtigungen an. */
export async function subscribe() {
  if (!isBrowserCapable()) {
    throw new Error('Push-Benachrichtigungen werden von diesem Browser/Gerät nicht unterstützt.');
  }
  const settings = await getSettings();
  if (!settings.pushVapidKey) {
    throw new Error('Bitte zuerst in den Einstellungen den Push-VAPID-Key hinterlegen.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Benachrichtigungen wurden nicht erlaubt.');
  }
  const { auth } = await import('./firebase.js');
  const uidVal = auth.currentUser?.uid;
  if (!uidVal) throw new Error('Nicht angemeldet.');

  const swRegistration = await navigator.serviceWorker.ready;
  const messaging = await getMessagingInstance();
  const { getToken } = await import('./vendor/firebase/firebase-messaging.js');
  const token = await getToken(messaging, { vapidKey: settings.pushVapidKey, serviceWorkerRegistration: swRegistration });
  if (!token) throw new Error('Es konnte kein Push-Token erzeugt werden.');

  await put('pushTokens', {
    id: token, userId: uidVal, role: getSession().role || '', userAgent: navigator.userAgent, updatedAt: new Date().toISOString(),
  });
  return token;
}

/** Meldet dieses Gerät wieder ab (Token gelöscht, keine weiteren Pushes). */
export async function unsubscribe() {
  if (!isBrowserCapable()) return;
  const { auth } = await import('./firebase.js');
  const uidVal = auth.currentUser?.uid;
  const messaging = await getMessagingInstance();
  const { deleteToken } = await import('./vendor/firebase/firebase-messaging.js');
  await deleteToken(messaging).catch(() => { /* Token war evtl. schon ungültig */ });
  if (uidVal) {
    const alle = await getAll('pushTokens');
    for (const t of alle.filter((t) => t.userId === uidVal)) {
      await remove('pushTokens', t.id);
    }
  }
}

/** Prüft, ob dieses Gerät (laut lokal gespeichertem Token) aktuell angemeldet ist. */
export async function isSubscribed() {
  if (!isBrowserCapable() || Notification.permission !== 'granted') return false;
  try {
    const { auth } = await import('./firebase.js');
    const uidVal = auth.currentUser?.uid;
    if (!uidVal) return false;
    const alle = await getAll('pushTokens');
    return alle.some((t) => t.userId === uidVal);
  } catch {
    return false;
  }
}

/**
 * Löst eine Push-Benachrichtigung an alle Geräte aus, deren angemeldeter
 * Nutzer eine der übergebenen Rollen hat - z.B. bei neuer Postfach-Nachricht
 * an alle admin/buero-Geräte. Das eigene, gerade aktive Gerät wird
 * ausgeklammert (wer die Aktion gerade selbst auslöst, muss sich nicht
 * darüber benachrichtigen).
 */
export async function notifyRoles(roles, { title, body, url } = {}) {
  if (!isBrowserCapable()) return;
  const { auth } = await import('./firebase.js');
  const eigenerUid = auth.currentUser?.uid;
  const alle = await getAll('pushTokens');
  const tokens = alle
    .filter((t) => roles.includes(t.role) && t.userId !== eigenerUid)
    .map((t) => t.id);
  await sendPushNotification({ tokens, title, body, url });
}

/**
 * Zeigt Push-Nachrichten, die eintreffen während die App im Vordergrund
 * geöffnet ist, als Toast statt als System-Benachrichtigung (die kommt nur,
 * wenn der Tab im Hintergrund/geschlossen ist - Browser-Standardverhalten).
 */
export async function initForegroundListener(onMessageReceived) {
  if (!isBrowserCapable()) return;
  try {
    const messaging = await getMessagingInstance();
    const { onMessage } = await import('./vendor/firebase/firebase-messaging.js');
    onMessage(messaging, (payload) => {
      const data = payload.notification || payload.data || {};
      onMessageReceived(data.title || 'Benachrichtigung', data.body || '');
    });
  } catch {
    // Messaging in diesem Browser nicht unterstützt - Push bleibt einfach aus
  }
}
