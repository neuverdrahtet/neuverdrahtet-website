// Automatischer Zahlungsabgleich: ordnet importierte Bankbuchungen (siehe
// bankimport.js) offenen Rechnungen (Zahlungseingang) oder offenen
// Kreditoren-Ausgaben (Zahlungsausgang) zu. Zwei Konfidenzstufen:
// - hoch: Rechnungsnummer/Lieferant im Verwendungszweck gefunden UND Betrag
//   passt exakt -> wird automatisch übernommen.
// - mittel: genau eine offene Rechnung/Ausgabe mit exakt passendem Betrag,
//   aber ohne Textindiz -> bleibt als Vorschlag zur manuellen Bestätigung.
import { getAll, put } from './db.js';
import * as journal from './journal.js';

const TOLERANZ = 0.01;

function enthaeltText(nadel, heuhaufen) {
  if (!nadel) return false;
  return (heuhaufen || '').toLowerCase().includes(String(nadel).trim().toLowerCase());
}

/** Ermittelt einen Zuordnungsvorschlag für eine einzelne Bankbuchung, ohne
 * etwas zu speichern. Betrag > 0 -> gegen offene Rechnungen, Betrag < 0 ->
 * gegen offene Kreditoren-Ausgaben. Gibt null zurück, wenn kein eindeutiger
 * Treffer existiert. */
export function findeVorschlag(bankbuchung, { rechnungen, ausgaben }) {
  const text = `${bankbuchung.verwendungszweck || ''} ${bankbuchung.empfaenger || ''}`;
  if (bankbuchung.betrag > 0) {
    const offene = rechnungen.filter((r) => r.status === 'offen' || r.status === 'teilbezahlt');
    const passendeBetraege = offene.filter((r) => Math.abs((r.brutto || 0) - bankbuchung.betrag) < TOLERANZ);
    const nummerTreffer = passendeBetraege.find((r) => enthaeltText(r.nummer, text));
    if (nummerTreffer) return { typ: 'rechnung', id: nummerTreffer.id, konfidenz: 'hoch' };
    if (passendeBetraege.length === 1) return { typ: 'rechnung', id: passendeBetraege[0].id, konfidenz: 'mittel' };
    return null;
  }
  if (bankbuchung.betrag < 0) {
    const betrag = Math.abs(bankbuchung.betrag);
    const offene = ausgaben.filter((a) => a.bezahlstatus === 'offen');
    const passendeBetraege = offene.filter((a) => Math.abs((a.betragBrutto || 0) - betrag) < TOLERANZ);
    const lieferantTreffer = passendeBetraege.find((a) => enthaeltText(a.lieferant, text));
    if (lieferantTreffer) return { typ: 'ausgabe', id: lieferantTreffer.id, konfidenz: 'hoch' };
    if (passendeBetraege.length === 1) return { typ: 'ausgabe', id: passendeBetraege[0].id, konfidenz: 'mittel' };
    return null;
  }
  return null;
}

/** Übernimmt eine (automatische oder manuell bestätigte) Zuordnung: markiert
 * die Rechnung/Ausgabe als bezahlt, verbucht sie (journal.js) und markiert
 * die Bankbuchung als zugeordnet. */
export async function uebernehmeZuordnung(bankbuchung, vorschlag, settings) {
  if (vorschlag.typ === 'rechnung') {
    const r = (await getAll('rechnungen')).find((x) => x.id === vorschlag.id);
    if (!r) return false;
    const updated = { ...r, status: 'bezahlt', bezahltAm: bankbuchung.datum, zahlungsart: 'ueberweisung' };
    await put('rechnungen', updated);
    try { await journal.syncBuchungFuerRechnung(updated, settings); } catch { /* Buchung ist Komfort, darf Zuordnung nicht blockieren */ }
  } else {
    const a = (await getAll('ausgaben')).find((x) => x.id === vorschlag.id);
    if (!a) return false;
    const updated = { ...a, bezahlstatus: 'bezahlt', bezahltAm: bankbuchung.datum };
    await put('ausgaben', updated);
    try { await journal.syncBuchungFuerAusgabe(updated, settings); } catch { /* siehe oben */ }
  }
  await put('bankbuchungen', { ...bankbuchung, matched: true, matchTyp: vorschlag.typ, matchId: vorschlag.id });
  return true;
}

/** Läuft über alle noch unbearbeiteten (nicht zugeordneten, nicht
 * ignorierten) Bankbuchungen: hohe Konfidenz wird automatisch übernommen,
 * mittlere Konfidenz nur als Vorschlag markiert (matched bleibt false). */
export async function laufeAbgleich(settings) {
  const [bankbuchungen, rechnungen, ausgaben] = await Promise.all([
    getAll('bankbuchungen'), getAll('rechnungen'), getAll('ausgaben'),
  ]);
  let automatisch = 0;
  let vorschlaege = 0;
  for (const b of bankbuchungen) {
    if (b.matched || b.ignoriert) continue;
    const vorschlag = findeVorschlag(b, { rechnungen, ausgaben });
    if (!vorschlag) continue;
    if (vorschlag.konfidenz === 'hoch') {
      await uebernehmeZuordnung(b, vorschlag, settings);
      automatisch++;
    } else if (b.matchTyp !== vorschlag.typ || b.matchId !== vorschlag.id) {
      await put('bankbuchungen', { ...b, matchTyp: vorschlag.typ, matchId: vorschlag.id });
      vorschlaege++;
    } else {
      vorschlaege++;
    }
  }
  return { automatisch, vorschlaege };
}
