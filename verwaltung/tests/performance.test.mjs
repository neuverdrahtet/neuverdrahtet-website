// Echter Regressionstest gegen den tatsächlichen Code (verwaltung/js/
// performance.js, reiner Import, keine Kopie) für die Performance-/
// Bonus-Simulation (Service-/Techniker-/Personalverwaltung Phase 8). Reine
// Simulation - siehe Kopfkommentar der geprüften Datei. Insbesondere wird
// geprüft, dass OHNE hinterlegten Referenzwert NIE ein Bonus erfunden wird.
//
// Ausführen: node verwaltung/tests/performance.test.mjs
import { berechneKennzahlen, findeGueltigeReferenzwerte, berechneBonusSimulation } from '../js/performance.js';

let bestanden = 0, fehlgeschlagen = 0;
function pruefe(name, fn) {
  try { fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

// =============================================================================
// berechneKennzahlen
// =============================================================================

pruefe('K1: zählt nur abgeschlossene Aufträge des EIGENEN Technikers im Zeitraum', () => {
  const auftraege = [
    { id: 'a1', technikerIds: ['t1'], status: 'abgeschlossen', aktualisiertAm: '2026-03-15T10:00:00Z' },
    { id: 'a2', technikerIds: ['t2'], status: 'abgeschlossen', aktualisiertAm: '2026-03-16T10:00:00Z' },
    { id: 'a3', technikerIds: ['t1'], status: 'abgeschlossen', aktualisiertAm: '2026-04-01T10:00:00Z' },
  ];
  const k = berechneKennzahlen('t1', '2026-03-01', '2026-03-31', auftraege, []);
  assert(k.abgeschlosseneAuftraege === 1, `erwartet 1, war ${k.abgeschlosseneAuftraege}`);
});

pruefe('K2: Pünktlichkeitsquote zählt einen Auftrag ohne Frist immer als pünktlich', () => {
  const auftraege = [{ id: 'a1', technikerIds: ['t1'], status: 'abgeschlossen', aktualisiertAm: '2026-03-15T10:00:00Z' }];
  const k = berechneKennzahlen('t1', '2026-03-01', '2026-03-31', auftraege, []);
  assert(k.puenktlichkeitQuote === 100);
});

pruefe('K3: ein nach Fristablauf abgeschlossener Auftrag zählt NICHT als pünktlich', () => {
  const auftraege = [{ id: 'a1', technikerIds: ['t1'], status: 'abgeschlossen', auftragsfrist: '2026-03-10', aktualisiertAm: '2026-03-15T10:00:00Z' }];
  const k = berechneKennzahlen('t1', '2026-03-01', '2026-03-31', auftraege, []);
  assert(k.puenktlichAbgeschlossen === 0 && k.puenktlichkeitQuote === 0);
});

pruefe('K4: ohne im Zeitraum abgeschlossene Aufträge ist die Quote null (keine erfundene 0%/100%-Aussage)', () => {
  const k = berechneKennzahlen('t1', '2026-03-01', '2026-03-31', [], []);
  assert(k.abgeschlosseneAuftraege === 0 && k.puenktlichkeitQuote === null, 'null statt 0 - sonst sähe "keine Daten" wie "schlechte Quote" aus');
});

pruefe('K5: offenUeberfaellig zählt aktuell offene Aufträge mit überschrittener Frist, unabhängig vom Auswertungszeitraum', () => {
  const auftraege = [
    { id: 'a1', technikerIds: ['t1'], status: 'in_bearbeitung', auftragsfrist: '2026-01-01' },
    { id: 'a2', technikerIds: ['t1'], status: 'in_bearbeitung', auftragsfrist: '2099-01-01' },
    { id: 'a3', technikerIds: ['t1'], status: 'abgebrochen', auftragsfrist: '2026-01-01' },
  ];
  const k = berechneKennzahlen('t1', '2026-03-01', '2026-03-31', auftraege, [], '2026-03-20');
  assert(k.offenUeberfaellig === 1, `erwartet 1 (a2 nicht überfällig, a3 abgebrochen zählt nie), war ${k.offenUeberfaellig}`);
});

pruefe('K6: Ist-Stunden summieren Zeiterfassungseinträge des Mitarbeiters im Zeitraum (Minuten -> Stunden)', () => {
  const zeiterfassung = [
    { mitarbeiterId: 't1', datum: '2026-03-10', dauerMinuten: 480 },
    { mitarbeiterId: 't1', datum: '2026-03-11', dauerMinuten: 120 },
    { mitarbeiterId: 't2', datum: '2026-03-10', dauerMinuten: 480 },
    { mitarbeiterId: 't1', datum: '2026-04-01', dauerMinuten: 480 },
  ];
  const k = berechneKennzahlen('t1', '2026-03-01', '2026-03-31', [], zeiterfassung);
  assert(k.istStunden === 10, `erwartet 10, war ${k.istStunden}`);
});

// =============================================================================
// findeGueltigeReferenzwerte
// =============================================================================

pruefe('R1: findet einen Referenzwert mit offenem gueltigBis', () => {
  const r = findeGueltigeReferenzwerte([{ id: 'r1', gueltigAb: '2026-01-01', gueltigBis: '' }], '2026-03-15');
  assert(r.length === 1 && r[0].id === 'r1');
});

pruefe('R2: ein Datum vor gueltigAb findet keinen Referenzwert', () => {
  assert(findeGueltigeReferenzwerte([{ id: 'r1', gueltigAb: '2026-06-01', gueltigBis: '' }], '2026-03-15').length === 0);
});

pruefe('R3: ohne jede Konfiguration (leere/undefinierte Liste) wird nichts gefunden', () => {
  assert(findeGueltigeReferenzwerte([], '2026-03-15').length === 0);
  assert(findeGueltigeReferenzwerte(undefined, '2026-03-15').length === 0);
});

// =============================================================================
// berechneBonusSimulation - KERNPUNKT: nie ein erfundener Schwellenwert
// =============================================================================

pruefe('B1: OHNE hinterlegten Referenzwert ist der simulierte Bonus 0 mit explizitem Hinweis (kein erfundener Schwellenwert)', () => {
  const sim = berechneBonusSimulation({ abgeschlosseneAuftraege: 20, puenktlichkeitQuote: 100 }, [], '2026-03-15');
  assert(sim.bonusBetrag === 0);
  assert(sim.hinweis.includes('Kein Referenzwert'));
});

pruefe('B2: ein erreichter Referenzwert liefert den konfigurierten Bonusbetrag', () => {
  const referenzwerte = [{ id: 'r1', kennzahl: 'abgeschlosseneAuftraege', schwellenwert: 10, bonusBetrag: 100, gueltigAb: '2026-01-01', gueltigBis: '' }];
  const sim = berechneBonusSimulation({ abgeschlosseneAuftraege: 12 }, referenzwerte, '2026-03-15');
  assert(sim.bonusBetrag === 100 && sim.erreichteReferenzwerte.length === 1);
});

pruefe('B3: ein NICHT erreichter Referenzwert liefert 0 EUR mit Hinweis, kein stiller Teilbonus', () => {
  const referenzwerte = [{ id: 'r1', kennzahl: 'abgeschlosseneAuftraege', schwellenwert: 10, bonusBetrag: 100, gueltigAb: '2026-01-01', gueltigBis: '' }];
  const sim = berechneBonusSimulation({ abgeschlosseneAuftraege: 5 }, referenzwerte, '2026-03-15');
  assert(sim.bonusBetrag === 0 && sim.erreichteReferenzwerte.length === 0);
  assert(sim.hinweis.includes('nicht erreicht'));
});

pruefe('B4: mehrere gleichzeitig gültige Referenzwerte für unterschiedliche Kennzahlen summieren sich', () => {
  const referenzwerte = [
    { id: 'r1', kennzahl: 'abgeschlosseneAuftraege', schwellenwert: 10, bonusBetrag: 100, gueltigAb: '2026-01-01', gueltigBis: '' },
    { id: 'r2', kennzahl: 'puenktlichkeitQuote', schwellenwert: 90, bonusBetrag: 50, gueltigAb: '2026-01-01', gueltigBis: '' },
  ];
  const sim = berechneBonusSimulation({ abgeschlosseneAuftraege: 12, puenktlichkeitQuote: 95 }, referenzwerte, '2026-03-15');
  assert(sim.bonusBetrag === 150, `erwartet 150, war ${sim.bonusBetrag}`);
});

pruefe('B5: eine Kennzahl mit Wert null (keine Datenbasis) erreicht NIE einen Referenzwert', () => {
  const referenzwerte = [{ id: 'r1', kennzahl: 'puenktlichkeitQuote', schwellenwert: 0, bonusBetrag: 100, gueltigAb: '2026-01-01', gueltigBis: '' }];
  const sim = berechneBonusSimulation({ puenktlichkeitQuote: null }, referenzwerte, '2026-03-15');
  assert(sim.bonusBetrag === 0, 'null darf nicht einmal eine Schwelle von 0 "erreichen" - sonst würde "keine Daten" wie ein Erfolg gezählt');
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
