// Tests für lib/push.js - VAPID-Schlüsselverwaltung (rein lokal, ohne
// Netzwerk). Das eigentliche Versenden (createPusher().sendToAll) braucht
// einen echten Push-Dienst und wird hier bewusst nicht unit-getestet -
// siehe README.md für den manuellen Test mit einem echten Gerät/Browser.
//
// Ausführen: node selfhost-server/tests/push.test.mjs
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getOrCreateVapidKeys } from '../lib/push.js';

let bestanden = 0, fehlgeschlagen = 0;
async function pruefe(name, fn) {
  try { await fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

async function mitTempDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'werkora-push-test-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

await pruefe('erzeugt beim ersten Aufruf neue Schlüssel mit Kontakt-E-Mail', async () => {
  await mitTempDir(async (dir) => {
    const keys = getOrCreateVapidKeys(dir, 'admin@example.com');
    assert(typeof keys.publicKey === 'string' && keys.publicKey.length > 0, 'publicKey sollte gesetzt sein');
    assert(typeof keys.privateKey === 'string' && keys.privateKey.length > 0, 'privateKey sollte gesetzt sein');
    assert(keys.contactEmail === 'admin@example.com', 'contactEmail sollte übernommen werden');
  });
});

await pruefe('liefert bei erneutem Aufruf dieselben Schlüssel (Persistenz)', async () => {
  await mitTempDir(async (dir) => {
    const erste = getOrCreateVapidKeys(dir, 'admin@example.com');
    const zweite = getOrCreateVapidKeys(dir, 'andere@example.com');
    assert(zweite.publicKey === erste.publicKey, 'publicKey sollte beim zweiten Aufruf gleich bleiben');
    assert(zweite.privateKey === erste.privateKey, 'privateKey sollte beim zweiten Aufruf gleich bleiben');
    // Die beim ERSTEN Aufruf gespeicherte E-Mail bleibt maßgeblich, nicht das
    // zweite (ignorierte) Argument - verhindert, dass ein späterer Aufruf
    // mit anderem contactEmail-Argument die Datei überschreibt.
    assert(zweite.contactEmail === 'admin@example.com', 'contactEmail sollte aus der gespeicherten Datei kommen, nicht aus dem zweiten Aufruf');
  });
});

await pruefe('schreibt die Schlüssel-Datei nur mit Besitzer-Leserechten (0600)', async () => {
  await mitTempDir(async (dir) => {
    getOrCreateVapidKeys(dir, 'admin@example.com');
    const { stat } = await import('node:fs/promises');
    const info = await stat(path.join(dir, 'vapid-keys.json'));
    assert((info.mode & 0o777) === 0o600, 'Datei sollte nur für den Besitzer lesbar/schreibbar sein');
  });
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
