// Standard-Katalog für Elektro-Handwerksbetriebe: übliche Leistungen/Arbeits-
// schritte und Materialien mit marktüblichen Netto-Preisen (Deutschland,
// Richtwerte) als Startpunkt zum Import in den eigenen Katalog. Über den
// Button "Standard-Katalog (Elektro) importieren" in Artikel & Leistungen
// aufrufbar - bereits vorhandene Bezeichnungen werden dabei übersprungen.
// Materialien sind zusätzlich mit einer Unterkategorie (z.B. "Kabel &
// Leitungen", "Sicherungsautomaten", "Zählerschränke & Unterverteilung")
// versehen, über die sich die Katalog-Auswahl in Projekt-Akte, Angeboten
// und Rechnungen zusätzlich zum Gewerk feiner filtern lässt.

const STEUERSATZ = 19;
const GEWERK = 'elektro';

function leistung(bezeichnung, einheit, preis) {
  return { typ: 'leistung', bezeichnung, beschreibung: '', einheit, einkaufspreis: 0, aufschlagProzent: 0, preis, steuersatz: STEUERSATZ, gewerk: GEWERK };
}

function artikel(bezeichnung, einheit, einkaufspreis, aufschlagProzent = 30) {
  const preis = Math.round(einkaufspreis * (1 + aufschlagProzent / 100) * 100) / 100;
  return { typ: 'artikel', bezeichnung, beschreibung: '', einheit, einkaufspreis, aufschlagProzent, preis, steuersatz: STEUERSATZ, gewerk: GEWERK };
}

