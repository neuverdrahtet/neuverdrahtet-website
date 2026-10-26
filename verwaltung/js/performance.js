// Service-/Techniker-/Personalverwaltung Phase 8: Performance- und
// Bonus-Simulation - gemeinsames Logikmodul (reine Funktionen, keine DOM-/
// Firestore-Abhängigkeit), analog zu reisekosten.js. Von der Büro-Ansicht
// (verwaltung/js/views/performance.js) importiert.
//
// WICHTIG - reine Simulation (Spezifikationsauflage für Phase 8): "Der
// Referenzwert ist noch nicht festgelegt" - es gibt KEINE von dieser
// Entwicklung erfundene feste Schwelle, ab der ein Bonus ausgelöst wird.
// Kennzahlen (berechneKennzahlen) werden immer aus echten, bereits
// vorhandenen Daten berechnet und angezeigt. Eine Bonus-Simulation
// (berechneBonusSimulation) liefert nur dann einen Betrag ungleich 0, wenn
// admin selbst einen Referenzwert in der versionierten Collection
// "bonusreferenzwerte" hinterlegt hat (gueltigAb/gueltigBis, analog
// reisekostensaetze - siehe firestore.rules: nur admin darf schreiben).
// Ohne hinterlegten Referenzwert bleibt der simulierte Bonus 0 EUR mit
// explizitem Hinweistext - es wird NIE ein Schwellenwert angenommen oder
// geschätzt. Keine automatische Auszahlung, keine Lohnwirkung, keine
// rechtliche Bindung - vor Umsetzung ist eine Freigabe durch
// Geschäftsführung/Lohnbüro erforderlich.

// Geschlossene Liste der Kennzahlen, auf die sich ein Referenzwert beziehen
// kann - bewusst nur objektive, bereits an anderer Stelle erfasste Werte
// (keine Bewertung/Ranking zwischen Mitarbeitern).
export const PERFORMANCE_KENNZAHLEN = [
  { id: 'abgeschlosseneAuftraege', titel: 'Abgeschlossene Serviceaufträge im Zeitraum', einheit: 'Aufträge' },
  { id: 'puenktlichkeitQuote', titel: 'Pünktlichkeitsquote (abgeschlossen ohne Fristüberschreitung)', einheit: '%' },
  { id: 'istStunden', titel: 'Erfasste Arbeitsstunden im Zeitraum', einheit: 'Std.' },
];

function istImZeitraum(datumIso, von, bis) {
  const d = (datumIso || '').toString().slice(0, 10);
  return !!d && d >= von && d <= bis;
}

// Berechnet objektive Kennzahlen für EINEN Mitarbeiter/Techniker im
// gewählten Zeitraum - rein deskriptiv, kein Scoring/Ranking. "heute" ist
// nur für offenUeberfaellig relevant (Momentaufnahme der aktuell offenen,
// überfälligen Aufträge - unabhängig vom gewählten Auswertungszeitraum).
export function berechneKennzahlen(mitarbeiterId, von, bis, serviceauftraege, zeiterfassung, heute = new Date().toISOString().slice(0, 10)) {
  const eigeneAuftraege = (serviceauftraege || []).filter((a) => (a.technikerIds || []).includes(mitarbeiterId));
  const abgeschlossenImZeitraum = eigeneAuftraege.filter((a) => a.status === 'abgeschlossen' && istImZeitraum(a.aktualisiertAm, von, bis));
  const puenktlichAbgeschlossen = abgeschlossenImZeitraum.filter((a) => !a.auftragsfrist || (a.aktualisiertAm || '').toString().slice(0, 10) <= a.auftragsfrist);
  const offenUeberfaellig = eigeneAuftraege.filter((a) => a.status !== 'abgeschlossen' && a.status !== 'abgebrochen' && a.auftragsfrist && a.auftragsfrist < heute);
  const istMinuten = (zeiterfassung || [])
    .filter((e) => e.mitarbeiterId === mitarbeiterId && istImZeitraum(e.datum, von, bis))
    .reduce((s, e) => s + (Number(e.dauerMinuten) || 0), 0);

  return {
    abgeschlosseneAuftraege: abgeschlossenImZeitraum.length,
    puenktlichAbgeschlossen: puenktlichAbgeschlossen.length,
    // null = keine Aufträge im Zeitraum abgeschlossen (keine Datenbasis) -
    // bewusst NICHT als 0% oder 100% ausgewiesen, das wäre eine erfundene Aussage.
    puenktlichkeitQuote: abgeschlossenImZeitraum.length > 0
      ? Math.round((puenktlichAbgeschlossen.length / abgeschlossenImZeitraum.length) * 1000) / 10
      : null,
    offenUeberfaellig: offenUeberfaellig.length,
    istStunden: Math.round((istMinuten / 60) * 100) / 100,
  };
}

// Findet alle am Stichtag gültigen Referenzwerte (gueltigAb/gueltigBis,
// identisches Muster wie findeGueltigenSatz in reisekosten.js) - es kann
// mehrere gleichzeitig gültige Referenzwerte für unterschiedliche
// Kennzahlen geben.
export function findeGueltigeReferenzwerte(referenzwerte, datum) {
  if (!datum) return [];
  return (referenzwerte || []).filter((r) => r.gueltigAb && r.gueltigAb <= datum && (!r.gueltigBis || datum <= r.gueltigBis));
}

// Simuliert einen Bonus NUR auf Basis tatsächlich von admin hinterlegter
// Referenzwerte. Ohne gültigen Referenzwert für den Stichtag gibt es
// AUSDRÜCKLICH keine Simulation (bonusBetrag 0 + Hinweis) statt eines
// erfundenen Schwellenwerts.
export function berechneBonusSimulation(kennzahlen, referenzwerte, datum) {
  const gueltige = findeGueltigeReferenzwerte(referenzwerte, datum);
  if (gueltige.length === 0) {
    return { bonusBetrag: 0, erreichteReferenzwerte: [], hinweis: 'Kein Referenzwert für diesen Zeitraum hinterlegt – keine Bonus-Simulation möglich, nur Kennzahlen.' };
  }
  const erreichteReferenzwerte = gueltige.filter((r) => {
    const wert = kennzahlen[r.kennzahl];
    return wert != null && wert >= Number(r.schwellenwert);
  });
  const bonusBetrag = erreichteReferenzwerte.reduce((s, r) => s + (Number(r.bonusBetrag) || 0), 0);
  return {
    bonusBetrag,
    erreichteReferenzwerte,
    hinweis: erreichteReferenzwerte.length === 0 ? 'Referenzwert(e) hinterlegt, aber im Zeitraum nicht erreicht.' : '',
  };
}
