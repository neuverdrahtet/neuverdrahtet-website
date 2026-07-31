// Standard-Katalog für das Gewerk Fliesen: übliche Leistungen/Arbeitsschritte
// und Materialien mit marktüblichen Netto-Preisen (Deutschland, Richtwerte)
// als Startpunkt zum Import in den eigenen Katalog. Über den Import-Dialog
// "Standard-Kataloge importieren" in Artikel & Leistungen aufrufbar - bereits
// vorhandene Bezeichnungen werden dabei übersprungen.

const STEUERSATZ = 19;
const GEWERK = 'fliesen';

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

export const STANDARD_KATALOG_FLIESEN = [
  // --- Leistungen: Arbeitszeit ---
  leistung('Facharbeiterstunde Fliesenleger', 'Std.', 52),
  leistung('Helferstunde Fliesenleger', 'Std.', 36),

  // --- Leistungen: Untergrund & Abdichtung ---
  leistung('Untergrund vorbereiten/grundieren', 'm²', 4),
  leistung('Verbundabdichtung im Nassbereich auftragen', 'm²', 20),
  leistung('Dusch-/Wannenanschluss abdichten', 'm', 15),
  leistung('Randentkopplung/Dehnfugenband einbauen', 'm', 8),

  // --- Leistungen: Verlegen ---
  leistung('Wandfliesen verlegen (Standardformat bis 30x60)', 'm²', 55),
  leistung('Wandfliesen verlegen (Großformat über 60x60)', 'm²', 70),
  leistung('Bodenfliesen verlegen (Standardformat)', 'm²', 50),
  leistung('Bodenfliesen verlegen (Großformat über 60x60)', 'm²', 65),
  leistung('Mosaikfliesen verlegen', 'm²', 80),
  leistung('Naturstein verlegen (Marmor/Schiefer/Travertin)', 'm²', 90),
  leistung('Fliesen auf Fliesen verlegen (Renovierung, ohne Altfliesen-Entfernung)', 'm²', 60),
  leistung('Sockelfliesen verlegen', 'm', 12),
  leistung('Fensterbank fliesen', 'Stk.', 55),
  leistung('Treppenstufen fliesen (je Stufe)', 'Stk.', 45),
  leistung('Bordüre/Dekorstreifen verlegen', 'm', 15),
  leistung('Fliesenspiegel Küche verlegen (Pauschal bis 6m²)', 'pauschal', 380),
  leistung('Fliesenzuschnitt Sonderform/Aussparung', 'Stk.', 12),

  // --- Leistungen: Fugen & Abschluss ---
  leistung('Fugen verfugen', 'm²', 8),
  leistung('Silikon-/Anschlussfugen ziehen', 'm', 6),

  // --- Materialien: Kleber & Untergrund ---
  ...materialGruppe('Kleber & Untergrund', [
    artikel('Flexkleber Fliesenkleber (25kg Sack)', 'Stk.', 17),
    artikel('Fliesenkleber flexibel für Fliese-auf-Fliese (25kg Sack)', 'Stk.', 19),
    artikel('Dichtschlämme/Verbundabdichtung (Eimer 5kg)', 'Stk.', 42),
    artikel('Dichtband/Dichtmanschetten-Set', 'Stk.', 26),
    artikel('Randentkopplungsband (Rolle 10m)', 'Stk.', 22),
    artikel('Grundierung Haftgrund Fliesen (5L Kanister)', 'Stk.', 30),
    artikel('Mapei Keraflex Maxi S1 Flexkleber (25kg Sack)', 'Stk.', 18),
    artikel('Schlüter-DITRA Entkopplungs-/Trennmatte (je m²)', 'm²', 11.4),
  ]),

  // --- Materialien: Fliesen ---
  ...materialGruppe('Fliesen', [
    artikel('Bodenfliese Feinsteinzeug Standard 30x60', 'm²', 22),
    artikel('Wandfliese Standard 25x40', 'm²', 18),
    artikel('Feinsteinzeug Großformat 60x60', 'm²', 34),
    artikel('Mosaikfliesen (Matte, ca. 30x30cm)', 'Stk.', 12),
    artikel('Natursteinfliese (Marmor/Travertin, Standard)', 'm²', 70),
    artikel('Sockelfliese passend', 'm', 6),
    artikel('Villeroy & Boch Feinsteinzeug Bodenfliese Betonoptik (je m²)', 'm²', 20),
    artikel('Villeroy & Boch Wandfliese Metro Flair (je m²)', 'm²', 19),
    artikel('RAK Ceramics Feinsteinzeug Großformat (bis 120x180cm, je m²)', 'm²', 45),
  ]),

  // --- Materialien: Fugen & Sonstiges ---
  ...materialGruppe('Fugen & Sonstiges', [
    artikel('Fugenmörtel (5kg Eimer)', 'Stk.', 14),
    artikel('Silikon Sanitär (Kartusche)', 'Stk.', 8),
    artikel('Nivelliersystem/Kreuzfugenkeile (Set 100 Stk.)', 'Stk.', 15),
    artikel('Mapei Ultracolor Plus Fugenmörtel (25kg Sack)', 'Stk.', 17),
    artikel('Mapei Kerapoxy Design Reaktionsharzfuge (2kg Set)', 'Stk.', 38),
  ]),

  // --- Materialien: Abdichtung & Profile (Schlüter-Systems) ---
  ...materialGruppe('Abdichtung & Profile (Schlüter-Systems)', [
    artikel('Schlüter-KERDI 200 Abdichtungsbahn (Rolle)', 'Stk.', 68.2),
    artikel('Schlüter-KERDI-KEBA Dichtband (je m)', 'm', 1.7),
    artikel('Schlüter-JOLLY Fliesenabschlussprofil Alu (Stange 2,5m)', 'Stk.', 8),
    artikel('Schlüter-KERDI-LINE Duschrinne Edelstahl (900mm)', 'Stk.', 155),
  ]),
];
