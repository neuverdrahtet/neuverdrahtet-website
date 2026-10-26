// Echter Regressionstest gegen den tatsächlichen Code (verwaltung/js/
// reisekosten.js, reiner Import, keine Kopie) für die Verpflegungspauschalen-
// Berechnung nach §9 Abs. 4a EStG (Service-/Techniker-/Personalverwaltung
// Phase 9). Reine Simulation/Orientierungshilfe - siehe Kopfkommentar der
// geprüften Datei.
//
// Ausführen: node verwaltung/tests/reisekosten.test.mjs
import { findeGueltigenSatz, berechneVerpflegungspauschale, berechneKilometergeld } from '../js/reisekosten.js';

let bestanden = 0, fehlgeschlagen = 0;
function pruefe(name, fn) {
  try { fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

const SAETZE_2020 = [{ id: 's-2020', gueltigAb: '2020-01-01', gueltigBis: '', verpflegungGanztag: 28, verpflegungAnUndAbreise: 14, kilometerpauschale: 0.30 }];

// =============================================================================
// findeGueltigenSatz
// =============================================================================

pruefe('S1: findet den gültigen Satz für ein Datum innerhalb eines offenen Zeitraums (kein gueltigBis)', () => {
  const s = findeGueltigenSatz(SAETZE_2020, '2026-03-15');
  assert(s && s.id === 's-2020');
});

pruefe('S2: ein Datum VOR gueltigAb findet keinen Satz', () => {
  assert(findeGueltigenSatz(SAETZE_2020, '2019-12-31') === null);
});

pruefe('S3: bei zwei Sätzen (alter mit gueltigBis, neuer offen) wird der jeweils passende gefunden', () => {
  const saetze = [
    { id: 'alt', gueltigAb: '2015-01-01', gueltigBis: '2019-12-31', verpflegungGanztag: 24, verpflegungAnUndAbreise: 12, kilometerpauschale: 0.30 },
    ...SAETZE_2020,
  ];
  assert(findeGueltigenSatz(saetze, '2018-06-01').id === 'alt');
  assert(findeGueltigenSatz(saetze, '2020-01-01').id === 's-2020');
  assert(findeGueltigenSatz(saetze, '2019-12-31').id === 'alt');
});

// =============================================================================
// berechneVerpflegungspauschale - eintägige Reisen
// =============================================================================

pruefe('E1: eintägige Reise mit GENAU 8 Stunden Abwesenheit hat KEINEN Anspruch (Gesetz verlangt "mehr als 8 Stunden")', () => {
  const r = berechneVerpflegungspauschale('2026-03-10T08:00', '2026-03-10T16:00', SAETZE_2020);
  assert(r.gesamtBetrag === 0, `erwartet 0, war ${r.gesamtBetrag}`);
  assert(r.tage[0].typ === 'eintaegig_bis_8h');
});

pruefe('E2: eintägige Reise mit 8 Stunden und 1 Minute hat Anspruch auf den An-/Abreise-Satz (14 EUR)', () => {
  const r = berechneVerpflegungspauschale('2026-03-10T08:00', '2026-03-10T16:01', SAETZE_2020);
  assert(r.gesamtBetrag === 14, `erwartet 14, war ${r.gesamtBetrag}`);
});

pruefe('E3: eintägige Reise mit deutlich mehr als 8 Stunden (aber unter 24) bleibt bei 14 EUR, NICHT 28', () => {
  const r = berechneVerpflegungspauschale('2026-03-10T06:00', '2026-03-10T22:00', SAETZE_2020);
  assert(r.gesamtBetrag === 14, 'eine eintägige Reise bekommt nie den vollen Tagessatz, egal wie lang sie dauert');
});

// =============================================================================
// berechneVerpflegungspauschale - mehrtägige Reisen
// =============================================================================

pruefe('M1: zweitägige Reise = An- und Abreisetag, je 14 EUR, macht 28 EUR gesamt (NICHT als "ein voller Tag" gerechnet)', () => {
  const r = berechneVerpflegungspauschale('2026-03-10T14:00', '2026-03-11T10:00', SAETZE_2020);
  assert(r.tage.length === 2);
  assert(r.tage[0].typ === 'an_abreisetag' && r.tage[0].betrag === 14);
  assert(r.tage[1].typ === 'an_abreisetag' && r.tage[1].betrag === 14);
  assert(r.gesamtBetrag === 28);
});

pruefe('M2: dreitägige Reise = An-/Abreisetag (14+14) + EIN voller Tag dazwischen (28) = 56 EUR gesamt', () => {
  const r = berechneVerpflegungspauschale('2026-03-10T08:00', '2026-03-12T18:00', SAETZE_2020);
  assert(r.tage.length === 3);
  assert(r.tage[0].betrag === 14 && r.tage[0].typ === 'an_abreisetag');
  assert(r.tage[1].betrag === 28 && r.tage[1].typ === 'voller_tag', 'der mittlere Tag ist per Definition ein voller Abwesenheitstag, unabhängig von der Uhrzeit');
  assert(r.tage[2].betrag === 14 && r.tage[2].typ === 'an_abreisetag');
  assert(r.gesamtBetrag === 56);
});

pruefe('M3: der An-/Abreisetag zählt IMMER 14 EUR, auch wenn die tatsächliche Abwesenheit an diesem Tag nur 1 Stunde beträgt', () => {
  // Abreise um 23:00 (nur 1 Std. an diesem Kalendertag) - das Gesetz pauschaliert trotzdem auf 14 EUR.
  const r = berechneVerpflegungspauschale('2026-03-10T23:00', '2026-03-11T02:00', SAETZE_2020);
  assert(r.gesamtBetrag === 28, 'beide Tage sind An-/Abreisetage (2 Kalendertage), je 14 EUR');
});

pruefe('M4: eine Reise, die einen Satzwechsel mitten in der Reise überschneidet, verwendet für jeden Tag den jeweils gültigen Satz', () => {
  const saetze = [
    { id: 'alt', gueltigAb: '2015-01-01', gueltigBis: '2026-03-11', verpflegungGanztag: 24, verpflegungAnUndAbreise: 12, kilometerpauschale: 0.30 },
    { id: 'neu', gueltigAb: '2026-03-12', gueltigBis: '', verpflegungGanztag: 30, verpflegungAnUndAbreise: 15, kilometerpauschale: 0.32 },
  ];
  const r = berechneVerpflegungspauschale('2026-03-11T08:00', '2026-03-13T18:00', saetze);
  assert(r.tage[0].betrag === 12, 'Anreisetag 11.3. fällt noch unter den alten Satz');
  assert(r.tage[1].betrag === 30, 'voller Tag 12.3. fällt bereits unter den neuen Satz (voller Tagessatz)');
  assert(r.tage[2].betrag === 15, 'Abreisetag 13.3. fällt unter den neuen Satz (An-/Abreise-Satz)');
});

pruefe('M5: fehlt für einen Tag ein gültiger Satz, wird dieser Tag mit 0 EUR geführt UND explizit als fehlend gemeldet (nie stillschweigend geschätzt)', () => {
  const r = berechneVerpflegungspauschale('2018-01-10T08:00', '2018-01-10T20:00', SAETZE_2020);
  assert(r.gesamtBetrag === 0);
  assert(r.fehlendeSaetze.includes('2018-01-10'), 'ein fehlender Satz darf nie zu einer erfundenen Annahme führen, sondern muss gemeldet werden');
});

pruefe('M6: ohne von/bis wird nichts berechnet (keine stille Annahme)', () => {
  const r = berechneVerpflegungspauschale('', '', SAETZE_2020);
  assert(r.gesamtBetrag === 0 && r.tage.length === 0);
});

// =============================================================================
// berechneKilometergeld
// =============================================================================

pruefe('K1: Kilometergeld ist Kilometer × Satz zum Reisebeginn', () => {
  assert(berechneKilometergeld(100, '2026-03-10T08:00', SAETZE_2020) === 30);
});

pruefe('K2: ohne Kilometerangabe oder ohne Reisebeginn ist das Kilometergeld 0', () => {
  assert(berechneKilometergeld(0, '2026-03-10T08:00', SAETZE_2020) === 0);
  assert(berechneKilometergeld(100, '', SAETZE_2020) === 0);
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
