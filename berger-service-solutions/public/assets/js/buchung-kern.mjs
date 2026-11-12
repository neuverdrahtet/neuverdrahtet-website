// Kernlogik der Online-Buchung (ohne DOM) – in Browser und Node testbar.
// Erzeugt den Lead-Payload nach docs/schemas/lead.schema.json (Version bss-lead/1).
import {
  pruefeEinsatzgebiet, validiereKontakt, validiereAdresse, normalisiereTelefon,
  normalisiereEmail, dublettenSchluessel, istWerktag,
} from './einsatzgebiet-logik.mjs';

export const SCHEMA_VERSION = 'bss-lead/1';
export const DATENSCHUTZ_TEXTVERSION = 'ds-entwurf-2026-11';

/** Zusatzfelder je Leistung (nur anzeigen, wenn fachlich sinnvoll). */
export function zusatzfelder(leistungSlug) {
  const felder = [];
  if (leistungSlug === 'dguv-v3-pruefung') felder.push('geraete');
  if (['waermepumpenwartung', 'klimaanlagenwartung', 'photovoltaik-batteriespeicher'].includes(leistungSlug)) felder.push('anlage');
  if (/boden|laminat|parkett|vinyl|teppich|sanierung|fliesen|maler|trockenbau|entruempelung|haushaltsaufloesung|entkernung|reinigung|gartenpflege|winterdienst/.test(leistungSlug)) felder.push('flaeche');
  return felder;
}

export function beschreibungsHilfe(leistung) {
  if (!leistung) return '';
  switch (leistung.prozess) {
    case 'wartung': return 'Hilfreich: Art und Anzahl der Anlagen/Geräte, letzte Prüfung oder Wartung, Zugangssituation.';
    case 'service': return 'Hilfreich: Was funktioniert nicht? Seit wann? Welche Sicherung bzw. welcher Raum ist betroffen?';
    case 'handwerk': return 'Hilfreich: Räume, ungefähre Größe, gewünschtes Ergebnis, Zeitrahmen. Fotos beschleunigen das Angebot.';
    case 'objekt': return 'Hilfreich: Objektart, Anzahl der Einheiten, gewünschte Leistungen und Intervalle.';
    case 'rueckbau': return 'Hilfreich: Räume, Etage, Aufzug, ungefähre Menge. Fotos aller Räume sind sehr hilfreich.';
    default: return '';
  }
}

export function validiereSchritt(nr, d, ctx = {}) {
  const f = {};
  if (nr === 1) {
    if (!d.leistung) f.leistung = 'Bitte eine Leistung auswählen.';
  }
  if (nr === 2) {
    Object.assign(f, validiereAdresse(d));
    if (!f.plz) {
      const eg = pruefeEinsatzgebiet({ plz: d.plz, ort: d.ort }, ctx.einsatzgebiet || {});
      if (eg.status === 'ungueltig') f.plz = eg.hinweise[0];
    }
    if (d.rechnungAbweichend) {
      if (!String(d.rName || '').trim()) f.rName = 'Bitte Rechnungsempfänger angeben.';
      const ra = validiereAdresse({ strasse: d.rStrasse, hausnummer: d.rHausnummer, plz: d.rPlz, ort: d.rOrt });
      if (ra.strasse) f.rStrasse = ra.strasse;
      if (ra.hausnummer) f.rHausnummer = ra.hausnummer;
      if (ra.plz) f.rPlz = ra.plz;
      if (ra.ort) f.rOrt = ra.ort;
    }
  }
  if (nr === 3) {
    if (String(d.beschreibung || '').trim().length < 15) f.beschreibung = 'Bitte beschreiben Sie die Arbeiten in mindestens einem Satz (15 Zeichen).';
    if (ctx.leistung?.buchung === 'direkt' && !d.slot) f.slot = 'Bitte einen Wunschtermin auswählen.';
    if (ctx.leistung?.buchung !== 'direkt' && d.wunschtermin) {
      const datum = new Date(d.wunschtermin + 'T00:00:00Z');
      const heute = ctx.heute || new Date();
      const heuteUTC = Date.UTC(heute.getUTCFullYear(), heute.getUTCMonth(), heute.getUTCDate());
      if (Number.isNaN(datum.getTime()) || datum.getTime() <= heuteUTC) f.wunschtermin = 'Bitte ein Datum in der Zukunft wählen.';
      else if (!istWerktag(datum)) f.wunschtermin = 'Bitte einen Werktag (Mo–Fr, kein Feiertag) wählen.';
    }
    if (ctx.dateien) {
      const fehler = pruefeDateien(ctx.dateien, ctx.buchungKonfig);
      if (fehler) f.dateien = fehler;
    }
  }
  if (nr === 4) Object.assign(f, validiereKontakt(d));
  if (nr === 5) {
    if (!d.datenschutz) f.datenschutz = 'Bitte bestätigen Sie die Datenschutzhinweise.';
  }
  return f;
}

