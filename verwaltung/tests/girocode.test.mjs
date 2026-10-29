// Reine Logik-Tests für baueGirocodePayload() aus verwaltung/js/girocode.js
// (EPC069-12 "GiroCode"-Zahlungs-QR-Code auf Rechnungs-PDFs). Deckt NICHT
// erzeugeGirocodeDataUrl() ab - das braucht echte Browser-APIs (Image,
// canvas, XMLSerializer) und die bereits an anderer Stelle (geraete.js)
// erprobte ZXing-Bibliothek, beides ohne DOM/Browser hier nicht sinnvoll
// testbar. baueGirocodePayload() ist die eigentliche fachliche Logik (welche
// Felder in welcher Reihenfolge/Formatierung in den QR-Code wandern) und
// eine reine Funktion - genau die hier abgedeckt wird.
//
// Ausführen: node verwaltung/tests/girocode.test.mjs
import { baueGirocodePayload } from '../js/girocode.js';

let bestanden = 0, fehlgeschlagen = 0;
function pruefe(name, fn) {
  try { fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

pruefe('G1: gültige Eingabe erzeugt einen 12-zeiligen EPC069-12-Payload in korrekter Feldreihenfolge', () => {
  const payload = baueGirocodePayload({
    empfaenger: 'neuverdrahtet UG', iban: 'DE02500105175407324931', bic: 'INGDDEFFXXX',
    betrag: 119.0, verwendungszweck: 'Rechnung RE-2026-001 - Mustermann GmbH',
  });
  assert(payload !== null, 'Payload darf bei gültigen Daten nicht null sein');
  const zeilen = payload.split('\n');
  assert(zeilen.length === 12, `erwartet 12 Zeilen, erhalten ${zeilen.length}`);
  assert(zeilen[0] === 'BCD');
  assert(zeilen[1] === '002');
  assert(zeilen[2] === '1');
  assert(zeilen[3] === 'SCT');
  assert(zeilen[4] === 'INGDDEFFXXX', `BIC an Zeile 5 erwartet, war "${zeilen[4]}"`);
  assert(zeilen[5] === 'neuverdrahtet UG', `Empfänger an Zeile 6 erwartet, war "${zeilen[5]}"`);
  assert(zeilen[6] === 'DE02500105175407324931', `IBAN an Zeile 7 erwartet, war "${zeilen[6]}"`);
  assert(zeilen[7] === 'EUR119.00', `Betrag an Zeile 8 erwartet "EUR119.00", war "${zeilen[7]}"`);
  assert(zeilen[8] === '' && zeilen[9] === '', 'Zeilen 9+10 (Zweck-Kennung/strukturierter Verwendungszweck) müssen leer sein');
  assert(zeilen[10] === 'Rechnung RE-2026-001 - Mustermann GmbH', `unstrukturierter Verwendungszweck an Zeile 11 erwartet, war "${zeilen[10]}"`);
  assert(zeilen[11] === '', 'letzte Zeile (Hinweis an Zahler) muss leer sein');
});

pruefe('G2: fehlende IBAN liefert null statt eines ungültigen QR-Codes', () => {
  const payload = baueGirocodePayload({ empfaenger: 'neuverdrahtet UG', iban: '', bic: '', betrag: 100, verwendungszweck: 'x' });
  assert(payload === null);
});

pruefe('G3: fehlender Empfänger liefert null', () => {
  const payload = baueGirocodePayload({ empfaenger: '', iban: 'DE02500105175407324931', betrag: 100, verwendungszweck: 'x' });
  assert(payload === null);
});

pruefe('G4: Betrag 0 oder negativ liefert null (kein Zahlungs-QR-Code für nichts/negative Beträge)', () => {
  assert(baueGirocodePayload({ empfaenger: 'x', iban: 'DE02500105175407324931', betrag: 0, verwendungszweck: 'x' }) === null);
  assert(baueGirocodePayload({ empfaenger: 'x', iban: 'DE02500105175407324931', betrag: -50, verwendungszweck: 'x' }) === null);
});

pruefe('G5: Betrag wird kaufmännisch auf 2 Nachkommastellen formatiert', () => {
  const payload = baueGirocodePayload({ empfaenger: 'x', iban: 'DE02500105175407324931', betrag: 42.999, verwendungszweck: 'x' });
  assert(payload.split('\n')[7] === 'EUR43.00', `erwartet "EUR43.00", war "${payload.split('\n')[7]}"`);
});

pruefe('G6: IBAN mit Leerzeichen (z.B. aus einer Formularkopie) wird normalisiert', () => {
  const payload = baueGirocodePayload({ empfaenger: 'x', iban: 'DE02 5001 0517 5407 3249 31', betrag: 10, verwendungszweck: 'x' });
  assert(payload.split('\n')[6] === 'DE02500105175407324931', `erwartet IBAN ohne Leerzeichen, war "${payload.split('\n')[6]}"`);
});

pruefe('G7: Empfänger/Verwendungszweck werden auf die EPC-Längengrenzen (70/140 Zeichen) gekürzt', () => {
  const langerName = 'A'.repeat(100);
  const langerZweck = 'B'.repeat(200);
  const payload = baueGirocodePayload({ empfaenger: langerName, iban: 'DE02500105175407324931', betrag: 10, verwendungszweck: langerZweck });
  const zeilen = payload.split('\n');
  assert(zeilen[5].length === 70, `Empfänger muss auf 70 Zeichen gekürzt werden, war ${zeilen[5].length}`);
  assert(zeilen[10].length === 140, `Verwendungszweck muss auf 140 Zeichen gekürzt werden, war ${zeilen[10].length}`);
});

pruefe('G8: fehlende BIC ist zulässig (seit 2016 bei SEPA-Inlandsüberweisungen optional) - Zeile bleibt leer, kein null', () => {
  const payload = baueGirocodePayload({ empfaenger: 'x', iban: 'DE02500105175407324931', bic: '', betrag: 10, verwendungszweck: 'x' });
  assert(payload !== null, 'fehlende BIC darf den Payload nicht ungültig machen');
  assert(payload.split('\n')[4] === '', 'BIC-Zeile muss leer sein, wenn keine BIC angegeben ist');
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
