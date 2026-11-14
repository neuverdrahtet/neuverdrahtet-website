// Echter Regressionstest gegen den tatsächlichen Code (verwaltung/js/views/
// mitarbeiter.js, reiner Import, keine Kopie) für CSV-Import, Status-Anzeige
// (Urlaub/Krank/Schulung/Baustelle) und die Lohnvorbereitung. Lücke aus dem
// Mitarbeiter-Bereich-Audit (14.11.2026) - vorher keine dedizierten Tests.
//
// Ausführen: node verwaltung/tests/mitarbeiter.test.mjs
//
// mitarbeiter.js importiert dokumente.js -> emailsend.js -> google.js, das
// beim bloßen Modul-Laden (nicht erst bei Aufruf) auf localStorage zugreift -
// unter Node ohne Browser-DOM gibt es das nicht. Gleicher Shim wie in
// serviceauftraege.test.mjs, per dynamischem import() (ein statischer
// "import" würde vor dieser Zeile ausgeführt, der Shim wäre zu spät).
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { parseMitarbeiterCsv, currentStatusFor, currentYearCount, tageImMonat } = await import('../js/views/mitarbeiter.js');

let bestanden = 0, fehlgeschlagen = 0;
function pruefe(name, fn) {
  try { fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

// =============================================================================
// parseMitarbeiterCsv
// =============================================================================

pruefe('C1: eine einfache Zeile mit Name + Rolle wird korrekt eingelesen', () => {
  const { rows, errors } = parseMitarbeiterCsv('Max Muster;;Elektriker');
  assert(errors.length === 0, 'keine Fehler erwartet');
  assert(rows.length === 1 && rows[0].name === 'Max Muster', 'Name muss übernommen werden');
  assert(rows[0].rolle === 'Elektriker', `Rolle muss an dritter Spalte stehen, war "${rows[0].rolle}"`);
});

pruefe('C2: eine Kopfzeile ("Name;...") wird erkannt und übersprungen', () => {
  const { rows } = parseMitarbeiterCsv('Name;Personalnummer;Rolle\nMax Muster;123;Elektriker');
  assert(rows.length === 1, `erwartet 1 Datenzeile (Kopfzeile übersprungen), war ${rows.length}`);
});

pruefe('C3: eine Zeile ohne Namen wird als Fehler gezählt, nicht als Datensatz', () => {
  const { rows, errors } = parseMitarbeiterCsv(';123;Elektriker');
  assert(rows.length === 0 && errors.length === 1, 'Zeile ohne Name muss in errors landen, nicht in rows');
});

pruefe('C4: Komma als Trennzeichen wird erkannt, wenn kein Semikolon vorkommt', () => {
  const { rows } = parseMitarbeiterCsv('Max Muster,,Elektriker');
  assert(rows.length === 1 && rows[0].rolle === 'Elektriker', 'Komma-Trennzeichen muss funktionieren');
});

pruefe('C5: fehlende Vertragsart wird nicht erfunden, sondern auf "Vollzeit" vorbelegt (dokumentiertes Standardverhalten)', () => {
  const { rows } = parseMitarbeiterCsv('Max Muster');
  assert(rows[0].vertragsart === 'Vollzeit', `erwartet Standard "Vollzeit", war "${rows[0].vertragsart}"`);
  assert(rows[0].zugriffsrolle === 'mitarbeiter', 'neu importierte Mitarbeiter müssen die Zugriffsrolle "mitarbeiter" bekommen, nie versehentlich admin');
});

// =============================================================================
// currentStatusFor (nutzt new Date() intern - Tests rechnen relativ zu heute,
// um ohne Date-Mock deterministisch zu bleiben)
// =============================================================================

const heute = new Date().toISOString().slice(0, 10);
function tagePlus(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

pruefe('S1: ein heute laufender Urlaubstermin wird als aktueller Status erkannt', () => {
  const termine = [{ mitarbeiterIds: ['m1'], typ: 'urlaub', start: `${tagePlus(-2)}T00:00`, ende: `${tagePlus(2)}T23:59` }];
  const status = currentStatusFor(termine, 'm1');
  assert(status && status.id === 'urlaub', `erwartet Status "urlaub", war ${JSON.stringify(status)}`);
});

pruefe('S2: ein bereits abgelaufener Urlaubstermin zählt nicht mehr als aktueller Status', () => {
  const termine = [{ mitarbeiterIds: ['m1'], typ: 'urlaub', start: `${tagePlus(-10)}T00:00`, ende: `${tagePlus(-2)}T23:59` }];
  assert(currentStatusFor(termine, 'm1') === null, 'ein vergangener Termin darf nicht als aktueller Status gelten');
});

pruefe('S3: ein Termin eines anderen Mitarbeiters wird nicht übernommen', () => {
  const termine = [{ mitarbeiterIds: ['m2'], typ: 'urlaub', start: `${tagePlus(-1)}T00:00`, ende: `${tagePlus(1)}T23:59` }];
  assert(currentStatusFor(termine, 'm1') === null, 'Termine anderer Mitarbeiter dürfen nicht zugeordnet werden');
});

pruefe('S4: ein Termin mit einem nicht als Status geführten Typ (z.B. "wartung") wird ignoriert', () => {
  const termine = [{ mitarbeiterIds: ['m1'], typ: 'wartung', start: `${heute}T00:00`, ende: `${heute}T23:59` }];
  assert(currentStatusFor(termine, 'm1') === null, 'nur urlaub/krank/schulung/baustelle sind Status-Typen');
});

// =============================================================================
// currentYearCount
// =============================================================================

pruefe('J1: nur Termine des laufenden Jahres werden gezählt', () => {
  const jahr = new Date().getFullYear();
  const termine = [
    { mitarbeiterIds: ['m1'], typ: 'urlaub', start: `${jahr}-03-10T00:00` },
    { mitarbeiterIds: ['m1'], typ: 'urlaub', start: `${jahr - 1}-03-10T00:00` },
  ];
  assert(currentYearCount(termine, 'm1', 'urlaub') === 1, 'Termine aus Vorjahren dürfen nicht mitgezählt werden');
});

pruefe('J2: nur Termine mit passendem Typ UND passender Mitarbeiter-Zuordnung zählen', () => {
  const jahr = new Date().getFullYear();
  const termine = [
    { mitarbeiterIds: ['m1'], typ: 'urlaub', start: `${jahr}-03-10T00:00` },
    { mitarbeiterIds: ['m1'], typ: 'krank', start: `${jahr}-04-10T00:00` },
    { mitarbeiterIds: ['m2'], typ: 'urlaub', start: `${jahr}-05-10T00:00` },
  ];
  assert(currentYearCount(termine, 'm1', 'urlaub') === 1, `erwartet genau 1 Treffer, war ${currentYearCount(termine, 'm1', 'urlaub')}`);
});

// =============================================================================
// tageImMonat (Lohnvorbereitung)
// =============================================================================

pruefe('T1: ein ganz innerhalb des Monats liegender Termin wird mit der tatsächlichen Tagesanzahl gezählt', () => {
  const termin = { typ: 'urlaub', start: '2026-03-10T00:00', ende: '2026-03-15T23:59' };
  assert(tageImMonat(termin, 'urlaub', '2026-03-01', '2026-03-31') === 6, 'vom 10. bis 15. sind 6 Tage');
});

pruefe('T2: ein über den Monatsanfang hinausreichender Termin wird am Monatsanfang gekappt', () => {
  const termin = { typ: 'urlaub', start: '2026-02-25T00:00', ende: '2026-03-05T23:59' };
  assert(tageImMonat(termin, 'urlaub', '2026-03-01', '2026-03-31') === 5, 'vom 1. bis 5. März sind 5 Tage, der Februar-Anteil zählt nicht');
});

pruefe('T3: ein Termin mit falschem Typ wird nicht gezählt', () => {
  const termin = { typ: 'krank', start: '2026-03-10T00:00', ende: '2026-03-15T23:59' };
  assert(tageImMonat(termin, 'urlaub', '2026-03-01', '2026-03-31') === 0, 'Krankheitstermine dürfen nicht als Urlaub gezählt werden');
});

pruefe('T4: ein Termin außerhalb des Monats ergibt 0', () => {
  const termin = { typ: 'urlaub', start: '2026-01-10T00:00', ende: '2026-01-15T23:59' };
  assert(tageImMonat(termin, 'urlaub', '2026-03-01', '2026-03-31') === 0, 'ein Termin im Januar darf im März-Report nicht auftauchen');
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
