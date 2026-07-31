// Standard-Katalog für das Gewerk Wohnungssanierung/Renovierung: übergreifende
// Pauschal-Leistungen und Baustellen-Nebenkosten mit marktüblichen Netto-
// Preisen (Deutschland, Richtwerte) als Startpunkt zum Import in den eigenen
// Katalog. Die detaillierten Einzelgewerke (Maler, Boden, Fliesen, Trocken-
// bau, Elektro, Abbruch) stehen in den jeweiligen Gewerke-Katalogen - hier
// stehen die gewerkübergreifenden Sanierungs-/Projektleistungen. Über den
// Import-Dialog "Standard-Kataloge importieren" in Artikel & Leistungen
// aufrufbar - bereits vorhandene Bezeichnungen werden dabei übersprungen.

const STEUERSATZ = 19;
const GEWERK = 'renovierung';

function leistung(bezeichnung, einheit, preis) {
  return { typ: 'leistung', bezeichnung, beschreibung: '', einheit, einkaufspreis: 0, aufschlagProzent: 0, preis, steuersatz: STEUERSATZ, gewerk: GEWERK };
}

function artikel(bezeichnung, einheit, einkaufspreis, aufschlagProzent = 25) {
  const preis = Math.round(einkaufspreis * (1 + aufschlagProzent / 100) * 100) / 100;
  return { typ: 'artikel', bezeichnung, beschreibung: '', einheit, einkaufspreis, aufschlagProzent, preis, steuersatz: STEUERSATZ, gewerk: GEWERK };
}

function materialGruppe(unterkategorie, items) {
  return items.map((item) => ({ ...item, unterkategorie }));
}

export const STANDARD_KATALOG_RENOVIERUNG = [
  // --- Leistungen: Pauschalpakete ---
  leistung('Vollsanierung Wohnung, Basis-Ausstattung (je m² Wohnfläche)', 'm²', 380),
  leistung('Kernsanierung Komplett, gehobene Ausstattung (je m² Wohnfläche)', 'm²', 1250),
  leistung('Teilsanierung Zimmer (Malern + Bodenbelag)', 'm²', 95),
  leistung('Renovierung bei Mieterauszug (Malern + kleine Ausbesserungen)', 'm²', 28),

  // --- Leistungen: Baustellenorganisation ---
  leistung('Baustelleneinrichtung/-räumung', 'pauschal', 250),
  leistung('Bauleitung/Projektkoordination (je Woche)', 'pauschal', 450),
  leistung('Rohbau-Bestandsaufnahme/Statik-Check koordinieren', 'pauschal', 280),
  leistung('Bauwasser-/Baustromanschluss einrichten', 'pauschal', 180),
  leistung('Baustellentoilette mieten (je Monat)', 'pauschal', 120),
  leistung('Schutzabdeckung Treppenhaus/Flure einrichten', 'pauschal', 180),
  leistung('Zwischenreinigung Baustelle (je Einsatz)', 'pauschal', 90),
  leistung('Baufeinreinigung/Endreinigung nach Sanierung', 'm²', 6),
  leistung('Entsorgung Sperrmüll/Altmöbel', 'pauschal', 220),

  // --- Materialien: Baustellenausstattung ---
  ...materialGruppe('Baustellenausstattung', [
    artikel('Abdeckvlies/Bodenschutz (Rolle)', 'Stk.', 20),
    artikel('Bauschutt-Container 5m³ (Miete inkl. Entsorgung)', 'Stk.', 320),
    artikel('Kantenschutzprofile (Set)', 'Stk.', 12),
    artikel('Absperr-/Warnband (Rolle 500m)', 'Stk.', 12),
    artikel('Bauzaun mieten (je m/Woche)', 'm', 2.5),
    artikel('Layher Rollgerüst/Fahrgerüst mieten (Arbeitshöhe bis 6m, je Woche)', 'Stk.', 125),
    artikel('Bagster Big Bag XL Bauschutt-Entsorgungssack (2m³)', 'Stk.', 16.8),
    artikel('Tesa Präzisionskrepp Outdoor-Klebeband, UV-beständig (Rolle 50m)', 'Stk.', 10.5),
  ]),
];
