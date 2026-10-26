// Echter Regressionstest gegen den tatsächlichen Code (verwaltung/js/
// mitarbeiterkosten.js, reiner Import, keine Kopie) für die Gesamtkosten-
// Berechnung pro Mitarbeiter (Service-/Techniker-/Personalverwaltung
// Phase 13). Reine Orientierungshilfe OHNE Lohnnebenkosten - siehe
// Kopfkommentar der geprüften Datei.
//
// Ausführen: node verwaltung/tests/mitarbeiterkosten.test.mjs
import {
  berechneBenefitKostenImZeitraum, berechneGrundverguetungImZeitraum,
  berechneReisekostenImZeitraum, berechneGesamtkosten,
} from '../js/mitarbeiterkosten.js';

let bestanden = 0, fehlgeschlagen = 0;
function pruefe(name, fn) {
  try { fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

// =============================================================================
// berechneBenefitKostenImZeitraum
// =============================================================================

pruefe('BK1: ein den gesamten Monat aktiver Benefit zählt mit dem vollen Monatsbetrag', () => {
  const benefits = [{ mitarbeiterId: 'm1', beginnDatum: '2026-01-01', endeDatum: '', arbeitgeberKostenMonatlich: 30 }];
  const k = berechneBenefitKostenImZeitraum(benefits, 'm1', '2026-03-01', '2026-03-31');
  assert(k === 30, `erwartet 30, war ${k}`);
});

pruefe('BK2: ein mitten im Zeitraum beginnender Benefit wird nach Tagen anteilig gerechnet', () => {
  // 2026-03 hat 31 Tage, Beginn am 16. -> 16 Tage aktiv (16. bis 31.)
  const benefits = [{ mitarbeiterId: 'm1', beginnDatum: '2026-03-16', endeDatum: '', arbeitgeberKostenMonatlich: 31 }];
  const k = berechneBenefitKostenImZeitraum(benefits, 'm1', '2026-03-01', '2026-03-31');
  assert(Math.abs(k - 16) < 0.01, `erwartet ~16, war ${k}`);
});

pruefe('BK3: ein vor dem Zeitraum beendeter Benefit zählt nicht mit', () => {
  const benefits = [{ mitarbeiterId: 'm1', beginnDatum: '2025-01-01', endeDatum: '2026-02-28', arbeitgeberKostenMonatlich: 30 }];
  const k = berechneBenefitKostenImZeitraum(benefits, 'm1', '2026-03-01', '2026-03-31');
  assert(k === 0);
});

pruefe('BK4: Benefits anderer Mitarbeiter zählen nicht mit', () => {
  const benefits = [{ mitarbeiterId: 'm2', beginnDatum: '2026-01-01', endeDatum: '', arbeitgeberKostenMonatlich: 30 }];
  assert(berechneBenefitKostenImZeitraum(benefits, 'm1', '2026-03-01', '2026-03-31') === 0);
});

pruefe('BK5: mehrere aktive Benefits summieren sich', () => {
  const benefits = [
    { mitarbeiterId: 'm1', beginnDatum: '2026-01-01', endeDatum: '', arbeitgeberKostenMonatlich: 30 },
    { mitarbeiterId: 'm1', beginnDatum: '2026-01-01', endeDatum: '', arbeitgeberKostenMonatlich: 20 },
  ];
  assert(berechneBenefitKostenImZeitraum(benefits, 'm1', '2026-03-01', '2026-03-31') === 50);
});

// Phase 16 Testaudit: BK2/BK3 deckten je nur ein offenes Ende ab (Beginn
// mitten im Zeitraum, offen; bzw. vor dem Zeitraum beendet) - hier zusätzlich
// der Fall, dass Beginn UND Ende beide MITTEN im Zeitraum liegen (Benefit
// läuft kürzer als der ausgewertete Monat).
pruefe('BK6: ein Benefit, der mitten im Zeitraum beginnt UND endet, wird nur für die tatsächlich aktiven Tage anteilig gerechnet', () => {
  // 2026-03 hat 31 Tage; aktiv vom 10. bis 15. = 6 Tage.
  const benefits = [{ mitarbeiterId: 'm1', beginnDatum: '2026-03-10', endeDatum: '2026-03-15', arbeitgeberKostenMonatlich: 31 }];
  const k = berechneBenefitKostenImZeitraum(benefits, 'm1', '2026-03-01', '2026-03-31');
  assert(Math.abs(k - 6) < 0.01, `erwartet ~6, war ${k}`);
});

// =============================================================================
// berechneGrundverguetungImZeitraum
// =============================================================================

pruefe('G1: Festgehalt wird unabhängig von der Zeitraumlänge voll angesetzt', () => {
  const g = berechneGrundverguetungImZeitraum({ id: 'm1', gehaltMonatlich: 3000 }, [], '2026-03-01', '2026-03-31');
  assert(g === 3000);
});

pruefe('G5: ohne gehaltMonatlich UND ohne stundenlohn ist die Grundvergütung 0 (keine erfundene Annahme)', () => {
  const g = berechneGrundverguetungImZeitraum({ id: 'm1' }, [{ mitarbeiterId: 'm1', datum: '2026-03-10', dauerMinuten: 480 }], '2026-03-01', '2026-03-31');
  assert(g === 0, `erwartet 0, war ${g}`);
});

pruefe('G2: Stundenlohn × tatsächlich erfasste Ist-Stunden im Zeitraum', () => {
  const zeiterfassung = [
    { mitarbeiterId: 'm1', datum: '2026-03-10', dauerMinuten: 480 },
    { mitarbeiterId: 'm1', datum: '2026-03-11', dauerMinuten: 480 },
    { mitarbeiterId: 'm2', datum: '2026-03-10', dauerMinuten: 480 },
  ];
  const g = berechneGrundverguetungImZeitraum({ id: 'm1', stundenlohn: 20 }, zeiterfassung, '2026-03-01', '2026-03-31');
  assert(g === 320, `erwartet 320 (16 Std. × 20), war ${g}`);
});

pruefe('G3: ein Austritt vor dem Zeitraum ergibt 0', () => {
  const g = berechneGrundverguetungImZeitraum({ id: 'm1', gehaltMonatlich: 3000, austrittsdatum: '2026-02-28' }, [], '2026-03-01', '2026-03-31');
  assert(g === 0);
});

pruefe('G4: ein Eintritt nach dem Zeitraum ergibt 0', () => {
  const g = berechneGrundverguetungImZeitraum({ id: 'm1', gehaltMonatlich: 3000, eintrittsdatum: '2026-04-01' }, [], '2026-03-01', '2026-03-31');
  assert(g === 0);
});

// =============================================================================
// berechneReisekostenImZeitraum
// =============================================================================

const SAETZE = [{ id: 's1', gueltigAb: '2020-01-01', gueltigBis: '', verpflegungGanztag: 28, verpflegungAnUndAbreise: 14, kilometerpauschale: 0.30 }];

pruefe('RK1: nur genehmigte Abrechnungen zählen als tatsächliche Kosten', () => {
  const abrechnungen = [
    { mitarbeiterId: 'm1', status: 'genehmigt', von: '2026-03-10T08:00', bis: '2026-03-10T17:00', kilometer: 0 },
    { mitarbeiterId: 'm1', status: 'eingereicht', von: '2026-03-15T08:00', bis: '2026-03-15T17:00', kilometer: 0 },
  ];
  const r = berechneReisekostenImZeitraum(abrechnungen, 'm1', '2026-03-01', '2026-03-31', SAETZE);
  assert(r === 14, `erwartet 14 (nur die genehmigte An-/Abreise-Pauschale), war ${r}`);
});

pruefe('RK2: Übernachtungskosten und Kilometergeld fließen zusätzlich ein', () => {
  const abrechnungen = [{ mitarbeiterId: 'm1', status: 'genehmigt', von: '2026-03-10T08:00', bis: '2026-03-10T17:00', kilometer: 100, uebernachtungskostenBrutto: 80 }];
  const r = berechneReisekostenImZeitraum(abrechnungen, 'm1', '2026-03-01', '2026-03-31', SAETZE);
  assert(r === 14 + 30 + 80, `erwartet 124, war ${r}`);
});

// =============================================================================
// berechneGesamtkosten
// =============================================================================

pruefe('GK1: Gesamtkosten summieren Grundvergütung, Benefit-Kosten und genehmigte Reisekosten', () => {
  const mitarbeiter = { id: 'm1', gehaltMonatlich: 3000 };
  const benefits = [{ mitarbeiterId: 'm1', beginnDatum: '2026-01-01', endeDatum: '', arbeitgeberKostenMonatlich: 30 }];
  const abrechnungen = [{ mitarbeiterId: 'm1', status: 'genehmigt', von: '2026-03-10T08:00', bis: '2026-03-10T17:00', kilometer: 0 }];
  const gk = berechneGesamtkosten(mitarbeiter, '2026-03-01', '2026-03-31', {
    zeiterfassung: [], benefits, reisekostenabrechnungen: abrechnungen, reisekostensaetze: SAETZE,
  });
  assert(gk.grundverguetung === 3000 && gk.benefitKosten === 30 && gk.reisekosten === 14);
  assert(gk.gesamt === 3044, `erwartet 3044, war ${gk.gesamt}`);
});

pruefe('GK2: das Ergebnis markiert explizit, dass keine Lohnnebenkosten enthalten sind (keine erfundene Vollständigkeit)', () => {
  const gk = berechneGesamtkosten({ id: 'm1', gehaltMonatlich: 1000 }, '2026-03-01', '2026-03-31', {
    zeiterfassung: [], benefits: [], reisekostenabrechnungen: [], reisekostensaetze: SAETZE,
  });
  assert(gk.enthaeltKeineLohnnebenkosten === true);
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
