// Phase 10 - Staging-Vorbereitung: legt AUSSCHLIESSLICH synthetische
// Testdaten (Kunden/Anlagen/Angebote/Rechnungen) in einem Firestore-Projekt
// an - für den isolierten Pilot-Testbetrieb, NIEMALS für Produktionsdaten
// gedacht. Dieses Skript tut NICHTS von selbst - es muss von Danny (oder
// mit seiner ausdrücklichen Freigabe) manuell gegen das SEPARATE
// Firebase-Staging-Projekt ausgeführt werden, siehe staging/README.md.
//
// Phase 10.1 Sicherheitskorrektur: ein bloßer Projektname mit dem Wort
// "staging" (oder ein einzelnes CLI-Flag) ist KEIN Sicherheitsnachweis - ein
// Tippfehler oder ein kopierter Befehl mit der falschen Projekt-ID hätte das
// nicht verhindert. Das Skript verlangt deshalb DREI UNABHÄNGIGE,
// tatsächlich überprüfte Bestätigungen, bevor irgendetwas geschrieben wird:
//
//   1. --project <id> UND --confirm-staging als CLI-Flags (wie bisher) -
//      bewusste Mehraufwand-Hürde gegen ein versehentliches Copy&Paste.
//   2. Die Projekt-ID in der tatsächlichen GOOGLE_APPLICATION_CREDENTIALS-
//      Datei (Service-Account-JSON) MUSS exakt mit --project übereinstimmen.
//      Das ist die kryptografische Bindung, die auch sonst in diesem Projekt
//      als Isolationsgarantie dient (siehe staging/README.md, "Warum das
//      ... sicherstellt") - verhindert, dass jemand mit PRODUKTIONS-
//      Credentials nur per Tippfehler/Unwissen glaubt, gegen Staging zu
//      laufen (oder umgekehrt).
//   3. Im Zielprojekt selbst muss VORHER, einmalig und manuell (z.B. über
//      die Firebase Console, siehe unten), ein Freigabe-Dokument angelegt
//      worden sein (_stagingFreigabe/freigabe mit freigegeben:true und
//      passender projektId). Das verlagert die eigentliche "ist das wirklich
//      Staging"-Entscheidung dorthin, wo sie hingehört: in eine bewusste,
//      von Danny im Zielsystem selbst hinterlegte Bestätigung - nicht in
//      einen Kommandozeilen-Text, der sich leicht verwechseln lässt.
//   4. Zusätzliche Heuristik: existieren in "kunden" bereits Dokumente OHNE
//      istTestdatensatz:true, bricht das Skript ab - sieht nach einem
//      Projekt mit echten Daten aus, selbst wenn alle Flags/Freigaben
//      stimmen (z.B. ein aus Versehen von Produktion geklontes Projekt).
//   5. (Phase 11) Explizite SPERRLISTE bekannter produktiver Firebase-
//      Projekt-IDs (PRODUKTIVE_PROJEKT_IDS unten) - wird GANZ ZUERST
//      geprüft, noch vor jeder anderen Prüfung. Die echte Produktions-ID
//      wird direkt aus verwaltung/js/firebase-config.js importiert (bleibt
//      dadurch automatisch aktuell, falls sich der Wert dort je ändert),
//      plus ein paar offensichtliche Varianten als zusätzliches Sicherheitsnetz.
//
// Freigabe-Dokument einmalig anlegen (Danny, NACH Einrichtung des Staging-
// Projekts, VOR dem ersten Seed-Lauf) - z.B. per kleinem eigenen Skript oder
// direkt in der Firebase Console (Firestore -> Daten -> Collection
// "_stagingFreigabe" -> Dokument-ID "freigabe" -> Felder wie unten):
//   { freigegeben: true, projektId: "neuverdrahtet-staging",
//     freigegebenAm: "2026-01-01T00:00:00.000Z", freigegebenVon: "Danny Berger" }
//
// Verwendung:
//   GOOGLE_APPLICATION_CREDENTIALS=/pfad/zum/staging-service-account.json \
//     node staging/seed-synthetic-data.mjs --project neuverdrahtet-staging --confirm-staging
//
// Voraussetzung: "npm install firebase-admin" (einmalig, lokal - nicht Teil
// des Cloudflare-Worker-Codes, läuft nur hier als Node-Skript).

