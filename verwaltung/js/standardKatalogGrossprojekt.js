// Zusätzliche Positionen für größere Ausschreibungen/Bauvorhaben (Demontage,
// Kabel auf Schellen, Verteilerbau, Musterwohnungen, Zähleranlage, Messungen/
// Prüfungen, Beleuchtung, Brandschutz-Abschottungen, Sprechanlage, Baustelle,
// LWL/Glasfaser) - ergänzt das bestehende Elektro-Leistungsverzeichnis um
// Positionen, die dort noch fehlten.
//
// WICHTIG: Die Preise sind recherchierte Richtwerte (Web-Marktrecherche,
// keine echten Lieferanten-/Einkaufspreise) - für Zähleranlage, Verteilungen,
// Beleuchtung, Sprechanlage und LWL-Technik ausdrücklich als Platzhalter
// gedacht, bis echte Lieferantenangebote vorliegen. Vor einer verbindlichen
// Kalkulation prüfen und anpassen.

const STEUERSATZ = 19;
const GEWERK = 'elektro';

function pos(typ, bezeichnung, einheit, preis, unterkategorie) {
  return { typ, bezeichnung, beschreibung: '', einheit, einkaufspreis: 0, aufschlagProzent: 0, preis, steuersatz: STEUERSATZ, gewerk: GEWERK, unterkategorie };
}

