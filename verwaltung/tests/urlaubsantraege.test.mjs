// Echter Regressionstest gegen den tatsächlichen Code (verwaltung/js/views/
// urlaubsantraege.js, reiner Import, keine Kopie) für baueTerminAusAntrag() -
// den bei Genehmigung automatisch angelegten Kalendertermin. Deckt
// insbesondere den am 28.10.2026 gefundenen Bug ab (siehe Kommentar in der
// geprüften Datei): "ende" muss eine Uhrzeit tragen, sonst erkennt
// terminUeberlappt()/findeTerminKonflikte() (serviceauftraege.js) am letzten
// Abwesenheitstag keinen Konflikt mehr (reiner String-Vergleich). Lücke aus
// dem Mitarbeiter-Bereich-Audit (14.11.2026) - vorher keine dedizierten Tests.
//
// Ausführen: node verwaltung/tests/urlaubsantraege.test.mjs
import { baueTerminAusAntrag } from '../js/views/urlaubsantraege.js';

let bestanden = 0, fehlgeschlagen = 0;
function pruefe(name, fn) {
  try { fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

pruefe('B1 (Regression 28.10.2026): "ende" trägt eine Uhrzeit (T23:59), nicht nur das reine Datum', () => {
  const antrag = { typ: 'urlaub', von: '2026-05-10', bis: '2026-05-12', mitarbeiterId: 'm1', kommentar: '' };
  const termin = baueTerminAusAntrag(antrag, 'Max Muster');
  assert(termin.ende === '2026-05-12T23:59', `erwartet "2026-05-12T23:59", war "${termin.ende}"`);
  // Die eigentliche Bug-Garantie: ein String-Vergleich mit einem Zeitstempel
  // am selben Tag (z.B. ein Serviceauftrag ab 09:00 Uhr) muss den Termin
  // weiterhin als überlappend/"kleiner oder gleich" erkennen können.
  assert(termin.ende >= '2026-05-12T09:00', 'ende muss als String mit einem Zeitstempel desselben Tages vergleichbar "größer" sein');
});

pruefe('B2: "start" trägt konsistent T00:00', () => {
  const antrag = { typ: 'krankmeldung', von: '2026-05-10', bis: '2026-05-10', mitarbeiterId: 'm1', kommentar: '' };
  const termin = baueTerminAusAntrag(antrag, 'Max Muster');
  assert(termin.start === '2026-05-10T00:00', `erwartet "2026-05-10T00:00", war "${termin.start}"`);
});

pruefe('TYP1: "urlaub" wird 1:1 auf den Termin-Typ "urlaub" gemappt', () => {
  const termin = baueTerminAusAntrag({ typ: 'urlaub', von: '2026-05-10', bis: '2026-05-10', mitarbeiterId: 'm1' }, 'Max Muster');
  assert(termin.typ === 'urlaub', `erwartet "urlaub", war "${termin.typ}"`);
});

pruefe('TYP2: "krankmeldung" wird auf den Termin-Typ "krank" gemappt (unterschiedliche Namen in Antrag vs. Termin)', () => {
  const termin = baueTerminAusAntrag({ typ: 'krankmeldung', von: '2026-05-10', bis: '2026-05-10', mitarbeiterId: 'm1' }, 'Max Muster');
  assert(termin.typ === 'krank', `erwartet "krank", war "${termin.typ}"`);
});

pruefe('M1: der Mitarbeiter wird korrekt in mitarbeiterIds eingetragen (für die Plantafel-Zuordnung)', () => {
  const termin = baueTerminAusAntrag({ typ: 'urlaub', von: '2026-05-10', bis: '2026-05-10', mitarbeiterId: 'm42' }, 'Max Muster');
  assert(Array.isArray(termin.mitarbeiterIds) && termin.mitarbeiterIds.length === 1 && termin.mitarbeiterIds[0] === 'm42');
});

pruefe('T1: der Titel enthält Typ und Mitarbeitername, für die Plantafel-Anzeige', () => {
  const termin = baueTerminAusAntrag({ typ: 'urlaub', von: '2026-05-10', bis: '2026-05-10', mitarbeiterId: 'm1' }, 'Max Muster');
  assert(termin.titel === 'Urlaub: Max Muster', `erwartet "Urlaub: Max Muster", war "${termin.titel}"`);
});

pruefe('K1: ein fehlender Kommentar wird als leerer String übernommen, kein "undefined" im Termin', () => {
  const termin = baueTerminAusAntrag({ typ: 'urlaub', von: '2026-05-10', bis: '2026-05-10', mitarbeiterId: 'm1' }, 'Max Muster');
  assert(termin.beschreibung === '', `erwartet leeren String, war ${JSON.stringify(termin.beschreibung)}`);
});

pruefe('K2: ein vorhandener Kommentar wird 1:1 als Beschreibung übernommen', () => {
  const termin = baueTerminAusAntrag({ typ: 'urlaub', von: '2026-05-10', bis: '2026-05-10', mitarbeiterId: 'm1', kommentar: 'Hochzeit' }, 'Max Muster');
  assert(termin.beschreibung === 'Hochzeit');
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
