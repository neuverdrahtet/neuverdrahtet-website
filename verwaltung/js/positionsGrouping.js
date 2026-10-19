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
