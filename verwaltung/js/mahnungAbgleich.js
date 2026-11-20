// Ordnet eine per KI erkannte, EMPFANGENE Mahnung (Zahlungserinnerung eines
// Lieferanten zu einer unbezahlten Eingangsrechnung) der passenden, bereits
// erfassten Ausgabe zu - per Kaskade Lieferant -> Rechnungsnummer -> Betrag
// (20.11.2026, auf Dannys Wunsch). Bewusst als eigenständiges, importfreies
// Modul (keine Abhängigkeit zu db.js/ui.js/etc.), damit es sich ohne
// Browser-Umgebung mit reinen Node-Tests prüfen lässt.
//
// Ausführen: node verwaltung/tests/mahnung-abgleich.test.mjs

// Vergleicht Lieferanten-/Firmennamen grob gegen Rechtsform-Zusätze und
// Groß-/Kleinschreibung hinweg (analog zur Kunden-Dubletten-Prüfung in
// ui.js), damit z.B. "Hornbach" und "Hornbach Baumarkt GmbH" als derselbe
// Lieferant erkannt werden.
export function normLieferant(s) {
  return (s || '').toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\b(gmbh|ug|ag|kg|ohg|gbr|co|inh)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Gibt die passende Ausgabe zurück, oder null, wenn die Zuordnung zu
 * unsicher wäre - lieber keine automatische Zuordnung als eine falsche,
 * Danny kann dann manuell nachschauen.
 */
export function findeAusgabeFuerMahnung({ haendler, rechnungsnummer, betragBrutto }, ausgaben) {
  const haendlerNorm = normLieferant(haendler);
  if (!haendlerNorm) return null;
  let kandidaten = ausgaben.filter((a) => a.lieferant && normLieferant(a.lieferant) === haendlerNorm);
  if (kandidaten.length === 0) return null;

  if (kandidaten.length > 1 && rechnungsnummer) {
    const nummerNorm = rechnungsnummer.trim().toLowerCase();
    const perNummer = kandidaten.filter((a) => (a.rechnungsnummer || '').trim().toLowerCase() === nummerNorm);
    if (perNummer.length >= 1) kandidaten = perNummer;
  }
  if (kandidaten.length === 1) return kandidaten[0];

  if (kandidaten.length > 1 && betragBrutto > 0) {
    // Der Mahnbetrag kann durch Mahngebühr/Verzugszinsen höher sein als der
    // ursprüngliche Rechnungsbetrag, aber nie niedriger - daher Toleranz nur
    // nach oben (max. Faktor 2), nicht nach unten.
    const passend = kandidaten.filter((a) => {
      const b = Number(a.betragBrutto) || 0;
      return b > 0 && b <= betragBrutto && b >= betragBrutto * 0.5;
    });
    if (passend.length >= 1) {
      kandidaten = [passend.reduce((best, a) => (Math.abs(Number(a.betragBrutto) - betragBrutto) < Math.abs(Number(best.betragBrutto) - betragBrutto) ? a : best))];
    }
  }
  return kandidaten.length === 1 ? kandidaten[0] : null;
}

/**
 * Findet einen bereits angelegten Lieferanten-Datensatz per Namensvergleich
 * (gleiche Normalisierung wie oben), oder null, wenn keiner passt - der
 * Aufrufer legt in diesem Fall einen neuen Lieferanten an (20.11.2026, auf
 * Dannys Wunsch: "automatisch die Lieferanten erstellen").
 */
export function findeLieferantFuerHaendler(haendler, lieferanten) {
  const haendlerNorm = normLieferant(haendler);
  if (!haendlerNorm) return null;
  return lieferanten.find((l) => l.firma && normLieferant(l.firma) === haendlerNorm) || null;
}

/**
 * Ordnet einen per KI erkannten, EINGEHENDEN Lieferschein (ohne eigenen
 * Betrag) der passenden, bereits erfassten Ausgabe zu - per Kaskade
 * Lieferant -> Rechnungsnummer (20.11.2026, auf Dannys Wunsch). Ohne Betrag
 * als Unterscheidungsmerkmal ist das strenger als bei Mahnungen: ohne
 * Rechnungsnummer wird nur zugeordnet, wenn der Lieferant eindeutig genau
 * eine offene/erfasste Ausgabe hat - sonst lieber keine automatische
 * Zuordnung als eine falsche.
 */
export function findeAusgabeFuerLieferschein({ haendler, rechnungsnummer }, ausgaben) {
  const haendlerNorm = normLieferant(haendler);
  if (!haendlerNorm) return null;
  let kandidaten = ausgaben.filter((a) => a.lieferant && normLieferant(a.lieferant) === haendlerNorm);
  if (kandidaten.length === 0) return null;
  if (kandidaten.length === 1) return kandidaten[0];

  if (rechnungsnummer) {
    const nummerNorm = rechnungsnummer.trim().toLowerCase();
    const perNummer = kandidaten.filter((a) => (a.rechnungsnummer || '').trim().toLowerCase() === nummerNorm);
    if (perNummer.length === 1) return perNummer[0];
  }
  return null;
}
