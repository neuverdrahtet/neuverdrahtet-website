// Zusätzliche Positionen für größere Ausschreibungen/Bauvorhaben, die auch
// nach Einpflegen der echten LV-Preise (standardKatalogLVEcht.js,
// standardKatalogLVEchtDormagen.js) noch nicht durch reale Kalkulationen
// abgedeckt sind - Rest-Richtwerte für Kleinteile/Zubehör ohne exaktes
// Gegenstück im echten LV.
//
// WICHTIG: Die Preise sind recherchierte Richtwerte (Web-Marktrecherche,
// keine echten Lieferanten-/Einkaufspreise). Vor einer verbindlichen
// Kalkulation prüfen und anpassen.

const STEUERSATZ = 19;
const GEWERK = 'elektro';

function pos(typ, bezeichnung, einheit, preis, unterkategorie) {
  return { typ, bezeichnung, beschreibung: '', einheit, einkaufspreis: 0, aufschlagProzent: 0, preis, steuersatz: STEUERSATZ, gewerk: GEWERK, unterkategorie };
}

export const STANDARD_KATALOG_GROSSPROJEKT = [
  // --- Demontage ---
  pos('leistung', 'Entsorgung Elektroschrott/Altmaterial', 'Psch.', 180, 'Demontage'),

  // --- Kabel/Leitungen (halogenfrei, funktionserhaltend - nicht im echten LV) ---
  pos('artikel', 'NHXMH-J 3x1,5 mm² Kabel (halogenfrei, funktionserhaltend)', 'm', 3.2, 'Kabel & Leitungen'),
  pos('artikel', 'NHXMH-J 5x1,5 mm² Kabel (halogenfrei, funktionserhaltend)', 'm', 4.8, 'Kabel & Leitungen'),
  pos('leistung', 'Kabelendverschluss/Kabelanschluss herstellen', 'Stk.', 22, 'Kabel & Leitungen'),

  // --- Installationsgeräte & Verteilerzubehör ---
  pos('artikel', 'Schütz Reiheneinbau (bis 25A)', 'Stk.', 45, 'Sicherungsautomaten'),
  pos('artikel', 'Verteilergehäuse leer (Auf-/Unterputz)', 'Stk.', 85, 'Zählerschränke & Unterverteilung'),
  pos('artikel', 'Sammelschiene für Verteiler', 'Stk.', 18, 'Zählerschränke & Unterverteilung'),
  pos('leistung', 'Verdrahtung Verteiler (je Reiheneinbaugerät)', 'Stk.', 15, 'Zählerschränke & Unterverteilung'),
  pos('leistung', 'Beschriftung Verteiler/Stromkreise', 'Psch.', 45, 'Zählerschränke & Unterverteilung'),

  // --- Beleuchtung ---
  pos('leistung', 'LED-Leuchte Innen Standard (Material + Montage)', 'Stk.', 65, 'Beleuchtung'),
  pos('leistung', 'Sicherheitsleuchte (Notlicht) inkl. Montage', 'Stk.', 125, 'Beleuchtung'),

  // --- LWL-Technik (Zubehör ohne exaktes Gegenstück im echten LV) ---
  pos('artikel', 'LWL-Verteiler/Kupplung', 'Stk.', 35, 'Kommunikation & Netzwerk'),
  pos('artikel', 'LWL-Pigtail', 'Stk.', 8, 'Kommunikation & Netzwerk'),
  pos('artikel', 'LWL-Patchkomponente', 'Stk.', 12, 'Kommunikation & Netzwerk'),
];
