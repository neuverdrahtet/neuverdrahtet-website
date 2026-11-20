// Reine Logik-Tests für findeAusgabeFuerMahnung() aus
// verwaltung/js/mahnungAbgleich.js (20.11.2026, "empfangene Mahnungen einer
// bestehenden Ausgabe/Lieferantenrechnung zuordnen").
//
// Ausführen: node verwaltung/tests/mahnung-abgleich.test.mjs
import { findeAusgabeFuerMahnung, findeLieferantFuerHaendler, findeAusgabeFuerLieferschein, normLieferant } from '../js/mahnungAbgleich.js';

let bestanden = 0, fehlgeschlagen = 0;
function pruefe(name, fn) {
  try { fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

pruefe('N1: normLieferant ignoriert Rechtsform-Zusätze und Groß-/Kleinschreibung', () => {
  assert(normLieferant('Hornbach Baumarkt GmbH') === normLieferant('hornbach baumarkt'), 'GmbH-Zusatz sollte ignoriert werden');
  assert(normLieferant('Sonepar Deutschland GmbH & Co. KG') !== '', 'darf nicht leer werden');
});

pruefe('M1: eindeutiger Lieferant ohne Nummer/Betrag wird zugeordnet', () => {
  const ausgaben = [{ id: 'a1', lieferant: 'Sonepar GmbH', betragBrutto: 150 }];
  const treffer = findeAusgabeFuerMahnung({ haendler: 'Sonepar' }, ausgaben);
  assert(treffer?.id === 'a1', 'erwartet Treffer a1');
});

pruefe('M2: kein Treffer, wenn kein Lieferant übereinstimmt', () => {
  const ausgaben = [{ id: 'a1', lieferant: 'Sonepar GmbH', betragBrutto: 150 }];
  const treffer = findeAusgabeFuerMahnung({ haendler: 'Hornbach' }, ausgaben);
  assert(treffer === null, 'erwartet keinen Treffer');
});

pruefe('M3: mehrere Rechnungen desselben Lieferanten werden per Rechnungsnummer unterschieden', () => {
  const ausgaben = [
    { id: 'a1', lieferant: 'Sonepar GmbH', rechnungsnummer: 'RE-100', betragBrutto: 150 },
    { id: 'a2', lieferant: 'Sonepar GmbH', rechnungsnummer: 'RE-200', betragBrutto: 300 },
  ];
  const treffer = findeAusgabeFuerMahnung({ haendler: 'Sonepar', rechnungsnummer: 'RE-200' }, ausgaben);
  assert(treffer?.id === 'a2', `erwartet a2, erhalten ${treffer?.id}`);
});

pruefe('M4: ohne Rechnungsnummer, aber mit passendem (leicht höherem) Mahnbetrag wird die näheste Rechnung gewählt', () => {
  const ausgaben = [
    { id: 'a1', lieferant: 'Sonepar GmbH', betragBrutto: 150 },
    { id: 'a2', lieferant: 'Sonepar GmbH', betragBrutto: 300 },
  ];
  // Mahnbetrag inkl. Mahngebühr etwas höher als die Original-Rechnung (a2 + 5€ Gebühr)
  const treffer = findeAusgabeFuerMahnung({ haendler: 'Sonepar', betragBrutto: 305 }, ausgaben);
  assert(treffer?.id === 'a2', `erwartet a2, erhalten ${treffer?.id}`);
});

pruefe('M5: bleibt die Zuordnung mehrdeutig (keine Nummer, kein passender Betrag), wird nichts automatisch zugeordnet', () => {
  const ausgaben = [
    { id: 'a1', lieferant: 'Sonepar GmbH', betragBrutto: 150 },
    { id: 'a2', lieferant: 'Sonepar GmbH', betragBrutto: 150 },
  ];
  const treffer = findeAusgabeFuerMahnung({ haendler: 'Sonepar' }, ausgaben);
  assert(treffer === null, 'erwartet keine automatische Zuordnung bei Mehrdeutigkeit');
});

pruefe('M6: ein Mahnbetrag, der NIEDRIGER als die Rechnung ist, zählt nicht als Treffer (Mahnung ist nie günstiger)', () => {
  const ausgaben = [
    { id: 'a1', lieferant: 'Sonepar GmbH', betragBrutto: 150 },
    { id: 'a2', lieferant: 'Sonepar GmbH', betragBrutto: 300 },
  ];
  const treffer = findeAusgabeFuerMahnung({ haendler: 'Sonepar', betragBrutto: 140 }, ausgaben);
  assert(treffer === null, 'erwartet keinen Treffer, da kein Betrag <= 140 passt');
});

pruefe('M7: leerer/fehlender Händlername liefert nie einen Treffer', () => {
  const ausgaben = [{ id: 'a1', lieferant: 'Sonepar GmbH', betragBrutto: 150 }];
  assert(findeAusgabeFuerMahnung({ haendler: '' }, ausgaben) === null, 'erwartet null bei leerem Händler');
  assert(findeAusgabeFuerMahnung({}, ausgaben) === null, 'erwartet null ohne haendler-Feld');
});

pruefe('L1: findeLieferantFuerHaendler findet einen bestehenden Lieferanten über Rechtsform-/Schreibweise hinweg', () => {
  const lieferanten = [{ id: 'l1', firma: 'Sonepar Deutschland GmbH' }];
  const treffer = findeLieferantFuerHaendler('sonepar deutschland', lieferanten);
  assert(treffer?.id === 'l1', 'erwartet Treffer l1');
});

pruefe('L2: findeLieferantFuerHaendler liefert null, wenn kein Lieferant passt (Aufrufer legt dann neu an)', () => {
  const lieferanten = [{ id: 'l1', firma: 'Sonepar Deutschland GmbH' }];
  assert(findeLieferantFuerHaendler('Hornbach', lieferanten) === null, 'erwartet keinen Treffer');
  assert(findeLieferantFuerHaendler('', lieferanten) === null, 'erwartet null bei leerem Namen');
});

pruefe('S1: findeAusgabeFuerLieferschein ordnet bei eindeutigem Lieferanten ohne Rechnungsnummer zu', () => {
  const ausgaben = [{ id: 'a1', lieferant: 'Sonepar GmbH', betragBrutto: 150 }];
  const treffer = findeAusgabeFuerLieferschein({ haendler: 'Sonepar' }, ausgaben);
  assert(treffer?.id === 'a1', 'erwartet Treffer a1');
});

pruefe('S2: findeAusgabeFuerLieferschein unterscheidet mehrere Rechnungen desselben Lieferanten per Rechnungsnummer', () => {
  const ausgaben = [
    { id: 'a1', lieferant: 'Sonepar GmbH', rechnungsnummer: 'RE-100', betragBrutto: 150 },
    { id: 'a2', lieferant: 'Sonepar GmbH', rechnungsnummer: 'RE-200', betragBrutto: 300 },
  ];
  const treffer = findeAusgabeFuerLieferschein({ haendler: 'Sonepar', rechnungsnummer: 'RE-200' }, ausgaben);
  assert(treffer?.id === 'a2', `erwartet a2, erhalten ${treffer?.id}`);
});

pruefe('S3: findeAusgabeFuerLieferschein ordnet bei Mehrdeutigkeit ohne Rechnungsnummer (anders als bei Mahnungen: kein Betrag-Fallback) nichts zu', () => {
  const ausgaben = [
    { id: 'a1', lieferant: 'Sonepar GmbH', betragBrutto: 150 },
    { id: 'a2', lieferant: 'Sonepar GmbH', betragBrutto: 300 },
  ];
  const treffer = findeAusgabeFuerLieferschein({ haendler: 'Sonepar' }, ausgaben);
  assert(treffer === null, 'erwartet keine automatische Zuordnung ohne Rechnungsnummer bei mehreren Kandidaten');
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
