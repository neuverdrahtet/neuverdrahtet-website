// Echter Regressionstest gegen den tatsächlichen Buchungscode
// (verwaltung/js/journal.js, reiner Import, keine Kopie) für die
// Gutschriften-Buchhaltungslogik (Kundenguthaben, unabhängig von einer
// konkreten Rechnung). Deckt den bei der Einführung gefundenen Fehler ab:
// ohne Gegenbuchung bei Verrechnung hätte das Konto "Verbindlichkeiten aus
// Kundengutschriften" (1790) dauerhaft offen bestehen bleiben und gleichzeitig
// die Bank-/Kassenbuchung einer per Gutschrift (teil-)beglichenen Rechnung
// einen fiktiven, nie tatsächlich geflossenen Bankeingang gebucht.
//
// Ausführen: node verwaltung/tests/journal-gutschriften.test.mjs
import { erzeugeBuchungenFuerRechnung, erzeugeBuchungenFuerGutschrift, effektivErhaltenerBetrag, summeVerrechneterGutschriften } from '../js/journal.js';
import { DEFAULT_KONTEN } from '../js/db.js';

const konten = DEFAULT_KONTEN;
// Nur die für die Buchungslogik relevanten Kontenzuordnungen - identisch zu
// den entsprechenden DEFAULT_SETTINGS-Werten in db.js.
const settings = { kontoBankId: 'konto-1200', kontoKasseId: 'konto-1000', kontoKundenguthabenId: 'konto-1790' };

