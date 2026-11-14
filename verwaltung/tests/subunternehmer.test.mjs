// Echter Regressionstest gegen den tatsächlichen Code (verwaltung/js/views/
// subunternehmer.js, reiner Import, keine Kopie) für den CSV-Import und die
// Gewerk-Zuordnung. Lücke aus dem Mitarbeiter-Bereich-Audit (14.11.2026) -
// vorher keine dedizierten Tests.
//
// Ausführen: node verwaltung/tests/subunternehmer.test.mjs
const { gewerkTitel, gewerkIdVonTitel, parseSubunternehmerCsv } = await import('../js/views/subunternehmer.js');

let bestanden = 0, fehlgeschlagen = 0;
function pruefe(name, fn) {
  try { fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

// =============================================================================
// gewerkTitel / gewerkIdVonTitel
// =============================================================================

pruefe('G1: eine bekannte Gewerk-ID liefert den passenden Titel', () => {
  // "elektro" ist das erste/zentrale Gewerk im GEWERKE-Katalog (db.js).
  const titel = gewerkTitel('elektro');
  assert(titel && titel.length > 0, 'elektro muss einen echten Titel haben, nicht leer bleiben');
});

pruefe('G2: eine unbekannte ID liefert einen leeren String statt einer erfundenen Bezeichnung', () => {
  assert(gewerkTitel('nicht-vorhanden-xyz') === '', 'unbekannte Gewerk-ID darf nichts erfinden');
});

pruefe('G3: gewerkIdVonTitel erkennt die ID direkt (Klartext wie aus einer CSV-Zelle)', () => {
  assert(gewerkIdVonTitel('elektro') === 'elektro');
});

pruefe('G4: gewerkIdVonTitel erkennt auch den menschenlesbaren Titel, unabhängig von Groß-/Kleinschreibung', () => {
  const titel = gewerkTitel('elektro');
  assert(gewerkIdVonTitel(titel.toUpperCase()) === 'elektro', `erwartet "elektro" für Titel "${titel}" (großgeschrieben), war "${gewerkIdVonTitel(titel.toUpperCase())}"`);
});

pruefe('G5: ein leerer oder unbekannter Text liefert eine leere ID (kein Rateversuch)', () => {
  assert(gewerkIdVonTitel('') === '');
  assert(gewerkIdVonTitel('Dachdecker-Spezialtruppe-XYZ') === '');
});

// =============================================================================
// parseSubunternehmerCsv
// =============================================================================

pruefe('C1: eine vollständige Zeile wird korrekt in alle Felder aufgeteilt', () => {
  const { rows, errors } = parseSubunternehmerCsv('Trockenbau Schulz;Herr Schulz;0201987654;schulz@example.de;elektro;45;Notiz');
  assert(errors.length === 0, 'keine Fehler erwartet');
  assert(rows.length === 1, 'genau 1 Zeile erwartet');
  const r = rows[0];
  assert(r.firma === 'Trockenbau Schulz' && r.ansprechpartner === 'Herr Schulz' && r.telefon === '0201987654' && r.email === 'schulz@example.de');
  assert(r.gewerk === 'elektro', `Gewerk muss als ID aufgelöst werden, war "${r.gewerk}"`);
  assert(r.stundensatz === 45, `Stundensatz muss als Zahl vorliegen, war ${JSON.stringify(r.stundensatz)}`);
  assert(r.notizen === 'Notiz');
});

pruefe('C2: eine Kopfzeile ("Firma;...") wird erkannt und übersprungen', () => {
  const { rows } = parseSubunternehmerCsv('Firma;Ansprechpartner\nTrockenbau Schulz;Herr Schulz');
  assert(rows.length === 1, `erwartet 1 Datenzeile, war ${rows.length}`);
});

pruefe('C3: eine Zeile ohne Firma wird als Fehler gezählt, nicht als Datensatz', () => {
  const { rows, errors } = parseSubunternehmerCsv(';Herr Schulz;;;;;');
  assert(rows.length === 0 && errors.length === 1, 'Zeile ohne Firma muss in errors landen');
});

pruefe('C4: ein deutsches Komma im Stundensatz (z.B. "45,50") wird korrekt als Zahl erkannt', () => {
  const { rows } = parseSubunternehmerCsv('Trockenbau Schulz;;;;;45,50;');
  assert(rows[0].stundensatz === 45.5, `erwartet 45.5, war ${rows[0].stundensatz}`);
});

pruefe('C5: ein nicht erkanntes Gewerk bleibt leer statt eine falsche ID zu erfinden', () => {
  const { rows } = parseSubunternehmerCsv('Trockenbau Schulz;;;;Fantasiegewerk;;');
  assert(rows[0].gewerk === '', `erwartet leeres Gewerk für unbekannten Text, war "${rows[0].gewerk}"`);
});

pruefe('C6: jede importierte Zeile bekommt eine eigene ID und Farbe (keine doppelt vergebenen IDs)', () => {
  const { rows } = parseSubunternehmerCsv('Firma A;;;;;;\nFirma B;;;;;;');
  assert(rows.length === 2 && rows[0].id !== rows[1].id, 'jede Zeile muss eine eigene, unterschiedliche ID bekommen');
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