import fs from 'node:fs';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { firebaseConfig } from '../verwaltung/js/firebase-config.js';

const args = process.argv.slice(2);
const projectArgIndex = args.indexOf('--project');
const projectId = projectArgIndex !== -1 ? args[projectArgIndex + 1] : null;
const bestaetigt = args.includes('--confirm-staging');

if (!projectId || !bestaetigt) {
  console.error('Abgebrochen: --project <projekt-id> UND --confirm-staging sind zwingend erforderlich.');
  console.error('Beispiel: node staging/seed-synthetic-data.mjs --project neuverdrahtet-staging --confirm-staging');
  console.error('Das ist eine bewusste Sicherheitshürde - prüfe die Projekt-ID sorgfältig, bevor du bestätigst.');
  process.exit(1);
}

// Prüfung 5 (Phase 11): explizite Sperrliste bekannter produktiver
// Firebase-Projekt-IDs - läuft VOR jeder anderen Prüfung, braucht keine
// Dateizugriffe/Netzwerk. firebaseConfig.projectId ist die tatsächliche,
// im Code hinterlegte Produktions-ID (siehe verwaltung/js/firebase-
// config.js) - zusätzlich ein paar naheliegende Varianten, falls Danny aus
// Versehen eine davon als Staging-Projekt-ID eintippt.
const PRODUKTIVE_PROJEKT_IDS = new Set(
  [firebaseConfig.projectId, 'neuverdrahtet-verwaltung', 'neuverdrahtet']
    .filter(Boolean)
    .map((id) => id.toLowerCase()),
);
if (PRODUKTIVE_PROJEKT_IDS.has(projectId.toLowerCase())) {
  console.error(`ABGEBROCHEN: "${projectId}" steht auf der Sperrliste bekannter PRODUKTIVER Firebase-Projekt-IDs (siehe PRODUKTIVE_PROJEKT_IDS in dieser Datei).`);
  console.error('Dieses Skript darf NIEMALS gegen ein produktives Projekt laufen, unabhängig davon, ob --confirm-staging gesetzt ist oder ein Freigabe-Dokument existiert.');
  process.exit(1);
}

// Prüfung 2: die Projekt-ID im CLI-Argument muss mit der tatsächlichen
// Projekt-ID in den Service-Account-Credentials übereinstimmen - ein reiner
// Namensabgleich im Kommandozeilen-Text reicht nicht, die Datei selbst wird
// gelesen und verglichen.
const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!credentialsPath) {
  console.error('Abgebrochen: GOOGLE_APPLICATION_CREDENTIALS ist nicht gesetzt (Pfad zur Staging-Service-Account-Datei).');
  process.exit(1);
}
let credentialsJson;
try {
  credentialsJson = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
} catch (err) {
  console.error(`Abgebrochen: GOOGLE_APPLICATION_CREDENTIALS ("${credentialsPath}") konnte nicht gelesen/geparst werden: ${err.message}`);
  process.exit(1);
}
if (credentialsJson.project_id !== projectId) {
  console.error(`Abgebrochen: die Projekt-ID in den Credentials ("${credentialsJson.project_id}") stimmt NICHT mit --project ("${projectId}") überein.`);
  console.error('Das ist ein starkes Warnsignal für eine Verwechslung (z.B. Produktions-Credentials bei einem als "staging" gemeinten Aufruf, oder umgekehrt) - Lauf abgebrochen, bevor irgendetwas geschrieben wurde.');
  process.exit(1);
}

console.log(`\n⚠️  Dieses Skript schreibt jetzt synthetische Testdaten in das Firestore-Projekt "${projectId}".`);
console.log('    Projekt-ID aus Credentials und --project stimmen überein. Prüfe jetzt die Freigabe im Zielprojekt selbst ...\n');

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

