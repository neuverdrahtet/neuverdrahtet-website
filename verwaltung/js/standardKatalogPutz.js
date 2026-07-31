// Standard-Katalog für das Gewerk Putz/Stuckateur: übliche Leistungen/
// Arbeitsschritte und Materialien mit marktüblichen Netto-Preisen
// (Deutschland, Richtwerte) als Startpunkt zum Import in den eigenen
// Katalog. Über den Import-Dialog "Standard-Kataloge importieren" in
// Artikel & Leistungen aufrufbar - bereits vorhandene Bezeichnungen werden
// dabei übersprungen.

const STEUERSATZ = 19;
const GEWERK = 'putz';

function leistung(bezeichnung, einheit, preis) {
  return { typ: 'leistung', bezeichnung, beschreibung: '', einheit, einkaufspreis: 0, aufschlagProzent: 0, preis, steuersatz: STEUERSATZ, gewerk: GEWERK };
}

function artikel(bezeichnung, einheit, einkaufspreis, aufschlagProzent = 30) {
  const preis = Math.round(einkaufspreis * (1 + aufschlagProzent / 100) * 100) / 100;
  return { typ: 'artikel', bezeichnung, beschreibung: '', einheit, einkaufspreis, aufschlagProzent, preis, steuersatz: STEUERSATZ, gewerk: GEWERK };
}

function materialGruppe(unterkategorie, items) {
  return items.map((item) => ({ ...item, unterkategorie }));
}

export const STANDARD_KATALOG_PUTZ = [
  // --- Leistungen: Arbeitszeit ---
  leistung('Facharbeiterstunde Stuckateur/Putzer', 'Std.', 54),
  leistung('Helferstunde Putzarbeiten', 'Std.', 36),

  // --- Leistungen: Vorarbeiten ---
  leistung('Untergrund vorbereiten/reinigen (Putzarbeiten)', 'm²', 4),
  leistung('Haftgrund/Voranstrich auftragen', 'm²', 3.5),
  leistung('Eckschutzschienen setzen', 'm', 6),
  leistung('Armierungsgewebe einbetten', 'm²', 5),

  // --- Leistungen: Innenputz ---
  leistung('Wand verputzen, Kalkzementputz maschinell (Standard)', 'm²', 22),
  leistung('Wand verputzen, Gipsputz maschinell (Standard)', 'm²', 20),
  leistung('Wand verputzen von Hand (kleine Fläche/Ausbesserung)', 'm²', 30),
  leistung('Deckenputz auftragen', 'm²', 26),
  leistung('Rabitz-/Armierungsputz auftragen (auf Putzträger)', 'm²', 28),
  leistung('Putzoberfläche filzen/glätten', 'm²', 6),
  leistung('Sanierputz gegen Feuchte/Salze auftragen', 'm²', 32),
  leistung('Kleinflächige Putzausbesserung/Rissesanierung', 'm²', 18),
  leistung('Edel-/Dekorputz auftragen (Kellenwurf/Kratzputz)', 'm²', 35),
  leistung('Stuckleiste/Zierprofil anbringen', 'm', 22),

  // --- Leistungen: Außenputz & Dämmung ---
  leistung('Außenputz auftragen (Grundputz + Oberputz, inkl. Gerüst)', 'm²', 45),
  leistung('Sockelputz wasserabweisend auftragen', 'm²', 38),
  leistung('Wärmedämmverbundsystem (WDVS) anbringen', 'm²', 85),
  leistung('Altputz sanieren/Feuchtesanierung Fassade', 'm²', 48),

  // --- Materialien: Putze ---
  ...materialGruppe('Putze', [
    artikel('Kalkzementputz Maschinenputz (Sack 30kg)', 'Stk.', 12),
    artikel('Gipsputz Maschinenputz (Sack 30kg)', 'Stk.', 13),
    artikel('Oberputz/Reibeputz (Sack 25kg)', 'Stk.', 22),
    artikel('Sanierputz (Sack 30kg)', 'Stk.', 28),
    artikel('Außenputz mineralisch (Sack 30kg)', 'Stk.', 16),
    artikel('Edelputz/Dekorputz (Sack 25kg)', 'Stk.', 24),
    artikel('Stuckleiste/Zierprofil (Meterware)', 'm', 8),
  ]),

  // --- Materialien: Zubehör ---
  ...materialGruppe('Zubehör', [
    artikel('Haftgrund/Tiefgrund (Kanister 5L)', 'Stk.', 26),
    artikel('Armierungsgewebe (Rolle 50m²)', 'Stk.', 45),
    artikel('Eckschutzschiene mit Gewebe (Stange 2,5m)', 'Stk.', 7),
    artikel('WDVS-Dämmplatte 100mm (m²)', 'm²', 14),
    artikel('Gerüst mieten (je m² Fassade/Woche)', 'm²', 4),
  ]),
];
