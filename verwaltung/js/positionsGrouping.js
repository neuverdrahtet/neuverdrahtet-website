// Gemeinsame Gruppierungslogik für die wählbare Kundenansicht bei Angeboten
// ("Detailgrad": Einzelpreise/Abschnittssummen/Kurzfassung) - wird sowohl von
// der HTML-Druckvorschau (pdf.js buildDocHtml) als auch vom echten PDF-Export
// (docpdf.js) verwendet, damit beide Renderer immer dieselbe Gruppierung
// zeigen statt zwei unabhängig gepflegte Kopien der Logik zu riskieren.
export function gruppierePositionenNachAbschnitt(positionen) {
  const gruppen = [];
  let aktuelle = { titel: null, beschreibung: '', positionen: [] };
  for (const p of positionen || []) {
    if (p.typ === 'ueberschrift') {
      if (aktuelle.positionen.length || aktuelle.titel) gruppen.push(aktuelle);
      aktuelle = { titel: p.bezeichnung || '', beschreibung: p.beschreibung || '', positionen: [] };
    } else {
      aktuelle.positionen.push(p);
    }
  }
  if (aktuelle.positionen.length || aktuelle.titel) gruppen.push(aktuelle);
  return gruppen.map((g) => ({
    ...g,
    summe: g.positionen.reduce((s, p) => s + (Number(p.menge) || 0) * (Number(p.einzelpreis) || 0), 0),
  }));
}

/** Ob die Positionsliste überhaupt in Abschnitte (Überschriften) gegliedert
 * ist - ohne mindestens einen echten Abschnittstitel ergeben "Abschnitts-
 * summen"/"Kurzfassung" nur eine einzige, nichtssagende Sammelzeile, deshalb
 * fällt die Anzeige in dem Fall auf die volle Einzelpositionen-Liste zurück. */
export function hatAbschnitte(gruppen) {
  return gruppen.some((g) => g.titel);
}

/** Kurzbeschreibung eines Abschnitts für die "Kurzfassung"-Ansicht: die vom
 * Nutzer hinterlegte Abschnitts-Beschreibung, sonst ersatzweise die
 * Bezeichnungen der enthaltenen Positionen aneinandergereiht. */
export function abschnittKurzbeschreibung(gruppe) {
  if (gruppe.beschreibung) return gruppe.beschreibung;
  return gruppe.positionen.map((p) => p.bezeichnung).filter(Boolean).join(', ');
}

/**
 * Fügt in die volle Einzelpositionen-Liste (Detailgrad "Einzelpreise", der
 * Standardfall für Angebote UND Rechnungen/Auftragsbestätigungen) nach jedem
 * ECHTEN Abschnitt (mit Überschrift) eine Zwischensummen-Zeile ein - anders
 * als "Abschnittssummen" (siehe oben) bleiben dabei alle Einzelpositionen
 * sichtbar. Positionen VOR der ersten Überschrift (kein eigener Abschnitt)
 * bekommen bewusst keine Zwischensumme, genau wie sie auch keine eigene
 * Abschnittsnummer (posNr-Präfix) bekommen, siehe renumberPositionen() in
 * positions.js. Ohne jede Überschrift (z.B. die meisten Rechnungen) ändert
 * sich dadurch nichts an der Ausgabe.
 */
export function abschnittsZwischensummenEinfuegen(positionen) {
  const ergebnis = [];
  let abschnittNr = 0;
  let laufendeSumme = 0;
  let laufendeAnzahl = 0;

  function schliesseAbschnitt() {
    if (abschnittNr > 0 && laufendeAnzahl > 0) {
      ergebnis.push({ typ: 'zwischensumme', abschnittNr, summe: laufendeSumme });
    }
  }

  for (const p of positionen || []) {
    if (p.typ === 'ueberschrift') {
      schliesseAbschnitt();
      abschnittNr++;
      laufendeSumme = 0;
      laufendeAnzahl = 0;
      ergebnis.push(p);
    } else {
      laufendeSumme += (Number(p.menge) || 0) * (Number(p.einzelpreis) || 0);
      laufendeAnzahl++;
      ergebnis.push(p);
    }
  }
  schliesseAbschnitt();
  return ergebnis;
}
