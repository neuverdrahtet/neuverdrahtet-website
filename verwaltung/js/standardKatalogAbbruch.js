// Standard-Katalog für das Gewerk Abbruch: übliche Leistungen/Arbeitsschritte
// und Materialien mit marktüblichen Netto-Preisen (Deutschland, Richtwerte)
// als Startpunkt zum Import in den eigenen Katalog. Über den Import-Dialog
// "Standard-Kataloge importieren" in Artikel & Leistungen aufrufbar - bereits
// vorhandene Bezeichnungen werden dabei übersprungen.

const STEUERSATZ = 19;
const GEWERK = 'abbruch';

function leistung(bezeichnung, einheit, preis) {
  return { typ: 'leistung', bezeichnung, beschreibung: '', einheit, einkaufspreis: 0, aufschlagProzent: 0, preis, steuersatz: STEUERSATZ, gewerk: GEWERK };
}

function artikel(bezeichnung, einheit, einkaufspreis, aufschlagProzent = 20) {
  const preis = Math.round(einkaufspreis * (1 + aufschlagProzent / 100) * 100) / 100;
  return { typ: 'artikel', bezeichnung, beschreibung: '', einheit, einkaufspreis, aufschlagProzent, preis, steuersatz: STEUERSATZ, gewerk: GEWERK };
}

export const STANDARD_KATALOG_ABBRUCH = [
  // --- Leistungen: Arbeitszeit ---
  leistung('Facharbeiterstunde Abbruch', 'Std.', 46),
  leistung('Helferstunde Abbruch', 'Std.', 34),
  leistung('Anfahrt/Fahrzeit (Nahbereich, pauschal)', 'pauschal', 35),

  // --- Leistungen: Rückbau Wände/Decken ---
  leistung('Nichttragende Wand abbrechen (Ziegel/Kalksandstein)', 'm²', 32),
  leistung('Trockenbauwand rückbauen', 'm²', 16),
  leistung('Durchbruch/Maueröffnung herstellen (bis 1m²)', 'Stk.', 220),
  leistung('Abgehängte Decke/Rigipsdecke rückbauen', 'm²', 18),
  leistung('Tapeten entfernen', 'm²', 6),
  leistung('Putz abschlagen (Wand)', 'm²', 14),

  // --- Leistungen: Bodenaufbau & Beläge ---
  leistung('Fliesen entfernen (Wand)', 'm²', 18),
  leistung('Fliesen entfernen (Boden)', 'm²', 20),
  leistung('Estrich aufnehmen (bis 8cm)', 'm²', 16),
  leistung('Teppich-/Bodenbelag entfernen', 'm²', 6),
  leistung('Parkett-/Laminatboden entfernen', 'm²', 8),

  // --- Leistungen: Sanitär/Heizung-Demontage ---
  leistung('Sanitärobjekt demontieren (WC/Waschbecken)', 'Stk.', 65),
  leistung('Badewanne/Dusche demontieren', 'Stk.', 95),
  leistung('Heizkörper demontieren', 'Stk.', 55),
  leistung('Tür/Zarge ausbauen und entsorgen', 'Stk.', 45),

  // --- Leistungen: Entsorgung & Baustelle ---
  leistung('Bauschutt-Entsorgung (je Tonne, inkl. Deponiegebühr)', 't', 95),
  leistung('Schuttcontainer 5m³ stellen, abholen und entsorgen (pauschal)', 'pauschal', 380),
  leistung('Staubschutzwand/Folienabtrennung einrichten', 'm²', 12),
  leistung('Entkernung Wohnung komplett (Richtwert je m² Wohnfläche)', 'm²', 45),
  leistung('Bauendreinigung nach Abbruch', 'm²', 6),

  // --- Materialien ---
  artikel('Bauschutt-Container/Big Bag (1m³) mieten', 'Stk.', 22),
  artikel('Absperr-/Schutzfolie (Rolle 4x5m)', 'Stk.', 8),
  artikel('Malerkrepp/Klebeband für Abtrennung (Rolle)', 'Stk.', 4),
  artikel('Bauabsperrband (Rolle 500m)', 'Stk.', 12),
  artikel('Staubschutzmaske FFP2 (Packung 10 Stk.)', 'Stk.', 15),
  artikel('Einweg-Schutzanzug', 'Stk.', 6),
  artikel('Handschuhe Arbeitsschutz (Paar)', 'Stk.', 3),
];
