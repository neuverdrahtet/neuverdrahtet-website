// Echter Regressionstest gegen den tatsächlichen Code (verwaltung/js/views/
// serviceauftraege.js, reiner Import, keine Kopie) für die Dublettenprüfung
// und die Fristüberwachung der Service-Auftragsverwaltung (Phase 1 der
// Service-/Techniker-/Personalverwaltung).
//
// Ausführen: node verwaltung/tests/serviceauftraege.test.mjs
//
// serviceauftraege.js importiert seit Phase 5/6 (Wartungsdokumentation)
// dokumente.js, das transitiv über emailsend.js -> google.js beim bloßen
// Modul-Laden (nicht erst bei Aufruf) auf localStorage zugreift - unter
// Node ohne Browser-DOM gibt es das nicht. Ein winziger In-Memory-Shim
// reicht, da dieser Test ausschließlich die reinen Funktionen
// (Dublettenprüfung/Fristüberwachung) prüft, nie tatsächlich mit
// Google/E-Mail interagiert. Per dynamischem import() statt eines
// statischen - ein statischer "import" wird vor jedem anderen Code im
// Modul ausgeführt (auch vor dieser Zeile), der Shim wäre dann zu spät.
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { normalisiereAuftragsnummer, findeDublette, istUeberfaellig, baueChecklistenPunkte } = await import('../js/views/serviceauftraege.js');

let bestanden = 0, fehlgeschlagen = 0;
function pruefe(name, fn) {
  try { fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

// =============================================================================
// normalisiereAuftragsnummer / findeDublette
// =============================================================================

pruefe('D1: zwei identische Auftragsnummern werden als Dublette erkannt', () => {
  const liste = [{ id: 'a1', externeAuftragsnummer: 'SE-2026-001' }];
  const treffer = findeDublette(liste, 'SE-2026-001', 'a2');
  assert(treffer && treffer.id === 'a1', 'muss die vorhandene Auftragsnummer als Dublette finden');
});

pruefe('D2: Groß-/Kleinschreibung und umgebende Leerzeichen spielen keine Rolle', () => {
  const liste = [{ id: 'a1', externeAuftragsnummer: '  SE-2026-001  ' }];
  const treffer = findeDublette(liste, 'se-2026-001', 'a2');
  assert(treffer && treffer.id === 'a1', 'Normalisierung muss Groß-/Kleinschreibung und Leerzeichen ignorieren');
});

pruefe('D3: das eigene Dokument (beim Bearbeiten) zählt NICHT als Dublette', () => {
  const liste = [{ id: 'a1', externeAuftragsnummer: 'SE-2026-001' }];
  const treffer = findeDublette(liste, 'SE-2026-001', 'a1');
  assert(treffer === null, 'die eigene ID darf nicht als Dublette ihrer selbst gelten');
});

pruefe('D4: eine leere Auftragsnummer liefert nie eine Dublette', () => {
  const liste = [{ id: 'a1', externeAuftragsnummer: '' }, { id: 'a2', externeAuftragsnummer: '' }];
  assert(findeDublette(liste, '', 'a3') === null, 'leere Nummern dürfen nicht gegeneinander als Dublette gelten');
});

pruefe('D5: unterschiedliche Auftragsnummern sind keine Dublette', () => {
  const liste = [{ id: 'a1', externeAuftragsnummer: 'SE-2026-001' }];
  assert(findeDublette(liste, 'SE-2026-002', 'a2') === null);
});

pruefe('D6: normalisiereAuftragsnummer ist stabil gegenüber undefined/null', () => {
  assert(normalisiereAuftragsnummer(undefined) === '');
  assert(normalisiereAuftragsnummer(null) === '');
  assert(normalisiereAuftragsnummer('  Ab-1 ') === 'ab-1');
});

// =============================================================================
// istUeberfaellig
// =============================================================================

pruefe('F1: ein offener Auftrag mit Frist in der Vergangenheit ist überfällig', () => {
  assert(istUeberfaellig({ status: 'zugewiesen', auftragsfrist: '2026-01-01' }, '2026-06-01') === true);
});

pruefe('F2: ein Auftrag ohne Frist ist nie überfällig', () => {
  assert(istUeberfaellig({ status: 'zugewiesen', auftragsfrist: '' }, '2026-06-01') === false);
});

pruefe('F3: ein ABGESCHLOSSENER Auftrag ist auch mit überschrittener Frist nicht überfällig', () => {
  assert(istUeberfaellig({ status: 'abgeschlossen', auftragsfrist: '2026-01-01' }, '2026-06-01') === false);
});

pruefe('F4: ein ABGEBROCHENER Auftrag ist auch mit überschrittener Frist nicht überfällig', () => {
  assert(istUeberfaellig({ status: 'abgebrochen', auftragsfrist: '2026-01-01' }, '2026-06-01') === false);
});

pruefe('F5: eine Frist in der Zukunft ist nicht überfällig', () => {
  assert(istUeberfaellig({ status: 'offen', auftragsfrist: '2026-12-31' }, '2026-06-01') === false);
});

// =============================================================================
// baueChecklistenPunkte (Phase 4: Checkliste des Büros -> Textzeilen -> Punkte,
// unter Erhalt des Technikerfortschritts bei unveränderten Zeilen)
// =============================================================================

pruefe('C1: aus einfachen Textzeilen entstehen neue, offene Checklistenpunkte', () => {
  const punkte = baueChecklistenPunkte('Sichtprüfung\nFilter geprüft', []);
  assert(punkte.length === 2);
  assert(punkte[0].titel === 'Sichtprüfung' && punkte[0].erledigt === false);
  assert(punkte[1].titel === 'Filter geprüft' && punkte[1].erledigt === false);
});

pruefe('C2: eine unveränderte Zeile behält den erledigt-Status (Technikerfortschritt geht nicht verloren)', () => {
  const vorherige = [{ titel: 'Sichtprüfung', erledigt: true, notiz: 'i.O.' }];
  const punkte = baueChecklistenPunkte('Sichtprüfung', vorherige);
  assert(punkte.length === 1);
  assert(punkte[0].erledigt === true, 'erledigt muss erhalten bleiben');
  assert(punkte[0].notiz === 'i.O.', 'Notiz muss erhalten bleiben');
});

pruefe('C3: eine inhaltlich geänderte Zeile (neuer Titel) startet wieder bei "offen"', () => {
  const vorherige = [{ titel: 'Sichtprüfung', erledigt: true, notiz: 'i.O.' }];
  const punkte = baueChecklistenPunkte('Sichtprüfung erweitert', vorherige);
  assert(punkte[0].titel === 'Sichtprüfung erweitert');
  assert(punkte[0].erledigt === false, 'eine neue/geänderte Zeile ist nicht automatisch erledigt');
});

pruefe('C4: leere Zeilen werden ignoriert', () => {
  const punkte = baueChecklistenPunkte('Sichtprüfung\n\n   \nFilter geprüft', []);
  assert(punkte.length === 2);
});

pruefe('C5: eine führende "[x] "/"[ ] "-Markierung (aus der Anzeige) wird beim erneuten Einlesen ignoriert, nicht Teil des Titels', () => {
  const vorherige = [{ titel: 'Sichtprüfung', erledigt: true, notiz: '' }];
  const punkte = baueChecklistenPunkte('[x] Sichtprüfung\n[ ] Filter geprüft', vorherige);
  assert(punkte[0].titel === 'Sichtprüfung' && punkte[0].erledigt === true, 'Titel ohne Markierung muss wieder auf den vorherigen Punkt matchen');
  assert(punkte[1].titel === 'Filter geprüft' && punkte[1].erledigt === false);
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