// Ordnet einer Gruppe von Materialien eine gemeinsame Unterkategorie zu.
function materialGruppe(unterkategorie, items) {
  return items.map((item) => ({ ...item, unterkategorie }));
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
  leistung('FI/LS-Kombiautomat (RCBO) einbauen', 'Stk.', 30),
  leistung('Verteilung komplett verdrahten und anschließen (je Modul)', 'Stk.', 12),
  leistung('Verteilung beschriften und Stromlaufplan erstellen', 'pauschal', 60),
  leistung('Zählerschrank-Austausch (Basis)', 'pauschal', 450),
  leistung('Zählerschrank komplett erneuern nach TAB (Multi-Zähler, ab 2 Zählerplätzen)', 'pauschal', 850),
  leistung('Zählerplatz nachrüsten/erweitern (je Platz)', 'Stk.', 220),
  leistung('SLS-Schalter einbauen (nach Vorgabe Netzbetreiber)', 'Stk.', 45),
  leistung('Überspannungsschutz Typ 1/2 einbauen', 'Stk.', 65),
  leistung('Hauptschalter/Trennschalter einbauen', 'Stk.', 35),
  leistung('Anmeldung/Abstimmung mit Netzbetreiber (VNB)', 'pauschal', 45),

  // --- Leistungen: Prüfungen & Sicherheit ---
  leistung('Rauchmelder montieren (inkl. Funktionstest)', 'Stk.', 20),
  leistung('E-Check Wohnung/kleines Objekt (DIN VDE 0105)', 'pauschal', 140),
  leistung('Wiederkehrende Prüfung DGUV V3 (bis 20 Geräte)', 'pauschal', 160),
  leistung('UVV-Prüfung', 'pauschal', 150),
  leistung('Blitzschutzprüfung', 'pauschal', 180),

  // --- Leistungen: Blitzschutz & Erdung ---
  leistung('Blitzschutz-Fangeinrichtung montieren (je m Dachfirst)', 'm', 35),
  leistung('Blitzschutz-Ableitung montieren (je Fallrohr)', 'Stk.', 180),
  leistung('Blitzschutzerdung/Fundamenterder anschließen', 'pauschal', 450),
  leistung('Innerer Blitzschutz komplett einbauen (Typ 1+2+3, Kombi-Ableiter)', 'pauschal', 380),
  leistung('Potentialausgleichsschiene montieren und anschließen', 'Stk.', 85),
  leistung('Potentialausgleich herstellen (je Anschluss, Rohrleitung/Metallteil)', 'Stk.', 25),

  // --- Leistungen: Sicherheitsbeleuchtung & Rettungswege ---
  leistung('Sicherheitsleuchte/Notleuchte montieren und anschließen', 'Stk.', 65),
  leistung('Rettungswegkennzeichnung (Piktogrammleuchte) montieren', 'Stk.', 55),
  leistung('Zentralbatterieanlage-Stromkreis einbinden', 'Stk.', 120),
  leistung('Funktionstest/Wartung Sicherheitsbeleuchtung (jährlich)', 'pauschal', 140),

  // --- Leistungen: Gebäudeautomation (KNX/Smart Home) ---
  leistung('KNX-Busleitung verlegen', 'm', 3.5),
  leistung('KNX-Aktor/Sensor einbauen und programmieren', 'Stk.', 85),
  leistung('KNX-Visualisierung/Zentrale einrichten', 'pauschal', 450),

  // --- Leistungen: Sicherheitstechnik (Alarm/Video) ---
  leistung('Einbruchmeldeanlage Grundinstallation (je Melder)', 'Stk.', 90),
  leistung('Bewegungsmelder Einbruchmeldeanlage einbauen', 'Stk.', 60),
  leistung('Videoüberwachungskamera montieren und anschließen', 'Stk.', 120),
  leistung('Videorekorder/NVR einrichten und in Betrieb nehmen', 'pauschal', 180),

  // --- Leistungen: Smart Home, Netzwerk, E-Mobility ---
  leistung('Smart-Home-Grundinstallation (je Raum)', 'Stk.', 120),
  leistung('Wallbox Montage und Anschluss (bis 11kW)', 'pauschal', 380),
  leistung('Wallbox Montage und Anschluss (11-22kW, dreiphasig)', 'pauschal', 480),
  leistung('Zuleitung Wallbox verlegen (Erdkabel, bis 15m)', 'pauschal', 320),
  leistung('FI Typ B nachrüsten (Pflicht für Wallbox-Ladepunkte)', 'Stk.', 95),
  leistung('Lastmanagement/dynamische Lastregelung einrichten', 'pauschal', 180),
  leistung('Wallbox beim Netzbetreiber anmelden', 'pauschal', 40),
  leistung('Netzwerkdose setzen und anschließen', 'Stk.', 55),
  leistung('Antennendose setzen und anschließen', 'Stk.', 45),
  leistung('Klingelanlage/Gegensprechanlage installieren (Basis)', 'pauschal', 250),

  // --- Leistungen: Photovoltaik ---
  leistung('PV-Anlage Aufdachmontage (je kWp)', 'kWp', 650),
  leistung('PV-Modul montieren und verkabeln (je Stk.)', 'Stk.', 45),
  leistung('Wechselrichter montieren und anschließen', 'Stk.', 280),
  leistung('DC-/AC-Verkabelung PV-Anlage verlegen', 'm', 6),
  leistung('Einspeise-/Zweirichtungszähler einbauen', 'Stk.', 180),
  leistung('Batteriespeicher montieren und anschließen', 'pauschal', 650),
  leistung('Blitz-/Überspannungsschutz PV-Anlage (DC-seitig) einbauen', 'Stk.', 120),
  leistung('PV-Anlage in Betrieb nehmen und beim Netzbetreiber anmelden', 'pauschal', 220),

  // --- Leistungen: Wärmepumpe (Elektroanschluss) ---
  leistung('Wärmepumpe elektrisch anschließen (Starkstromanschluss)', 'pauschal', 380),
  leistung('Steuerleitung Wärmepumpe verlegen (Innen-/Außeneinheit)', 'm', 8),
  leistung('Sperrzeiten-/Wärmepumpenzähler einbauen', 'Stk.', 150),
  leistung('FI Typ B für Wärmepumpe einbauen', 'Stk.', 65),

  // --- Leistungen: Küche/Hausgeräte ---
  leistung('Herdanschluss (Starkstromdose) setzen', 'Stk.', 65),
  leistung('Backofen/Kochfeld-Anschluss fest verdrahtet', 'Stk.', 55),
  leistung('Waschmaschinen-/Trockneranschluss (Steckdose)', 'Stk.', 35),

  // --- Leistungen: Sonstiges ---
  leistung('Entsorgung Altmaterial/Verpackung (je Einsatz)', 'pauschal', 15),

  // --- Materialien: Steckdosen & Schalter ---
  ...materialGruppe('Steckdosen & Schalter', [
    artikel('Steckdose UP, Serie Standard, weiß', 'Stk.', 4),
    artikel('Schalter UP, Serie Standard (Aus/Wechsel), weiß', 'Stk.', 4),
    artikel('Steckdose UP, Serie gehoben (Design)', 'Stk.', 12),
    artikel('Feuchtraum-Steckdose IP44', 'Stk.', 9),
    artikel('Rahmen UP, 1-fach', 'Stk.', 2.5),
    artikel('Rahmen UP, 2-fach', 'Stk.', 4),
    artikel('Rahmen UP, 3-fach', 'Stk.', 5.5),
    artikel('Wechselschalter UP, Serie Standard, weiß', 'Stk.', 4),
    artikel('Serienschalter UP, Serie Standard, weiß', 'Stk.', 5),
    artikel('Kreuzschalter UP, Serie Standard, weiß', 'Stk.', 6),
    artikel('Taster UP (Treppenlicht/Klingel), Serie Standard, weiß', 'Stk.', 4.5),
    artikel('Dimmer-Einsatz UP, Universal-LED, weiß', 'Stk.', 22),
    artikel('Jalousie-/Rollladenschalter UP, weiß', 'Stk.', 16),
    artikel('Bewegungsmelder-Schalter UP', 'Stk.', 28),
    artikel('Steckdose AP mit Klappdeckel, IP44', 'Stk.', 10),
    artikel('Steckdose UP 2-fach, weiß', 'Stk.', 7),
    artikel('USB-Steckdose UP, Lade A+C, weiß', 'Stk.', 25),
    artikel('CEE-Steckdose 16A, 5-polig, rot (Drehstrom, AP)', 'Stk.', 22),
    artikel('CEE-Steckdose 32A, 5-polig, rot (Drehstrom, AP)', 'Stk.', 38),
  ]),

  // --- Materialien: Befestigung & Kleinmaterial ---
  ...materialGruppe('Befestigung & Kleinmaterial', [
    artikel('Drehstiftdübel 6x40mm (Packung 100 Stk.)', 'Stk.', 6),
    artikel('Spreizdübel Nylon 8x40mm (Packung 100 Stk.)', 'Stk.', 8),
    artikel('Metall-/Rahmendübel 8x60mm (Packung 50 Stk.)', 'Stk.', 14),
    artikel('Universalschrauben 4x40mm, Senkkopf (Packung 200 Stk.)', 'Stk.', 9),
    artikel('Unterputzdose (Schalterdose), Tiefe 45mm', 'Stk.', 0.6),
    artikel('Kombi-Unterputzdose 2-fach', 'Stk.', 1.4),
    artikel('Aufputz-Abzweigdose IP54', 'Stk.', 3.5),
    artikel('Kabelbinder 200mm, UV-beständig (Packung 100 Stk.)', 'Stk.', 5),
    artikel('Kabelschelle/Bügelschelle bis 10mm (Packung 25 Stk.)', 'Stk.', 6),
    artikel('Rohrschelle für Installationsrohr M20 (Packung 25 Stk.)', 'Stk.', 7),
  ]),

  // --- Materialien: Kabel & Leitungen ---
  ...materialGruppe('Kabel & Leitungen', [
    artikel('NYM-J 3x1,5mm² Kabel', 'm', 0.9),
    artikel('NYM-J 3x2,5mm² Kabel', 'm', 1.2),
    artikel('NYM-J 3x4mm² Kabel', 'm', 1.8),
    artikel('NYM-J 5x1,5mm² Kabel', 'm', 1.7),
    artikel('NYM-J 5x2,5mm² Kabel', 'm', 2.2),
    artikel('NYM-J 5x4mm² Kabel', 'm', 3.2),
    artikel('NYM-J 5x6mm² Kabel (Starkstrom)', 'm', 5.5),
    artikel('NYM-J 5x10mm² Kabel (Starkstrom/Herd)', 'm', 7.5),
    artikel('NYY-J 3x1,5mm² Erdkabel', 'm', 0.95),
    artikel('NYY-J 3x2,5mm² Erdkabel', 'm', 1.6),
    artikel('NYY-J 5x2,5mm² Erdkabel', 'm', 2.4),
    artikel('NYY-J 5x6mm² Erdkabel', 'm', 4.5),
    artikel('NYY-J 5x10mm² Erdkabel', 'm', 9.5),
    artikel('H07V-U 1,5mm² Aderleitung, starr (Leerrohr)', 'm', 0.25),
    artikel('H07V-K 1,5mm² Aderleitung, flexibel (Leerrohr)', 'm', 0.3),
    artikel('YSLY-JZ 5x1,5mm² Steuerleitung', 'm', 2.2),
    artikel('J-Y(ST)Y 2x2x0,8 Fernmelde-/Busleitung', 'm', 0.55),
    artikel('Netzwerkkabel Cat7 (Verlegekabel, Meterware)', 'm', 1.1),
    artikel('Koaxialkabel SAT/Antenne (Meterware)', 'm', 0.6),
    artikel('Installationsrohr M20 (Leerrohr)', 'm', 0.6),
    artikel('Kabelkanal 40x20mm (2m Stange)', 'Stk.', 5),
  ]),

  // --- Materialien: Sicherungsautomaten ---
  ...materialGruppe('Sicherungsautomaten', [
    artikel('Leitungsschutzschalter (LS) B16, 1-polig', 'Stk.', 9),
    artikel('Leitungsschutzschalter (LS) B16, 3-polig', 'Stk.', 28),
    artikel('Hager MBN116 LS-Schalter B16, 1-polig, 6kA', 'Stk.', 2.8),
    artikel('Hager MBN316 LS-Schalter B16, 3-polig, 6kA', 'Stk.', 22),
    artikel('Hager NBN116 LS-Schalter B16, 1-polig, 10kA', 'Stk.', 5.5),
    artikel('ABB S201-B16 LS-Schalter B16, 1-polig, 6kA', 'Stk.', 3.8),
    artikel('ABB S203-C32 LS-Schalter C32, 3-polig, 10kA (Motoren/induktive Lasten)', 'Stk.', 24),
    artikel('FI/RCD-Schutzschalter 25A/30mA, 2-polig', 'Stk.', 32),
    artikel('FI/RCD-Schutzschalter 40A/30mA, 4-polig', 'Stk.', 65),
    artikel('ABB F202A-25/0,03 FI-Schalter Typ A, 2-polig, 25A/30mA', 'Stk.', 23),
    artikel('ABB F204A-25/0,03 FI-Schalter Typ A, 4-polig, 25A/30mA', 'Stk.', 40),
    artikel('FI/LS-Kombiautomat (RCBO) B16/30mA, 1+N-polig', 'Stk.', 45),
    artikel('FI-Schutzschalter Typ B, 4-polig (für Wallbox/PV/Wärmepumpe)', 'Stk.', 220),
    artikel('SLS-Schalter 3x63A (nach Vorgabe Netzbetreiber)', 'Stk.', 85),
    artikel('Überspannungsschutz Kombi-Ableiter Typ 1/2, 3-polig', 'Stk.', 180),
    artikel('Hauptschalter/Trennschalter 3-polig, 63A', 'Stk.', 35),
  ]),

  // --- Materialien: Zählerschränke & Unterverteilung ---
  ...materialGruppe('Zählerschränke & Unterverteilung', [
    artikel('Unterverteilung Aufputz (12 Module)', 'Stk.', 55),
    artikel('Unterverteilung Aufputz (24 Module)', 'Stk.', 75),
    artikel('Unterverteilung Unterputz (24 Module)', 'Stk.', 95),
    artikel('Unterverteilung Unterputz (36 Module)', 'Stk.', 125),
    artikel('Hager Volta VU48NC Kleinverteiler UP, 48 Module', 'Stk.', 58.8),
    artikel('Hager Volta VA60CN Kleinverteiler AP, 60 Module', 'Stk.', 86.55),
    artikel('Zählerschrank-Grundgerüst (1 Zähler)', 'Stk.', 180),
    artikel('Zählerschrank-Grundgerüst (2 Zähler)', 'Stk.', 260),
    artikel('Zählerschrank-Grundgerüst (3 Zähler)', 'Stk.', 340),
    artikel('ABB Zählerverteilerfeld nach TAB (Erweiterungsfeld)', 'Stk.', 230),
    artikel('Sammelschiene (Meterware)', 'm', 3),
    artikel('Reihenklemmen-Set (Sortimentsbox)', 'Stk.', 12),
    artikel('Hutschiene TS35 (1m)', 'Stk.', 3.5),
    artikel('Aderendhülsen (Sortimentsbox)', 'Stk.', 15),
    artikel('Klemmen/Verbinder (Wago-Typ, Packung)', 'Stk.', 6),
  ]),

  // --- Materialien: Blitzschutz & Erdung ---
  ...materialGruppe('Blitzschutz & Erdung', [
    artikel('Fangstange/Fangleitung (Meterware)', 'm', 8),
    artikel('Blitzableiter-Ableitung (Set je Fallrohr)', 'Stk.', 65),
    artikel('Fundamenterder-Anschlussfahne', 'Stk.', 25),
    artikel('Potentialausgleichsschiene (PAS)', 'Stk.', 35),
    artikel('Erdungsleitung 16mm² (Meterware)', 'm', 2.5),
  ]),

  // --- Materialien: Sicherheitsbeleuchtung ---
  ...materialGruppe('Sicherheitsbeleuchtung', [
    artikel('Sicherheitsleuchte LED, Einzelbatterie', 'Stk.', 65),
    artikel('Rettungswegleuchte/Piktogramm, Einzelbatterie', 'Stk.', 55),
  ]),

  // --- Materialien: Gebäudeautomation (KNX) ---
  ...materialGruppe('Gebäudeautomation (KNX)', [
    artikel('KNX-Busleitung (Meterware)', 'm', 1.1),
    artikel('KNX-Schaltaktor, 4-fach', 'Stk.', 120),
    artikel('KNX-Taster/Bedienelement', 'Stk.', 85),
  ]),

  // --- Materialien: Sicherheitstechnik (Alarm/Video) ---
  ...materialGruppe('Sicherheitstechnik (Alarm/Video)', [
    artikel('Bewegungsmelder Einbruchmeldeanlage', 'Stk.', 45),
    artikel('Überwachungskamera IP, Außenbereich', 'Stk.', 140),
    artikel('Netzwerk-Videorekorder (NVR, 8-Kanal)', 'Stk.', 280),
  ]),

  // --- Materialien: Beleuchtung ---
  ...materialGruppe('Beleuchtung', [
    artikel('LED-Deckenleuchte einfach (rund, 24W)', 'Stk.', 22),
    artikel('LED-Panel 62x62cm', 'Stk.', 35),
    artikel('Außenwandleuchte IP44', 'Stk.', 28),
    artikel('Bewegungsmelder Aufputz 180°', 'Stk.', 18),
  ]),

  // --- Materialien: Rauchmelder & Brandschutz ---
  ...materialGruppe('Rauchmelder & Brandschutz', [
    artikel('Rauchmelder (DIN 14676, 10 Jahre Batterie)', 'Stk.', 14),
  ]),

  // --- Materialien: Kommunikation & Netzwerk ---
  ...materialGruppe('Kommunikation & Netzwerk', [
    artikel('Netzwerkdose Cat6 UP', 'Stk.', 8),
    artikel('Antennendose UP (Kombi Sat/TV)', 'Stk.', 9),
    artikel('Klingeltrafo/Gegensprechanlage-Set (Basis)', 'Stk.', 90),
  ]),

  // --- Materialien: Wallbox/E-Mobility ---
  ...materialGruppe('Wallbox/E-Mobility', [
    artikel('Wallbox 11kW (Basisgerät)', 'Stk.', 550, 20),
    artikel('Wallbox 22kW (Basisgerät, dreiphasig)', 'Stk.', 750, 20),
    artikel('Erdkabel NYY-J 5x6mm² (Wallbox-/Außenzuleitung)', 'm', 4.5),
  ]),

  // --- Materialien: Photovoltaik ---
  ...materialGruppe('Photovoltaik', [
    artikel('PV-Modul monokristallin, ca. 400Wp', 'Stk.', 140),
    artikel('Wechselrichter Hybrid, bis 10kW', 'Stk.', 1400, 20),
    artikel('Batteriespeicher 5kWh', 'Stk.', 2800, 20),
    artikel('Solarkabel 6mm² (Meterware)', 'm', 1.2),
    artikel('MC4-Steckverbinder-Set', 'Stk.', 8),
    artikel('Unterkonstruktion Aufdach (je Modul)', 'Stk.', 25),
    artikel('DC-Freischalter/Trennschalter PV', 'Stk.', 65),
    artikel('Einspeise-/Zweirichtungszähler', 'Stk.', 140),
  ]),

  // --- Materialien: Wärmepumpe ---
  ...materialGruppe('Wärmepumpe', [
    artikel('Zuleitung Wärmepumpe NYY-J 5x6mm² (Erdkabel)', 'm', 4.5),
    artikel('Sperrzeiten-/Wärmepumpenzähler', 'Stk.', 130),
    artikel('Vaillant aroTHERM plus VWL 75/6 A Luft-Wasser-Wärmepumpe (Außeneinheit)', 'Stk.', 9700),
    artikel('Stiebel Eltron WPL 10 A Kompakt-Wärmepumpe (Luft-Wasser)', 'Stk.', 7150),
    artikel('Viessmann Vitocal 250-A Monoblock Luft-Wasser-Wärmepumpe', 'Stk.', 7560),
  ]),

  // --- Materialien: Hausgeräte-Anschluss ---
  ...materialGruppe('Hausgeräte-Anschluss', [
    artikel('Herdanschlussdose (Starkstrom CEE)', 'Stk.', 14),
  ]),
];
