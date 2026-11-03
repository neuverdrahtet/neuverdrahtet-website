// Maßnahme 9 (DSGVO, November 2026): Werkzeuge für Art. 15 (Auskunft) und
// Art. 17 (Löschung) DSGVO je Kunde.
//
// Bewusst NICHT kaskadierend über Projekte/Rechnungen/Belege hinweg: eine
// Löschung auf Antrag betrifft die personenbezogenen STAMMDATEN des Kunden
// (Ansprechpartner, Kontaktdaten, Notizen, bei Privatpersonen auch Name/
// Anschrift) - die Geschäftsvorgänge selbst (Projekte, Rechnungen, Belege)
// bleiben bestehen, da sie betrieblich/steuerlich weiter benötigt werden.
//
// Bereits versendete (GoBD-gesperrte, siehe gutschriften.js/rechnungen.js
// "versendet") Rechnungen/Gutschriften verlangen nach §147 AO/GoBD, dass ihr
// Inhalt inkl. Empfänger für die gesetzliche Aufbewahrungsfrist unverändert
// nachvollziehbar bleibt - Firma/Anschrift werden daher NICHT gelöscht,
// solange mindestens ein solcher Beleg existiert. Kontaktdaten (Telefon,
// E-Mail, Notizen, Portal-Zugang) sind davon nicht betroffen und werden in
// jedem Fall gelöscht.

function sammleVerknuepfteDaten(kunde, kontext) {
  const {
    projekte = [], termine = [], angebote = [], auftragsbestaetigungen = [],
    rechnungen = [], gutschriften = [], ausgaben = [], emails = [], dokumente = [], mahnungen = [],
  } = kontext;
  const kProjekte = projekte.filter((p) => p.kundeId === kunde.id);
  const projektIds = new Set(kProjekte.map((p) => p.id));
  const kRechnungen = rechnungen.filter((r) => r.kundeId === kunde.id);
  const rechnungIds = new Set(kRechnungen.map((r) => r.id));
  return {
    projekte: kProjekte,
    termine: termine.filter((t) => t.kundeId === kunde.id),
    angebote: angebote.filter((a) => a.kundeId === kunde.id),
    auftragsbestaetigungen: auftragsbestaetigungen.filter((a) => a.kundeId === kunde.id),
    rechnungen: kRechnungen,
    gutschriften: gutschriften.filter((g) => g.kundeId === kunde.id),
    ausgaben: ausgaben.filter((a) => a.kundeId === kunde.id || projektIds.has(a.projektId)),
    emails: emails.filter((e) => e.kundeId === kunde.id),
    dokumente: dokumente.filter((d) => d.bezugTyp === 'kunde' && d.bezugId === kunde.id),
    mahnungen: mahnungen.filter((m) => rechnungIds.has(m.rechnungId)),
  };
}

/** Art. 15 DSGVO: vollständige, strukturierte Auskunft über einen Kunden. */
export function erzeugeDatenauskunft(kunde, kontext) {
  return {
    erzeugtAm: new Date().toISOString(),
    hinweis: 'Automatisch erzeugte Auskunft nach Art. 15 DSGVO über alle in Werkora zu diesem Kunden gespeicherten Daten. Hochgeladene Dateien (Dokumente/Belege/E-Mail-Anhänge) sind hier nur mit Name/Kategorie/Datum aufgeführt, nicht mit Dateiinhalt - bei Bedarf einzeln in der Kundenakte herunterladen.',
    stammdaten: kunde,
    ...sammleVerknuepfteDaten(kunde, kontext),
  };
}

/** Prüft, ob eine GoBD-Aufbewahrungspflicht einer vollständigen Löschung der Stammdaten entgegensteht. */
export function pruefeLoeschsperre(kunde, kontext) {
  const { rechnungen, gutschriften } = sammleVerknuepfteDaten(kunde, kontext);
  const gesperrteBelege = [
    ...rechnungen.filter((r) => r.versendet).map((r) => ({ typ: 'Rechnung', nummer: r.nummer })),
    ...gutschriften.filter((g) => g.versendet).map((g) => ({ typ: 'Gutschrift', nummer: g.nummer })),
  ];
  return { gesperrt: gesperrteBelege.length > 0, gesperrteBelege };
}

const IMMER_LOESCHBARE_FELDER = ['ansprechpartner', 'telefon', 'email', 'notizen', 'portalZugangscode'];
const NUR_OHNE_SPERRE_LOESCHBARE_FELDER = ['strasse', 'plz', 'ort'];

/**
 * Art. 17 DSGVO: berechnet die anonymisierte Version der Kundenstammdaten,
 * verändert aber noch nichts - der Aufrufer schreibt das Ergebnis erst nach
 * Bestätigung durch den Nutzer per put('kunden', aktualisiert).
 */
export function berechneLoeschung(kunde, kontext) {
  const { gesperrt, gesperrteBelege } = pruefeLoeschsperre(kunde, kontext);
  const aktualisiert = { ...kunde };
  const geloeschteFelder = [];
  for (const feld of IMMER_LOESCHBARE_FELDER) {
    if (aktualisiert[feld]) { geloeschteFelder.push(feld); aktualisiert[feld] = ''; }
  }
  if (!gesperrt) {
    for (const feld of NUR_OHNE_SPERRE_LOESCHBARE_FELDER) {
      if (aktualisiert[feld]) { geloeschteFelder.push(feld); aktualisiert[feld] = ''; }
    }
    if (aktualisiert.firma && !aktualisiert.firma.startsWith('Gelöschter Kunde')) {
      geloeschteFelder.push('firma (Name/Anschrift anonymisiert)');
      aktualisiert.firma = `Gelöschter Kunde (ehem. ${kunde.kundennummer || kunde.id.slice(0, 8)})`;
    }
  }
  return { aktualisiert, geloeschteFelder, gesperrt, gesperrteBelege };
}
