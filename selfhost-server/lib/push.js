// Push-Benachrichtigungen über Standard-Web-Push (VAPID) als Ersatz für
// Firebase Cloud Messaging - funktioniert mit jedem Browser, der
// PushManager unterstützt, ohne Google/Firebase-Abhängigkeit. Einziger
// npm-Abhängigkeit des gesamten Selfhost-Servers (siehe package.json) - die
// zugrundeliegende Verschlüsselung (RFC 8291) von Hand nachzubauen wäre
// fehleranfällig und ließe sich ohne echte Browser/Push-Dienste in der
// Entwicklungsumgebung kaum verlässlich prüfen; die etablierte, geprüfte
// "web-push"-Bibliothek ist hier die robustere Wahl als eigener Code.
import * as webpush from 'web-push';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function getOrCreateVapidKeys(dataDir, contactEmail) {
  const keysPath = path.join(dataDir, 'vapid-keys.json');
  if (existsSync(keysPath)) {
    return JSON.parse(readFileSync(keysPath, 'utf8'));
  }
  const keys = { ...webpush.generateVAPIDKeys(), contactEmail };
  writeFileSync(keysPath, JSON.stringify(keys, null, 2), { mode: 0o600 });
  return keys;
}

export function createPusher(vapidKeys) {
  webpush.setVapidDetails(`mailto:${vapidKeys.contactEmail}`, vapidKeys.publicKey, vapidKeys.privateKey);

  // Schickt an jedes subscriptions-Element, meldet pro Element Erfolg/Fehler
  // zurück - der Aufrufer (server.js) entfernt daraufhin abgelaufene
  // Subscriptions (HTTP 404/410 vom Push-Dienst: Gerät abgemeldet/
  // deinstalliert) aus der Datenbank.
  async function sendToAll(subscriptions, payload) {
    const ergebnisse = await Promise.all(subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify(payload),
        );
        return { id: sub.id, ok: true };
      } catch (err) {
        const abgelaufen = err.statusCode === 404 || err.statusCode === 410;
        return { id: sub.id, ok: false, abgelaufen, error: err.message };
      }
    }));
    return ergebnisse;
  }

  return { sendToAll };
}
