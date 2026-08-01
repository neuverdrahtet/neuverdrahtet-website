// Automatische Verbuchung von bezahlten Rechnungen und erfassten Ausgaben als
// echte Buchungssätze (doppelte Buchführung, Kern-Kontenplan siehe db.js
// DEFAULT_KONTEN). Bewusst vereinfacht: pro Vorgang werden bis zu zwei
// Buchungssätze erzeugt (Netto-Betrag + Steuer-Betrag als eigene Zeile) statt
// eines mehrzeiligen Buchungssatzes - hält das Datenmodell (ein Soll-/ein
// Haben-Konto pro Buchungssatz) simpel, ergibt im Kontenblatt aber trotzdem
// den korrekten Saldo. Ersetzt keine Steuerberatung.
import { getAll, put, remove } from './db.js';
import { uid } from './utils.js';

function findKonto(konten, id, nummer) {
  return konten.find((k) => k.id === id) || (nummer ? konten.find((k) => k.nummer === nummer) : null) || null;
}

function effektiverSteuersatz(netto, steuer) {
  if (!netto) return 19;
  const satz = Math.round((steuer / netto) * 100);
  return satz === 7 ? 7 : 19;
}

function bankOderKasse(konten, settings, zahlungsart) {
  const id = zahlungsart === 'bar' ? settings.kontoKasseId : settings.kontoBankId;
  const fallbackNummer = zahlungsart === 'bar' ? '1000' : '1200';
  return findKonto(konten, id, fallbackNummer);
}

/** Erzeugt (ohne zu speichern) die Buchungssatz-Zeilen für eine bezahlte Rechnung. */
export function erzeugeBuchungenFuerRechnung(r, { konten, settings }) {
  if (r.status !== 'bezahlt') return [];
  const geldKonto = bankOderKasse(konten, settings, r.zahlungsart);
  if (!geldKonto) return [];
  const datum = r.bezahltAm || r.datum;
  const belegtext = `Rechnung ${r.nummer}`;
  const quelle = { typ: 'rechnung', id: r.id };
  const buchungen = [];

  const steuerfrei = r.steuerart && r.steuerart !== 'regel';
  const satz = effektiverSteuersatz(r.netto, r.steuer);
  const erloesKonto = steuerfrei
    ? findKonto(konten, 'konto-8125', '8125')
    : findKonto(konten, satz === 7 ? 'konto-8300' : 'konto-8400', satz === 7 ? '8300' : '8400');
  if (erloesKonto && r.netto) {
    buchungen.push({
      id: uid(), datum, text: belegtext, sollKontoId: geldKonto.id, habenKontoId: erloesKonto.id,
      betrag: Math.round(r.netto * 100) / 100, quelle, manuell: false, createdAt: new Date().toISOString(),
    });
  }
  if (r.steuer) {
    const ustKonto = findKonto(konten, satz === 7 ? 'konto-1771' : 'konto-1776', satz === 7 ? '1771' : '1776');
    if (ustKonto) {
      buchungen.push({
        id: uid(), datum, text: `${belegtext} (USt.)`, sollKontoId: geldKonto.id, habenKontoId: ustKonto.id,
        betrag: Math.round(r.steuer * 100) / 100, quelle, manuell: false, createdAt: new Date().toISOString(),
      });
    }
  }
  return buchungen;
}

/** Erzeugt (ohne zu speichern) die Buchungssatz-Zeilen für eine erfasste Ausgabe.
 * Drei Fälle je nach `bezahlstatus`:
 * - kein `bezahlstatus` (Standard/Altbestand): sofort bezahlter Beleg, wie bisher
 *   direkt gegen Bank/Kasse gebucht.
 * - `'offen'` (noch nicht bezahlte Lieferantenrechnung): Aufwand + Vorsteuer
 *   gegen Verbindlichkeiten (Konto 1600), kein Bank-/Kasse-Kontakt.
 * - `'bezahlt'` (aus 'offen' heraus beglichen): die Verbindlichkeiten-Buchungen
 *   bleiben (datiert auf `datum`) und eine dritte Buchung gleicht die
 *   Verbindlichkeit gegen Bank/Kasse aus (datiert auf `bezahltAm`). */
