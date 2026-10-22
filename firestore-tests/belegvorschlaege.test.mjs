// Echter Test gegen den TATSÄCHLICHEN Produktionscode
// (verwaltung/js/belegvorschlaege.js, *Mit-Varianten mit injizierter
// Firestore-Instanz - siehe Kopfkommentar dort) gegen einen laufenden
// Firestore-Emulator (keine Mocks). Deckt Phase 11 Punkt 3 "Versionierung
// und konkurrierende Freigaben" ab: die Freigabe eines Beleg-Vorschlags
// (Phase 11 Punkt 1, bulkFixReceipts-Vorschlagsmodus) darf eine Ausgabe
// NICHT übernehmen, wenn sie sich seit dem Vorschlag bereits geändert hat -
// das muss serverseitig (durch die Firestore-Transaktion selbst) erzwungen
// werden, nicht nur durch eine Browser-Annahme.
//
// Nutzt bewusst dieselbe VENDORTE Firebase-SDK-Kopie
// (verwaltung/js/vendor/firebase/...), die auch belegvorschlaege.js selbst
// importiert - die npm-Pakete "firebase"/"@firebase/rules-unit-testing"
// sind eine ANDERE SDK-Instanz und nicht kompatibel ("Type does not match
// the expected instance", empirisch geprüft). Läuft deshalb gegen offene
// Testregeln (open-rules-for-logic-tests.rules) statt gegen die echten
// firestore.rules - die eigentliche Rollenprüfung für belegVorschlaege/
// ausgaben ist bereits in firestore-tests/rules.test.mjs gegen die ECHTEN
// Regeln abgedeckt; dieser Test prüft ausschließlich die Versions-/
// Transaktionslogik selbst.
//
// Ausführen: npm run test:belegvorschlaege (startet/stoppt den Firestore-
// Emulator automatisch über "firebase emulators:exec --config
// firestore-tests/firebase.testconfig.json")
// Die vendorte Firestore-SDK-Kopie geht (anders als das npm-Paket) von einem
// Browser mit XMLHttpRequest aus, insbesondere für die Emulator-Verbindung -
// in Node fehlt das, daher dieser minimale Polyfill, NUR für diesen Test.
import XMLHttpRequest from 'xhr2';
globalThis.XMLHttpRequest = XMLHttpRequest;

import { initializeApp, getApps, deleteApp } from '../verwaltung/js/vendor/firebase/firebase-app.js';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc } from '../verwaltung/js/vendor/firebase/firebase-firestore.js';
import { freigebenBelegVorschlagMit, ablehnenBelegVorschlagMit, BelegVorschlagVeraltetError } from '../verwaltung/js/belegvorschlaege.js';

for (const app of getApps()) await deleteApp(app);
const app = initializeApp({ projectId: 'demo-test' }, 'belegvorschlaege-test');
const db = getFirestore(app);
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const [host, portStr] = emulatorHost.split(':');
connectFirestoreEmulator(db, host, Number(portStr));

