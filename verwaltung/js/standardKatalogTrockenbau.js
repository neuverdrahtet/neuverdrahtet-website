// Standard-Katalog für das Gewerk Trockenbau: übliche Leistungen/Arbeits-
// schritte und Materialien mit marktüblichen Netto-Preisen (Deutschland,
// Richtwerte) als Startpunkt zum Import in den eigenen Katalog. Über den
// Import-Dialog "Standard-Kataloge importieren" in Artikel & Leistungen
// aufrufbar - bereits vorhandene Bezeichnungen werden dabei übersprungen.

const STEUERSATZ = 19;
const GEWERK = 'trockenbau';

function leistung(bezeichnung, einheit, preis) {
  return { typ: 'leistung', bezeichnung, beschreibung: '', einheit, einkaufspreis: 0, aufschlagProzent: 0, preis, steuersatz: STEUERSATZ, gewerk: GEWERK };
}

function artikel(bezeichnung, einheit, einkaufspreis, aufschlagProzent = 30) {
  const preis = Math.round(einkaufspreis * (1 + aufschlagProzent / 100) * 100) / 100;
  return { typ: 'artikel', bezeichnung, beschreibung: '', einheit, einkaufspreis, aufschlagProzent, preis, steuersatz: STEUERSATZ, gewerk: GEWERK };
}

export const STANDARD_KATALOG_TROCKENBAU = [
  // --- Leistungen: Arbeitszeit ---
  leistung('Facharbeiterstunde Trockenbau', 'Std.', 46),
  leistung('Helferstunde Trockenbau', 'Std.', 34),

  // --- Leistungen: Wände ---
  leistung('Metallständerwand aufstellen, einfach beplankt', 'm²', 35),
  leistung('Metallständerwand aufstellen, doppelt beplankt (Schallschutz)', 'm²', 48),
  leistung('Vorsatzschale montieren', 'm²', 30),
  leistung('Trockenputz aufbringen (Gipskartonplatten direkt auf Mauerwerk geklebt)', 'm²', 28),
  leistung('Feuerschutzwand F30/F90 (Aufpreis je m²)', 'm²', 15),
  leistung('Tür-/Fensteröffnung in Ständerwand einbauen', 'Stk.', 85),
  leistung('Revisionsklappe einbauen', 'Stk.', 45),

  // --- Leistungen: Decken ---
  leistung('Abgehängte Decke montieren, einfach beplankt', 'm²', 32),
  leistung('Rasterdecke montieren', 'm²', 28),
  leistung('Dämmung einbringen (Mineralwolle)', 'm²', 8),

  // --- Leistungen: Oberflächen ---
  leistung('Verspachteln Q2 (Standard)', 'm²', 6),
  leistung('Verspachteln Q3 (streiflichtfrei)', 'm²', 10),
  leistung('Eckschutzschiene montieren', 'm', 6),

  // --- Materialien: Platten ---
  artikel('Gipskartonplatte 12,5mm', 'm²', 3.5),
  artikel('Feuerschutzplatte GKF 12,5mm', 'm²', 5.5),
  artikel('Feuchtraumplatte GKBI 12,5mm', 'm²', 5.5),
  artikel('Klebegips für Trockenputz (25kg Sack)', 'Stk.', 12),

  // --- Materialien: Profile & Dämmung ---
  artikel('CW-Profil 75mm (Stange 3m)', 'Stk.', 5),
  artikel('UW-Profil 75mm (Stange 3m)', 'Stk.', 5),
  artikel('CD-Profil Deckenschiene (Stange 3m)', 'Stk.', 4),
  artikel('Mineralwolldämmung 100mm (je m²)', 'm²', 3.8),

  // --- Materialien: Verarbeitung ---
  artikel('Spachtelmasse (Sack 25kg)', 'Stk.', 14),
  artikel('Bewehrungs-/Fugenband (Rolle 150m)', 'Stk.', 14),
  artikel('Schnellbauschrauben (Packung 1000 Stk.)', 'Stk.', 18),
  artikel('Revisionsklappe (Stk.)', 'Stk.', 22),
  artikel('Eckschutzschiene Metall (Stange 2,5m)', 'Stk.', 6),
];