export function erzeugeBuchungenFuerAusgabe(a, { konten, settings }) {
  const aufwandKonto = findKonto(konten, 'konto-4900', settings.datevAufwandKonto || '4900');
  if (!aufwandKonto) return [];
  const belegtext = `${a.kategorie || 'Ausgabe'}${a.beschreibung ? `: ${a.beschreibung}` : ''}${a.lieferant ? ` (${a.lieferant})` : ''}`;
  const quelle = { typ: 'ausgabe', id: a.id };
  const buchungen = [];
  const netto = a.betragNetto || 0;
  const vorsteuer = (a.betragBrutto || 0) - netto;
  const vorsteuerSatz = netto ? Math.round((vorsteuer / netto) * 100) : Number(a.steuersatz) || 19;
  const vorsteuerKonto = findKonto(konten, vorsteuerSatz === 7 ? 'konto-1571' : 'konto-1576', vorsteuerSatz === 7 ? '1571' : '1576');

  const istOffenOderKreditor = a.bezahlstatus === 'offen' || a.bezahlstatus === 'bezahlt';
  let gegenkonto;
  if (istOffenOderKreditor) {
    gegenkonto = findKonto(konten, 'konto-1600', '1600');
  } else {
    gegenkonto = bankOderKasse(konten, settings, a.bezahltMit);
  }
  if (!gegenkonto) return [];

  if (netto) {
    buchungen.push({
      id: uid(), datum: a.datum, text: belegtext, sollKontoId: aufwandKonto.id, habenKontoId: gegenkonto.id,
      betrag: Math.round(netto * 100) / 100, quelle, manuell: false, createdAt: new Date().toISOString(),
    });
  }
  if (vorsteuer && vorsteuerKonto) {
    buchungen.push({
      id: uid(), datum: a.datum, text: `${belegtext} (Vorsteuer)`, sollKontoId: vorsteuerKonto.id, habenKontoId: gegenkonto.id,
      betrag: Math.round(vorsteuer * 100) / 100, quelle, manuell: false, createdAt: new Date().toISOString(),
    });
  }

  // Kreditorenrechnung inzwischen beglichen: Verbindlichkeit gegen Bank/Kasse ausgleichen.
  if (a.bezahlstatus === 'bezahlt') {
    const geldKonto = bankOderKasse(konten, settings, a.bezahltMit);
    const verbindlichkeitenKonto = gegenkonto;
    if (geldKonto && (a.betragBrutto || 0)) {
      buchungen.push({
        id: uid(), datum: a.bezahltAm || a.datum, text: `${belegtext} (Zahlungsausgleich)`,
        sollKontoId: verbindlichkeitenKonto.id, habenKontoId: geldKonto.id,
        betrag: Math.round((a.betragBrutto || 0) * 100) / 100, quelle, manuell: false, createdAt: new Date().toISOString(),
      });
    }
  }

  return buchungen;
}

/** Erzeugt (ohne zu speichern) die Kapitalisierungsbuchung für eine neu
 * angelegte Anlage (Anlagenverzeichnis): Soll Anlagevermögen-/GWG-Konto
 * (aktiv, je nach `anlage.gwg`), Haben Bank/Kasse, plus eigene Zeile für die
 * Vorsteuer - analog zur Ausgaben-Buchung, nur gegen ein Aktivkonto statt
 * direkt gegen Aufwand. Die jährlichen Abschreibungsbuchungen selbst kommen
 * separat aus `abschreibung.js` + `erzeugeAbschreibungsbuchungenFuerAnlage`. */
