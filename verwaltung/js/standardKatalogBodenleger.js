// Standard-Katalog für das Gewerk Bodenleger: übliche Leistungen/Arbeits-
// schritte und Materialien mit marktüblichen Netto-Preisen (Deutschland,
// Richtwerte) als Startpunkt zum Import in den eigenen Katalog. Über den
// Import-Dialog "Standard-Kataloge importieren" in Artikel & Leistungen
// aufrufbar - bereits vorhandene Bezeichnungen werden dabei übersprungen.

const STEUERSATZ = 19;
const GEWERK = 'boden';

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

export const STANDARD_KATALOG_BODENLEGER = [
  // --- Leistungen: Arbeitszeit ---
  leistung('Facharbeiterstunde Bodenleger', 'Std.', 48),
  leistung('Helferstunde Bodenleger', 'Std.', 34),

  // --- Leistungen: Untergrundvorbereitung ---
  leistung('Alt-Bodenbelag entfernen und entsorgen', 'm²', 5),
  leistung('Untergrund schleifen/vorbereiten', 'm²', 6),
  leistung('Untergrund grundieren', 'm²', 3),
  leistung('Ausgleichsmasse spachteln (bis 5mm)', 'm²', 9),
  leistung('Bodenausgleich, dickschichtig (5-30mm)', 'm²', 16),
  leistung('Trittschalldämmung verlegen', 'm²', 3),

  // --- Leistungen: Bodenbeläge verlegen ---
  leistung('Parkett verlegen (schwimmend)', 'm²', 18),
  leistung('Parkett verlegen (vollflächig verklebt)', 'm²', 26),
  leistung('Parkett verlegen im Fischgrätmuster (Aufpreis je m²)', 'm²', 15),
  leistung('Massivparkett schleifen und versiegeln', 'm²', 22),
  leistung('Korkboden verlegen', 'm²', 16),
  leistung('Laminat verlegen', 'm²', 12),
  leistung('Vinyl-/Designboden verlegen (Klick)', 'm²', 14),
  leistung('Vinyl-/Designboden verlegen (vollflächig verklebt)', 'm²', 18),
  leistung('Teppichboden verlegen (verklebt)', 'm²', 10),
  leistung('PVC-Bahnenware verlegen', 'm²', 13),
  leistung('Fußbodenheizung-Ausgleichsschicht einbringen', 'm²', 12),

  // --- Leistungen: Abschlussarbeiten ---
  leistung('Sockelleiste montieren', 'm', 6),
  leistung('Übergangs-/Abschlussprofil setzen', 'Stk.', 15),
  leistung('Treppenrenovierung mit Stufenbelag (je Stufe)', 'Stk.', 45),

  // --- Materialien: Untergrund ---
  ...materialGruppe('Untergrund', [
    artikel('Ausgleichs-/Spachtelmasse (25kg Sack)', 'Stk.', 16),
    artikel('Ausgleichsmasse dickschichtig, bis 30mm (25kg Sack)', 'Stk.', 19),
    artikel('Grundierung Fußboden (5L Kanister)', 'Stk.', 28),
    artikel('Trittschalldämmung (Rolle, je m²)', 'm²', 2.5),
    artikel('Uzin NC 160 Selbstverlaufende Ausgleichsmasse (25kg Sack)', 'Stk.', 35),
  ]),

  // --- Materialien: Beläge ---
  ...materialGruppe('Beläge', [
    artikel('Fertigparkett Eiche, gebürstet', 'm²', 32),
    artikel('Laminat Klasse 32', 'm²', 11),
    artikel('Vinyl-/Designboden (Klick)', 'm²', 18),
    artikel('Vinyl-/Designboden (Bahnenware, verklebt)', 'm²', 20),
    artikel('SPC-Vinylboden (rigide)', 'm²', 24),
    artikel('Massivparkett Eiche', 'm²', 55),
    artikel('Korkboden', 'm²', 20),
    artikel('Teppichboden Objektqualität', 'm²', 11),
    artikel('PVC-Bahnenware', 'm²', 14),
    artikel('Parador Vinyl Basic 30 Eiche Memory (Klick-Vinyl, je m²)', 'm²', 43.1),
    artikel('Parador SPC Vinyl Designboden Classic 2070 (je m²)', 'm²', 47.85),
    artikel('Egger Laminat Bardolino Eiche, NK32 (je m²)', 'm²', 10),
  ]),

  // --- Materialien: Kleber & Abschluss ---
  ...materialGruppe('Kleber & Abschluss', [
    artikel('Fußbodenkleber (Eimer 15kg)', 'Stk.', 42),
    artikel('Dispersionskleber Vinyl (Eimer 14kg)', 'Stk.', 38),
    artikel('Sockelleiste MDF/Kunststoff (Stange 2,5m)', 'Stk.', 4),
    artikel('Übergangsprofil Alu', 'Stk.', 8),
    artikel('Uzin KE 66 Ökoline Dispersionsklebstoff (14kg Eimer)', 'Stk.', 40),
  ]),
];
