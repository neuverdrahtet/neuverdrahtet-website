// Ergänzende Positionen aus dem Abgleich einer realen Ausschreibung
// (LV "2026LV-01287_210_Anfrage Elektroarbeiten") gegen den bestehenden
// Katalog - Positionen, die dort nachweislich noch fehlten (Sprechanlage,
// Sicherheitsbeleuchtung, Brandschutz-Abschottungen in konkreten Maßen,
// LWL-Messung, LSA-Verteiler mit Überspannungsschutz, Baustellen-
// Installationsgeräte, Daten-/Fernmeldekabel).
//
// WICHTIG: Die Preise sind recherchierte Marktrichtwerte, keine echten
// Lieferanten-/Einkaufspreise - vor einer verbindlichen Kalkulation prüfen
// und ggf. an reale Angebote anpassen. Bei den Kabelpositionen (I-Y(St)Y,
// Cat.-7 S-FTP) ist zusätzlich die genaue Aderzahl/Kategorie laut LV zu
// bestätigen, da im Marktvergleich je nach Ausführung stark abweichende
// Preise möglich sind.

const STEUERSATZ = 19;
const GEWERK = 'elektro';

function pos(typ, bezeichnung, einheit, preis, unterkategorie) {
  return { typ, bezeichnung, beschreibung: '', einheit, einkaufspreis: 0, aufschlagProzent: 0, preis, steuersatz: STEUERSATZ, gewerk: GEWERK, unterkategorie };
}

export const STANDARD_KATALOG_LV_ERGAENZUNG_2 = [
  // --- 1.13 Sprechanlage (Siedle) ---
  pos('leistung', 'Nutzerlizenz für zusätzlichen IP-Teilnehmer (Bedarfsposition)', 'Stk.', 95, 'Kommunikation & Netzwerk'),
  pos('leistung', 'Komplette Inbetriebnahme, Parametrierung und Einweisung Sprechanlage', 'Psch.', 480, 'Kommunikation & Netzwerk'),

  // --- 1.11 Sicherheitsbeleuchtung ---
  pos('leistung', 'Rettungszeichenleuchte mit Einzelbatterie, ca. 1 h Autonomie, LED, inkl. Kennzeichnung und Montage', 'Stk.', 155, 'Beleuchtung'),

  // --- 1.12 Brandschutz (Abschottungen nach konkreten Maßen) ---
  pos('leistung', 'Wandabschottung bis 30x10 cm', 'Stk.', 180, 'Sicherheitstechnik'),
  pos('leistung', 'Deckenabschottung bis 10x10 cm', 'Stk.', 110, 'Sicherheitstechnik'),
  pos('leistung', 'Deckenabschottung bis 30x10 cm', 'Stk.', 230, 'Sicherheitstechnik'),

  // --- 1.16 LWL ---
  pos('leistung', 'LWL-Messung komplett je Faser (Referenzmessung, Reinigung, Prüfung, Messprotokoll)', 'Stk.', 16, 'Kommunikation & Netzwerk'),

  // --- 1.9 Kommunikation/Verteilungen ---
  pos('leistung', 'LSA-Verteiler komplett inkl. Überspannungsschutz, montiert und angeschlossen', 'Stk.', 220, 'Verteilungen'),

  // --- 1.14 Baustellenausstattung ---
  pos('leistung', 'Feuchtraum-Aufputz-Wechselschalter (FRaP), Material + Montage', 'Stk.', 42, 'Elektroinstallation'),
  pos('leistung', 'Feuchtraum-Aufputz-Abzweigdose (FRaP), Material + Montage', 'Stk.', 35, 'Elektroinstallation'),

  // --- 1.2 Daten-/Fernmeldekabel (Aderzahl/Kategorie laut LV prüfen) ---
  pos('artikel', 'I-Y(St)Y Fernmeldekabel (Material, Aderzahl laut LV prüfen)', 'm', 1.5, 'Kabel & Leitungen'),
  pos('artikel', 'Cat.-7 Datenkabel S-FTP/J-02YSCH (Material)', 'm', 1.6, 'Kabel & Leitungen'),
];