let bestanden = 0, fehlgeschlagen = 0;
function pruefe(name, fn) {
  try { fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }
function nahe(a, b, msg) { assert(Math.abs(a - b) < 0.01, `${msg || ''} erwartet ${b}, war ${a}`); }
function summeBuchungen(buchungen, sollKontoId, habenKontoId) {
  return buchungen.filter((b) => b.sollKontoId === sollKontoId && b.habenKontoId === habenKontoId).reduce((s, b) => s + b.betrag, 0);
}

const KONTO_ERLOES_19 = 'konto-8400';
const KONTO_UST_19 = 'konto-1776';
const KONTO_GUTHABEN = 'konto-1790';
const KONTO_BANK = 'konto-1200';

pruefe('G1: Ausstellung einer Gutschrift bucht Erlösminderung gegen die Verbindlichkeit (1790), einmalig', () => {
  const gutschrift = { id: 'g1', nummer: 'GS-1', datum: '2026-01-10', status: 'offen', versendet: true, netto: 33.61, steuer: 6.39, brutto: 40 };
  const buchungen = erzeugeBuchungenFuerGutschrift(gutschrift, { konten, settings });
  nahe(summeBuchungen(buchungen, KONTO_ERLOES_19, KONTO_GUTHABEN), 33.61, 'Soll Erlöskonto/Haben Guthaben (netto)');
  nahe(summeBuchungen(buchungen, KONTO_UST_19, KONTO_GUTHABEN), 6.39, 'Soll USt/Haben Guthaben');
});

pruefe('G2: eine stornierte Gutschrift erzeugt KEINE Buchung', () => {
  const gutschrift = { id: 'g2', nummer: 'GS-2', datum: '2026-01-10', status: 'storniert', versendet: true, netto: 33.61, steuer: 6.39, brutto: 40 };
  const buchungen = erzeugeBuchungenFuerGutschrift(gutschrift, { konten, settings });
  assert(buchungen.length === 0, 'storniert darf keine Buchung erzeugen');
});

pruefe('G3 (Kernfall - vorher fehlender Fix): eine komplett per Gutschrift beglichene, als "bezahlt" markierte Rechnung bucht NICHTS gegen Bank/Kasse (kein fiktiver Bankeingang)', () => {
  const rechnung = {
    id: 'r1', nummer: 'RE-1', datum: '2026-03-01', status: 'bezahlt', zahlungsart: 'ueberweisung',
    netto: 84.03, steuer: 15.97, brutto: 100,
    verrechneteGutschriften: [{ gutschriftId: 'g1', gutschriftNummer: 'GS-1', betrag: 100 }],
  };
  const buchungen = erzeugeBuchungenFuerRechnung(rechnung, { konten, settings });
  nahe(summeBuchungen(buchungen, KONTO_BANK, KONTO_ERLOES_19), 0, 'kein Bankeingang, da voll per Gutschrift gedeckt');
  nahe(summeBuchungen(buchungen, KONTO_GUTHABEN, KONTO_ERLOES_19), 84.03, 'volle Erlösanerkennung über die Gutschrift-Verrechnung (netto)');
  nahe(summeBuchungen(buchungen, KONTO_GUTHABEN, KONTO_UST_19), 15.97, 'volle USt-Anerkennung über die Gutschrift-Verrechnung');
});

pruefe('G4 (Kernfall - gemischte Zahlung): €100-Rechnung, €40 per Gutschrift verrechnet, €60 tatsächlich über Bank bezahlt - Summe muss exakt dem vollen Rechnungsbetrag entsprechen, nur €60 geht wirklich auf die Bank', () => {
  const rechnung = {
    id: 'r2', nummer: 'RE-2', datum: '2026-03-05', bezahltAm: '2026-03-10', status: 'bezahlt', zahlungsart: 'ueberweisung',
    netto: 84.03, steuer: 15.97, brutto: 100,
    verrechneteGutschriften: [{ gutschriftId: 'g1', gutschriftNummer: 'GS-1', betrag: 40 }],
  };
  const buchungen = erzeugeBuchungenFuerRechnung(rechnung, { konten, settings });
  const bankNetto = summeBuchungen(buchungen, KONTO_BANK, KONTO_ERLOES_19);
  const bankUst = summeBuchungen(buchungen, KONTO_BANK, KONTO_UST_19);
  const guthabenNetto = summeBuchungen(buchungen, KONTO_GUTHABEN, KONTO_ERLOES_19);
  const guthabenUst = summeBuchungen(buchungen, KONTO_GUTHABEN, KONTO_UST_19);
  nahe(bankNetto + bankUst, 60, 'nur die tatsächlich über Bank eingegangenen 60 EUR dürfen gegen das Bankkonto gebucht werden');
  nahe(guthabenNetto + guthabenUst, 40, 'die per Gutschrift verrechneten 40 EUR laufen über das Guthabenkonto, nicht über die Bank');
  nahe(bankNetto + bankUst + guthabenNetto + guthabenUst, 100, 'in Summe muss der VOLLE Rechnungsbetrag als Umsatz erkannt werden (keine verlorene oder doppelte Erlösanerkennung)');
});

pruefe('G2b: eine noch unversendete Gutschrift (Entwurf) erzeugt KEINE Buchung - fließt erst mit tatsächlichem Versand in die Buchhaltung ein', () => {
  const gutschrift = { id: 'g2b', nummer: 'GS-2b', datum: '2026-01-10', status: 'offen', versendet: false, netto: 33.61, steuer: 6.39, brutto: 40 };
  const buchungen = erzeugeBuchungenFuerGutschrift(gutschrift, { konten, settings });
  assert(buchungen.length === 0, 'ein unversendeter Gutschrift-Entwurf darf keine Buchung erzeugen');
});

pruefe('G5 (voller Lebenszyklus, Kernfall - vorher fehlender Fix): die bei Ausstellung gebuchte Verbindlichkeit (1790) wird durch die spätere Verrechnung GENAU wieder ausgeglichen - Saldo muss am Ende 0 sein', () => {
  const gutschrift = { id: 'g3', nummer: 'GS-3', datum: '2026-01-10', status: 'offen', versendet: true, netto: 33.61, steuer: 6.39, brutto: 40 };
  const ausstellung = erzeugeBuchungenFuerGutschrift(gutschrift, { konten, settings });
  const rechnung = {
    id: 'r3', nummer: 'RE-3', datum: '2026-03-05', bezahltAm: '2026-03-10', status: 'bezahlt', zahlungsart: 'ueberweisung',
    netto: 84.03, steuer: 15.97, brutto: 100,
    verrechneteGutschriften: [{ gutschriftId: 'g3', gutschriftNummer: 'GS-3', betrag: 40 }],
  };
  const verrechnung = erzeugeBuchungenFuerRechnung(rechnung, { konten, settings });

  // Saldo von Konto 1790 über BEIDE Vorgänge hinweg: Haben-Buchungen (Mehrung
  // der Verbindlichkeit bei Ausstellung) minus Soll-Buchungen (Auflösung bei
  // Verrechnung) muss exakt 0 ergeben - keine dauerhaft offene Verbindlichkeit.
  const habenBeiAusstellung = ausstellung.filter((b) => b.habenKontoId === KONTO_GUTHABEN).reduce((s, b) => s + b.betrag, 0);
  const sollBeiVerrechnung = verrechnung.filter((b) => b.sollKontoId === KONTO_GUTHABEN).reduce((s, b) => s + b.betrag, 0);
  nahe(habenBeiAusstellung, 40, 'Ausstellung muss die volle Verbindlichkeit (40) buchen');
  nahe(sollBeiVerrechnung, 40, 'Verrechnung muss die volle Verbindlichkeit (40) wieder auflösen');
  nahe(habenBeiAusstellung - sollBeiVerrechnung, 0, 'Konto 1790 darf nach vollständiger Verrechnung keinen offenen Saldo mehr zeigen');
});

pruefe('G6: effektivErhaltenerBetrag berücksichtigt Gutschrift UND Skonto gemeinsam korrekt (additiv auf den Bank-Anteil)', () => {
  const rechnung = {
    status: 'bezahlt', netto: 84.03, steuer: 15.97, brutto: 100, skontoGenutzt: true, skontoProzent: 2,
    verrechneteGutschriften: [{ gutschriftId: 'g1', betrag: 40 }],
  };
  const { netto, steuer, brutto } = effektivErhaltenerBetrag(rechnung);
  // Bank-Basis nach Gutschrift: 60, davon 2% Skonto -> 58.80 tatsächlich über Bank
  nahe(brutto, 58.8, 'nach Gutschrift (40) und 2% Skonto auf den Rest (60) müssen 58,80 EUR über Bank verbleiben');
  nahe(netto + steuer, brutto, 'netto+steuer müssen wieder den Bruttobetrag ergeben');
});

pruefe('G7: eine "teilbezahlt"-Rechnung mit zusätzlicher Gutschrift bucht die Teilzahlung unverändert (teilzahlungBetrag ist bereits der reine Bank-/Kasse-Anteil)', () => {
  const rechnung = {
    id: 'r4', datum: '2026-03-05', nummer: 'RE-4', status: 'teilbezahlt', zahlungsart: 'ueberweisung',
    netto: 84.03, steuer: 15.97, brutto: 100, teilzahlungBetrag: 30,
    verrechneteGutschriften: [{ gutschriftId: 'g1', betrag: 40 }],
  };
  const buchungen = erzeugeBuchungenFuerRechnung(rechnung, { konten, settings });
  const bankSumme = summeBuchungen(buchungen, KONTO_BANK, KONTO_ERLOES_19) + summeBuchungen(buchungen, KONTO_BANK, KONTO_UST_19);
  const guthabenSumme = summeBuchungen(buchungen, KONTO_GUTHABEN, KONTO_ERLOES_19) + summeBuchungen(buchungen, KONTO_GUTHABEN, KONTO_UST_19);
  nahe(bankSumme, 30, 'Bank-Anteil bleibt exakt die erfasste Teilzahlung');
  nahe(guthabenSumme, 40, 'Gutschrift-Anteil wird zusätzlich, unabhängig von der Teilzahlung, verbucht');
});

pruefe('G8: eine Rechnung ohne jede Gutschrift und ohne Zahlungsstatus ("offen") erzeugt weiterhin KEINE Buchung (unverändertes Altverhalten)', () => {
  const rechnung = { id: 'r5', nummer: 'RE-5', datum: '2026-03-05', status: 'offen', netto: 84.03, steuer: 15.97, brutto: 100 };
  const buchungen = erzeugeBuchungenFuerRechnung(rechnung, { konten, settings });
  assert(buchungen.length === 0, 'eine offene, unbeglichene Rechnung ohne Gutschrift darf keine Buchung erzeugen');
});

pruefe('G9: summeVerrechneterGutschriften summiert korrekt über mehrere Gutschriften', () => {
  const rechnung = { verrechneteGutschriften: [{ betrag: 10 }, { betrag: 15.5 }, { betrag: 0 }] };
  nahe(summeVerrechneterGutschriften(rechnung), 25.5);
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
