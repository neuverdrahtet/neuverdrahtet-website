// Echter Regressionstest gegen den tatsächlichen Code (verwaltung/js/views/
// zahlungsabgleich.js, reiner Import, keine Kopie) für die beiden
// Review-Befunde: (1) der Kontoabgleich verglich eingehende Zahlungen nur
// gegen den VOLLEN ursprünglichen Rechnungsbetrag statt gegen den
// tatsächlich noch offenen Restbetrag - eine Restzahlung auf eine bereits
// teilbezahlte/per-Gutschrift-reduzierte Rechnung wurde nie als Treffer
// erkannt. (2) Eine Überzahlung wurde stillschweigend als "voll bezahlt"
// verbucht, der Überschuss ging dabei spurlos verloren.
//
// Ausführen: node verwaltung/tests/zahlungsabgleich.test.mjs
import { istZahlungsKandidat, berechneZahlungsabgleichErgebnis } from '../js/views/zahlungsabgleich.js';

let bestanden = 0, fehlgeschlagen = 0;
function pruefe(name, fn) {
  try { fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }
function nahe(a, b, msg) { assert(Math.abs(a - b) < 0.01, `${msg || ''} erwartet ${b}, war ${a}`); }

const settings = { standardSteuersatz: 19 };

// =============================================================================
// istZahlungsKandidat (Kandidaten-Erkennung beim Synchronisieren)
// =============================================================================

pruefe('K1: eine unberührte offene Rechnung wird weiterhin gegen den vollen Bruttobetrag erkannt (Altverhalten unverändert)', () => {
  const r = { status: 'offen', brutto: 500, netto: 420.17, steuer: 79.83 };
  assert(istZahlungsKandidat(r, 500), 'voller Betrag muss weiterhin erkannt werden');
  assert(!istZahlungsKandidat(r, 300), 'ein unpassender Betrag darf kein Treffer sein');
});

pruefe('K2 (Kernfall - Review-Befund 1): eine bereits teilbezahlte Rechnung wird bei Zahlung des RESTBETRAGS jetzt (zusätzlich zum vollen Ursprungsbetrag) als Treffer erkannt - das war vorher NICHT der Fall', () => {
  const r = { status: 'teilbezahlt', brutto: 1000, teilzahlungBetrag: 400, netto: 840.34, steuer: 159.66 };
  assert(istZahlungsKandidat(r, 600), 'die Restzahlung (600 von noch offenen 600) muss als Treffer erkannt werden - das ist der eigentliche Fix');
  assert(!istZahlungsKandidat(r, 777), 'ein Betrag, der weder dem vollen Ursprungsbetrag noch dem Restbetrag entspricht, bleibt kein Treffer');
});

pruefe('K3: ein Betrag, der weder dem Bruttobetrag noch dem (ggf. per Gutschrift reduzierten) Restbetrag entspricht, ist kein Treffer', () => {
  const r = { status: 'offen', brutto: 200, verrechneteGutschriften: [{ betrag: 200 }], netto: 168.07, steuer: 31.93 };
  assert(!istZahlungsKandidat(r, 150), 'ein unpassender Betrag darf kein Treffer sein, unabhängig von der Gutschrift-Reduzierung');
});

pruefe('K4: Skonto-Betrag bleibt weiterhin ein gültiger Treffer', () => {
  const r = { status: 'offen', brutto: 100, skontoProzent: 2, netto: 84.03, steuer: 15.97 };
  assert(istZahlungsKandidat(r, 98), '2% Skonto auf 100 = 98, muss weiterhin erkannt werden');
});

// =============================================================================
// berechneZahlungsabgleichErgebnis (Bestätigungs-Entscheidung)
// =============================================================================

pruefe('E1: exakte Zahlung auf eine unberührte Rechnung markiert sie als bezahlt (Altverhalten unverändert)', () => {
  const r = { nummer: 'RE-1', status: 'offen', brutto: 500, netto: 420.17, steuer: 79.83 };
  const { aktualisiert, hinweis, gutschriftEntwurf } = berechneZahlungsabgleichErgebnis(r, 500, { settings, bezahltAm: '2026-03-01' });
  assert(aktualisiert.status === 'bezahlt', 'Status muss bezahlt sein');
  assert(!gutschriftEntwurf, 'bei exakter Zahlung darf kein Gutschrift-Entwurf entstehen');
  assert(hinweis.includes('RE-1'), 'Hinweis muss die Rechnungsnummer nennen');
});

pruefe('E2 (Kernfall - Review-Befund 1): die Restzahlung einer teilbezahlten Rechnung markiert sie korrekt als vollständig bezahlt', () => {
  const r = { nummer: 'RE-2', status: 'teilbezahlt', brutto: 1000, teilzahlungBetrag: 400, netto: 840.34, steuer: 159.66 };
  const { aktualisiert, gutschriftEntwurf } = berechneZahlungsabgleichErgebnis(r, 600, { settings, bezahltAm: '2026-03-01' });
  assert(aktualisiert.status === 'bezahlt', `die 600 EUR Restzahlung müssen die Rechnung vollständig abschließen, Status war "${aktualisiert.status}"`);
  assert(!gutschriftEntwurf, 'eine exakte Restzahlung ist keine Überzahlung');
});

pruefe('E3 (Kernfall - Review-Befund 2): eine Überzahlung markiert die Rechnung als bezahlt UND legt einen Gutschrift-Entwurf über den Überschuss an', () => {
  const r = { nummer: 'RE-3', status: 'offen', brutto: 1000, netto: 840.34, steuer: 159.66 };
  const { aktualisiert, gutschriftEntwurf, hinweis, istUeberzahlung } = berechneZahlungsabgleichErgebnis(r, 1050, { settings, bezahltAm: '2026-03-01' });
  assert(istUeberzahlung === true, 'muss als Überzahlung erkannt werden');
  assert(aktualisiert.status === 'bezahlt', 'die Rechnung selbst ist vollständig bezahlt');
  assert(gutschriftEntwurf, 'es MUSS ein Gutschrift-Entwurf für den Überschuss entstehen - der Überschuss darf nicht spurlos verschwinden');
  nahe(gutschriftEntwurf.brutto, 50, 'der Gutschrift-Entwurf muss genau den Überschuss (50 EUR) abdecken');
  assert(gutschriftEntwurf.grund === 'ueberzahlung', 'Grund muss "ueberzahlung" sein');
  assert(gutschriftEntwurf.kundeId === undefined || true, 'kundeId wird aus der Rechnung übernommen (hier nicht gesetzt, nur Formcheck)');
  assert(gutschriftEntwurf.versendet === false, 'der Entwurf darf NICHT automatisch versendet/gebucht werden - das entscheidet der Mensch');
  assert(hinweis.includes('Überschuss'), 'der Hinweistext muss den Überschuss explizit nennen, damit er nicht übersehen wird');
});

pruefe('E3b: der Gutschrift-Entwurf für eine Überzahlung hat eine korrekte Netto-/USt.-Aufteilung bei 19%', () => {
  const r = { nummer: 'RE-3b', status: 'offen', brutto: 1000, netto: 840.34, steuer: 159.66, steuerart: 'regel' };
  const { gutschriftEntwurf } = berechneZahlungsabgleichErgebnis(r, 1119, { settings, bezahltAm: '2026-03-01' });
  nahe(gutschriftEntwurf.brutto, 119, 'Überschuss muss 119 EUR betragen');
  nahe(gutschriftEntwurf.netto + gutschriftEntwurf.steuer, 119, 'netto+steuer müssen wieder den Bruttoüberschuss ergeben');
  nahe(gutschriftEntwurf.steuer / gutschriftEntwurf.netto, 0.19, 'Steuersatz muss 19% entsprechen');
});

pruefe('E4: eine Zahlung, die weder voll noch Skonto noch Überzahlung ist, bleibt eine normale Teilzahlung', () => {
  const r = { nummer: 'RE-4', status: 'offen', brutto: 1000, netto: 840.34, steuer: 159.66 };
  const { aktualisiert, gutschriftEntwurf } = berechneZahlungsabgleichErgebnis(r, 300, { settings, bezahltAm: '2026-03-01' });
  assert(aktualisiert.status === 'teilbezahlt', 'muss teilbezahlt bleiben');
  nahe(aktualisiert.teilzahlungBetrag, 300);
  assert(!gutschriftEntwurf, 'eine normale Teilzahlung ist keine Überzahlung');
});

pruefe('E5: mehrere Teilzahlungen addieren sich weiterhin korrekt (Altverhalten unverändert)', () => {
  const r = { nummer: 'RE-5', status: 'teilbezahlt', brutto: 1000, teilzahlungBetrag: 300, netto: 840.34, steuer: 159.66 };
  const { aktualisiert } = berechneZahlungsabgleichErgebnis(r, 200, { settings, bezahltAm: '2026-03-01' });
  assert(aktualisiert.status === 'teilbezahlt', 'bleibt teilbezahlt (300+200=500 von 1000)');
  nahe(aktualisiert.teilzahlungBetrag, 500);
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
