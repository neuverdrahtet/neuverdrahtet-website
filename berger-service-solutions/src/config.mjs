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
    inhaber: 'Danny Berger',
    rechtsform: 'Einzelunternehmen',
    ustId: 'DE456245279',
    // Steuernummer bewusst NICHT hier: gehört nicht ins Impressum (Missbrauchsrisiko).
    kammer: 'Handwerkskammer Düsseldorf, Georg-Schulhoff-Platz 1, 40221 Düsseldorf',
    // OFFEN: eingetragene Handwerke/Berufsbezeichnung laut Handwerkskarte, z. B. 'Elektrotechniker-Handwerk (Meister)'
    handwerksrolle: null,
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
    email: 'info@berger-servicesolution.de',
    oeffnungszeiten: [
      // Vorschlag, OFFEN zur Bestätigung
      { tage: ['Mo', 'Di', 'Mi', 'Do', 'Fr'], von: '07:30', bis: '17:00' },
    ],
  },

  website: {
    // OFFEN: endgültige Domain. Wird für canonical, Sitemap und JSON-LD genutzt.
    url: 'https://berger-servicesolution.de',
    sprache: 'de-DE',
    // Solange false: jede Seite trägt "noindex", robots.txt sperrt Crawler.
    // Erst auf true setzen, wenn Impressum, Datenschutz und Kontaktdaten
    // vollständig und geprüft sind (siehe docs/11-umsetzungsplan-qualitaetssicherung.md).
    indexierbar: false,
    // Gelbes Hinweisband „Prototyp“ oben auf jeder Seite (unabhängig von der Google-Sperre).
    prototypHinweis: false,
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
    // Ziel der Online-Buchung. null + E-Mail-Empfänger gesetzt = PHP-Skript
    // api/anfrage.php (E-Mail-Versand, z. B. bei IONOS). Beides leer = Demo-Modus.
    // Später: URL des Werkora-Lead-Endpunkts.
    endpunkt: null,
    email: {
      empfaenger: 'info@berger-servicesolution.de',
      absender: 'info@berger-servicesolution.de', // Postfach der eigenen Domain (IONOS verlangt eigene Domain als Absender)
      kundenbestaetigung: true,
    },
    maxGesamtMB: 20,
    vorlaufWerktage: 2,
    horizontTage: 28,
    slotZeiten: ['08:00', '10:30', '13:30'],
    maxDateien: 6,
    maxDateiMB: 10,
    erlaubteDateitypen: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'],
  },
};

/** Liste aller offenen Konfigurationspunkte – wird im Test und im Build-Log ausgegeben. */
/** Tatsächliches Ziel der Online-Buchung (null = Demo-Modus). */
export function buchungsEndpunkt(cfg = CONFIG) {
  if (cfg.buchung.endpunkt) return cfg.buchung.endpunkt;
  return cfg.buchung.email.empfaenger && cfg.buchung.email.absender ? 'api/anfrage.php' : null;
}

export function offeneKonfigurationspunkte(cfg = CONFIG) {
  const offen = [];
  const pruefe = (wert, label) => { if (wert === null || wert === undefined || wert === '') offen.push(label); };
  pruefe(cfg.firma.inhaber, 'Inhaber (Impressum)');
  pruefe(cfg.firma.rechtsform, 'Rechtsform (Impressum)');
  pruefe(cfg.firma.ustId, 'USt-IdNr. (Impressum, falls vorhanden)');
  pruefe(cfg.firma.handwerksrolle, 'Eingetragene Handwerke/Berufsbezeichnung laut Handwerkskarte (Impressum)');
  pruefe(cfg.kontakt.strasse, 'Geschäftsadresse: Straße');
  pruefe(cfg.kontakt.plz, 'Geschäftsadresse: PLZ');
  pruefe(cfg.kontakt.telefon, 'Telefonnummer');
  pruefe(cfg.kontakt.whatsapp, 'WhatsApp-Business-Nummer');
  pruefe(cfg.kontakt.email, 'E-Mail-Adresse');
  if (!cfg.buchung.endpunkt) {
    pruefe(cfg.buchung.email.empfaenger, 'E-Mail-Empfänger für Online-Anfragen');
    pruefe(cfg.buchung.email.absender, 'E-Mail-Absender (Postfach der eigenen Domain)');
  }
  if (!cfg.einsatzgebiet.preiseFreigegeben) offen.push('Anfahrtspauschalen je Zone (Preisfreigabe)');
  if (!cfg.website.indexierbar) offen.push('Go-live-Schalter website.indexierbar (derzeit noindex)');
  return offen;
}
