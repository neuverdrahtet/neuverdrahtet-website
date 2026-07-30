// Standard-Katalog für das Gewerk Maler: übliche Leistungen/Arbeitsschritte
// und Materialien mit marktüblichen Netto-Preisen (Deutschland, Richtwerte)
// als Startpunkt zum Import in den eigenen Katalog. Über den Import-Dialog
// "Standard-Kataloge importieren" in Artikel & Leistungen aufrufbar - bereits
// vorhandene Bezeichnungen werden dabei übersprungen.

const STEUERSATZ = 19;
const GEWERK = 'maler';

function leistung(bezeichnung, einheit, preis) {
  return { typ: 'leistung', bezeichnung, beschreibung: '', einheit, einkaufspreis: 0, aufschlagProzent: 0, preis, steuersatz: STEUERSATZ, gewerk: GEWERK };
}

function artikel(bezeichnung, einheit, einkaufspreis, aufschlagProzent = 30) {
  const preis = Math.round(einkaufspreis * (1 + aufschlagProzent / 100) * 100) / 100;
  return { typ: 'artikel', bezeichnung, beschreibung: '', einheit, einkaufspreis, aufschlagProzent, preis, steuersatz: STEUERSATZ, gewerk: GEWERK };
}

export const STANDARD_KATALOG_MALER = [
  // --- Leistungen: Arbeitszeit ---
  leistung('Facharbeiterstunde Maler', 'Std.', 42),
  leistung('Helferstunde Maler', 'Std.', 32),

  // --- Leistungen: Vorbereitung ---
  leistung('Abklebe-/Abdeckarbeiten (Boden/Möbel schützen)', 'm²', 1.5),
  leistung('Untergrund reinigen und abkleben', 'm²', 2),
  leistung('Kleinere Schäden spachteln/ausbessern', 'm²', 6),
  leistung('Tapete entfernen', 'm²', 6),
  leistung('Grundierung/Tiefgrund auftragen', 'm²', 3),

  // --- Leistungen: Streichen ---
  leistung('Wand streichen (2x Anstrich, Standard)', 'm²', 9),
  leistung('Decke streichen (2x Anstrich)', 'm²', 10),
  leistung('Heizkörper lackieren', 'Stk.', 35),
  leistung('Fenster/Türen lasieren oder lackieren', 'Stk.', 45),
  leistung('Fassade streichen (ohne Gerüst)', 'm²', 18),
  leistung('Wischtechnik/Lasurtechnik (Effektanstrich, Aufpreis je m²)', 'm²', 12),
  leistung('Schimmelschutzanstrich auftragen', 'm²', 14),
  leistung('Bodenbeschichtung Garage/Keller auftragen', 'm²', 22),
  leistung('Graffiti entfernen/überstreichen', 'm²', 16),

  // --- Leistungen: Tapezieren ---
  leistung('Raufasertapete tapezieren', 'm²', 12),
  leistung('Vliestapete tapezieren', 'm²', 14),
  leistung('Fototapete/Sondertapete verlegen', 'm²', 22),

  // --- Leistungen: Sonstiges ---
  leistung('Silikonfugen im Bad erneuern', 'm', 6),
  leistung('Tapezieren/Streichen Treppenhaus (Pauschal je Geschoss)', 'pauschal', 350),

  // --- Materialien: Farben ---
  artikel('Wandfarbe innen, weiß (10L Eimer)', 'Stk.', 42),
  artikel('Wandfarbe innen, Volltonfarbe (10L Eimer)', 'Stk.', 58),
  artikel('Tiefgrund/Grundierung Wand (10L Kanister)', 'Stk.', 32),
  artikel('Fassadenfarbe (12,5L Eimer)', 'Stk.', 82),
  artikel('Abtönfarbe/Pigment (Flasche)', 'Stk.', 6),
  artikel('Holzlasur/Holzlack (750ml)', 'Stk.', 20),
  artikel('Schimmelschutzfarbe (10L Eimer)', 'Stk.', 68),
  artikel('Bodenbeschichtung Garage (5L Gebinde)', 'Stk.', 55),

  // --- Materialien: Tapeten & Zubehör ---
  artikel('Raufasertapete (Rolle)', 'Stk.', 11),
  artikel('Vliestapete (Rolle)', 'Stk.', 24),
  artikel('Tapetenkleister (Packung)', 'Stk.', 7),
  artikel('Malervlies/Abdeckvlies (Rolle)', 'Stk.', 14),
  artikel('Malerkrepp (Rolle 50m)', 'Stk.', 4),
  artikel('Silikon Sanitär (Kartusche)', 'Stk.', 8),
];
