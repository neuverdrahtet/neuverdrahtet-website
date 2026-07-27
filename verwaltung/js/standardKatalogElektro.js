// Standard-Katalog für Elektro-Handwerksbetriebe: übliche Leistungen/Arbeits-
// schritte und Materialien mit marktüblichen Netto-Preisen (Deutschland,
// Richtwerte) als Startpunkt zum Import in den eigenen Katalog. Über den
// Button "Standard-Katalog (Elektro) importieren" in Artikel & Leistungen
// aufrufbar - bereits vorhandene Bezeichnungen werden dabei übersprungen.

const STEUERSATZ = 19;

function leistung(bezeichnung, einheit, preis) {
  return { typ: 'leistung', bezeichnung, beschreibung: '', einheit, einkaufspreis: 0, aufschlagProzent: 0, preis, steuersatz: STEUERSATZ };
}

function artikel(bezeichnung, einheit, einkaufspreis, aufschlagProzent = 30) {
  const preis = Math.round(einkaufspreis * (1 + aufschlagProzent / 100) * 100) / 100;
  return { typ: 'artikel', bezeichnung, beschreibung: '', einheit, einkaufspreis, aufschlagProzent, preis, steuersatz: STEUERSATZ };
}

export const STANDARD_KATALOG_ELEKTRO = [
  // --- Leistungen: Arbeitszeit ---
  leistung('Facharbeiterstunde Elektroinstallation', 'Std.', 75),
  leistung('Hilfsarbeiterstunde / Auszubildender', 'Std.', 42),
  leistung('Anfahrt/Fahrzeit (Nahbereich, pauschal)', 'pauschal', 35),

  // --- Leistungen: Steckdosen, Schalter, Kabel ---
  leistung('Steckdose UP setzen/anschließen (Bestand)', 'Stk.', 45),
  leistung('Schalter UP setzen/anschließen (Bestand)', 'Stk.', 45),
  leistung('Steckdose/Schalter Rohinstallation (Neubau)', 'Stk.', 28),
  leistung('Feuchtraum-Steckdose setzen/anschließen', 'Stk.', 50),
  leistung('Kabel verlegen, Unterputz (Bestand, inkl. Schlitzen+Verputzen)', 'm', 12),
  leistung('Kabel verlegen, Rohinstallation (Neubau)', 'm', 4),
  leistung('Kabel verlegen, Aufputz mit Kabelkanal', 'm', 8),
  leistung('Wand schlitzen (nur Schlitz, ohne Kabel)', 'm', 8),
  leistung('Schlitz verschließen/verputzen', 'm', 6),

  // --- Leistungen: Beleuchtung ---
  leistung('Leuchte montieren und anschließen (einfach)', 'Stk.', 35),
  leistung('Leuchte montieren und anschließen (Deckenauslass/schwer)', 'Stk.', 55),
  leistung('Deckenauslass setzen', 'Stk.', 40),
  leistung('Außenleuchte montieren und anschließen', 'Stk.', 45),
  leistung('Bewegungsmelder montieren und anschließen', 'Stk.', 40),

  // --- Leistungen: Verteilung & Absicherung ---
  leistung('Unterverteilung Austausch/Erneuerung (bis 12 Module)', 'pauschal', 380),
  leistung('Unterverteilung erweitern (je Modul)', 'Stk.', 45),
  leistung('Leitungsschutzschalter (LS) einbauen', 'Stk.', 25),
  leistung('FI/RCD-Schutzschalter einbauen', 'Stk.', 35),
  leistung('Zählerschrank-Austausch (Basis)', 'pauschal', 450),

  // --- Leistungen: Prüfungen & Sicherheit ---
  leistung('Rauchmelder montieren (inkl. Funktionstest)', 'Stk.', 20),
  leistung('E-Check Wohnung/kleines Objekt (DIN VDE 0105)', 'pauschal', 140),
  leistung('Wiederkehrende Prüfung DGUV V3 (bis 20 Geräte)', 'pauschal', 160),
  leistung('UVV-Prüfung', 'pauschal', 150),
  leistung('Blitzschutzprüfung', 'pauschal', 180),

  // --- Leistungen: Smart Home, Netzwerk, E-Mobility ---
  leistung('Smart-Home-Grundinstallation (je Raum)', 'Stk.', 120),
  leistung('Wallbox Montage und Anschluss (bis 11kW)', 'pauschal', 380),
  leistung('Netzwerkdose setzen und anschließen', 'Stk.', 55),
  leistung('Antennendose setzen und anschließen', 'Stk.', 45),
  leistung('Klingelanlage/Gegensprechanlage installieren (Basis)', 'pauschal', 250),

  // --- Leistungen: Küche/Hausgeräte ---
  leistung('Herdanschluss (Starkstromdose) setzen', 'Stk.', 65),
  leistung('Backofen/Kochfeld-Anschluss fest verdrahtet', 'Stk.', 55),
  leistung('Waschmaschinen-/Trockneranschluss (Steckdose)', 'Stk.', 35),

  // --- Leistungen: Sonstiges ---
  leistung('Entsorgung Altmaterial/Verpackung (je Einsatz)', 'pauschal', 15),

  // --- Materialien: Steckdosen & Schalter ---
  artikel('Steckdose UP, Serie Standard, weiß', 'Stk.', 4),
  artikel('Schalter UP, Serie Standard (Aus/Wechsel), weiß', 'Stk.', 4),
  artikel('Steckdose UP, Serie gehoben (Design)', 'Stk.', 12),
  artikel('Feuchtraum-Steckdose IP44', 'Stk.', 9),
  artikel('Rahmen UP, 1-fach', 'Stk.', 2.5),
  artikel('Rahmen UP, 2-fach', 'Stk.', 4),
  artikel('Rahmen UP, 3-fach', 'Stk.', 5.5),

  // --- Materialien: Kabel & Leerrohr ---
  artikel('NYM-J 3x1,5mm² Kabel', 'm', 0.9),
  artikel('NYM-J 3x2,5mm² Kabel', 'm', 1.2),
  artikel('NYM-J 5x1,5mm² Kabel', 'm', 1.7),
  artikel('NYM-J 5x2,5mm² Kabel', 'm', 2.2),
  artikel('NYM-J 5x6mm² Kabel (Starkstrom)', 'm', 5.5),
  artikel('Installationsrohr M20 (Leerrohr)', 'm', 0.6),
  artikel('Kabelkanal 40x20mm (2m Stange)', 'Stk.', 5),

  // --- Materialien: Verteilung & Absicherung ---
  artikel('Leitungsschutzschalter (LS) B16, 1-polig', 'Stk.', 9),
  artikel('Leitungsschutzschalter (LS) B16, 3-polig', 'Stk.', 28),
  artikel('FI/RCD-Schutzschalter 25A/30mA, 2-polig', 'Stk.', 32),
  artikel('FI/RCD-Schutzschalter 40A/30mA, 4-polig', 'Stk.', 65),
  artikel('Unterverteilung Aufputz (12 Module)', 'Stk.', 55),
  artikel('Unterverteilung Unterputz (24 Module)', 'Stk.', 95),
  artikel('Zählerschrank-Grundgerüst (1 Zähler)', 'Stk.', 180),
  artikel('Klemmen/Verbinder (Wago-Typ, Packung)', 'Stk.', 6),

  // --- Materialien: Beleuchtung ---
  artikel('LED-Deckenleuchte einfach (rund, 24W)', 'Stk.', 22),
  artikel('LED-Panel 62x62cm', 'Stk.', 35),
  artikel('Außenwandleuchte IP44', 'Stk.', 28),
  artikel('Bewegungsmelder Aufputz 180°', 'Stk.', 18),

  // --- Materialien: Sicherheit, Netzwerk, Smart Home, E-Mobility ---
  artikel('Rauchmelder (DIN 14676, 10 Jahre Batterie)', 'Stk.', 14),
  artikel('Netzwerkdose Cat6 UP', 'Stk.', 8),
  artikel('Antennendose UP (Kombi Sat/TV)', 'Stk.', 9),
  artikel('Wallbox 11kW (Basisgerät)', 'Stk.', 550, 20),
  artikel('Klingeltrafo/Gegensprechanlage-Set (Basis)', 'Stk.', 90),

  // --- Materialien: Hausgeräte-Anschluss ---
  artikel('Herdanschlussdose (Starkstrom CEE)', 'Stk.', 14),
];