export const STANDARD_KATALOG_GROSSPROJEKT = [
  // --- Demontage ---
  pos('leistung', 'Demontage Unterverteilung', 'Stk.', 120, 'Demontage'),
  pos('leistung', 'Demontage Zählerverteilung', 'Stk.', 150, 'Demontage'),
  pos('leistung', 'Demontage Kabel/Leitung (Bestand)', 'm', 3.5, 'Demontage'),
  pos('leistung', 'Demontage Fernmeldeleitung', 'm', 3, 'Demontage'),
  pos('leistung', 'Demontage Leuchte', 'Stk.', 25, 'Demontage'),
  pos('leistung', 'Demontage Installationsgerät (Schalter/Steckdose)', 'Stk.', 12, 'Demontage'),
  pos('leistung', 'Entsorgung Elektroschrott/Altmaterial', 'Psch.', 180, 'Demontage'),

  // --- Kabel/Leitungen (Großprojekt: NYY auf Schellen, NHXMH, Zubehör) ---
  pos('artikel', 'NYY-J 1x6 mm² Kabel', 'm', 1.2, 'Kabel & Leitungen'),
  pos('artikel', 'NYY-J 1x10 mm² Kabel', 'm', 1.8, 'Kabel & Leitungen'),
  pos('artikel', 'NYY-J 1x16 mm² Kabel', 'm', 2.6, 'Kabel & Leitungen'),
  pos('artikel', 'NYY-J 1x95 mm² Kabel', 'm', 14.5, 'Kabel & Leitungen'),
  pos('leistung', 'Kabel auf Kabelschellen verlegen und befestigen (bis 16 mm²)', 'm', 6.5, 'Kabel & Leitungen'),
  pos('leistung', 'Kabel auf Kabelschellen verlegen und befestigen (25–95 mm²)', 'm', 9.5, 'Kabel & Leitungen'),
  pos('artikel', 'Potentialausgleichsbrücke', 'Stk.', 12, 'Kabel & Leitungen'),
  pos('artikel', 'NHXMH-J 3x1,5 mm² Kabel (halogenfrei, funktionserhaltend)', 'm', 3.2, 'Kabel & Leitungen'),
  pos('artikel', 'NHXMH-J 5x1,5 mm² Kabel (halogenfrei, funktionserhaltend)', 'm', 4.8, 'Kabel & Leitungen'),
  pos('leistung', 'Kabelendverschluss/Kabelanschluss herstellen', 'Stk.', 22, 'Kabel & Leitungen'),

  // --- Installationsgeräte & Verteilerzubehör (Großprojekt) ---
  pos('artikel', 'Schütz Reiheneinbau (bis 25A)', 'Stk.', 45, 'Sicherungsautomaten'),
  pos('artikel', 'Stromstoßschalter', 'Stk.', 38, 'Sicherungsautomaten'),
  pos('artikel', 'Verteilergehäuse leer (Auf-/Unterputz)', 'Stk.', 85, 'Zählerschränke & Unterverteilung'),
  pos('artikel', 'Sammelschiene für Verteiler', 'Stk.', 18, 'Zählerschränke & Unterverteilung'),
  pos('leistung', 'Verdrahtung Verteiler (je Reiheneinbaugerät)', 'Stk.', 15, 'Zählerschränke & Unterverteilung'),
  pos('leistung', 'Beschriftung Verteiler/Stromkreise', 'Psch.', 45, 'Zählerschränke & Unterverteilung'),

  // --- Musterwohnung / Wohnungsinstallation komplett ---
  // Grobe Richtwerte auf Basis marktüblicher Elektroinstallations-Komplett-
  // preise (ca. 80–200 €/m² je nach Ausstattung) - MÜSSEN an die tatsächliche
  // Wohnungsgröße/den Ausstattungsumfang von Typ A/B/C angepasst werden.
  pos('leistung', 'Komplettpreis Elektroinstallation Wohnung Typ A (inkl. UV, Geräte, Kabel, Schlitze/Dosen, Anschlüsse, Messung, Glasfaser-HA)', 'Psch.', 8500, 'Musterwohnung / Wohnungsinstallation'),
  pos('leistung', 'Komplettpreis Elektroinstallation Wohnung Typ B (inkl. UV, Geräte, Kabel, Schlitze/Dosen, Anschlüsse, Messung, Glasfaser-HA)', 'Psch.', 9800, 'Musterwohnung / Wohnungsinstallation'),
  pos('leistung', 'Komplettpreis Elektroinstallation Wohnung Typ C (inkl. UV, Geräte, Kabel, Schlitze/Dosen, Anschlüsse, Messung, Glasfaser-HA, LS-Schalter, Projektierung)', 'Psch.', 7200, 'Musterwohnung / Wohnungsinstallation'),

  // --- Verteilungen (Großprojekt) ---
  pos('leistung', 'Unterverteiler/Standverteiler komplett montiert und angeschlossen (bis 24 TE)', 'Psch.', 650, 'Verteilungen'),
  pos('leistung', 'Unterverteiler/Standverteiler komplett montiert und angeschlossen (25–48 TE)', 'Psch.', 1100, 'Verteilungen'),
  pos('leistung', 'Projektierung/Dokumentation (Schaltpläne, Stromlaufpläne, Stücklisten)', 'Std.', 75, 'Verteilungen'),
  pos('artikel', 'LSA-Verteilerkasten inkl. Technik', 'Stk.', 65, 'Verteilungen'),

  // --- Zähleranlage (Richtwert - für eine echte Kalkulation Lieferantenangebot einholen) ---
  pos('leistung', 'Zählerschrank/Zähleranlage komplett je Zählerplatz (Zählerfeld, SLS, APZ, SPD, Verdrahtung, Anschluss, Beschriftung)', 'Stk.', 950, 'Zählerschränke & Unterverteilung'),

  // --- Messungen/Prüfungen ---
  pos('leistung', 'Isolationsmessung je Stromkreis', 'Stk.', 8, 'Elektroinstallation'),
  pos('leistung', 'Schleifen-/Netzimpedanzmessung je Stromkreis', 'Stk.', 8, 'Elektroinstallation'),
  pos('leistung', 'RCD-Prüfung je FI-Schutzschalter', 'Stk.', 12, 'Elektroinstallation'),
  pos('leistung', 'Prüfprotokoll/Messdokumentation', 'Psch.', 90, 'Elektroinstallation'),

  // --- Beleuchtung (Großprojekt) ---
  pos('leistung', 'LED-Leuchte Innen Standard (Material + Montage)', 'Stk.', 65, 'Beleuchtung'),
  pos('leistung', 'Rettungszeichenleuchte inkl. Montage', 'Stk.', 145, 'Beleuchtung'),
  pos('leistung', 'Sicherheitsleuchte (Notlicht) inkl. Montage', 'Stk.', 125, 'Beleuchtung'),

  // --- Brandschutz (Richtwert - je nach Schottgröße/-hersteller abweichend) ---
  pos('leistung', 'Kabelschott (bis DN 100) inkl. Material + Montage', 'Stk.', 85, 'Sicherheitstechnik'),
  pos('leistung', 'Wand-/Deckenschott größer (Brandschutzkanal)', 'Stk.', 220, 'Sicherheitstechnik'),
  pos('leistung', 'Öffnen und Wiederverschließen vorhandener Schott', 'Stk.', 55, 'Sicherheitstechnik'),
  pos('leistung', 'Kennzeichnung/Schottbuch-Dokumentation je Schott', 'Stk.', 15, 'Sicherheitstechnik'),

  // --- Siedle-Sprechanlage (Richtwert - für eine echte Kalkulation Lieferantenangebot einholen) ---
  pos('artikel', 'Siedle Türstation mit Kamera', 'Stk.', 480, 'Kommunikation & Netzwerk'),
  pos('artikel', 'Siedle Innenstation/Gateway', 'Stk.', 220, 'Kommunikation & Netzwerk'),
  pos('artikel', 'Siedle Bus-Netzgerät', 'Stk.', 180, 'Kommunikation & Netzwerk'),
  pos('leistung', 'Montage/Programmierung/Inbetriebnahme Sprechanlage', 'Psch.', 350, 'Kommunikation & Netzwerk'),

  // --- Baustelle/Sonstiges ---
  pos('leistung', 'Baustelleneinrichtung', 'Psch.', 450, 'Elektroinstallation'),
  pos('leistung', 'Baustromverteiler mieten/vorhalten', 'Monat', 85, 'Elektroinstallation'),

  // --- LWL-Technik (Richtwert - für eine echte Kalkulation Lieferantenangebot einholen) ---
  pos('artikel', 'LWL-Kabel (Material)', 'm', 2.8, 'Kommunikation & Netzwerk'),
  pos('leistung', 'LWL-Spleiß (Fusion) inkl. Prüfung', 'Stk.', 18, 'Kommunikation & Netzwerk'),
  pos('artikel', 'LWL-Verteiler/Kupplung', 'Stk.', 35, 'Kommunikation & Netzwerk'),
  pos('artikel', 'LWL-Pigtail', 'Stk.', 8, 'Kommunikation & Netzwerk'),
  pos('artikel', 'LWL-Patchkomponente', 'Stk.', 12, 'Kommunikation & Netzwerk'),
  pos('leistung', 'OTDR-/Dämpfungsmessung inkl. Messprotokoll', 'Stk.', 14, 'Kommunikation & Netzwerk'),
  pos('leistung', 'Kennzeichnung LWL-/Installationskomponenten', 'Stk.', 4, 'Kommunikation & Netzwerk'),
];
