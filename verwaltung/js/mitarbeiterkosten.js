// Service-/Techniker-/Personalverwaltung Phase 13: Gesamtkosten pro
// Mitarbeiter - gemeinsames Logikmodul (reine Funktionen, keine DOM-/
// Firestore-Abhängigkeit), analog zu reisekosten.js/performance.js.
//
// WICHTIG - bewusst UNVOLLSTÄNDIG, keine erfundenen Lohnnebenkosten: Die
// gesetzlichen Arbeitgeberanteile zur Sozialversicherung (Kranken-, Pflege-,
// Renten-, Arbeitslosenversicherung) ändern sich jährlich und hängen vom
// individuellen Krankenversicherungsstatus/-beitragssatz ab - diese
// Entwicklung legt dafür KEINEN Pauschalsatz fest (Spezifikationsauflage
// "keine steuerlichen/sozialversicherungsrechtlichen Regeln erfinden").
// berechneGesamtkosten() liefert deshalb nur Grundvergütung + tatsächliche
// Benefit-Arbeitgeberkosten + genehmigte Reisekostenerstattungen, mit
// explizitem Hinweis, dass gesetzliche Lohnnebenkosten NICHT enthalten sind.
// Reine Orientierungshilfe, keine Lohnbuchhaltung, keine Auszahlungswirkung -
// vor jeder Verwendung in einer echten Kalkulation ist eine Prüfung durch
// Lohnbüro/Steuerberater erforderlich.

import { berechneVerpflegungspauschale, berechneKilometergeld } from './reisekosten.js';

function tageAktivImZeitraum(benefit, von, bis) {
  if (!benefit.beginnDatum) return 0;
  if (benefit.beginnDatum > bis) return 0;
  if (benefit.endeDatum && benefit.endeDatum < von) return 0;
  const start = benefit.beginnDatum > von ? benefit.beginnDatum : von;
  const ende = benefit.endeDatum && benefit.endeDatum < bis ? benefit.endeDatum : bis;
  return Math.round((new Date(ende) - new Date(start)) / 86400000) + 1;
}

// Anteilige Arbeitgeberkosten aller Benefits eines Mitarbeiters im
// Zeitraum - ein mitten im Zeitraum beginnender/endender Benefit wird nach
// Tagen anteilig gerechnet statt den vollen Monatsbetrag anzunehmen.
export function berechneBenefitKostenImZeitraum(benefits, mitarbeiterId, von, bis) {
  const tageGesamt = Math.round((new Date(bis) - new Date(von)) / 86400000) + 1;
  if (tageGesamt <= 0) return 0;
  return (benefits || [])
    .filter((b) => b.mitarbeiterId === mitarbeiterId)
    .reduce((summe, b) => {
      const tage = tageAktivImZeitraum(b, von, bis);
      if (tage <= 0) return summe;
      return summe + (Number(b.arbeitgeberKostenMonatlich) || 0) * (tage / tageGesamt);
    }, 0);
}

// Grundvergütung im Zeitraum: Festgehalt (unabhängig von der Länge des
// Zeitraums - ein Monatsgehalt gilt für genau einen Monat) ODER
// Stundenlohn × tatsächlich erfasste Ist-Stunden, je nachdem, was am
// Mitarbeiterdatensatz gepflegt ist. Ein/Austrittsdatum außerhalb des
// Zeitraums ergibt 0 (kein anteiliges Rechnen hier - dafür müsste bekannt
// sein, an welchem Wochentag der Zeitraum beginnt, was bei einem Festgehalt
// ohnehin Aufgabe der echten Lohnabrechnung ist, nicht dieser Simulation).
export function berechneGrundverguetungImZeitraum(mitarbeiter, zeiterfassung, von, bis) {
  if (mitarbeiter.eintrittsdatum && mitarbeiter.eintrittsdatum > bis) return 0;
  if (mitarbeiter.austrittsdatum && mitarbeiter.austrittsdatum < von) return 0;
  if (mitarbeiter.gehaltMonatlich) return Number(mitarbeiter.gehaltMonatlich) || 0;
  if (mitarbeiter.stundenlohn) {
    const istMinuten = (zeiterfassung || [])
      .filter((e) => e.mitarbeiterId === mitarbeiter.id && (e.datum || '') >= von && (e.datum || '') <= bis)
      .reduce((s, e) => s + (Number(e.dauerMinuten) || 0), 0);
    return Math.round((istMinuten / 60) * Number(mitarbeiter.stundenlohn) * 100) / 100;
  }
  return 0;
}

// Summe der im Zeitraum GENEHMIGTEN Reisekostenerstattungen (nur
// "genehmigt" zählt als tatsächliche Kosten - ein Entwurf/eingereicht ist
// noch keine beschlossene Erstattung).
export function berechneReisekostenImZeitraum(abrechnungen, mitarbeiterId, von, bis, saetze) {
  return (abrechnungen || [])
    .filter((a) => a.mitarbeiterId === mitarbeiterId && a.status === 'genehmigt' && (a.von || '').slice(0, 10) >= von && (a.von || '').slice(0, 10) <= bis)
    .reduce((summe, a) => {
      const verpflegung = berechneVerpflegungspauschale(a.von, a.bis, saetze);
      const km = berechneKilometergeld(a.kilometer, a.von, saetze);
      return summe + verpflegung.gesamtBetrag + km + (Number(a.uebernachtungskostenBrutto) || 0);
    }, 0);
}

// Gesamtkosten = Grundvergütung + anteilige Benefit-AG-Kosten + genehmigte
// Reisekosten. OHNE gesetzliche Lohnnebenkosten (siehe Kopfkommentar) - das
// wird über "enthaeltKeineLohnnebenkosten" explizit markiert, damit die
// Oberfläche das nie als vollständige Kostenaussage darstellt.
export function berechneGesamtkosten(mitarbeiter, von, bis, { zeiterfassung, benefits, reisekostenabrechnungen, reisekostensaetze }) {
  const grundverguetung = berechneGrundverguetungImZeitraum(mitarbeiter, zeiterfassung, von, bis);
  const benefitKosten = berechneBenefitKostenImZeitraum(benefits, mitarbeiter.id, von, bis);
  const reisekosten = berechneReisekostenImZeitraum(reisekostenabrechnungen, mitarbeiter.id, von, bis, reisekostensaetze);
  return {
    grundverguetung: Math.round(grundverguetung * 100) / 100,
    benefitKosten: Math.round(benefitKosten * 100) / 100,
    reisekosten: Math.round(reisekosten * 100) / 100,
    gesamt: Math.round((grundverguetung + benefitKosten + reisekosten) * 100) / 100,
    enthaeltKeineLohnnebenkosten: true,
  };
}
