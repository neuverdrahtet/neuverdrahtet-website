// Stundenverrechnungssatz-Rechner: leitet aus echten Betriebsdaten
// (Personalkosten, Betriebskosten, Abschreibungen, produktive Stunden) den
// kostendeckenden Mindeststundensatz ab - die klassische
// Handwerkskammer-Kalkulation: (Personalkosten + Betriebskosten) /
// produktive Gesamtstunden, optional zzgl. Gewinnaufschlag. Reine
// Rechenfunktionen ohne DOM-/Storage-Zugriff (siehe views/buchhaltung.js
// für die UI). Ersetzt keine betriebswirtschaftliche Beratung.
import { berechneAbschreibungsplan } from './abschreibung.js';

function runden(n) {
  return Math.round(n * 100) / 100;
}

/** Summiert die Jahres-Personalkosten aus den Mitarbeiter-Bruttolöhnen
 * (Stundenlohn × Jahresarbeitsstunden bzw. Monatsgehalt × 12) zzgl.
 * Lohnnebenkosten-Aufschlag (Arbeitgeberanteil Sozialversicherung u.ä.,
 * das die App sonst nirgends erfasst). Mitarbeiter ohne hinterlegten Lohn
 * werden übersprungen und separat gezählt (für einen Hinweis in der UI). */
export function berechnePersonalkosten(mitarbeiter, { jahresarbeitsstunden, lohnnebenkostenProzent }) {
  let bruttolohnsumme = 0;
  let anzahlMitZahlen = 0;
  let anzahlOhneZahlen = 0;
  for (const m of mitarbeiter) {
    const stundenlohn = Number(m.stundenlohn) || 0;
    const gehaltMonatlich = Number(m.gehaltMonatlich) || 0;
    const jahreslohn = stundenlohn ? stundenlohn * jahresarbeitsstunden : gehaltMonatlich * 12;
    if (jahreslohn) {
      bruttolohnsumme += jahreslohn;
      anzahlMitZahlen++;
    } else {
      anzahlOhneZahlen++;
    }
  }
  const lohnnebenkosten = bruttolohnsumme * (lohnnebenkostenProzent / 100);
  return {
    bruttolohnsumme: runden(bruttolohnsumme),
    lohnnebenkosten: runden(lohnnebenkosten),
    gesamt: runden(bruttolohnsumme + lohnnebenkosten),
    anzahlMitZahlen,
    anzahlOhneZahlen,
  };
}

/** Gruppiert Ausgaben (Nettobeträge) eines Jahres nach Kategorie
 * (Gemeinkosten) - Material ist standardmäßig ausgeschlossen, da es 1:1 an
 * den Kunden weiterberechnet wird und nicht in den Stundensatz gehört. */
export function berechneBetriebskosten(ausgaben, jahr, ausgeschlosseneKategorien = ['Material']) {
  const proKategorie = new Map();
  for (const a of ausgaben) {
    if (!a.datum || !a.datum.startsWith(String(jahr))) continue;
    const kategorie = a.kategorie || 'Sonstiges';
    const betrag = Number(a.betragNetto) || 0;
    proKategorie.set(kategorie, (proKategorie.get(kategorie) || 0) + betrag);
  }
  const zeilen = Array.from(proKategorie.entries()).map(([kategorie, betrag]) => ({ kategorie, betrag: runden(betrag) }));
  const gesamt = zeilen
    .filter((z) => !ausgeschlosseneKategorien.includes(z.kategorie))
    .reduce((s, z) => s + z.betrag, 0);
  return { zeilen, gesamt: runden(gesamt) };
}

/** Summiert die Abschreibung (AfA) aller Anlagegüter für ein Jahr, über
 * berechneAbschreibungsplan aus abschreibung.js (zeitanteilig korrekt) -
 * unabhängig davon, ob die Buchung im Journal schon ausgelöst wurde. */
export function berechneAbschreibungenGesamt(anlagegueter, jahr) {
  let summe = 0;
  for (const anlage of anlagegueter) {
    const plan = berechneAbschreibungsplan(anlage, `${jahr}-12-31`);
    const eintrag = plan.find((p) => p.jahr === Number(jahr));
    if (eintrag) summe += eintrag.betrag;
  }
  return runden(summe);
}

/** Produktive Gesamtstunden = Anzahl produktiver Mitarbeiter ×
 * Jahresarbeitsstunden × Produktivitätsgrad (Anteil der Anwesenheitszeit,
 * der tatsächlich verrechenbar ist - Rest sind Fahrzeiten, interne
 * Arbeiten, Ausfall). */
export function berechneProduktiveStunden({ anzahlMitarbeiter, jahresarbeitsstunden, produktivitaetsgradProzent }) {
  return runden(anzahlMitarbeiter * jahresarbeitsstunden * (produktivitaetsgradProzent / 100));
}

/** Kostendeckender Mindeststundensatz (Break-Even) sowie empfohlener
 * Verkaufsstundensatz inkl. Gewinnaufschlag. */
export function berechneStundensatz({ personalkosten, betriebskosten, produktiveStunden, gewinnaufschlagProzent = 0 }) {
  if (!produktiveStunden) return { breakEven: 0, empfohlen: 0 };
  const breakEven = (personalkosten + betriebskosten) / produktiveStunden;
  const empfohlen = breakEven * (1 + gewinnaufschlagProzent / 100);
  return { breakEven: runden(breakEven), empfohlen: runden(empfohlen) };
}
