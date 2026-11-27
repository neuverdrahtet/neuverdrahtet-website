import { getSettings, put, getAll, remove } from './db.js';
import { firebaseConfig } from './firebase-config.js';
import { selfhostConfig } from './selfhost-config.js';
import {
  pushVapidPublicKeySelfhost, pushSubscribeSelfhost, pushUnsubscribeSelfhost, pushNotifyRolesSelfhost,
} from './selfhostClient.js';
import { getSession } from './auth.js';
import { sendPushNotification } from './ai.js';

// Push-Benachrichtigungen laufen entweder über Firebase Cloud Messaging
// (FIREBASE_ENABLED) oder über Standard-Web-Push/VAPID gegen den eigenen
// Selfhost-Server (SELFHOST_ENABLED, siehe selfhost-server/lib/push.js) -
// im lokalen IndexedDB-Fallback-Modus ist die Funktion grundsätzlich nicht
// verfügbar.
const SELFHOST_ENABLED = !!selfhostConfig.enabled;
export const FIREBASE_ENABLED = !SELFHOST_ENABLED && !!firebaseConfig.projectId;

export function isBrowserCapable() {
  return (SELFHOST_ENABLED || FIREBASE_ENABLED) && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
}

export function permissionState() {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

async function getMessagingInstance() {
  const { getMessaging } = await import('./vendor/firebase/firebase-messaging.js');
  return getMessaging();
}

// Standard-Web-Push braucht den öffentlichen VAPID-Schlüssel als
// Uint8Array statt als Base64url-String (Browser-API-Vorgabe).
function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Fordert die Berechtigung an und meldet dieses Gerät für Push-Benachrichtigungen an. */
export async function subscribe() {
  if (!isBrowserCapable()) {
    throw new Error('Push-Benachrichtigungen werden von diesem Browser/Gerät nicht unterstützt.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Benachrichtigungen wurden nicht erlaubt.');
  }
  const swRegistration = await navigator.serviceWorker.ready;
  const session = getSession();

  if (SELFHOST_ENABLED) {
    const vapidPublicKey = await pushVapidPublicKeySelfhost();
    let subscription = await swRegistration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await swRegistration.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
    }
    await pushSubscribeSelfhost(subscription, { userId: session?.uid || '', role: session?.role || '' });
    return subscription.endpoint;
  }

  const settings = await getSettings();
  if (!settings.pushVapidKey) {
    throw new Error('Bitte zuerst in den Einstellungen den Push-VAPID-Key hinterlegen.');
  }
  const { auth } = await import('./firebase.js');
  const uidVal = auth.currentUser?.uid;
  if (!uidVal) throw new Error('Nicht angemeldet.');

  const messaging = await getMessagingInstance();
  const { getToken } = await import('./vendor/firebase/firebase-messaging.js');
  const token = await getToken(messaging, { vapidKey: settings.pushVapidKey, serviceWorkerRegistration: swRegistration });
  if (!token) throw new Error('Es konnte kein Push-Token erzeugt werden.');

  await put('pushTokens', {
    id: token, userId: uidVal, role: session.role || '', userAgent: navigator.userAgent, updatedAt: new Date().toISOString(),
  });
  return token;
}

/** Meldet dieses Gerät wieder ab (Token/Subscription gelöscht, keine weiteren Pushes). */
export async function unsubscribe() {
  if (!isBrowserCapable()) return;

  if (SELFHOST_ENABLED) {
    const swRegistration = await navigator.serviceWorker.ready;
    const subscription = await swRegistration.pushManager.getSubscription();
    if (!subscription) return;
    await pushUnsubscribeSelfhost(subscription.endpoint).catch(() => { /* Server kennt sie evtl. schon nicht mehr */ });
    await subscription.unsubscribe();
    return;
  }

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

/** Prüft, ob dieses Gerät aktuell angemeldet ist. */
export async function isSubscribed() {
  if (!isBrowserCapable() || Notification.permission !== 'granted') return false;

  if (SELFHOST_ENABLED) {
    const swRegistration = await navigator.serviceWorker.ready;
    return !!(await swRegistration.pushManager.getSubscription());
  }

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
 * darüber benachrichtigen) - im Selfhost-Modus serverseitig anhand der
 * Session, im Firebase-Modus clientseitig anhand der eigenen uid.
 */
export async function notifyRoles(roles, { title, body, url } = {}) {
  if (!isBrowserCapable()) return;

  if (SELFHOST_ENABLED) {
    await pushNotifyRolesSelfhost(roles, { title, body, url });
    return;
  }

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
 * Im Selfhost-Modus schickt der Service Worker (sw.js) dafür eine
 * postMessage an alle offenen Tabs, da Standard-Web-Push (anders als
 * Firebase Messagings onMessage()) keinen eigenen Vordergrund-Callback kennt.
 */
export async function initForegroundListener(onMessageReceived) {
  if (!isBrowserCapable()) return;

  if (SELFHOST_ENABLED) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type !== 'nv-push') return;
      onMessageReceived(event.data.title || 'Benachrichtigung', event.data.body || '');
    });
    return;
  }

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
