// Phase 16 (Testaudit und -konsolidierung) der Service-/Techniker-/
// Personalverwaltung: bisher musste jede der >12 reinen Node-Testdateien
// unter verwaltung/tests/ und cloudflare-worker/jarvis-tests/ einzeln von
// Hand aufgerufen werden (package.json kannte nur test:rules/
// test:belegvorschlaege/test:browser-smoke) - leicht zu vergessen, welche
// Datei es überhaupt gibt, und keine EINE ehrliche Gesamtzahl über alle
// Testdateien hinweg. Dieses Skript läuft jede gefundene Testdatei als
// eigenen Node-Prozess (genau wie bisher von Hand), liest deren eigene
// "--- Ergebnis: X bestanden, Y fehlgeschlagen ---"-Zeile aus und fasst sie
// zu EINER Gesamtzahl zusammen - keine neue Testlogik, nur Aggregation der
// bereits bestehenden, echten Testergebnisse.
//
// Deckt NICHT die Firestore-Regel-Tests ab (firestore-tests/rules.test.mjs
// braucht den Firebase-Emulator, siehe "npm run test:rules") und nicht
// test:belegvorschlaege (eigene Emulator-Konfiguration) - beide bleiben
// eigene npm-Skripte, siehe "test:all" in package.json, das dieses Skript
// UND test:rules nacheinander aufruft.
//
// Ausführen: node scripts/run-all-tests.mjs  (oder: npm run test:unit)
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const TEST_VERZEICHNISSE = [
  'verwaltung/tests',
  'cloudflare-worker/jarvis-tests',
];

function findeTestdateien(verzeichnis) {
  const absolut = path.join(repoRoot, verzeichnis);
  return readdirSync(absolut)
    .filter((name) => name.endsWith('.mjs'))
    .sort()
    .map((name) => path.join(verzeichnis, name));
}

const dateien = TEST_VERZEICHNISSE.flatMap(findeTestdateien);

const ERGEBNIS_ZEILE = /--- Ergebnis: (\d+) bestanden, (\d+) fehlgeschlagen ---/;

let gesamtBestanden = 0, gesamtFehlgeschlagen = 0, dateienOhneAuswertbaresErgebnis = 0;
const fehlgeschlageneDateien = [];

for (const relativerPfad of dateien) {
  const { stdout, stderr, status } = spawnSync(process.execPath, [relativerPfad], { cwd: repoRoot, encoding: 'utf8' });
  const treffer = ERGEBNIS_ZEILE.exec(stdout);
  if (!treffer) {
    // Eine Testdatei ohne die erwartete Abschlusszeile ist selbst ein
    // Befund (z.B. Absturz vor dem letzten console.log) - nicht stillschweigend
    // als "0 Tests, alles gut" werten.
    dateienOhneAuswertbaresErgebnis++;
    fehlgeschlageneDateien.push(relativerPfad);
    console.log(`??  ${relativerPfad} - keine auswertbare Ergebniszeile (Exit-Code ${status})`);
    if (stderr) console.log(stderr.trim());
    continue;
  }
  const [, bestandenStr, fehlgeschlagenStr] = treffer;
  const bestanden = Number(bestandenStr);
  const fehlgeschlagen = Number(fehlgeschlagenStr);
  gesamtBestanden += bestanden;
  gesamtFehlgeschlagen += fehlgeschlagen;
  const status_ = fehlgeschlagen > 0 ? 'FAIL' : 'OK  ';
  console.log(`${status_} ${relativerPfad} (${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen)`);
  if (fehlgeschlagen > 0) fehlgeschlageneDateien.push(relativerPfad);
}

console.log(`\n=== Gesamt: ${dateien.length} Testdateien, ${gesamtBestanden} bestanden, ${gesamtFehlgeschlagen} fehlgeschlagen${dateienOhneAuswertbaresErgebnis > 0 ? `, ${dateienOhneAuswertbaresErgebnis} ohne auswertbares Ergebnis` : ''} ===`);
if (fehlgeschlageneDateien.length > 0) {
  console.log(`Betroffene Dateien: ${fehlgeschlageneDateien.join(', ')}`);
}
process.exit(gesamtFehlgeschlagen > 0 || dateienOhneAuswertbaresErgebnis > 0 ? 1 : 0);