// Prüfung 3: Freigabe-Dokument im ZIELPROJEKT selbst (nicht im Skript-Text) -
// siehe Kopfkommentar oben für die Anleitung, wie Danny es einmalig anlegt.
const freigabeDoc = await db.collection('_stagingFreigabe').doc('freigabe').get();
const freigabe = freigabeDoc.exists ? freigabeDoc.data() : null;
if (!freigabe || freigabe.freigegeben !== true || freigabe.projektId !== projectId) {
  console.error(`Abgebrochen: im Projekt "${projectId}" fehlt das Freigabe-Dokument "_stagingFreigabe/freigabe" (oder es stimmt nicht/nicht zu diesem Projekt).`);
  console.error('Ein Projektname mit "staging" im Namen ist KEIN Sicherheitsnachweis - lege das Dokument einmalig manuell an (siehe Kopfkommentar dieser Datei), bevor du dieses Skript erneut ausführst.');
  process.exit(1);
}

// Prüfung 4: Heuristik gegen ein Projekt, das (trotz aller vorherigen
// Prüfungen) schon echte, nicht als Test gekennzeichnete Kundendaten enthält.
const bestehendeKunden = await db.collection('kunden').limit(5).get();
const unerwarteteEchteDaten = bestehendeKunden.docs.filter((d) => d.data()?.istTestdatensatz !== true);
if (unerwarteteEchteDaten.length > 0) {
  console.error(`Abgebrochen: Projekt "${projectId}" enthält bereits ${unerwarteteEchteDaten.length} Kunden-Dokument(e) OHNE istTestdatensatz:true - das sieht nach echten Daten aus (z.B. ein versehentlich von Produktion geklontes Projekt).`);
  console.error('Dieses Skript schreibt niemals in ein Projekt, das schon unmarkierte Bestandsdaten enthält.');
  process.exit(1);
}

console.log('Freigabe-Dokument gefunden und gültig, keine unerwarteten Bestandsdaten gefunden. Lege Testdaten an ...\n');

// Deutlich als Testdaten erkennbar (Namen/Adressen/Beträge klar fiktiv,
// keine realen Personen-/Firmennamen oder echten Adressen) - entspricht der
// Vorgabe "keine echten Kundendaten" auch im Staging-Betrieb.
const kunden = [
  { id: 'test-kunde-1', firma: 'Testfirma Musterbau GmbH (synthetisch)', typ: 'firma', email: 'test1@beispiel.invalid', telefon: '0000-0000001', strasse: 'Teststraße 1', plz: '00000', ort: 'Testort', status: 'kunde' },
  { id: 'test-kunde-2', firma: 'Erika Musterfrau (synthetisch)', typ: 'privat', email: 'test2@beispiel.invalid', telefon: '0000-0000002', strasse: 'Teststraße 2', plz: '00000', ort: 'Testort', status: 'kunde' },
];

const anlagen = [
  { id: 'test-anlage-1', kundeId: 'test-kunde-1', bezeichnung: 'Verteilung Keller (Testanlage)', kategorie: 'verteilung', standort: 'Testort' },
  { id: 'test-anlage-2', kundeId: 'test-kunde-2', bezeichnung: 'Wärmepumpe (Testanlage)', kategorie: 'waermepumpe', standort: 'Testort' },
];

const angebote = [
  { id: 'test-angebot-1', kundeId: 'test-kunde-1', titel: 'Testangebot Elektroinstallation', status: 'versendet', version: 1 },
];

const rechnungen = [
  { id: 'test-rechnung-1', kundeId: 'test-kunde-1', titel: 'Testrechnung', betragBrutto: 100, status: 'offen', version: 1 },
];

async function seedCollection(name, docs) {
  for (const doc of docs) {
    const { id, ...daten } = doc;
    await db.collection(name).doc(id).set({ ...daten, istTestdatensatz: true, erstelltAm: new Date().toISOString() });
    console.log(`  ${name}/${id} angelegt`);
  }
}

await seedCollection('kunden', kunden);
await seedCollection('anlagen', anlagen);
await seedCollection('angebote', angebote);
await seedCollection('rechnungen', rechnungen);

console.log('\nFertig. Alle Testdatensätze tragen zusätzlich das Feld "istTestdatensatz: true" zur eindeutigen Wiedererkennung/Aufräumbarkeit.');
