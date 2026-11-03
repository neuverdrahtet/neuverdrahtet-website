// Reine Logik-Tests für verwaltung/js/dsgvo.js (Maßnahme 9, DSGVO
// Auskunft/Löschung je Kunde). Alle drei exportierten Funktionen sind reine
// Funktionen auf Plain-Objects (keine Firestore-/Browser-Abhängigkeit) -
// genau das wird hier abgedeckt. Die eigentliche Firestore-Schreiboperation
// (put('kunden', ...)) und der Download-Trigger laufen in kunden.js und
// brauchen echte Firebase-/Browser-APIs, siehe browser-smoke.test.mjs.
//
// Ausführen: node verwaltung/tests/dsgvo.test.mjs
import { erzeugeDatenauskunft, pruefeLoeschsperre, berechneLoeschung } from '../js/dsgvo.js';

let bestanden = 0, fehlgeschlagen = 0;
function pruefe(name, fn) {
  try { fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

const KUNDE = {
  id: 'k1', firma: 'Mustermann GmbH', ansprechpartner: 'Max Mustermann',
  telefon: '0201 123456', email: 'max@mustermann.de', strasse: 'Musterstr. 1',
  plz: '45127', ort: 'Essen', notizen: 'Bevorzugt Termine vormittags.',
  kundennummer: 'K-2026-001', portalZugangscode: 'abc123',
};

function leererKontext(overrides = {}) {
  return {
    projekte: [], termine: [], angebote: [], auftragsbestaetigungen: [],
    rechnungen: [], gutschriften: [], ausgaben: [], emails: [], dokumente: [], mahnungen: [],
    ...overrides,
  };
}

pruefe('D1: Auskunft enthält Stammdaten + nur die diesem Kunden zugeordneten Datensätze', () => {
  const kontext = leererKontext({
    projekte: [{ id: 'p1', kundeId: 'k1', titel: 'Zählerschrank' }, { id: 'p2', kundeId: 'anderer' }],
    rechnungen: [{ id: 'r1', kundeId: 'k1', nummer: 'RE-1' }],
    mahnungen: [{ id: 'm1', rechnungId: 'r1', stufe: 1 }, { id: 'm2', rechnungId: 'andere-rechnung' }],
  });
  const auskunft = erzeugeDatenauskunft(KUNDE, kontext);
  assert(auskunft.stammdaten === KUNDE, 'Stammdaten müssen den Kunden selbst enthalten');
  assert(auskunft.projekte.length === 1 && auskunft.projekte[0].id === 'p1', 'nur verknüpfte Projekte dürfen enthalten sein');
  assert(auskunft.rechnungen.length === 1 && auskunft.rechnungen[0].id === 'r1');
  assert(auskunft.mahnungen.length === 1 && auskunft.mahnungen[0].id === 'm1', 'Mahnungen werden über die Rechnungs-ID des Kunden gefunden');
  assert(typeof auskunft.erzeugtAm === 'string' && auskunft.erzeugtAm.length > 0);
});

pruefe('D2: ohne versendete Rechnungen/Gutschriften besteht keine Löschsperre', () => {
  const kontext = leererKontext({ rechnungen: [{ id: 'r1', kundeId: 'k1', nummer: 'RE-1', versendet: false }] });
  const { gesperrt, gesperrteBelege } = pruefeLoeschsperre(KUNDE, kontext);
  assert(gesperrt === false, 'ein Rechnungsentwurf (nicht versendet) darf keine Sperre auslösen');
  assert(gesperrteBelege.length === 0);
});

pruefe('D3: eine versendete (GoBD-gesperrte) Rechnung löst die Löschsperre aus', () => {
  const kontext = leererKontext({ rechnungen: [{ id: 'r1', kundeId: 'k1', nummer: 'RE-2026-003', versendet: true }] });
  const { gesperrt, gesperrteBelege } = pruefeLoeschsperre(KUNDE, kontext);
  assert(gesperrt === true);
  assert(gesperrteBelege.length === 1 && gesperrteBelege[0].nummer === 'RE-2026-003' && gesperrteBelege[0].typ === 'Rechnung');
});

pruefe('D4: eine versendete Gutschrift löst die Löschsperre genauso aus', () => {
  const kontext = leererKontext({ gutschriften: [{ id: 'g1', kundeId: 'k1', nummer: 'GS-2026-001', versendet: true }] });
  const { gesperrt, gesperrteBelege } = pruefeLoeschsperre(KUNDE, kontext);
  assert(gesperrt === true);
  assert(gesperrteBelege[0].typ === 'Gutschrift');
});

pruefe('D5: ohne Sperre werden Kontaktdaten UND Firma/Anschrift anonymisiert', () => {
  const { aktualisiert, geloeschteFelder, gesperrt } = berechneLoeschung(KUNDE, leererKontext());
  assert(gesperrt === false);
  assert(aktualisiert.ansprechpartner === '' && aktualisiert.telefon === '' && aktualisiert.email === '');
  assert(aktualisiert.notizen === '' && aktualisiert.portalZugangscode === '');
  assert(aktualisiert.strasse === '' && aktualisiert.plz === '' && aktualisiert.ort === '');
  assert(aktualisiert.firma.startsWith('Gelöschter Kunde'), `Firma muss anonymisiert werden, war "${aktualisiert.firma}"`);
  assert(geloeschteFelder.includes('ansprechpartner') && geloeschteFelder.some((f) => f.startsWith('firma')));
  assert(aktualisiert.id === 'k1', 'die ID darf sich nie ändern');
});

pruefe('D6: mit Sperre bleiben Firma/Anschrift bestehen, Kontaktdaten werden trotzdem gelöscht', () => {
  const kontext = leererKontext({ rechnungen: [{ id: 'r1', kundeId: 'k1', nummer: 'RE-2026-003', versendet: true }] });
  const { aktualisiert, geloeschteFelder, gesperrt, gesperrteBelege } = berechneLoeschung(KUNDE, kontext);
  assert(gesperrt === true);
  assert(gesperrteBelege.length === 1);
  assert(aktualisiert.firma === KUNDE.firma, 'Firma darf bei GoBD-Sperre NICHT verändert werden');
  assert(aktualisiert.strasse === KUNDE.strasse && aktualisiert.ort === KUNDE.ort, 'Anschrift darf bei GoBD-Sperre NICHT verändert werden');
  assert(aktualisiert.telefon === '' && aktualisiert.email === '' && aktualisiert.notizen === '', 'Kontaktdaten/Notizen werden unabhängig von der Sperre gelöscht');
  assert(!geloeschteFelder.some((f) => f.startsWith('firma')), 'Firma darf nicht in der Liste der gelöschten Felder stehen');
});

pruefe('D7: ein bereits anonymisierter Kunde ohne verbleibende Daten liefert eine leere Löschliste', () => {
  const bereitsGeloescht = { id: 'k2', firma: 'Gelöschter Kunde (ehem. K-2026-002)' };
  const { geloeschteFelder } = berechneLoeschung(bereitsGeloescht, leererKontext());
  assert(geloeschteFelder.length === 0, 'nichts mehr zu löschen, Firma bleibt beim bereits anonymisierten Platzhalter');
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
