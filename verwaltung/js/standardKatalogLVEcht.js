// Reale, vom Nutzer bereitgestellte Einheitspreise aus dem tatsächlichen
// Leistungsverzeichnis "Umbau Hotel und Boardinghaus in Mietwohnungen -
// Elektroarbeiten" (Neanderstraße 2-4, 40699 Erkrath) - im Unterschied zu den
// zuvor recherchierten Marktrichtpreisen (standardKatalogElektroLV.js,
// standardKatalogGrossprojekt.js) sind dies ECHTE, bereits kalkulierte
// Einheitspreise aus der Cosuno-Ausschreibung -
// keine Schätzungen. Bei gleichnamigen Positionen mit unterschiedlichem Preis
// (z.B. dieselbe Steckdose in Musterwohnung Typ A/B/C oder in der allgemeinen
// Installationsgeräte-Liste) wurde die Bezeichnung um die Herkunfts-Gruppe
// ergänzt, damit keiner der real unterschiedlichen Preise beim Import verloren geht.

const STEUERSATZ = 19;
const GEWERK = 'elektro';

function pos(typ, bezeichnung, einheit, preis, unterkategorie, beschreibung = '') {
  return { typ, bezeichnung, beschreibung, einheit, einkaufspreis: 0, aufschlagProzent: 0, preis, steuersatz: STEUERSATZ, gewerk: GEWERK, unterkategorie };
}

