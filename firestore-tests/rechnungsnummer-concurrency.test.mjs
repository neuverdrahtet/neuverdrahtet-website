// Echter Parallelitätstest gegen einen LAUFENDEN Firestore-Emulator für die
// P0-Sicherheitskorrektur vom 28.10.2026 (Master-Audit Bericht 03, Risiko
// #6): die Rechnungsnummer-Vergabe muss atomar sein, damit zwei fast
// gleichzeitige Speichervorgänge (zwei Browser-Tabs/zwei Mitarbeiter)
// niemals dieselbe Nummer erhalten können.
//
// Hinweis zum Testaufbau: vergibRechnungsnummerAtomisch() in verwaltung/js/
// db.js ist fest an die EINE globale, über firebase-config.js konfigurierte
// Firestore-Instanz der App gebunden (kein Dependency-Injection-Parameter
// für eine Test-Instanz) - sie lässt sich daher nicht direkt gegen den
// hier gestarteten, isolierten Emulator-Kontext aufrufen, ohne die
// Produktionskonfiguration der App anzufassen (was hier bewusst vermieden
// wird). Dieser Test reproduziert deshalb exakt dieselbe Transaction-Form
// (ein Dokument lesen, denselben reinen Zähler-Algorithmus wie
// nextDailyNummer()/naechsteTagesnummer() anwenden, im selben Schritt
// zurückschreiben) direkt gegen den Emulator über die echte Firestore-SDK-
// Transaction-API - er beweist damit die zentrale Eigenschaft, auf die sich
// db.js verlässt: dass Firestore konkurrierende Transactions auf demselben
// Dokument korrekt serialisiert (Optimistic Concurrency mit automatischem
// Retry), und keine zwei von 100 echten, gleichzeitig gestarteten Aufrufen
// dieselbe Nummer erhalten können. Die Zähler-Logik selbst (reine Funktion,
// kein I/O) ist bereits in verwaltung/tests/aufbewahrungsfristen.test.mjs
// bzw. an anderer Stelle gegen den tatsächlichen Code abgedeckt.
//
// Ausführen: npm run test:rechnungsnummer-concurrency
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, runTransaction, getDoc } from 'firebase/firestore';
import { nextDailyNummer } from '../verwaltung/js/utils.js';

const hierDir = path.dirname(fileURLToPath(import.meta.url));
const rules = fs.readFileSync(path.join(hierDir, '..', 'firestore.rules'), 'utf8');

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const [host, portStr] = emulatorHost.split(':');

const testEnv = await initializeTestEnvironment({
  projectId: 'demo-test',
  firestore: { host, port: Number(portStr), rules },
});

let bestanden = 0, fehlgeschlagen = 0;
async function pruefe(name, fn) {
  try { await fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const { setDoc } = await import('firebase/firestore');
  await setDoc(doc(ctx.firestore(), 'users', 'admin-1'), { role: 'admin' });
});

// Dieselbe Transaction-Form wie vergibRechnungsnummerAtomisch() in db.js:
// einstellungen/global lesen, nextDailyNummer() anwenden, zurückschreiben -
// alles innerhalb EINER Firestore-Transaction, damit die Serialisierung
// durch Firestore selbst erfolgt, nicht durch Code hier im Test.
async function vergibAtomischImTest(firestoreInstanz, prefix) {
  const ref = doc(firestoreInstanz, 'einstellungen', 'global');
  return runTransaction(firestoreInstanz, async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists() ? snap.data() : {};
    const next = nextDailyNummer(prefix, { datum: data.rechnungNummerDatum, zaehler: data.rechnungNummerZaehler });
    tx.set(ref, { rechnungNummerDatum: next.datum, rechnungNummerZaehler: next.zaehler }, { merge: true });
    return next.nummer;
  });
}

await pruefe('K1: 100 gleichzeitige Rechnungsnummer-Anforderungen erzeugen 100 eindeutige, lückenlose Nummern', async () => {
  const adminFirestore = testEnv.authenticatedContext('admin-1').firestore();
  const ANZAHL = 100;
  // Promise.all startet alle 100 Transactions praktisch gleichzeitig, nicht
  // nacheinander - genau das Szenario "zwei (oder hier: 100) fast
  // gleichzeitige Speichervorgänge" aus der Vorgabe.
  const nummern = await Promise.all(
    Array.from({ length: ANZAHL }, () => vergibAtomischImTest(adminFirestore, 'R-'))
  );
  assert(nummern.length === ANZAHL, `erwartet ${ANZAHL} Ergebnisse, erhalten ${nummern.length}`);
  const eindeutige = new Set(nummern);
  assert(eindeutige.size === ANZAHL, `Duplikate gefunden: ${ANZAHL - eindeutige.size} von ${ANZAHL} Nummern waren keine Einzigartigen (${nummern.length - eindeutige.size} Kollisionen)`);

  // Lückenlosigkeit/kein Lost Update: der Endstand des Zählers im Dokument
  // muss exakt 100 sein - wäre auch nur eine der 100 Transactions den
  // Zählerstand einer anderen überschrieben worden (statt korrekt
  // serialisiert zu werden), stünde hier ein kleinerer Wert.
  const endstand = await getDoc(doc(adminFirestore, 'einstellungen', 'global'));
  assert(endstand.data().rechnungNummerZaehler === ANZAHL, `Endstand des Zählers erwartet ${ANZAHL}, war ${endstand.data().rechnungNummerZaehler} (Lost Update, falls kleiner)`);
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
await testEnv.cleanup();