let bestanden = 0, fehlgeschlagen = 0;
async function pruefe(name, fn) {
  try { await fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

async function setzeAusgabe(id, daten) { await setDoc(doc(db, 'ausgaben', id), daten); }
async function setzeVorschlag(id, daten) { await setDoc(doc(db, 'belegVorschlaege', id), daten); }
async function liesDoc(collection, id) {
  const snap = await getDoc(doc(db, collection, id));
  return snap.exists() ? snap.data() : null;
}

await pruefe('V1: eine UNVERÄNDERTE Ausgabe wird korrekt mit den Vorschlagswerten aktualisiert, Vorschlag wird "freigegeben"', async () => {
  await setzeAusgabe('a-v1', { betragBrutto: 0, lieferant: '', datum: '2026-01-01' });
  await setzeVorschlag('v-v1', {
    ausgabeId: 'a-v1', status: 'offen',
    alteWerte: { betragBrutto: 0, lieferant: '' },
    neueWerte: { betragBrutto: 119, betragNetto: 100, steuersatz: 19, lieferant: 'Test GmbH' },
  });
  const ergebnis = await freigebenBelegVorschlagMit(db, 'v-v1');
  assert(ergebnis.ausgabeId === 'a-v1', 'Ergebnis muss die betroffene ausgabeId enthalten');
  const ausgabe = await liesDoc('ausgaben', 'a-v1');
  assert(ausgabe.betragBrutto === 119, `Betrag muss übernommen worden sein, war ${ausgabe.betragBrutto}`);
  assert(ausgabe.lieferant === 'Test GmbH', 'Lieferant muss übernommen worden sein');
  const vorschlag = await liesDoc('belegVorschlaege', 'v-v1');
  assert(vorschlag.status === 'freigegeben', `Vorschlag muss "freigegeben" sein, war ${vorschlag.status}`);
});

await pruefe('V2 (Kernfall "konkurrierende Freigaben"): hat sich die Ausgabe NACH dem Vorschlag geändert (z.B. jemand hat sie zwischenzeitlich manuell bearbeitet), wird NICHT blind übernommen - BelegVorschlagVeraltetError, Vorschlag wird "veraltet"', async () => {
  await setzeAusgabe('a-v2', { betragBrutto: 0, lieferant: '' });
  await setzeVorschlag('v-v2', {
    ausgabeId: 'a-v2', status: 'offen',
    alteWerte: { betragBrutto: 0 }, // Stand ZUM ZEITPUNKT DES VORSCHLAGS
    neueWerte: { betragBrutto: 50 },
  });
  // Simuliert eine konkurrierende Änderung NACH der Vorschlagserstellung, z.B.
  // weil ein Mitarbeiter den Beleg zwischenzeitlich selbst korrigiert hat.
  await setzeAusgabe('a-v2', { betragBrutto: 30, lieferant: '' });

  let geworfen = null;
  try {
    await freigebenBelegVorschlagMit(db, 'v-v2');
  } catch (err) {
    geworfen = err;
  }
  assert(geworfen instanceof BelegVorschlagVeraltetError, `muss BelegVorschlagVeraltetError werfen, war ${geworfen?.constructor?.name}`);

  const ausgabe = await liesDoc('ausgaben', 'a-v2');
  assert(ausgabe.betragBrutto === 30, 'die konkurrierend gesetzte Änderung (30) darf NICHT durch den veralteten Vorschlag (50) überschrieben werden');

  const vorschlag = await liesDoc('belegVorschlaege', 'v-v2');
  assert(vorschlag.status === 'veraltet', `Vorschlag muss als "veraltet" markiert sein, war ${vorschlag.status}`);
});

await pruefe('V3: ein bereits freigegebener Vorschlag kann nicht ein zweites Mal freigegeben werden (keine doppelte Anwendung)', async () => {
  await setzeAusgabe('a-v3', { betragBrutto: 0 });
  await setzeVorschlag('v-v3', { ausgabeId: 'a-v3', status: 'freigegeben', alteWerte: { betragBrutto: 0 }, neueWerte: { betragBrutto: 999 } });
  let fehler = null;
  try { await freigebenBelegVorschlagMit(db, 'v-v3'); } catch (err) { fehler = err; }
  assert(fehler !== null, 'eine zweite Freigabe desselben Vorschlags muss fehlschlagen');
  const ausgabe = await liesDoc('ausgaben', 'a-v3');
  assert(ausgabe.betragBrutto === 0, 'eine zweite Freigabe darf die Ausgabe nicht erneut (oder überhaupt) verändern');
});

await pruefe('V4: Ablehnen verändert die Ausgabe NICHT, nur den Vorschlags-Status', async () => {
  await setzeAusgabe('a-v4', { betragBrutto: 0 });
  await setzeVorschlag('v-v4', { ausgabeId: 'a-v4', status: 'offen', alteWerte: { betragBrutto: 0 }, neueWerte: { betragBrutto: 77 } });
  await ablehnenBelegVorschlagMit(db, 'v-v4', { abgelehntVonUid: 'uid-test' });
  const ausgabe = await liesDoc('ausgaben', 'a-v4');
  assert(ausgabe.betragBrutto === 0, 'Ablehnen darf die Ausgabe nicht verändern');
  const vorschlag = await liesDoc('belegVorschlaege', 'v-v4');
  assert(vorschlag.status === 'abgelehnt', `Vorschlag muss "abgelehnt" sein, war ${vorschlag.status}`);
  assert(vorschlag.abgelehntVonUid === 'uid-test', 'abgelehntVonUid muss gespeichert werden (Audit-Trail)');
});

await pruefe('V5: ein unverändertes, aber IRRELEVANTES Feld (z.B. eine neue interne Notiz) darf die Freigabe NICHT blockieren - nur die im Vorschlag genannten Felder werden verglichen', async () => {
  await setzeAusgabe('a-v5', { betragBrutto: 0, internerVermerk: 'ursprünglich' });
  await setzeVorschlag('v-v5', { ausgabeId: 'a-v5', status: 'offen', alteWerte: { betragBrutto: 0 }, neueWerte: { betragBrutto: 42 } });
  // Nur ein Feld geändert, das NICHT Teil von alteWerte/neueWerte ist.
  await setzeAusgabe('a-v5', { betragBrutto: 0, internerVermerk: 'nachträglich geändert' });
  const ergebnis = await freigebenBelegVorschlagMit(db, 'v-v5');
  assert(ergebnis.ausgabeId === 'a-v5', 'Freigabe muss trotz irrelevanter Feldänderung gelingen');
  const ausgabe = await liesDoc('ausgaben', 'a-v5');
  assert(ausgabe.betragBrutto === 42, 'Betrag muss übernommen worden sein');
  assert(ausgabe.internerVermerk === 'nachträglich geändert', 'das irrelevante Feld darf durch die Freigabe nicht zurückgesetzt werden');
});

await pruefe('V6: eine fehlende Ausgabe (z.B. zwischenzeitlich gelöscht) führt zu "veraltet", nicht zu einem unbehandelten Absturz', async () => {
  await setzeVorschlag('v-v6', { ausgabeId: 'nicht-vorhanden', status: 'offen', alteWerte: { betragBrutto: 0 }, neueWerte: { betragBrutto: 5 } });
  let geworfen = null;
  try { await freigebenBelegVorschlagMit(db, 'v-v6'); } catch (err) { geworfen = err; }
  assert(geworfen instanceof BelegVorschlagVeraltetError, `muss BelegVorschlagVeraltetError werfen, war ${geworfen?.constructor?.name}`);
  const vorschlag = await liesDoc('belegVorschlaege', 'v-v6');
  assert(vorschlag.status === 'veraltet', `Vorschlag muss "veraltet" sein, war ${vorschlag.status}`);
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
await deleteApp(app);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
