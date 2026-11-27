// Tests für lib/passwordReset.js - Tokens fürs "Passwort vergessen".
//
// Ausführen: node selfhost-server/tests/passwordReset.test.mjs
import { openStore } from '../lib/store.js';
import { createResetToken, consumeResetToken } from '../lib/passwordReset.js';

let bestanden = 0, fehlgeschlagen = 0;
async function pruefe(name, fn) {
  try { await fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

await pruefe('gültiges Token liefert die E-Mail-Adresse zurück', () => {
  const store = openStore(':memory:');
  const token = createResetToken(store, 'kunde@example.com');
  assert(consumeResetToken(store, token) === 'kunde@example.com');
});

await pruefe('Token ist nur einmal verwendbar', () => {
  const store = openStore(':memory:');
  const token = createResetToken(store, 'kunde@example.com');
  consumeResetToken(store, token);
  assert(consumeResetToken(store, token) === null, 'ein zweites Mal sollte das Token nicht mehr gültig sein');
});

await pruefe('unbekanntes Token liefert null', () => {
  const store = openStore(':memory:');
  assert(consumeResetToken(store, 'nicht-existent') === null);
});

await pruefe('abgelaufenes Token liefert null und wird gelöscht', () => {
  const store = openStore(':memory:');
  const token = createResetToken(store, 'kunde@example.com');
  const eintrag = store.get('passwordResets', token);
  store.put('passwordResets', { ...eintrag, expiresAt: Date.now() - 1000 });
  assert(consumeResetToken(store, token) === null, 'abgelaufenes Token sollte ungültig sein');
  assert(store.get('passwordResets', token) === undefined, 'abgelaufenes Token sollte trotzdem aufgeräumt werden');
});

await pruefe('zwei Tokens für dieselbe Adresse sind unterschiedlich', () => {
  const store = openStore(':memory:');
  const t1 = createResetToken(store, 'kunde@example.com');
  const t2 = createResetToken(store, 'kunde@example.com');
  assert(t1 !== t2, 'Tokens sollten zufällig und eindeutig sein');
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
