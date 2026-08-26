// Reale, vom Nutzer bereitgestellte Einheitspreise aus dem tatsächlichen
// Leistungsverzeichnis "Dormagen, Jahnstraße, Funke Immo UG, 6 RH - Elektro"
// (Reihenhaus-/Wohnungsbau, Elektroinstallation EFH) - wie bei
// standardKatalogLVEcht.js sind dies ECHTE, bereits kalkulierte Einheitspreise,
// keine Schätzungen. Deckt vor allem alltägliche Wohnbau-Positionen ab
// (Schalter/Steckdosen, Kabel, Klingelanlage, PV/Speicher, sowie eine große
// Liste an Sonderwünschen/Zusatzleistungen für Bauherren, z.B. zusätzliche
// Steckdosen, E-Auto-Ladevorbereitung, Netzwerkdosen, SAT/Antennenanschluss).

const STEUERSATZ = 19;
const GEWERK = 'elektro';

function pos(typ, bezeichnung, einheit, preis, unterkategorie, beschreibung = '') {
  return { typ, bezeichnung, beschreibung, einheit, einkaufspreis: 0, aufschlagProzent: 0, preis, steuersatz: STEUERSATZ, gewerk: GEWERK, unterkategorie };
}

export const STANDARD_KATALOG_LV_ECHT_DORMAGEN = [
  // --- Verteiler ---
  pos('artikel', 'Zählerschrank LWWP', 'St', 2650.0, 'Zählerschränke & Unterverteilung'),
  // --- Kabel und Leitungen ---
  pos('artikel', 'NYY-J 3x1,5mm²', 'm', 3.95, 'Kabel & Leitungen'),
  pos('artikel', 'NYY-J 5x1,5mm²', 'm', 4.58, 'Kabel & Leitungen'),
  pos('artikel', 'NYY-J 3x2,5mm²', 'm', 4.47, 'Kabel & Leitungen'),
  pos('artikel', 'NYY-J 5x2,5mm²', 'm', 5.91, 'Kabel & Leitungen'),
  pos('artikel', 'NYY-J 5x16mm²', 'm', 22.44, 'Kabel & Leitungen'),
  pos('artikel', 'NYY-J 1x6', 'm', 4.26, 'Kabel & Leitungen'),
  pos('artikel', 'NYY-J 1x16mm²', 'm', 6.42, 'Kabel & Leitungen'),
  pos('artikel', 'J-Y(St)Y 2x2x0,8', 'm', 3.18, 'Kabel & Leitungen'),
  pos('artikel', 'J-Y(St)Y 4x2x0,8', 'm', 3.72, 'Kabel & Leitungen'),
  pos('artikel', 'Koaxialkabel 4-Fach geschirmt', 'm', 4.0, 'Kabel & Leitungen'),
  pos('artikel', 'Datenleitung Simplex UV-beständig', 'm', 4.57, 'Kabel & Leitungen'),
  // --- Schalt- / Installationsgeräte ---
  pos('artikel', 'UP-Universal Aus-Wechselschalter', 'St', 27.54, 'Installationsgeräte'),
  pos('artikel', 'UP-Serienschalter', 'St', 36.32, 'Installationsgeräte'),
  pos('artikel', 'UP-Serien-Kontroll-Schalter', 'St', 40.18, 'Installationsgeräte'),
  pos('artikel', 'UP-Schukosteckdose 1-fach', 'St', 23.28, 'Installationsgeräte'),
  pos('artikel', 'UP-Schukosteckdose 2-fach', 'St', 37.58, 'Installationsgeräte'),
  pos('artikel', 'UP-Außensteckdose IP44', 'St', 40.25, 'Installationsgeräte'),
  pos('artikel', 'UP-Breitband-Stichleitungsdose', 'St', 37.11, 'Installationsgeräte'),
  pos('leistung', 'UP Leerdose Vorbereitung Medienanschluss', 'St', 19.44, 'Installationsgeräte'),
  pos('leistung', 'Herdanschlussdose 5x2,5mm²', 'St', 26.81, 'Installationsgeräte'),
  pos('artikel', 'AP Schukosteckdose 1-fach', 'St', 26.07, 'Installationsgeräte'),
  pos('artikel', 'Rauchmelder', 'St', 36.69, 'Installationsgeräte'),
  pos('artikel', 'bauseitiger Raumthermostat', 'St', 23.83, 'Installationsgeräte'),
  pos('artikel', 'Raumthermostat', 'St', 83.56, 'Installationsgeräte', 'Bedarfsposition laut LV'),
  pos('artikel', 'bauseitiger Heizkreisverteiler', 'St', 89.13, 'Installationsgeräte'),
  pos('artikel', 'bauseitiger Wohnraum-Kleinventilator', 'St', 33.06, 'Installationsgeräte', 'Bedarfsposition laut LV'),
  pos('leistung', 'Einführung Wohnraum-Kleinventilator', 'St', 23.83, 'Installationsgeräte', 'Bedarfsposition laut LV'),
  // --- Leitungsführungssysteme ---
  pos('artikel', 'Kunststoff-Wellrohr M16', 'm', 4.12, 'Verlegesysteme'),
  pos('artikel', 'Kunststoff-Wellrohr M20', 'm', 4.52, 'Verlegesysteme'),
  pos('artikel', 'Kunststoff-Wellrohr M25', 'm', 4.88, 'Verlegesysteme'),
  pos('artikel', 'Kunststoff-Wellrohr M32', 'm', 6.36, 'Verlegesysteme', 'Bedarfsposition laut LV'),
  pos('artikel', 'Kunststoff-Wellrohr M40', 'm', 7.95, 'Verlegesysteme', 'Bedarfsposition laut LV'),
  pos('artikel', 'Kunststoff-Stangenrohr M20', 'm', 6.44, 'Verlegesysteme'),
  pos('artikel', 'Kunststoff-Stangenrohr M25', 'm', 7.57, 'Verlegesysteme'),
  pos('artikel', 'Kunststoff-Stangenrohr M40', 'm', 11.15, 'Verlegesysteme'),
  pos('artikel', 'Leitungsführungskanal 60x110mm', 'm', 23.09, 'Verlegesysteme', 'Bedarfsposition laut LV'),
  // --- Klingel-/Türsprechanlage ---
  pos('artikel', 'UP-Taster Glockensymbol und Namensschild', 'St', 36.77, 'Kommunikation & Netzwerk'),
  pos('artikel', 'AP Läutwerk für Klingel', 'St', 43.77, 'Kommunikation & Netzwerk'),
  // --- Potentialausgleich ---
  pos('artikel', 'Potentialausgleichsschiene 188mm', 'St', 37.37, 'Kabel & Leitungen'),
  pos('artikel', 'Banderdungschelle', 'St', 14.77, 'Kabel & Leitungen', 'Bedarfsposition laut LV'),
  // --- Lüftungsanlage Bluetooth ---
  pos('artikel', 'NYY-J 3x1,5', 'm', 4.24, 'Elektroinstallation'),
  pos('artikel', 'bauseitiges Steuerelement für Lüftung', 'St', 36.54, 'Elektroinstallation', 'Bedarfsposition laut LV'),
  pos('artikel', 'bauseitiger Wohnraumpendellüfter', 'St', 31.7, 'Elektroinstallation', 'Bedarfsposition laut LV'),
  pos('artikel', 'bauseitiger WC-Lüfter', 'St', 39.38, 'Elektroinstallation', 'Bedarfsposition laut LV'),
  // --- PV-Anlage ---
  pos('leistung', 'PV-Anlage Flachdach', 'St', 10600.0, 'Photovoltaik'),
  pos('leistung', 'Batteriespeicher', 'St', 2450.0, 'Photovoltaik'),
  // --- Sonstiges ---
  pos('leistung', 'Gegenseitiger Stundenverrechnungssatz', 'h', 65.18, 'Stundenlohn', 'Bedarfsposition laut LV'),
  // --- Sonderwünsche ---
  pos('leistung', 'Zusätzliche Einfachsteckdose', 'St', 80.3, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Zusätzliche Zweifachsteckdose', 'St', 95.42, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Zusätzliche Dreifachsteckdose', 'St', 113.98, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Zusätzliche Vierfachsteckdose', 'St', 133.52, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Erweiterung um eine Steckdose', 'St', 50.73, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Steckdose separat abgesichert', 'St', 128.45, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Schaltbare Steckdose mit Schalter', 'St', 156.26, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Zusätzliches Leerrohr M25', 'St', 80.49, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Zusätzliches Lehrrohr M40', 'St', 97.26, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Zusätzlicher Leuchtenauslass mit Ausschaltung', 'St', 124.63, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Zusätzlicher Leuchtenauslass', 'St', 68.68, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Serienschaltung anstatt Ausschaltung', 'St', 94.66, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Wechselschaltung anstatt Ausschaltung', 'St', 121.68, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Wechselschaltung mit einem Leuchtenauslass', 'St', 166.58, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Kreuzschaltung anstatt Wechselschaltung', 'St', 163.08, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Zusätzlicher Schalter', 'St', 88.96, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Zusätzlicher Taster', 'St', 89.61, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Zusätzlicher Dimmer', 'St', 156.95, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Herdanschluss', 'St', 148.73, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Drehstromanschluss Keller', 'St', 217.61, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Strom Garage/Carport', 'St', 445.06, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Vorbereitung Ladesteckdose E-Auto Garage / Carport', 'St', 705.36, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Vorbereitung Ladesteckdose E-Auto Stellplatz', 'St', 723.66, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Vorbereitung elektrischer Rollladenantriebe', 'St', 146.4, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Vorbereitung Markisenanschluss', 'St', 146.36, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Sprechanlage', 'St', 732.03, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Zusätzliche Sprechstelle', 'St', 200.89, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Video - Sprechanlage', 'St', 1394.89, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Zusätzliche Video - Sprechstelle', 'St', 583.12, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'CAT 7 - Kabel mit Netzwerkdose', 'St', 180.41, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Doppel-CAT 7 - Kabel mit Netzwerkdose', 'St', 212.87, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'CAT 7 - Kabel in vorhandenes Leerrohr', 'St', 133.84, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Zusätzlicher Rauchmelder', 'St', 53.87, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Stromanschluss Außenbereich', 'St', 172.36, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Elektro Rollladen - Schalter versetzten', 'St', 115.95, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Zusätzlicher Antennenanschluss', 'St', 150.16, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Antennenanschluss in vorhandenes Leerrohr', 'St', 141.09, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'SAT-Vorbereitung, Flachdach', 'St', 1000.24, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Erweiterung SAT - Vorbereitung', 'St', 507.53, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
  pos('leistung', 'Vorbereitung Sprechanlage inkl. Elektrische Türöffner', 'psch', 490.0, 'Sonderwünsche / Zusatzleistungen', 'Bedarfsposition laut LV'),
];