export function erzeugeBuchungenFuerAnlage(anlage, { konten, settings }) {
  const kontoId = anlage.gwg ? settings.kontoGwgId : settings.kontoAnlagevermoegenId;
  const fallbackNummer = anlage.gwg ? '0480' : '0400';
  const anlageKonto = findKonto(konten, kontoId, fallbackNummer);
  if (!anlageKonto) return [];
  const geldKonto = bankOderKasse(konten, settings, anlage.bezahltMit);
  if (!geldKonto) return [];

  const belegtext = `Anschaffung: ${anlage.bezeichnung || 'Anlagegut'}${anlage.lieferant ? ` (${anlage.lieferant})` : ''}`;
  const quelle = { typ: 'anlagegut', id: anlage.id };
  const buchungen = [];
  const netto = anlage.anschaffungswertNetto || 0;
  const brutto = anlage.anschaffungswertBrutto || netto;
  const vorsteuer = brutto - netto;
  const vorsteuerSatz = netto ? Math.round((vorsteuer / netto) * 100) : Number(anlage.steuersatz) || 19;
  const vorsteuerKonto = findKonto(konten, vorsteuerSatz === 7 ? 'konto-1571' : 'konto-1576', vorsteuerSatz === 7 ? '1571' : '1576');

  if (netto) {
    buchungen.push({
      id: uid(), datum: anlage.anschaffungsdatum, text: belegtext, sollKontoId: anlageKonto.id, habenKontoId: geldKonto.id,
      betrag: Math.round(netto * 100) / 100, quelle, manuell: false, createdAt: new Date().toISOString(),
    });
  }
  if (vorsteuer && vorsteuerKonto) {
    buchungen.push({
      id: uid(), datum: anlage.anschaffungsdatum, text: `${belegtext} (Vorsteuer)`, sollKontoId: vorsteuerKonto.id, habenKontoId: geldKonto.id,
      betrag: Math.round(vorsteuer * 100) / 100, quelle, manuell: false, createdAt: new Date().toISOString(),
    });
  }
  return buchungen;
}

async function ersetzeAutomatischeBuchungen(quelleTyp, quelleId, neueBuchungen) {
  const alle = await getAll('buchungen');
  const bestehende = alle.filter((b) => !b.manuell && b.quelle?.typ === quelleTyp && b.quelle?.id === quelleId);
  for (const b of bestehende) await remove('buchungen', b.id);
  for (const b of neueBuchungen) await put('buchungen', b);
}

/** Hält die automatisch erzeugten Buchungssätze einer Rechnung mit ihrem aktuellen
 * Status synchron: bezahlt → Buchungssätze vorhanden, sonst (offen/storniert/...) → keine. */
export async function syncBuchungFuerRechnung(r, settings) {
  const konten = await getAll('konten');
  const neueBuchungen = erzeugeBuchungenFuerRechnung(r, { konten, settings });
  await ersetzeAutomatischeBuchungen('rechnung', r.id, neueBuchungen);
}

/** Hält die automatisch erzeugten Buchungssätze einer Ausgabe mit ihrem aktuellen
 * Inhalt synchron (Betrag/Kategorie/Zahlart geändert → Buchung wird neu erzeugt). */
export async function syncBuchungFuerAusgabe(a, settings) {
  const konten = await getAll('konten');
  const neueBuchungen = erzeugeBuchungenFuerAusgabe(a, { konten, settings });
  await ersetzeAutomatischeBuchungen('ausgabe', a.id, neueBuchungen);
}

/** Entfernt alle automatisch erzeugten Buchungssätze einer gelöschten Ausgabe. */
export async function entferneBuchungFuerAusgabe(ausgabeId) {
  await ersetzeAutomatischeBuchungen('ausgabe', ausgabeId, []);
}

/** Hält die Kapitalisierungsbuchung einer Anlage mit ihrem aktuellen Inhalt
 * synchron (Betrag/Kategorie/Zahlart geändert → Buchung wird neu erzeugt). */
export async function syncBuchungFuerAnlage(anlage, settings) {
  const konten = await getAll('konten');
  const neueBuchungen = erzeugeBuchungenFuerAnlage(anlage, { konten, settings });
  await ersetzeAutomatischeBuchungen('anlagegut', anlage.id, neueBuchungen);
}

/** Entfernt alle automatisch erzeugten Buchungssätze (Kapitalisierung +
 * Abschreibungen) einer gelöschten Anlage. */
export async function entferneBuchungenFuerAnlage(anlageId) {
  await ersetzeAutomatischeBuchungen('anlagegut', anlageId, []);
  await ersetzeAutomatischeBuchungen('anlagegut-afa', anlageId, []);
}
