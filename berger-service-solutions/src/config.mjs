// Zentrale Konfiguration der Website BERGER SERVICE SOLUTIONS.
//
// Alles, was vor dem Go-live durch den Inhaber bestätigt oder ergänzt werden
// muss, ist hier gebündelt und mit OFFEN markiert. Werte, die `null` sind,
// werden auf der Website NICHT erfunden, sondern ausgeblendet bzw. mit einem
// neutralen Hinweis ersetzt (siehe build.mjs). Der Qualitätstest
// (tests/site-qualitaet.test.mjs) listet alle offenen Punkte auf.

export const CONFIG = {
  firma: {
    name: 'BERGER SERVICE SOLUTIONS',
    kurzname: 'Berger Service Solutions',
    slogan: 'Handwerk. Service. Lösungen.',
    // OFFEN: Rechtsform/Inhaber für Impressum (z. B. Einzelunternehmen, Inhaber …)
    inhaber: null,
    rechtsform: null,
    ustId: null, // OFFEN
    handwerksrolle: null, // OFFEN: Eintragung(en) bei der Handwerkskammer Düsseldorf
  },

  kontakt: {
    // OFFEN: Geschäftsadresse. Ohne Straße wird nur "Essen" ausgegeben und
    // die Adresse NICHT in strukturierte Daten geschrieben.
    strasse: null,
    plz: null,
    ort: 'Essen',
    region: 'Nordrhein-Westfalen',
    land: 'DE',
    telefon: null, // OFFEN, Format "+49 201 …"
    whatsapp: null, // OFFEN, nur Ziffern inkl. Ländervorwahl, z. B. "49201…"
    email: null, // OFFEN
    oeffnungszeiten: [
      // Vorschlag, OFFEN zur Bestätigung
      { tage: ['Mo', 'Di', 'Mi', 'Do', 'Fr'], von: '07:30', bis: '17:00' },
    ],
  },

  website: {
    // OFFEN: endgültige Domain. Wird für canonical, Sitemap und JSON-LD genutzt.
    url: 'https://www.berger-service-solutions.de',
    sprache: 'de-DE',
    // Solange false: jede Seite trägt "noindex", robots.txt sperrt Crawler.
    // Erst auf true setzen, wenn Impressum, Datenschutz und Kontaktdaten
    // vollständig und geprüft sind (siehe docs/11-umsetzungsplan-qualitaetssicherung.md).
    indexierbar: false,
  },

  // Mittelpunkt des Einsatzgebiets: Essen (Innenstadt, ungefähr Hbf).
  einsatzgebiet: {
    zentrum: { name: 'Essen', lat: 51.4513, lon: 7.0138 },
    radiusKm: 50,
    // Faktor Luftlinie -> Straßenkilometer (Erfahrungswert im Ruhrgebiet, Schätzung)
    strassenFaktor: 1.3,
    durchschnittKmh: 38,
    // Anfahrtszonen nach Luftlinie. Beträge sind Geschäftsentscheidungen des
    // Inhabers – solange preiseFreigegeben false ist, zeigt die Website nur
    // die Zone und KEINEN Betrag an.
    zonen: [
      { id: 'A', bisKm: 10, label: 'Zone A – Essen und direkte Umgebung', pauschaleEuro: null },
      { id: 'B', bisKm: 25, label: 'Zone B – Nachbarstädte', pauschaleEuro: null },
      { id: 'C', bisKm: 40, label: 'Zone C – erweitertes Ruhrgebiet', pauschaleEuro: null },
      { id: 'D', bisKm: 50, label: 'Zone D – Randbereich des Einsatzgebiets', pauschaleEuro: null },
    ],
    preiseFreigegeben: false,
  },

  buchung: {
    // OFFEN: Endpunkt für die Lead-Übertragung nach Werkora.
    // null = Demo-Modus: Formular läuft vollständig durch, überträgt aber nichts.
    endpunkt: null,
    vorlaufWerktage: 2,
    horizontTage: 28,
    slotZeiten: ['08:00', '10:30', '13:30'],
    maxDateien: 6,
    maxDateiMB: 10,
    erlaubteDateitypen: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'],
  },
};

/** Liste aller offenen Konfigurationspunkte – wird im Test und im Build-Log ausgegeben. */
export function offeneKonfigurationspunkte(cfg = CONFIG) {
  const offen = [];
  const pruefe = (wert, label) => { if (wert === null || wert === undefined || wert === '') offen.push(label); };
  pruefe(cfg.firma.inhaber, 'Inhaber (Impressum)');
  pruefe(cfg.firma.rechtsform, 'Rechtsform (Impressum)');
  pruefe(cfg.firma.ustId, 'USt-IdNr. (Impressum, falls vorhanden)');
  pruefe(cfg.firma.handwerksrolle, 'Handwerksrolle/Verzeichnis-Eintragungen (Impressum, Leistungsumfang)');
  pruefe(cfg.kontakt.strasse, 'Geschäftsadresse: Straße');
  pruefe(cfg.kontakt.plz, 'Geschäftsadresse: PLZ');
  pruefe(cfg.kontakt.telefon, 'Telefonnummer');
  pruefe(cfg.kontakt.whatsapp, 'WhatsApp-Business-Nummer');
  pruefe(cfg.kontakt.email, 'E-Mail-Adresse');
  pruefe(cfg.buchung.endpunkt, 'Lead-Endpunkt (Werkora-Schnittstelle)');
  if (!cfg.einsatzgebiet.preiseFreigegeben) offen.push('Anfahrtspauschalen je Zone (Preisfreigabe)');
  if (!cfg.website.indexierbar) offen.push('Go-live-Schalter website.indexierbar (derzeit noindex)');
  return offen;
}