export const STANDARD_KATALOG_LV_ECHT = [
  // --- Niederspannungsanlagen > Demontagearbeiten ---
  pos('leistung', 'Demontage UV bis Maße (b x h x t) ca. 1500x 2000 x 275mm', 'Stck', 597.51, 'Demontage'),
  pos('leistung', 'Demontage UV bis Maße (b x h x t) ca. 550x 600 x 275mm', 'Stck', 319.88, 'Demontage'),
  pos('leistung', 'Demontage Wohnungsverteiler', 'Stck', 201.32, 'Demontage'),
  pos('leistung', 'Demontage Zähleverteilung', 'Stck', 950.0, 'Demontage'),
  pos('leistung', 'Demontage Kabel- und Leitungsnetz Kabeltyp: NYY-J/ NYM-J bis 5x2,5 mm²', 'm', 2.51, 'Demontage'),
  pos('leistung', 'Demontage Kabel- und Leitungsnetz Kabeltyp: NYY-J/ NYM-J bis 5x10 mm²', 'm', 3.57, 'Demontage'),
  pos('leistung', 'Demontage Kabel- und Leitungsnetz Kabeltyp: NYY-J/ NYM-J von 5x16mm² bis 5x35 mm²', 'm', 5.06, 'Demontage'),
  pos('leistung', 'Demontage Kabel- und Leitungsnetz Kabeltyp: NYY-J/ NYM-J von 5x50mm² bis 5x120 mm²', 'm', 10.3, 'Demontage'),
  pos('leistung', 'Demontage Kabel- und Leitungsnetz, Kabeltyp: J-H(St) bis 10x2x0,6/0,8', 'm', 2.34, 'Demontage'),
  pos('leistung', 'Demontage Kabel- und Leitungsnetz, Kabeltyp: J-H(St) bis 100x2x0,6/0,8', 'm', 23.0, 'Demontage'),
  pos('leistung', 'Demontage Tragsysteme, Rohre und Kanäle', 'm', 9.25, 'Demontage'),
  pos('leistung', 'Demontage von Leuchten (bis h=2,5m)', 'Stck', 27.91, 'Demontage'),
  pos('leistung', 'Demontage Installationsgeräte', 'Stck', 6.29, 'Demontage'),
  pos('leistung', 'Leitungen ausklemmen und beschriften bis 5x 2,5 qmm', 'Stck', 15.55, 'Demontage'),
  pos('leistung', 'Leitungen ausklemmen und beschriften von 5x 4 qmm bis 5x 25 qmm', 'Stck', 17.41, 'Demontage'),
  pos('leistung', 'Leitungen ausklemmen und beschriften von 5x 35 qmm bis 5x 70 qmm', 'Stck', 380.0, 'Demontage'),
  pos('leistung', 'FM-Leitung: 4x2x0,6/0,8 abklemmen und beschriften', 'Stck', 8.91, 'Demontage'),
  // --- Niederspannungsanlagen > Kabel und Leitungen ---
  pos('artikel', 'NYM-J 3 x 1,5 mm², in Wanne / Rohr / Kanal (Kabel/Leitungen)', 'm', 3.43, 'Kabel & Leitungen'),
  // --- Niederspannungsanlagen > Musterwohnung TYP A inkl. UV ---
  pos('artikel', 'NYM-J 3 x 1,5 mm², in Wanne / Rohr / Kanal (Typ A)', 'm', 3.47, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP B inkl. UV ---
  pos('artikel', 'NYM-J 3 x 1,5 mm², in Wanne / Rohr / Kanal (Typ B)', 'm', 3.52, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP C inkl. UV ---
  pos('artikel', 'NYM-J 3 x 1,5 mm², in Wanne / Rohr / Kanal (Typ C)', 'm', 3.46, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Kabel und Leitungen ---
  pos('artikel', 'NYM-J 5 x 1,5 mm², in Wanne / Rohr / Kanal (Kabel/Leitungen)', 'm', 4.14, 'Kabel & Leitungen'),
  // --- Niederspannungsanlagen > Musterwohnung TYP A inkl. UV ---
  pos('artikel', 'NYM-J 5 x 1,5 mm², in Wanne / Rohr / Kanal (Typ A)', 'm', 4.23, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP B inkl. UV ---
  pos('artikel', 'NYM-J 5 x 1,5 mm², in Wanne / Rohr / Kanal (Typ B)', 'm', 4.2, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP C inkl. UV ---
  pos('artikel', 'NYM-J 5 x 1,5 mm², in Wanne / Rohr / Kanal (Typ C)', 'm', 4.19, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Kabel und Leitungen ---
  pos('artikel', 'NYM-J 3 x 2,5 mm², in Wanne / Rohr / Kanal', 'm', 4.19, 'Kabel & Leitungen'),
  pos('artikel', 'NYM-J 3 x 4 mm², in Wanne / Rohr / Kanal', 'm', 5.84, 'Kabel & Leitungen'),
  pos('artikel', 'NYM-J 5 x 2,5 mm², in Wanne / Rohr / Kanal (Kabel/Leitungen)', 'm', 5.77, 'Kabel & Leitungen'),
  // --- Niederspannungsanlagen > Musterwohnung TYP B inkl. UV ---
  pos('artikel', 'NYM-J 5 x 2,5 mm², in Wanne / Rohr / Kanal (Typ B)', 'm', 5.67, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP C inkl. UV ---
  pos('artikel', 'NYM-J 5 x 2,5 mm², in Wanne / Rohr / Kanal (Typ C)', 'm', 5.62, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Kabel und Leitungen ---
  pos('artikel', 'NYM-J 5 x 10 mm², in Wanne / Rohr / Kanal', 'm', 14.34, 'Kabel & Leitungen'),
  pos('artikel', 'NYM-J 5 x 16 mm², in Wanne / Rohr / Kanal', 'm', 20.21, 'Kabel & Leitungen'),
  pos('artikel', 'NYCWY 4x 95/50mm², in Wanne/ Rohr/ Kanal', 'm', 84.35, 'Kabel & Leitungen'),
  pos('artikel', 'NYM-J 3 x 1,5 mm², in Schellen', 'm', 4.56, 'Kabel & Leitungen'),
  pos('artikel', 'NYM-J 5 x 1,5 mm², in Schellen', 'm', 5.42, 'Kabel & Leitungen'),
  pos('artikel', 'NYM-J 3 x 2,5 mm², in Schellen', 'm', 5.29, 'Kabel & Leitungen'),
  pos('artikel', 'NYM-J 5 x 2,5 mm², in Schellen', 'm', 6.89, 'Kabel & Leitungen'),
  pos('artikel', 'NYM-J 5 x 16 mm², in Schellen', 'm', 21.78, 'Kabel & Leitungen'),
  pos('artikel', 'NYCWY 4x 95/50mm², in Schellen', 'm', 82.72, 'Kabel & Leitungen'),
  pos('artikel', 'NYY-J 3 x 1,5 mm², Wanne/Rohr', 'm', 3.87, 'Kabel & Leitungen'),
  pos('artikel', 'NYY-J 3 x 2,5 mm², Wanne/Rohr', 'm', 4.34, 'Kabel & Leitungen'),
  pos('artikel', 'NYY-J 5 x 1,5 mm², Wanne/Rohr', 'm', 4.55, 'Kabel & Leitungen'),
  pos('artikel', 'NYY-J 5 x 2,5 mm², Wanne/Rohr', 'm', 5.6, 'Kabel & Leitungen'),
  pos('artikel', 'NYY-J 5 x 4 mm², Wanne/Rohr', 'm', 7.4, 'Kabel & Leitungen'),
  pos('artikel', 'NYY-J 1 x 6 mm2 gn/ge, Wanne/Rohr', 'm', 4.3, 'Kabel & Leitungen'),
  pos('artikel', 'NYY-J 1 x 10 mm2 gn/ge, Wanne/Rohr', 'm', 5.34, 'Kabel & Leitungen'),
  pos('artikel', 'NYY-J 1 x 16 mm2 gn/ge, Wanne/Rohr', 'm', 6.37, 'Kabel & Leitungen'),
  pos('artikel', 'Potentialausgleichsbrücke für Kabeltragsysteme', 'Stck', 22.68, 'Kabel & Leitungen'),
  pos('artikel', 'NYY-J 1 x 6 mm2 gn/ge, auf Schellen', 'm', 4.62, 'Kabel & Leitungen'),
  pos('artikel', 'NYY-J 1 x 10 mm2 gn/ge, auf Schellen', 'm', 6.26, 'Kabel & Leitungen'),
  pos('artikel', 'NYY-J 1 x 16 mm2 gn/ge, auf Schellen', 'm', 7.32, 'Kabel & Leitungen'),
  pos('artikel', 'NYY-J 1 x 95 mm2 gn/ge, auf Schellen', 'm', 23.25, 'Kabel & Leitungen'),
  pos('leistung', 'Bohrungen in MAUER bis 12mm Ø (Kabel/Leitungen)', 'Stck', 14.21, 'Kabel & Leitungen'),
  // --- Niederspannungsanlagen > Musterwohnung TYP A inkl. UV ---
  pos('leistung', 'Bohrungen in MAUER bis 12mm Ø (Typ A)', 'St', 12.75, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP B inkl. UV ---
  pos('leistung', 'Bohrungen in MAUER bis 12mm Ø (Typ B)', 'Stck', 12.58, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP C inkl. UV ---
  pos('leistung', 'Bohrungen in MAUER bis 12mm Ø (Typ C)', 'Stck', 12.59, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Kabel und Leitungen ---
  pos('leistung', 'Bohrungen in MAUER bis 20 mm Ø', 'Stck', 17.84, 'Kabel & Leitungen'),
  pos('leistung', 'Bohrungen in MAUER bis 45 mm Ø', 'Stck', 29.63, 'Kabel & Leitungen'),
  pos('leistung', 'Bohrungen in BETON bis 20 mm Ø', 'Stck', 26.56, 'Kabel & Leitungen'),
  pos('leistung', 'Bohrungen in BETON bis 45 mm Ø', 'Stck', 49.28, 'Kabel & Leitungen'),
  pos('artikel', 'LWL Universalkabel 1x4 E9/125µm', 'm', 4.18, 'Kabel & Leitungen'),
  pos('artikel', 'I-Y(St)Y St III ISDN 2 x 2 x 0,8 in Wanne / Rohr/ Kanal', 'm', 3.16, 'Kabel & Leitungen'),
  pos('artikel', 'I-Y(St)Y St III ISDN 4 x 2 x 0,8 in Wanne / Rohr/ Kanal', 'm', 3.46, 'Kabel & Leitungen'),
  pos('artikel', 'I-Y(St)Y St III ISDN 6 x 2 x 0,8 in Wanne / Rohr/ Kanal', 'm', 3.89, 'Kabel & Leitungen'),
  pos('artikel', 'S-FTP J-02YSCH AWG 23 simplex in Wanne / Rohr', 'm', 3.91, 'Kabel & Leitungen'),
  // --- Niederspannungsanlagen > Installationsgeräte ---
  pos('artikel', '1-fach Schuko aP, Klappdeckel abschließbar', 'Stck', 65.11, 'Installationsgeräte'),
  pos('artikel', '1-fach Schuko aP, Klappdeckel (Installationsgeräte)', 'Stck', 32.6, 'Installationsgeräte'),
  // --- Niederspannungsanlagen > Musterwohnung TYP C inkl. UV ---
  pos('artikel', '1-fach Schuko aP, Klappdeckel (Typ C)', 'Stck', 32.25, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Installationsgeräte ---
  pos('artikel', '2-fach Schuko aP, Klappdeckel', 'Stck', 46.26, 'Installationsgeräte'),
  pos('artikel', 'Aus-Wechselschalter aP', 'Stck', 28.11, 'Installationsgeräte'),
  pos('artikel', 'Schuko-Steckdose u.P. (Installationsgeräte)', 'Stck', 26.37, 'Installationsgeräte'),
  // --- Niederspannungsanlagen > Musterwohnung TYP A inkl. UV ---
  pos('artikel', 'Schuko-Steckdose u.P. (Typ A)', 'Stck', 22.57, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP B inkl. UV ---
  pos('artikel', 'Schuko-Steckdose u.P. (Typ B)', 'Stck', 21.6, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP C inkl. UV ---
  pos('artikel', 'Schuko-Steckdose u.P. (Typ C)', 'Stck', 21.63, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Installationsgeräte ---
  pos('artikel', 'Wechselschalter u.P. (Installationsgeräte)', 'Stck', 32.23, 'Installationsgeräte'),
  // --- Niederspannungsanlagen > Musterwohnung TYP A inkl. UV ---
  pos('artikel', 'Wechselschalter u.P. (Typ A)', 'Stck', 36.74, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP B inkl. UV ---
  pos('artikel', 'Wechselschalter u.P. (Typ B)', 'Stck', 36.58, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP C inkl. UV ---
  pos('artikel', 'Wechselschalter u.P. (Typ C)', 'Stck', 36.2, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Installationsgeräte ---
  pos('artikel', 'Serienschalter u.P.', 'Stck', 36.4, 'Installationsgeräte'),
  pos('artikel', 'Taster u.P.', 'Stck', 32.96, 'Installationsgeräte'),
  pos('artikel', 'Präsenzmelder u.P für Flurbeleuchtung', 'Stck', 142.33, 'Installationsgeräte'),
  pos('artikel', 'Präsenzmelder 360°, Deckenmontage', 'Stck', 136.11, 'Installationsgeräte'),
  pos('artikel', 'Dämmerungsschalter a.P.', 'Stck', 116.05, 'Installationsgeräte'),
  pos('artikel', 'Bewegungsmelder für Außenbereich', 'Stck', 147.02, 'Installationsgeräte'),
  pos('artikel', 'Hohlwand-Gerätedose (Installationsgeräte)', 'Stck', 8.55, 'Installationsgeräte'),
  // --- Niederspannungsanlagen > Musterwohnung TYP A inkl. UV ---
  pos('artikel', 'Hohlwand-Gerätedose (Typ A)', 'Stck', 8.76, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP B inkl. UV ---
  pos('artikel', 'Hohlwand-Gerätedose (Typ B)', 'Stck', 8.78, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP C inkl. UV ---
  pos('artikel', 'Hohlwand-Gerätedose (Typ C)', 'Stck', 8.71, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Installationsgeräte ---
  pos('artikel', 'Hohlwand-Brandschutz-Gerätedose', 'Stck', 23.25, 'Installationsgeräte'),
  pos('artikel', 'CEE 16A 400V aP', 'Stck', 37.79, 'Installationsgeräte'),
  pos('artikel', 'FR-Abzweigkasten ca. 85x85 mm', 'Stck', 20.24, 'Installationsgeräte'),
  pos('artikel', 'FR-Abzweigkasten ca. 130x85 mm', 'Stck', 27.15, 'Installationsgeräte'),
  pos('artikel', 'Potentialausgleichsschiene 188mm grau', 'Stck', 43.78, 'Installationsgeräte'),
  pos('artikel', 'Potenzialausgleichsschiene für Hausanschlüsse', 'Stck', 73.51, 'Installationsgeräte'),
  // --- Niederspannungsanlagen > Verlegesysteme ---
  pos('artikel', 'Sammelhalter Kunststoff für 30 Leitungen', 'Stck', 7.01, 'Verlegesysteme'),
  pos('artikel', 'Sammelhalter Kunststoff für 15 Leitungen', 'Stck', 6.24, 'Verlegesysteme'),
  pos('artikel', 'Sammelhalter M30', 'Stck', 8.29, 'Verlegesysteme'),
  pos('artikel', 'Sammelhalter M15', 'Stck', 7.42, 'Verlegesysteme'),
  pos('artikel', 'C-Profilschiene 40 cm', 'Stck', 23.1, 'Verlegesysteme'),
  pos('artikel', 'C-Profilschiene 30 cm', 'Stck', 220.3, 'Verlegesysteme'),
  pos('artikel', 'Bügelschelle, 1-fach, Spannbereich 8-12mm', 'Stk', 4.1, 'Verlegesysteme'),
  pos('artikel', 'Bügelschelle, 1-fach, Spannbereich 12-16mm', 'Stk', 4.15, 'Verlegesysteme'),
  pos('artikel', 'Bügelschelle, 1-fach, Spannbereich 22-28mm', 'Stk', 4.46, 'Verlegesysteme'),
  pos('artikel', 'Bügelschelle, 2-fach, Spannbereich 12-16mm', 'Stk', 4.86, 'Verlegesysteme'),
  pos('artikel', 'Bügelschelle, 2-fach, Spannbereich 16-22mm', 'Stk', 4.99, 'Verlegesysteme'),
  pos('artikel', 'Bügelschelle, 2-fach, Spannbereich 22-28mm', 'Stk', 5.2, 'Verlegesysteme'),
  pos('artikel', 'Bügelschelle, 3-fach, Spannbereich 12-16mm', 'Stk', 5.08, 'Verlegesysteme'),
  pos('artikel', 'Bügelschelle, 3-fach, Spannbereich 22-28mm', 'Stk', 5.67, 'Verlegesysteme'),
  pos('leistung', 'Standard Kabelrinne 200x60 liefern und auf verlegefähigem Tragsystem montieren', 'm', 45.27, 'Verlegesysteme'),
  pos('leistung', 'Standard Kabelrinne 200x110 liefern und auf verlegefähigem Tragsystem montieren', 'm', 48.72, 'Verlegesysteme'),
  pos('leistung', 'Standard Kabelrinne 300x60 liefern und auf verlegefähigem Tragsystem montieren', 'm', 51.41, 'Verlegesysteme'),
  pos('leistung', 'Standard Kabelrinne 300x110 liefern und auf verlegefähigem Tragsystem montieren', 'm', 59.81, 'Verlegesysteme'),
  pos('leistung', 'Standard Kabelrinne 400x60 liefern und auf verlegefähigem Tragsystem montieren', 'm', 59.43, 'Verlegesysteme'),
  pos('leistung', 'Standard Kabelrinne 400x110 liefern und auf verlegefähigem Tragsystem montieren', 'm', 66.88, 'Verlegesysteme'),
  pos('leistung', 'Standard Kabelrinne 500x60 liefern und auf verlegefähigem Tragsystem montieren', 'm', 73.16, 'Verlegesysteme'),
  pos('leistung', 'Standard Kabelrinne 600x110 liefern und auf verlegefähigem Tragsystem montieren', 'm', 89.75, 'Verlegesysteme'),
  pos('artikel', 'Bogen für Kabelrinne 200 x 60 mm', 'St', 53.12, 'Verlegesysteme'),
  pos('artikel', 'Bogen für Kabelrinne 200 x 110 mm', 'St', 59.94, 'Verlegesysteme'),
  pos('artikel', 'Bogen für Kabelrinne 300 x 60 mm', 'St', 60.03, 'Verlegesysteme'),
  pos('artikel', 'Bogen für Kabelrinne 300 x 110 mm', 'St', 70.97, 'Verlegesysteme'),
  pos('artikel', 'Bogen für Kabelrinne 400 x 110 mm', 'St', 91.73, 'Verlegesysteme'),
  pos('artikel', 'Bogen für Kabelrinne 600 x 110 mm', 'St', 114.12, 'Verlegesysteme'),
  pos('artikel', 'T-Stück für Kabelrinne 200 x 60 mm', 'St', 60.61, 'Verlegesysteme'),
  pos('artikel', 'T-Stück für Kabelrinne 200 x 110 mm', 'St', 75.12, 'Verlegesysteme'),
  pos('artikel', 'T-Stück für Kabelrinne 300 x 60 mm', 'St', 64.73, 'Verlegesysteme'),
  pos('artikel', 'T-Stück für Kabelrinne 300 x 110 mm', 'St', 88.11, 'Verlegesysteme'),
  pos('artikel', 'T-Stück für Kabelrinne 400 x 110 mm', 'St', 111.48, 'Verlegesysteme'),
  pos('artikel', 'T-Stück für Kabelrinne 600 x 110 mm', 'St', 130.92, 'Verlegesysteme'),
  pos('artikel', 'Trennsteg Kabelrinne h=60mm', 'm', 9.46, 'Verlegesysteme'),
  pos('artikel', 'Trennsteg Kabelrinne h=110mm', 'm', 10.6, 'Verlegesysteme'),
  pos('artikel', 'Kabelleiter 200x60', 'm', 58.41, 'Verlegesysteme'),
  pos('artikel', 'Kabelleiter 300x60', 'm', 62.63, 'Verlegesysteme'),
  pos('artikel', 'Kabelleiter 500x110', 'm', 91.96, 'Verlegesysteme'),
  pos('leistung', 'Kupa-Rohr EN 16 auf Putz, in offener Verlegeart montieren', 'm', 7.35, 'Verlegesysteme'),
  pos('leistung', 'Kupa-Rohr EN 20 auf Putz, in offener Verlegeart montieren', 'm', 7.55, 'Verlegesysteme'),
  pos('leistung', 'Kupa-Rohr EN 25 auf Putz, in offener Verlegeart montieren', 'm', 8.22, 'Verlegesysteme'),
  pos('leistung', 'Stapa- Rohr EN 16 in offener Verlegeart montieren', 'm', 15.26, 'Verlegesysteme'),
  pos('leistung', 'Stapa- Rohr EN 20 in in offener Verlegeart montieren', 'm', 16.31, 'Verlegesysteme'),
  pos('leistung', 'Stapa- Rohr EN 25 in in offener Verlegeart montieren', 'm', 18.82, 'Verlegesysteme'),
  pos('artikel', 'Leitungskanal ca. 20 x 30 mm', 'm', 9.82, 'Verlegesysteme'),
  pos('artikel', 'Leitungskanal ca. 60 x 30 mm', 'm', 13.34, 'Verlegesysteme'),
  pos('artikel', 'Leitungskanal ca. 110 x 60 mm', 'm', 23.77, 'Verlegesysteme'),
  pos('artikel', 'Sonderstück zu Leitungskanal 110 x 60 mm', 'Stck', 28.61, 'Verlegesysteme'),
  pos('artikel', 'Stahlblech-Leitungskanal 26 x 30 mm', 'm', 20.36, 'Verlegesysteme'),
  pos('artikel', 'Stahlblech-Leitungskanal 100 x 64 mm', 'm', 50.82, 'Verlegesysteme'),
  // --- Niederspannungsanlagen > Musterwohnung TYP A inkl. UV ---
  pos('artikel', 'Abdeckrahmen, 1-fach (Typ A)', 'St', 5.39, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP B inkl. UV ---
  pos('artikel', 'Abdeckrahmen, 1-fach (Typ B)', 'Stck', 5.29, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP C inkl. UV ---
  pos('artikel', 'Abdeckrahmen, 1-fach (Typ C)', 'Stck', 5.32, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP A inkl. UV ---
  pos('artikel', 'Abdeckrahmen, 2-fach (Typ A)', 'St', 9.34, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP B inkl. UV ---
  pos('artikel', 'Abdeckrahmen, 2-fach (Typ B)', 'Stck', 9.05, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP C inkl. UV ---
  pos('artikel', 'Abdeckrahmen, 2-fach (Typ C)', 'Stck', 8.66, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP A inkl. UV ---
  pos('artikel', 'Schalter-Klemmdose, tief (Typ A)', 'Stck', 15.11, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP B inkl. UV ---
  pos('artikel', 'Schalter-Klemmdose, tief (Typ B)', 'Stck', 14.35, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP C inkl. UV ---
  pos('artikel', 'Schalter-Klemmdose, tief (Typ C)', 'Stck', 14.94, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP A inkl. UV ---
  pos('artikel', 'Sockelleistenkanal (Typ A)', 'm', 16.92, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP B inkl. UV ---
  pos('artikel', 'Sockelleistenkanal (Typ B)', 'm', 16.53, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP C inkl. UV ---
  pos('artikel', 'Sockelleistenkanal (Typ C)', 'm', 16.33, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP A inkl. UV ---
  pos('artikel', 'Sonderstück zu Sockelleistenkanal (Typ A)', 'St', 19.16, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP B inkl. UV ---
  pos('artikel', 'Sonderstück zu Sockelleistenkanal (Typ B)', 'Stck', 18.67, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP C inkl. UV ---
  pos('artikel', 'Sonderstück zu Sockelleistenkanal (Typ C)', 'Stck', 18.42, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP A inkl. UV ---
  pos('artikel', 'Geräteträger Steckdose 2-fach für Sockelleistenkanal (Typ A)', 'St', 39.4, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP B inkl. UV ---
  pos('artikel', 'Geräteträger Steckdose 2-fach für Sockelleistenkanal (Typ B)', 'Stck', 37.72, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP C inkl. UV ---
  pos('artikel', 'Geräteträger Steckdose 2-fach für Sockelleistenkanal (Typ C)', 'Stck', 37.69, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP A inkl. UV ---
  pos('artikel', 'Elektroinstallationsrohr DN 20 (Typ A)', 'm', 5.91, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP B inkl. UV ---
  pos('artikel', 'Elektroinstallationsrohr DN 20 (Typ B)', 'm', 5.95, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP C inkl. UV ---
  pos('artikel', 'Elektroinstallationsrohr DN 20 (Typ C)', 'm', 5.88, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP A inkl. UV ---
  pos('artikel', 'Rauchwarnmelder, batteriebetrieben (Typ A)', 'Stck', 51.52, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP B inkl. UV ---
  pos('artikel', 'Rauchwarnmelder, batteriebetrieben (Typ B)', 'Stck', 50.27, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP C inkl. UV ---
  pos('artikel', 'Rauchwarnmelder, batteriebetrieben (Typ C)', 'Stck', 50.69, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP A inkl. UV ---
  pos('leistung', 'Schlitze bis 20 mm Ø in Mauerwerk (Typ A)', 'm', 11.6, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP B inkl. UV ---
  pos('leistung', 'Schlitze bis 20 mm Ø in Mauerwerk (Typ B)', 'm', 11.17, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP C inkl. UV ---
  pos('leistung', 'Schlitze bis 20 mm Ø in Mauerwerk (Typ C)', 'm', 11.19, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP A inkl. UV ---
  pos('leistung', 'Schlitze bis 40 mm Ø in Mauerwerk (Typ A)', 'm', 16.92, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP B inkl. UV ---
  pos('leistung', 'Schlitze bis 40 mm Ø in Mauerwerk (Typ B)', 'm', 16.47, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP C inkl. UV ---
  pos('leistung', 'Schlitze bis 40 mm Ø in Mauerwerk (Typ C)', 'm', 16.62, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP A inkl. UV ---
  pos('leistung', 'Schlitze im Estrich herstellen, bis 25 mm Breite (Typ A)', 'm', 18.84, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP B inkl. UV ---
  pos('leistung', 'Schlitze im Estrich herstellen, bis 25 mm Breite (Typ B)', 'm', 18.78, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP C inkl. UV ---
  pos('leistung', 'Schlitze im Estrich herstellen, bis 25 mm Breite (Typ C)', 'm', 17.53, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP A inkl. UV ---
  pos('leistung', 'Schlitze im Estrich herstellen, bis 50 mm Breite (Typ A)', 'm', 28.29, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP B inkl. UV ---
  pos('leistung', 'Schlitze im Estrich herstellen, bis 50 mm Breite (Typ B)', 'm', 26.56, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP C inkl. UV ---
  pos('leistung', 'Schlitze im Estrich herstellen, bis 50 mm Breite (Typ C)', 'm', 24.54, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP A inkl. UV ---
  pos('artikel', 'Kleinverteiler 4-reihig 48 PLE, Hohlwandverteiler (Typ A)', 'St', 186.23, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP B inkl. UV ---
  pos('artikel', 'Kleinverteiler 4-reihig 48 PLE, Hohlwandverteiler (Typ B)', 'Stck', 192.88, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP C inkl. UV ---
  pos('artikel', 'Kleinverteiler 4-reihig 48 PLE, Hohlwandverteiler (Typ C)', 'Stck', 188.06, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP A inkl. UV ---
  pos('artikel', 'Hauptschalter 63A (Typ A)', 'Stck', 98.85, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP B inkl. UV ---
  pos('artikel', 'Hauptschalter 63A (Typ B)', 'Stck', 107.22, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP C inkl. UV ---
  pos('artikel', 'Hauptschalter 63A (Typ C)', 'Stck', 100.23, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP A inkl. UV ---
  pos('artikel', 'Überspannungsabl. 4-pol.Typ 2 (Typ A)', 'Stck', 178.65, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP B inkl. UV ---
  pos('artikel', 'Überspannungsabl. 4-pol.Typ 2 (Typ B)', 'Stck', 175.64, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP C inkl. UV ---
  pos('artikel', 'Überspannungsabl. 4-pol.Typ 2 (Typ C)', 'Stck', 177.35, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Verteilungen ---
  pos('artikel', 'Überspannungsabl. 4-pol.Typ 2 (Verteilungen)', 'Stck', 184.7, 'Verteilungen'),
  // --- Niederspannungsanlagen > Musterwohnung TYP A inkl. UV ---
  pos('artikel', 'FI-Schalter 40A 4pol 30mA Typ A (Typ A)', 'St', 67.84, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP B inkl. UV ---
  pos('artikel', 'FI-Schalter 40A 4pol 30mA Typ A (Typ B)', 'Stck', 69.96, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP C inkl. UV ---
  pos('artikel', 'FI-Schalter 40A 4pol 30mA Typ A (Typ C)', 'Stck', 68.42, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP A inkl. UV ---
  pos('artikel', 'LS-Schalter 1-pol. Klasse 3/6000, 1x16A/B (Typ A)', 'St', 18.04, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP B inkl. UV ---
  pos('artikel', 'LS-Schalter 1-pol. Klasse 3/6000, 1x16A/B (Typ B)', 'Stck', 18.25, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP C inkl. UV ---
  pos('artikel', 'LS-Schalter 1-pol. Klasse 3/6000, 1x16A/B (Typ C)', 'Stck', 18.32, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Zählerverteilung ---
  pos('artikel', 'LS-Schalter 1-pol. Klasse 3/6000, 1x16A/B (Zählerverteilung)', 'Stck', 18.19, 'Zählerschränke & Unterverteilung'),
  // --- Niederspannungsanlagen > Musterwohnung TYP A inkl. UV ---
  pos('leistung', 'Projektierung Schaltplanunterlagen Unterverteiler (Typ A)', 'psch', 1250.0, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP B inkl. UV ---
  pos('leistung', 'Projektierung Schaltplanunterlagen Unterverteiler (Typ B)', 'Stck', 315.33, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP C inkl. UV ---
  pos('leistung', 'Projektierung Schaltplanunterlagen Unterverteiler (Typ C)', 'psch', 2620.0, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Zählerverteilung ---
  pos('leistung', 'Projektierung Schaltplanunterlagen Unterverteiler (Zählerverteilung)', 'psch', 350.0, 'Zählerschränke & Unterverteilung'),
  // --- Niederspannungsanlagen > Verteilungen ---
  pos('leistung', 'Projektierung Schaltplanunterlagen Unterverteiler (Verteilungen)', 'Stck', 894.24, 'Verteilungen'),
  // --- Niederspannungsanlagen > Musterwohnung TYP A inkl. UV ---
  pos('leistung', 'Musterwohnung TYP A', 'Stck', 2620.0, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP B inkl. UV ---
  pos('artikel', 'Herdanschlussdose u.P (Typ B)', 'Stck', 29.7, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP C inkl. UV ---
  pos('artikel', 'Herdanschlussdose u.P (Typ C)', 'Stck', 29.72, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP B inkl. UV ---
  pos('artikel', 'LS-Schalter 3-pol. Klasse 3/6000, 3x16A/B (Typ B)', 'Stck', 50.32, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP C inkl. UV ---
  pos('artikel', 'LS-Schalter 3-pol. Klasse 3/6000, 3x16A/B (Typ C)', 'Stck', 50.76, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP B inkl. UV ---
  pos('leistung', 'Musterwohnung TYP B', 'Stck', 3863.0, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Musterwohnung TYP C inkl. UV ---
  pos('artikel', 'Abdeckrahmen, 3-fach', 'Stck', 12.68, 'Musterwohnung / Wohnungsinstallation'),
  pos('leistung', 'Musterwohnung TYP C', 'Stk', 4566.0, 'Musterwohnung / Wohnungsinstallation'),
  // --- Niederspannungsanlagen > Zählerverteilung ---
  pos('leistung', 'Zähleranlage 1, komplett, 74 Zählerplätze', 'Stck', 25045.92, 'Zählerschränke & Unterverteilung'),
  pos('artikel', 'Reitersicherung D02 63A, 3-polig (Zählerverteilung)', 'Stck', 61.05, 'Zählerschränke & Unterverteilung'),
  // --- Niederspannungsanlagen > Verteilungen ---
  pos('artikel', 'Reitersicherung D02 63A, 3-polig (Verteilungen)', 'Stck', 62.02, 'Verteilungen'),
  // --- Niederspannungsanlagen > Zählerverteilung ---
  pos('artikel', 'RCD 40/0,03A, Typ A, 4. Pol (Zählerverteilung)', 'Stck', 70.54, 'Zählerschränke & Unterverteilung'),
  // --- Niederspannungsanlagen > Verteilungen ---
  pos('artikel', 'RCD 40/0,03A, Typ A, 4. Pol (Verteilungen)', 'Stck', 72.57, 'Verteilungen'),
  // --- Niederspannungsanlagen > Zählerverteilung ---
  pos('artikel', 'FI/LS 16/0,03A, 2-polig (Zählerverteilung)', 'Stck', 69.52, 'Zählerschränke & Unterverteilung'),
  // --- Niederspannungsanlagen > Verteilungen ---
  pos('artikel', 'FI/LS 16/0,03A, 2-polig (Verteilungen)', 'Stck', 71.92, 'Verteilungen'),
  // --- Niederspannungsanlagen > Zählerverteilung ---
  pos('leistung', 'Dreistock- Installations-Klemme liefern und montieren. (Zählerverteilung)', 'Stck', 10.51, 'Zählerschränke & Unterverteilung'),
  // --- Niederspannungsanlagen > Verteilungen ---
  pos('leistung', 'Dreistock- Installations-Klemme liefern und montieren. (Verteilungen)', 'Stck', 10.67, 'Verteilungen'),
  pos('artikel', 'Standverteiler 1850x800x275mm', 'Stck', 2590.77, 'Verteilungen'),
  pos('artikel', 'Sockel 100mm', 'Stck', 98.98, 'Verteilungen'),
  pos('artikel', 'Lasttrennschalter 3polig 63 A', 'Stck', 93.56, 'Verteilungen'),
  pos('artikel', 'Anschlussmodul mit Klemmen für Sammelschiene', 'Stck', 86.09, 'Verteilungen'),
  pos('artikel', 'LS-Schalter 1-pol. Klasse 3/10000, 1x16A/B', 'Stck', 19.62, 'Verteilungen'),
  pos('artikel', 'LS-Schalter 1-pol. Klasse 3/10000, 1x16A/C', 'Stck', 29.74, 'Verteilungen'),
  pos('artikel', 'LS-Schalter 3-pol. Klasse 3/10000, 3x16A/B', 'Stck', 71.66, 'Verteilungen'),
  pos('artikel', 'LS-Schalter 3-pol. Klasse 3/10000, 3x20A/B', 'Stck', 81.81, 'Verteilungen'),
  pos('artikel', 'LS-Schalter 3-pol. Klasse 3/10000, 3x32A/B', 'Stck', 99.73, 'Verteilungen'),
  pos('artikel', 'Zeitschaltuhr 1 Kanal', 'Stck', 179.0, 'Verteilungen'),
  pos('artikel', 'Fernschalter (Stromstoßschalter)', 'Stck', 47.64, 'Verteilungen'),
  pos('artikel', 'LSA Verteilerkasten', 'Stck', 436.32, 'Verteilungen'),
  // --- Niederspannungsanlagen > Messung VDE 0100 ---
  pos('leistung', 'Messung des Isolationswiderstandes eines Wechselstromkreises mit Dokumentation', 'Stck', 24.19, 'Elektroinstallation'),
  pos('leistung', 'Messung des Isolationswiderstandes eines Drehstromkreises mit Dokumentation', 'Stck', 23.26, 'Elektroinstallation'),
  pos('leistung', 'Messung der Schleifenimpedanz eines Wechselstromkreises mit Dokumentation', 'Stck', 19.63, 'Elektroinstallation'),
  pos('leistung', 'Prüfung von Fehlerstrom-Schutzschaltung (RCD) nach DIN VDE 0100 Teil 600 (FI-)', 'Stck', 24.08, 'Elektroinstallation'),
  pos('leistung', '15 Prüfungen niederohmigen Verbindungen der Schutzkontake von Steckdosen+Geräte', 'Stck', 45.0, 'Elektroinstallation'),
  pos('leistung', 'Pauschale Bereitstellungskosten für die bei der Prüfung notwendigen Messgeräte', 'psch', 450.0, 'Elektroinstallation'),
  pos('leistung', 'Erstellung und Übergabe der ausgefüllten Dokumentation über die E-CHECK-Prüfung', 'Stck', 380.0, 'Elektroinstallation'),
  // --- Niederspannungsanlagen > Beleuchtungsanlagen ---
  pos('artikel', 'Beleuchtung Typ 1 Flurbereiche', 'Stck', 175.51, 'Beleuchtung'),
  pos('artikel', 'Beleuchtung Typ 2 für Tiefgarage', 'Stck', 95.07, 'Beleuchtung'),
  pos('artikel', 'Beleuchtung Typ 3 für Eingangsbereiche', 'Stck', 352.58, 'Beleuchtung'),
  pos('artikel', 'Beleuchtung Typ 4 Kellerabteile u. Technikräume', 'Stck', 110.83, 'Beleuchtung'),
  pos('artikel', 'Beleuchtung Typ 5 Außenbereich', 'Stck', 230.85, 'Beleuchtung'),
  pos('artikel', 'Beleuchtung Typ 6 Pollerleuchte', 'Stck', 832.76, 'Beleuchtung'),
  pos('artikel', 'Beleuchtung Typ 7 LED-Feuchtraumleuchte, oval', 'Stck', 68.0, 'Beleuchtung'),
  pos('artikel', 'Rettungszeichenhinweisleuchte', 'Stck', 210.41, 'Beleuchtung'),
  // --- Niederspannungsanlagen > Brandschutz ---
  pos('artikel', 'Öffnungsgröße: 0,01 m2', 'Stck', 84.83, 'Sicherheitstechnik'),
  pos('artikel', 'Öffnungsgröße: 0,02 m2', 'Stck', 92.26, 'Sicherheitstechnik'),
  pos('artikel', 'Öffnungsgröße: 0,03 m2', 'Stck', 106.93, 'Sicherheitstechnik'),
  pos('artikel', 'Öffnungsgröße: 0,04 m2', 'Stck', 116.11, 'Sicherheitstechnik'),
  pos('artikel', 'Öffnungsgröße: 0,05 m2', 'Stck', 117.07, 'Sicherheitstechnik'),
  pos('leistung', 'Brandschutzabschottung für Kernbohrungen bis Ø 100 mm in Decken', 'Stck', 87.3, 'Sicherheitstechnik'),
  pos('artikel', 'Brandschutz Wand bis 30 x 10 cm', 'Stck', 112.18, 'Sicherheitstechnik'),
  pos('artikel', 'Brandschutz Decke bis 10 x 10 cm', 'Stck', 88.9, 'Sicherheitstechnik'),
  pos('artikel', 'Brandschutz Decke bis 30 x 10 cm', 'Stck', 125.5, 'Sicherheitstechnik'),
  pos('artikel', 'Selbständiger Installationskanal I90', 'm', 353.89, 'Sicherheitstechnik'),
  pos('artikel', 'E 90 - Kanal mit 50 x 110 mm Innenmaß', 'm', 311.06, 'Sicherheitstechnik'),
  pos('artikel', 'E 90 - Kanal mit 105 x 260 mm Innenmaß', 'm', 393.75, 'Sicherheitstechnik'),
  pos('leistung', 'Brandschutz öffnen/ schließen', 'Stck', 71.6, 'Sicherheitstechnik'),
  pos('leistung', 'Schottbuch - Dokumentation', 'Stck', 850.0, 'Sicherheitstechnik'),
  // --- Niederspannungsanlagen > Sprechanlage ---
  pos('artikel', 'Türstation Siedle Classic', 'Stck', 3670.78, 'Kommunikation & Netzwerk'),
  pos('artikel', 'Edelstahl-Türstationstele', 'Stck', 2420.58, 'Kommunikation & Netzwerk'),
  pos('artikel', 'Audio-Innenstation Siedle Basic', 'Stck', 111.06, 'Kommunikation & Netzwerk'),
  pos('artikel', 'Transformator im Schalttafelgehäuse', 'Stck', 105.73, 'Kommunikation & Netzwerk'),
  pos('artikel', 'Bus-Video-Netzgerät', 'Stck', 456.12, 'Kommunikation & Netzwerk'),
  pos('artikel', 'Zubehör-Bus-Video-Netzgerät', 'Stck', 160.82, 'Kommunikation & Netzwerk'),
  pos('artikel', 'Bus-Audio/Video-Verteiler', 'Stck', 155.25, 'Kommunikation & Netzwerk'),
  pos('artikel', 'Zubehör-Bus-Versorgung', 'Stck', 83.36, 'Kommunikation & Netzwerk'),
  pos('artikel', 'Programmierinterface', 'Stck', 399.8, 'Kommunikation & Netzwerk'),
  pos('artikel', 'Bus-Video-Verteiler', 'Stck', 182.31, 'Kommunikation & Netzwerk'),
  pos('artikel', 'Netzgerät im Schalttafelgehäuse', 'Stck', 209.75, 'Kommunikation & Netzwerk'),
  pos('artikel', 'Bus-Interface-Modul im Schalttafelgehäuse', 'Stck', 275.93, 'Kommunikation & Netzwerk'),
  pos('artikel', 'Bus-Audio-Auskopplung', 'Stck', 142.63, 'Kommunikation & Netzwerk'),
  pos('artikel', 'Zubehör Western-Anschlussdose', 'Stck', 25.0, 'Kommunikation & Netzwerk'),
  pos('artikel', 'Smart Gateway Professional', 'Stck', 682.54, 'Kommunikation & Netzwerk'),
  pos('artikel', 'Nutzerlizenz', 'Stck', 115.2, 'Kommunikation & Netzwerk', 'Bedarfsposition laut LV'),
  pos('leistung', 'Inbetriebnahme und Einweisung', 'psch', 1200.0, 'Kommunikation & Netzwerk'),
  // --- Niederspannungsanlagen > sonstige Bauleistungen ---
  pos('artikel', 'Mineralwolledämmung im Bereich von Unterverteilern und Installation in F30-Wänden', 'm²', 66.1, 'Elektroinstallation'),
  pos('artikel', 'Potentialausgleich an Rohren bis 5 "', 'Stck', 35.36, 'Elektroinstallation'),
  pos('artikel', 'Potentialausgleich an Rohren bis 2 "', 'Stck', 25.59, 'Elektroinstallation'),
  pos('artikel', 'Potentialausgleich an Metallteilen/Duschtassen bis 6mm²', 'Stck', 24.66, 'Elektroinstallation'),
  pos('artikel', 'FRAP-LED Wannenleuchte, schlagfest', 'Stck', 95.4, 'Elektroinstallation'),
  pos('artikel', 'FRaP-Wechselschalter, 1-pol,', 'Stck', 32.95, 'Elektroinstallation'),
  pos('artikel', 'FRaP-Abzweigdose, mittel, 12 Einführungen', 'Stck', 25.3, 'Elektroinstallation'),
  pos('artikel', 'ISO-Kleinverteiler', 'Stck', 176.33, 'Elektroinstallation'),
  pos('artikel', 'H07RN-F 3 x 1,5 mm', 'm', 4.7, 'Elektroinstallation'),
  pos('leistung', 'Umsetzen eines Baubeleuchtungskörpers', 'Stck', 86.85, 'Elektroinstallation'),
  pos('artikel', 'Baustromverteiler', 'Stck', 1619.53, 'Elektroinstallation'),
  pos('leistung', 'Baustellenverteiler, Kleinverteiler, betriebsbereit', 'Stck', 480.0, 'Elektroinstallation'),
  pos('artikel', 'Baustromverteiler Standzeitverlängerung pro Monat', 'Mona', 135.56, 'Elektroinstallation'),
  // --- Niederspannungsanlagen > Stundenlohnarbeiten ---
  pos('leistung', 'Stunden zum Nachweis eines selbst. Monteurs', 'Std.', 66.08, 'Stundenlohn'),
  pos('leistung', 'Stunden zum Nachweis eines Montagehelfers', 'Std.', 51.42, 'Stundenlohn'),
  // --- Niederspannungsanlagen > LWL-Technik ---
  pos('artikel', 'Genexis Fiber Twist FTU-110', 'Stck', 145.0, 'Kommunikation & Netzwerk'),
  pos('artikel', 'Genexis Fiber Twist Blindcover', 'Stck', 18.0, 'Kommunikation & Netzwerk'),
  pos('artikel', '19Zoll Wand-Netzwerkschrank 20HE', 'Stck', 1143.35, 'Kommunikation & Netzwerk'),
  pos('artikel', 'LWL Spleißbox flex 24xLC/APC Duplex OS2 spleißfertig', 'Stck', 473.01, 'Kommunikation & Netzwerk'),
  pos('artikel', 'Kabelmanagment 1 HE', 'Stck', 50.25, 'Kommunikation & Netzwerk'),
  pos('leistung', 'Herstellen von LWL-Spleißverbindungen', 'Stck', 19.3, 'Kommunikation & Netzwerk'),
  pos('leistung', 'OTDR-Messung nach DIN ISO/IEC 1463 mit Vor- und Nachlauffasern von zwei Seiten', 'Stck', 22.87, 'Kommunikation & Netzwerk'),
  pos('leistung', 'Kennzeichnung', 'Stck', 6.6, 'Kommunikation & Netzwerk'),
];
