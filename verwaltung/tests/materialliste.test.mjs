// Reine Logik-Tests für verwaltung/js/materialliste.js (keine Firebase/
// Netzwerkabhängigkeit) - deckt die Ableitung der Materialliste aus
// Angebotspositionen (Projekte) und die freie Texteingabe->Checkliste
// (Serviceaufträge) ab.
//
// Ausführen: node verwaltung/tests/materialliste.test.mjs
import {
  sammleMaterialAusAngeboten, aktualisiereMaterialliste, baueFreieMaterialliste, materiallisteAlsText,
} from '../js/materialliste.js';

let bestanden = 0, fehlgeschlagen = 0;
function pruefe(name, fn) {
  try { fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

const katalogById = {
  k1: { id: 'k1', typ: 'artikel', bezeichnung: 'Kabelrohr 16mm', einheit: 'm' },
  k2: { id: 'k2', typ: 'artikel', bezeichnung: 'Steckdose', einheit: 'Stk.' },
  k3: { id: 'k3', typ: 'leistung', bezeichnung: 'Montage', einheit: 'Std.' },
  k4: { id: 'k4', typ: 'geraet', bezeichnung: 'Wärmepumpe XY', einheit: 'Stk.' },
};

pruefe('M1: nur Artikel (typ=artikel) werden übernommen, Leistungen/Geräte nicht', () => {
  const angebote = [{
    status: 'angenommen',
    positionen: [
      { katalogId: 'k1', bezeichnung: 'Kabelrohr 16mm', menge: 10, einheit: 'm' },
      { katalogId: 'k2', bezeichnung: 'Steckdose', menge: 3, einheit: 'Stk.' },
      { katalogId: 'k3', bezeichnung: 'Montage', menge: 4, einheit: 'Std.' },
      { katalogId: 'k4', bezeichnung: 'Wärmepumpe XY', menge: 1, einheit: 'Stk.' },
    ],
  }];
  const liste = sammleMaterialAusAngeboten(angebote, katalogById);
  assert(liste.length === 2, `erwartet 2 Material-Positionen, erhalten ${liste.length}`);
  assert(liste.some((p) => p.katalogId === 'k1' && p.menge === 10));
  assert(liste.some((p) => p.katalogId === 'k2' && p.menge === 3));
});

pruefe('M2: nicht angenommene Angebote (Entwurf/abgelehnt) werden ignoriert', () => {
  const angebote = [
    { status: 'entwurf', positionen: [{ katalogId: 'k1', bezeichnung: 'Kabelrohr', menge: 5 }] },
    { status: 'abgelehnt', positionen: [{ katalogId: 'k2', bezeichnung: 'Steckdose', menge: 5 }] },
  ];
  const liste = sammleMaterialAusAngeboten(angebote, katalogById);
  assert(liste.length === 0, `erwartet 0 Positionen aus nicht angenommenen Angeboten, erhalten ${liste.length}`);
});

pruefe('M3: mehrere angenommene Angebote (Haupt- + Nachtragsangebot) werden mengenmäßig zusammengefasst', () => {
  const angebote = [
    { status: 'angenommen', positionen: [{ katalogId: 'k1', bezeichnung: 'Kabelrohr 16mm', menge: 10, einheit: 'm' }] },
    { status: 'angenommen', positionen: [{ katalogId: 'k1', bezeichnung: 'Kabelrohr 16mm', menge: 4, einheit: 'm' }] },
  ];
  const liste = sammleMaterialAusAngeboten(angebote, katalogById);
  assert(liste.length === 1, `erwartet 1 zusammengefasste Position, erhalten ${liste.length}`);
  assert(liste[0].menge === 14, `erwartet Menge 14, erhalten ${liste[0].menge}`);
});

pruefe('M4: Positionen ohne katalogId oder mit unbekanntem/gelöschtem Artikel werden übersprungen', () => {
  const angebote = [{
    status: 'angenommen',
    positionen: [
      { bezeichnung: 'Freitext-Position ohne Katalog', menge: 1 },
      { katalogId: 'nicht-vorhanden', bezeichnung: 'Gelöschter Artikel', menge: 1 },
    ],
  }];
  const liste = sammleMaterialAusAngeboten(angebote, katalogById);
  assert(liste.length === 0, `erwartet 0 Positionen, erhalten ${liste.length}`);
});

pruefe('M5: aktualisiereMaterialliste behält den erledigt-Status für weiterhin vorhandene Positionen', () => {
  const bisherige = [{ katalogId: 'k1', titel: 'Kabelrohr', menge: 10, einheit: 'm', erledigt: true }];
  const neueRohliste = [{ katalogId: 'k1', titel: 'Kabelrohr', menge: 14, einheit: 'm' }];
  const ergebnis = aktualisiereMaterialliste(bisherige, neueRohliste);
  assert(ergebnis.length === 1);
  assert(ergebnis[0].erledigt === true, 'erledigt-Status muss erhalten bleiben');
  assert(ergebnis[0].menge === 14, 'Menge muss auf den aktuellen Kalkulationsstand aktualisiert werden');
});

pruefe('M6: aktualisiereMaterialliste entfernt Positionen, die in der Kalkulation nicht mehr vorkommen', () => {
  const bisherige = [
    { katalogId: 'k1', titel: 'Kabelrohr', erledigt: true },
    { katalogId: 'k2', titel: 'Steckdose', erledigt: false },
  ];
  const neueRohliste = [{ katalogId: 'k1', titel: 'Kabelrohr', menge: 5 }];
  const ergebnis = aktualisiereMaterialliste(bisherige, neueRohliste);
  assert(ergebnis.length === 1, `erwartet 1 verbleibende Position, erhalten ${ergebnis.length}`);
  assert(ergebnis[0].katalogId === 'k1');
});

pruefe('M7: aktualisiereMaterialliste ohne vorherige Liste (erste Erzeugung) markiert alles als nicht erledigt', () => {
  const ergebnis = aktualisiereMaterialliste(undefined, [{ katalogId: 'k1', titel: 'Kabelrohr', menge: 5 }]);
  assert(ergebnis.length === 1 && ergebnis[0].erledigt === false);
});

pruefe('M8: baueFreieMaterialliste wandelt Textzeilen in Positionen um und ignoriert leere Zeilen', () => {
  const ergebnis = baueFreieMaterialliste('Kältemittel R32\n\nErsatzfilter\n   \nDichtungsset', []);
  assert(ergebnis.length === 3, `erwartet 3 Positionen, erhalten ${ergebnis.length}`);
  assert(ergebnis.every((p) => p.erledigt === false));
  assert(ergebnis[0].titel === 'Kältemittel R32');
});

pruefe('M9: baueFreieMaterialliste behält erledigt-Status für unveränderte Titel (Abgleich über Titeltext)', () => {
  const vorherige = [{ titel: 'Ersatzfilter', erledigt: true }];
  const ergebnis = baueFreieMaterialliste('Kältemittel R32\nErsatzfilter', vorherige);
  const ersatzfilter = ergebnis.find((p) => p.titel === 'Ersatzfilter');
  assert(ersatzfilter.erledigt === true, 'bereits abgehakte Position darf beim Bearbeiten nicht zurückgesetzt werden');
  const kaeltemittel = ergebnis.find((p) => p.titel === 'Kältemittel R32');
  assert(kaeltemittel.erledigt === false, 'neue Position muss unerledigt starten');
});

pruefe('M10: baueFreieMaterialliste akzeptiert Zeilen mit vorangestelltem [x]/[ ] (Rückkopieren aus materiallisteAlsText)', () => {
  const ergebnis = baueFreieMaterialliste('[x] Kältemittel R32\n[ ] Ersatzfilter', []);
  assert(ergebnis.length === 2);
  assert(ergebnis[0].titel === 'Kältemittel R32', `Präfix "[x] " muss entfernt werden, war: "${ergebnis[0].titel}"`);
});

pruefe('M11: materiallisteAlsText ist die Kehrfunktion zu baueFreieMaterialliste (Rundtrip)', () => {
  const positionen = [{ titel: 'Kältemittel R32', erledigt: true }, { titel: 'Ersatzfilter', erledigt: false }];
  const text = materiallisteAlsText(positionen);
  assert(text === '[x] Kältemittel R32\n[ ] Ersatzfilter', `unerwarteter Text: "${text}"`);
  const zurueck = baueFreieMaterialliste(text, []);
  assert(zurueck.length === 2 && zurueck[0].titel === 'Kältemittel R32');
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