export function pruefeDateien(dateien, konfig = {}) {
  const max = konfig.maxDateien ?? 6;
  const maxMB = konfig.maxDateiMB ?? 10;
  const typen = konfig.erlaubteDateitypen ?? ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];
  if (dateien.length > max) return `Bitte höchstens ${max} Dateien auswählen.`;
  for (const d of dateien) {
    const typOk = typen.includes(d.type) || (/\.heic$/i.test(d.name) && typen.includes('image/heic'));
    if (!typOk) return `„${d.name}“ hat ein nicht unterstütztes Format.`;
    if (d.size > maxMB * 1024 * 1024) return `„${d.name}“ ist größer als ${maxMB} MB.`;
  }
  return null;
}

/** Baut den Lead-Payload. `d` = Formulardaten (flach), `ctx` = Katalog/Zeitpunkt. */
export async function baueLead(d, ctx) {
  const leistung = ctx.leistung;
  const eg = pruefeEinsatzgebiet({ plz: d.plz, ort: d.ort }, ctx.einsatzgebiet || {});
  const jetzt = (ctx.jetzt || new Date()).toISOString();
  const direkt = leistung.buchung === 'direkt';
  const [slotDatum, slotZeit] = String(d.slot || '').split('T');
  const lead = {
    schemaVersion: SCHEMA_VERSION,
    idempotenzSchluessel: ctx.idempotenzSchluessel,
    erstelltAm: jetzt,
    quelle: { kanal: 'website', seite: 'buchen.html', kampagne: ctx.kampagne || null },
    vorgangsart: direkt ? 'buchung' : 'anfrage',
    leistung: { slug: leistung.slug, name: leistung.name, bereich: leistung.bereich, prozess: leistung.prozess },
    einsatzort: {
      strasse: String(d.strasse).trim(), hausnummer: String(d.hausnummer).trim(), plz: String(d.plz).trim(), ort: String(d.ort).trim(),
      zusatz: String(d.adresszusatz || '').trim() || null,
      einsatzgebiet: { status: eg.status, zone: eg.zone ?? null, luftlinieKm: eg.luftlinieKm ?? null, strasseKmGeschaetzt: eg.strasseKmGeschaetzt ?? null, fahrzeitMinGeschaetzt: eg.fahrzeitMinGeschaetzt ?? null },
    },
    rechnungsadresse: d.rechnungAbweichend ? { name: String(d.rName).trim(), strasse: String(d.rStrasse).trim(), hausnummer: String(d.rHausnummer).trim(), plz: String(d.rPlz).trim(), ort: String(d.rOrt).trim() } : null,
    kunde: {
      typ: d.kundentyp || 'privat', firma: String(d.firma || '').trim() || null,
      vorname: String(d.vorname).trim(), nachname: String(d.nachname).trim(),
      telefon: normalisiereTelefon(d.telefon), email: normalisiereEmail(d.email), bevorzugterKontaktweg: d.kontaktweg || 'telefon',
    },
    details: {
      beschreibung: String(d.beschreibung).trim(),
      anzahlGeraete: d.anzahlGeraete ? Number(d.anzahlGeraete) : null,
      anlage: String(d.anlage || '').trim() || null,
      flaecheM2: d.flaecheM2 ? Number(d.flaecheM2) : null,
    },
    termin: direkt
      ? { art: 'slot', datum: slotDatum || null, zeit: slotZeit || null, dauerMinRichtwert: leistung.dauerMin || null, status: 'vorlaeufig' }
      : { art: 'wunsch', datum: d.wunschtermin || null, zeitfenster: d.zeitfenster || 'egal', status: 'wunsch' },
    dateien: (ctx.dateien || []).map((f) => ({ name: f.name, typ: f.type || null, groesseBytes: f.size })),
    einwilligungen: {
      datenschutz: { erteilt: !!d.datenschutz, zeitpunkt: jetzt, textVersion: DATENSCHUTZ_TEXTVERSION },
      whatsapp: { erteilt: !!d.whatsappEinwilligung, zeitpunkt: d.whatsappEinwilligung ? jetzt : null },
    },
    dubletten: await dublettenSchluessel({ email: d.email, telefon: d.telefon, adresse: { plz: d.plz, strasse: d.strasse, hausnummer: d.hausnummer } }),
    spamSchutz: { honeypot: String(d.website || ''), ausfuellzeitMs: ctx.ausfuellzeitMs ?? null },
  };
  return lead;
}

/** Lokale, vorläufige Vorgangsnummer für den Demo-Modus. Echte Nummern vergibt Werkora. */
export function demoVorgangsnummer(jetzt = new Date(), zufall = Math.random) {
  const d = jetzt.toISOString().slice(0, 10).replace(/-/g, '');
  const z = Math.floor(zufall() * 0xffff).toString(16).toUpperCase().padStart(4, '0');
  return `DEMO-${d}-${z}`;
}
