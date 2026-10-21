// Phase 10 - Staging-Vorbereitung: legt AUSSCHLIESSLICH synthetische
// Testdaten (Kunden/Anlagen/Angebote/Rechnungen) in einem Firestore-Projekt
// an - für den isolierten Pilot-Testbetrieb, NIEMALS für Produktionsdaten
// gedacht. Dieses Skript tut NICHTS von selbst - es muss von Danny (oder
// mit seiner ausdrücklichen Freigabe) manuell gegen das SEPARATE
// Firebase-Staging-Projekt ausgeführt werden, siehe staging/README.md.
//
// Sicherheitsmechanismus gegen ein versehentliches Ausführen gegen die
// Produktion: das Skript verweigert den Start, wenn die Projekt-ID nicht
// explizit über --project angegeben UND zusätzlich per --confirm-staging
// bestätigt wird. Es prüft NICHT inhaltlich, ob ein Projekt "wirklich"
// Staging ist (das kann nur Danny selbst wissen) - die beiden Flags sind
// eine bewusste Mehraufwand-Hürde gegen ein versehentliches Kopieren eines
// Befehls mit der falschen Projekt-ID.
//
// Verwendung:
//   GOOGLE_APPLICATION_CREDENTIALS=/pfad/zum/staging-service-account.json \
//     node staging/seed-synthetic-data.mjs --project neuverdrahtet-staging --confirm-staging
//
// Voraussetzung: "npm install firebase-admin" (einmalig, lokal - nicht Teil
// des Cloudflare-Worker-Codes, läuft nur hier als Node-Skript).

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

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

console.log(`\n⚠️  Dieses Skript schreibt jetzt synthetische Testdaten in das Firestore-Projekt "${projectId}".`);
console.log('    Stelle sicher, dass GOOGLE_APPLICATION_CREDENTIALS auf den STAGING-Service-Account zeigt, NICHT auf Produktion.\n');

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

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
