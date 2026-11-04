// Reine Logik-Tests für verwaltung/js/positionsGrouping.js - insbesondere
// abschnittsZwischensummenEinfuegen() (Zwischensummen je Abschnitt bei
// voller Einzelpositionen-Liste, auf Wunsch von Danny ergänzt: "mit
// Abschnitten arbeiten" in Angeboten UND Rechnungen). Deckt NICHT die
// eigentliche PDF-/HTML-Darstellung ab (docpdf.js/pdf.js) - das sind reine
// String-Formatierungen der hier getesteten Datenstruktur.
//
// Ausführen: node verwaltung/tests/positionsGrouping.test.mjs
import { gruppierePositionenNachAbschnitt, hatAbschnitte, abschnittsZwischensummenEinfuegen } from '../js/positionsGrouping.js';

let bestanden = 0, fehlgeschlagen = 0;
function pruefe(name, fn) {
  try { fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

pruefe('P1: ohne jede Überschrift werden keine Zwischensummen eingefügt (z.B. normale Rechnung)', () => {
  const positionen = [
    { bezeichnung: 'Material', menge: 2, einzelpreis: 10 },
    { bezeichnung: 'Arbeitszeit', menge: 1, einzelpreis: 50 },
  ];
  const ergebnis = abschnittsZwischensummenEinfuegen(positionen);
  assert(ergebnis.length === 2, `erwartet 2 Zeilen (unverändert), erhalten ${ergebnis.length}`);
  assert(!ergebnis.some((p) => p.typ === 'zwischensumme'));
});

pruefe('P2: Positionen vor der ersten Überschrift bekommen keine Zwischensumme', () => {
  const positionen = [
    { bezeichnung: 'test', menge: 1, einzelpreis: 21 },
    { typ: 'ueberschrift', bezeichnung: 'Neuer Abschnitt' },
    { bezeichnung: 'Pos im Abschnitt', menge: 1, einzelpreis: 0 },
  ];
  const ergebnis = abschnittsZwischensummenEinfuegen(positionen);
  // erwartet: [test, ueberschrift, position, zwischensumme] - also 4 Zeilen
  assert(ergebnis.length === 4, `erwartet 4 Zeilen, erhalten ${ergebnis.length}`);
  assert(ergebnis[0].bezeichnung === 'test' && ergebnis[0].typ === undefined);
  assert(ergebnis[1].typ === 'ueberschrift');
  assert(ergebnis[2].bezeichnung === 'Pos im Abschnitt');
  assert(ergebnis[3].typ === 'zwischensumme', `letzte Zeile sollte die Zwischensumme sein, war ${JSON.stringify(ergebnis[3])}`);
  assert(ergebnis[3].abschnittNr === 1, `erste echte Überschrift sollte Abschnittsnummer 1 bekommen, war ${ergebnis[3].abschnittNr}`);
});

pruefe('P3: Zwischensumme berechnet korrekt menge*einzelpreis je Abschnitt', () => {
  const positionen = [
    { typ: 'ueberschrift', bezeichnung: 'A' },
    { bezeichnung: 'x', menge: 2, einzelpreis: 10 },
    { bezeichnung: 'y', menge: 3, einzelpreis: 5 },
  ];
  const ergebnis = abschnittsZwischensummenEinfuegen(positionen);
  const zw = ergebnis.find((p) => p.typ === 'zwischensumme');
  assert(zw.summe === 35, `erwartet 2*10+3*5=35, war ${zw.summe}`);
});

pruefe('P4: mehrere Abschnitte bekommen jeweils eigene, fortlaufende Zwischensummen (2. Abschnitt = "2.")', () => {
  const positionen = [
    { typ: 'ueberschrift', bezeichnung: 'Erster Abschnitt' },
    { bezeichnung: 'a', menge: 1, einzelpreis: 100 },
    { typ: 'ueberschrift', bezeichnung: 'Zweiter Abschnitt' },
    { bezeichnung: 'b', menge: 1, einzelpreis: 50 },
  ];
  const ergebnis = abschnittsZwischensummenEinfuegen(positionen);
  const zwischensummen = ergebnis.filter((p) => p.typ === 'zwischensumme');
  assert(zwischensummen.length === 2, `erwartet 2 Zwischensummen, erhalten ${zwischensummen.length}`);
  assert(zwischensummen[0].abschnittNr === 1 && zwischensummen[0].summe === 100);
  assert(zwischensummen[1].abschnittNr === 2 && zwischensummen[1].summe === 50);
  // Reihenfolge: die erste Zwischensumme muss VOR der zweiten Überschrift stehen.
  const idxZw1 = ergebnis.indexOf(zwischensummen[0]);
  const idxUeb2 = ergebnis.findIndex((p) => p.typ === 'ueberschrift' && p.bezeichnung === 'Zweiter Abschnitt');
  assert(idxZw1 < idxUeb2, 'erste Zwischensumme muss vor der zweiten Überschrift eingefügt werden');
});

pruefe('P5: eine leere Überschrift ohne nachfolgende Positionen bekommt keine Zwischensumme', () => {
  const positionen = [
    { typ: 'ueberschrift', bezeichnung: 'Leerer Abschnitt' },
    { typ: 'ueberschrift', bezeichnung: 'Nächster Abschnitt' },
    { bezeichnung: 'x', menge: 1, einzelpreis: 10 },
  ];
  const ergebnis = abschnittsZwischensummenEinfuegen(positionen);
  const zwischensummen = ergebnis.filter((p) => p.typ === 'zwischensumme');
  assert(zwischensummen.length === 1, `erwartet nur 1 Zwischensumme (für den gefüllten Abschnitt), erhalten ${zwischensummen.length}`);
  assert(zwischensummen[0].abschnittNr === 2, 'Zwischensumme muss dem zweiten (gefüllten) Abschnitt zugeordnet sein');
});

pruefe('P6: bestehende Gruppierungsfunktionen (Abschnittssummen/Kurzfassung) bleiben unverändert funktionsfähig', () => {
  const positionen = [
    { bezeichnung: 'vor Abschnitt', menge: 1, einzelpreis: 5 },
    { typ: 'ueberschrift', bezeichnung: 'Titel' },
    { bezeichnung: 'in Abschnitt', menge: 2, einzelpreis: 3 },
  ];
  const gruppen = gruppierePositionenNachAbschnitt(positionen);
  assert(gruppen.length === 2);
  assert(hatAbschnitte(gruppen) === true);
  assert(gruppen[1].summe === 6);
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
