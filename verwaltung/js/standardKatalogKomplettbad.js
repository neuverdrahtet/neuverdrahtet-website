// Standard-Katalog für das Gewerk Komplettbad: übliche Leistungen/Arbeits-
// schritte und Materialien mit marktüblichen Netto-Preisen (Deutschland,
// Richtwerte) als Startpunkt zum Import in den eigenen Katalog. Elektro-,
// Fliesen- und Trockenbau-Arbeiten am Bad finden sich in den jeweiligen
// Gewerke-Katalogen - hier stehen die badspezifischen Sanitär-/Komplett-
// leistungen. Über den Import-Dialog "Standard-Kataloge importieren" in
// Artikel & Leistungen aufrufbar - bereits vorhandene Bezeichnungen werden
// dabei übersprungen.

const STEUERSATZ = 19;
const GEWERK = 'komplettbad';

function leistung(bezeichnung, einheit, preis) {
  return { typ: 'leistung', bezeichnung, beschreibung: '', einheit, einkaufspreis: 0, aufschlagProzent: 0, preis, steuersatz: STEUERSATZ, gewerk: GEWERK };
}

function artikel(bezeichnung, einheit, einkaufspreis, aufschlagProzent = 25) {
  const preis = Math.round(einkaufspreis * (1 + aufschlagProzent / 100) * 100) / 100;
  return { typ: 'artikel', bezeichnung, beschreibung: '', einheit, einkaufspreis, aufschlagProzent, preis, steuersatz: STEUERSATZ, gewerk: GEWERK };
}

export const STANDARD_KATALOG_KOMPLETTBAD = [
  // --- Leistungen: Arbeitszeit ---
  leistung('Facharbeiterstunde Sanitär/Bad', 'Std.', 56),
  leistung('Helferstunde Sanitär/Bad', 'Std.', 36),

  // --- Leistungen: Vorarbeiten ---
  leistung('Bad-Entkernung komplett (bis 8m², inkl. Altfliesen/Sanitär demontieren)', 'pauschal', 950),
  leistung('Sanitär-Grundleitungen erneuern (bis 8m²)', 'pauschal', 1800),
  leistung('Estrich/Bodenaufbau für bodengleiche Dusche anpassen', 'pauschal', 450),

  // --- Leistungen: Sanitärobjekte montieren ---
  leistung('WC-Element/Vorwandinstallation montieren', 'Stk.', 320),
  leistung('WC wandhängend montieren', 'Stk.', 180),
  leistung('Waschtisch mit Unterschrank montieren', 'Stk.', 220),
  leistung('Dusche bodengleich einbauen (inkl. Ablauf)', 'pauschal', 650),
  leistung('Duschabtrennung montieren', 'Stk.', 250),
  leistung('Badewanne einbauen', 'Stk.', 280),
  leistung('Armatur montieren (Waschtisch/Dusche/Wanne)', 'Stk.', 95),
  leistung('Handtuchheizkörper montieren', 'Stk.', 180),
  leistung('Fußbodenheizung Bad verlegen', 'm²', 65),
  leistung('Bad-Lüfter/Lüftungsanlage einbauen', 'Stk.', 150),
  leistung('Spiegelschrank/Spiegel montieren', 'Stk.', 90),
  leistung('Dusch-WC/Bidet montieren', 'Stk.', 380),
  leistung('Waschtischunterschrank mit Auszügen montieren', 'Stk.', 280),
  leistung('Barrierefreier Umbau (Haltegriffe, Stützklappgriffe, bodengleiche Dusche)', 'pauschal', 1200),

  // --- Leistungen: Komplettpaket ---
  leistung('Komplettbad-Sanierung Pauschalpaket (bis 8m², mittlere Preisklasse, schlüsselfertig)', 'pauschal', 14500),

  // --- Materialien: Sanitärobjekte ---
  artikel('WC-Element/Vorwandtechnik', 'Stk.', 190),
  artikel('WC-Keramik wandhängend', 'Stk.', 220),
  artikel('WC-Sitz mit Absenkautomatik', 'Stk.', 65),
  artikel('Waschtisch mit Unterschrank (Set)', 'Stk.', 340),
  artikel('Dusch-Rinne/Bodenablauf', 'Stk.', 130),
  artikel('Duschabtrennung (Set, 90x90)', 'Stk.', 320),
  artikel('Badewanne Acryl Standard (170x75)', 'Stk.', 260),

  // --- Materialien: Armaturen & Zubehör ---
  artikel('Armatur Waschtisch (Standard)', 'Stk.', 95),
  artikel('Armatur Dusche/Wanne (Unterputz)', 'Stk.', 160),
  artikel('Handtuchheizkörper (600x1200)', 'Stk.', 210),
  artikel('Spiegelschrank mit Beleuchtung', 'Stk.', 220),
  artikel('Silikon Sanitär (Kartusche)', 'Stk.', 8),
  artikel('Bad-Lüfter mit Nachlauf', 'Stk.', 65),
  artikel('Dusch-WC (Basismodell)', 'Stk.', 650),
  artikel('Haltegriff/Stützklappgriff barrierefrei', 'Stk.', 45),
];
