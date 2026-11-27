// Tests für lib/rateLimit.js - Brute-Force-Schutz fürs Login. Nutzt kleine,
// künstliche Parameter (maxVersuche/sperrdauerMs/fensterMs), damit die
// Tests ohne echtes Warten in Millisekunden-Bereich laufen.
//
// Ausführen: node selfhost-server/tests/rateLimit.test.mjs
import { createLoginLimiter } from '../lib/rateLimit.js';

let bestanden = 0, fehlgeschlagen = 0;
async function pruefe(name, fn) {
  try { await fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }
function warte(ms) { return new Promise((r) => setTimeout(r, ms)); }

await pruefe('keine Sperre vor dem ersten Fehlschlag', () => {
  const limiter = createLoginLimiter({ maxVersuche: 3, sperrdauerMs: 1000, fensterMs: 10000 });
  assert(limiter.pruefeSperre('test@example.com') === null, 'sollte ohne jeden Versuch nicht gesperrt sein');
});

await pruefe('sperrt erst nach Erreichen von maxVersuche', () => {
  const limiter = createLoginLimiter({ maxVersuche: 3, sperrdauerMs: 1000, fensterMs: 10000 });
  limiter.vermerkeFehlschlag('a@example.com');
  limiter.vermerkeFehlschlag('a@example.com');
  assert(limiter.pruefeSperre('a@example.com') === null, 'nach 2 von 3 erlaubten Fehlschlägen noch nicht gesperrt');
  limiter.vermerkeFehlschlag('a@example.com');
  assert(limiter.pruefeSperre('a@example.com') !== null, 'nach dem 3. Fehlschlag sollte gesperrt sein');
});

await pruefe('Sperre betrifft nur die betroffene E-Mail-Adresse', () => {
  const limiter = createLoginLimiter({ maxVersuche: 2, sperrdauerMs: 1000, fensterMs: 10000 });
  limiter.vermerkeFehlschlag('b@example.com');
  limiter.vermerkeFehlschlag('b@example.com');
  assert(limiter.pruefeSperre('b@example.com') !== null, 'b sollte gesperrt sein');
  assert(limiter.pruefeSperre('andere@example.com') === null, 'andere Adresse sollte unberührt bleiben');
});

await pruefe('E-Mail-Vergleich ignoriert Groß-/Kleinschreibung und Leerzeichen', () => {
  const limiter = createLoginLimiter({ maxVersuche: 2, sperrdauerMs: 1000, fensterMs: 10000 });
  limiter.vermerkeFehlschlag('  Test@Example.com ');
  limiter.vermerkeFehlschlag('test@example.com');
  assert(limiter.pruefeSperre('TEST@EXAMPLE.COM') !== null, 'sollte trotz anderer Schreibweise als dieselbe Adresse gelten');
});

await pruefe('erfolgreicher Login setzt den Zähler zurück', () => {
  const limiter = createLoginLimiter({ maxVersuche: 3, sperrdauerMs: 1000, fensterMs: 10000 });
  limiter.vermerkeFehlschlag('c@example.com');
  limiter.vermerkeFehlschlag('c@example.com');
  limiter.vermerkeErfolg('c@example.com');
  limiter.vermerkeFehlschlag('c@example.com');
  assert(limiter.pruefeSperre('c@example.com') === null, 'nach einem Erfolg sollte der alte Zähler nicht mehr nachwirken');
});

await pruefe('Sperre läuft nach sperrdauerMs automatisch ab', async () => {
  const limiter = createLoginLimiter({ maxVersuche: 1, sperrdauerMs: 150, fensterMs: 10000 });
  limiter.vermerkeFehlschlag('d@example.com');
  assert(limiter.pruefeSperre('d@example.com') !== null, 'sollte direkt nach dem Fehlschlag gesperrt sein');
  await warte(250);
  assert(limiter.pruefeSperre('d@example.com') === null, 'sollte nach Ablauf der Sperrdauer wieder entsperrt sein');
});

await pruefe('Zähler verfällt nach fensterMs Ruhe, auch ohne Erfolg', async () => {
  const limiter = createLoginLimiter({ maxVersuche: 3, sperrdauerMs: 1000, fensterMs: 150 });
  limiter.vermerkeFehlschlag('e@example.com');
  limiter.vermerkeFehlschlag('e@example.com');
  await warte(250);
  limiter.vermerkeFehlschlag('e@example.com');
  assert(limiter.pruefeSperre('e@example.com') === null, 'nach Verfall des Zeitfensters sollte der alte Zähler nicht mehr zählen');
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
