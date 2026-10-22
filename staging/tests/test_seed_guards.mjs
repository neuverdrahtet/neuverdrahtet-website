// Echter Test gegen das TATSÄCHLICHE Skript staging/seed-synthetic-data.mjs
// (kein Mock/keine __test__-Hintertür - das Skript läuft als eigener
// Node-Prozess, exakt wie Danny es später per Kommandozeile aufrufen würde).
// Deckt Phase 11 Punkt 1 ab: eine explizite Sperrliste bekannter produktiver
// Firebase-Projekt-IDs muss den Lauf verweigern, noch bevor irgendein
// Dateizugriff/Firestore-Schreibversuch passiert.
//
// Ausführen: node staging/tests/test_seed_guards.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const skriptPfad = path.join(repoRoot, 'staging', 'seed-synthetic-data.mjs');

function runSkript(args, env = {}) {
  return spawnSync(process.execPath, [skriptPfad, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

let bestanden = 0, fehlgeschlagen = 0;
function pruefe(name, fn) {
  try { fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

pruefe('S1: die echte PRODUKTIONS-Projekt-ID ("neuverdrahtet-verwaltung", aus firebase-config.js importiert) wird abgelehnt, auch mit --confirm-staging', () => {
  const res = runSkript(['--project', 'neuverdrahtet-verwaltung', '--confirm-staging']);
  assert(res.status !== 0, 'Prozess muss mit Fehler beenden (exit != 0)');
  assert(/Sperrliste/.test(res.stderr), `stderr muss die Sperrliste nennen, war: ${res.stderr}`);
});

pruefe('S2: eine weitere bekannte produktive Variante ("neuverdrahtet") wird ebenfalls abgelehnt', () => {
  const res = runSkript(['--project', 'neuverdrahtet', '--confirm-staging']);
  assert(res.status !== 0, 'Prozess muss mit Fehler beenden');
  assert(/Sperrliste/.test(res.stderr), `stderr muss die Sperrliste nennen, war: ${res.stderr}`);
});

pruefe('S2b: die Sperrlisten-Prüfung ist case-insensitive (Groß-/Kleinschreibung darf keine Lücke sein)', () => {
  const res = runSkript(['--project', 'Neuverdrahtet-Verwaltung', '--confirm-staging']);
  assert(res.status !== 0, 'Prozess muss mit Fehler beenden');
  assert(/Sperrliste/.test(res.stderr), `stderr muss die Sperrliste nennen, war: ${res.stderr}`);
});

pruefe('S3: ein unverdächtiger Staging-Name ("neuverdrahtet-staging") wird NICHT von der Sperrliste geblockt - der Lauf scheitert danach regulär an fehlenden Credentials, nicht an der Sperrliste', () => {
  const res = runSkript(['--project', 'neuverdrahtet-staging', '--confirm-staging'], { GOOGLE_APPLICATION_CREDENTIALS: '' });
  assert(res.status !== 0, 'Prozess muss trotzdem mit Fehler enden (keine echten Credentials vorhanden)');
  assert(!/Sperrliste/.test(res.stderr), `ein legitimer Staging-Name darf NICHT als Sperrlisten-Treffer erscheinen, stderr war: ${res.stderr}`);
  assert(/GOOGLE_APPLICATION_CREDENTIALS/.test(res.stderr), `muss statt dessen an der Credentials-Prüfung scheitern, stderr war: ${res.stderr}`);
});

pruefe('S4: ohne --project/--confirm-staging wird sofort abgebrochen (unverändert aus Phase 10.1)', () => {
  const res = runSkript([]);
  assert(res.status !== 0, 'Prozess muss mit Fehler beenden');
  assert(/--confirm-staging/.test(res.stderr), `stderr muss auf die fehlenden Flags hinweisen, war: ${res.stderr}`);
});

pruefe('S5: eine Projekt-ID in den Credentials, die NICHT zu --project passt, wird abgelehnt (Prüfung 2, unverändert aus Phase 10.1) - mit einem ERLAUBTEN Staging-Namen, damit die Sperrliste diesen Fall nicht überdeckt', () => {
  const tmpCred = path.join(os.tmpdir(), `fake-creds-${Date.now()}.json`);
  fs.writeFileSync(tmpCred, JSON.stringify({ project_id: 'ein-anderes-projekt' }));
  try {
    const res = runSkript(['--project', 'neuverdrahtet-staging', '--confirm-staging'], { GOOGLE_APPLICATION_CREDENTIALS: tmpCred });
    assert(res.status !== 0, 'Prozess muss mit Fehler beenden');
    assert(/stimmt NICHT mit --project/.test(res.stderr), `stderr muss den Mismatch nennen, war: ${res.stderr}`);
  } finally {
    fs.unlinkSync(tmpCred);
  }
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
