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
const {
  normalisiereAuftragsnummer, findeDublette, istUeberfaellig, baueChecklistenPunkte,
  terminUeberlappt, findeTerminKonflikte, brauchtBestaetigungVorVerschieben, berechneTerminEnde,
  fehlendeServiceauftragFelder,
} = await import('../js/views/serviceauftraege.js');

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

// =============================================================================
// Phase 7: Google-Kalender-Integration - Terminkonflikte, Bestätigungs-
// Rückfrage vor dem Verschieben, Ende-Berechnung aus Start+Dauer.
// =============================================================================

pruefe('K1: zwei Termine desselben Technikers mit überlappendem Zeitraum gelten als Konflikt', () => {
  assert(terminUeberlappt({ start: '2026-11-03T08:00', ende: '2026-11-03T10:00' }, { start: '2026-11-03T09:00', ende: '2026-11-03T11:00' }));
});

pruefe('K2: zwei unmittelbar aneinander anschließende Termine (Ende = Start) überlappen sich NICHT', () => {
  assert(!terminUeberlappt({ start: '2026-11-03T08:00', ende: '2026-11-03T10:00' }, { start: '2026-11-03T10:00', ende: '2026-11-03T12:00' }));
});

pruefe('K3: findeTerminKonflikte findet nur Termine, die mindestens einen gemeinsamen Techniker UND einen überlappenden Zeitraum haben', () => {
  const termine = [
    { id: 't1', mitarbeiterIds: ['ma-1'], start: '2026-11-03T08:00', ende: '2026-11-03T10:00' },
    { id: 't2', mitarbeiterIds: ['ma-2'], start: '2026-11-03T08:30', ende: '2026-11-03T09:30' },
    { id: 't3', mitarbeiterIds: ['ma-1'], start: '2026-11-04T08:00', ende: '2026-11-04T10:00' },
  ];
  const konflikte = findeTerminKonflikte(termine, ['ma-1'], '2026-11-03T09:00', '2026-11-03T11:00', null);
  assert(konflikte.length === 1 && konflikte[0].id === 't1', 't2 hat einen anderen Techniker, t3 einen anderen Tag - nur t1 ist ein echter Konflikt');
});

pruefe('K4: der eigene (gerade bearbeitete) Termin zählt nicht als Konflikt mit sich selbst', () => {
  const termine = [{ id: 't1', mitarbeiterIds: ['ma-1'], start: '2026-11-03T08:00', ende: '2026-11-03T10:00' }];
  assert(findeTerminKonflikte(termine, ['ma-1'], '2026-11-03T08:00', '2026-11-03T10:00', 't1').length === 0);
});

pruefe('K5: ohne Techniker-Zuweisung oder ohne Start gibt es keine Konfliktprüfung', () => {
  const termine = [{ id: 't1', mitarbeiterIds: ['ma-1'], start: '2026-11-03T08:00', ende: '2026-11-03T10:00' }];
  assert(findeTerminKonflikte(termine, [], '2026-11-03T08:00', '2026-11-03T10:00', null).length === 0);
  assert(findeTerminKonflikte(termine, ['ma-1'], '', '', null).length === 0);
});

pruefe('B1 (Spezifikation: "bereits bestätigte Kundentermine nicht ohne Bürofreigabe verschieben"): eine Zeitänderung an einem bestätigten Termin braucht eine Rückfrage', () => {
  const vorher = { start: '2026-11-03T08:00', ende: '2026-11-03T10:00', kundenBestaetigtAm: '2026-11-01T12:00:00.000Z' };
  assert(brauchtBestaetigungVorVerschieben(vorher, '2026-11-04T08:00', '2026-11-04T10:00') === true);
});

pruefe('B2: ein unveränderter Zeitraum braucht KEINE Rückfrage, auch wenn der Termin bestätigt ist', () => {
  const vorher = { start: '2026-11-03T08:00', ende: '2026-11-03T10:00', kundenBestaetigtAm: '2026-11-01T12:00:00.000Z' };
  assert(brauchtBestaetigungVorVerschieben(vorher, '2026-11-03T08:00', '2026-11-03T10:00') === false);
});

pruefe('B3: ein noch NICHT bestätigter Termin braucht auch bei einer Zeitänderung keine Rückfrage', () => {
  const vorher = { start: '2026-11-03T08:00', ende: '2026-11-03T10:00', kundenBestaetigtAm: '' };
  assert(brauchtBestaetigungVorVerschieben(vorher, '2026-11-04T08:00', '2026-11-04T10:00') === false);
});

pruefe('B4: ein neuer Termin (kein vorheriger) braucht keine Rückfrage', () => {
  assert(brauchtBestaetigungVorVerschieben(null, '2026-11-04T08:00', '2026-11-04T10:00') === false);
});

pruefe('E1: berechneTerminEnde addiert die Dauer in Stunden korrekt (inkl. halber Stunden)', () => {
  assert(berechneTerminEnde('2026-11-03T08:00', 2) === '2026-11-03T10:00');
  assert(berechneTerminEnde('2026-11-03T08:00', 1.5) === '2026-11-03T09:30');
});

pruefe('E2: berechneTerminEnde rechnet korrekt über Mitternacht hinaus', () => {
  assert(berechneTerminEnde('2026-11-03T23:00', 2) === '2026-11-04T01:00');
});

// =============================================================================
// fehlendeServiceauftragFelder (Datenvollständigkeits-Check für bereits
// angelegte Serviceaufträge - unabhängig von der reinen Entwurfsprüfung
// vor der Partner-Import-Übernahme)
// =============================================================================

pruefe('G1: ein vollständig ausgefüllter Auftrag liefert keine fehlenden Felder', () => {
  const auftrag = {
    kundeId: 'k-1', kundenname: '', serviceempfaenger: 'Herr Krause', einsatzadresse: 'Musterweg 1, 45141 Essen',
    telefonnummer: '0201123', wartungsart: 'Jahreswartung', auftragsfrist: '2026-12-01',
  };
  assert(fehlendeServiceauftragFelder(auftrag).length === 0);
});

pruefe('G2: kundeId ODER kundenname reicht - beide leer wird als fehlender Kunde gemeldet', () => {
  const basis = { serviceempfaenger: 'x', einsatzadresse: 'x', telefonnummer: 'x', wartungsart: 'x', auftragsfrist: '2026-12-01' };
  assert(fehlendeServiceauftragFelder({ ...basis, kundeId: '', kundenname: 'TLS Eco Plus Service' }).length === 0, 'kundenname allein reicht');
  assert(fehlendeServiceauftragFelder({ ...basis, kundeId: 'k-1', kundenname: '' }).length === 0, 'kundeId allein reicht');
  assert(fehlendeServiceauftragFelder({ ...basis, kundeId: '', kundenname: '' }).includes('Kunde'), 'ohne beides muss "Kunde" als fehlend gemeldet werden');
});

pruefe('G3: jedes leere Pflichtfeld wird einzeln benannt, mehrere gleichzeitig fehlende Felder werden alle gemeldet', () => {
  const fehlend = fehlendeServiceauftragFelder({ kundeId: 'k-1', serviceempfaenger: '', einsatzadresse: '', telefonnummer: 'x', wartungsart: 'x', auftragsfrist: '' });
  assert(fehlend.includes('Serviceempfänger') && fehlend.includes('Einsatzadresse') && fehlend.includes('Auftragsfrist'), `erwartet Serviceempfänger/Einsatzadresse/Auftragsfrist, war ${JSON.stringify(fehlend)}`);
  assert(fehlend.length === 3, `es dürfen nur die tatsächlich leeren Felder gemeldet werden, war ${JSON.stringify(fehlend)}`);
});

pruefe('G4: ein Feld mit nur Leerzeichen zählt als leer, nicht als ausgefüllt', () => {
  const fehlend = fehlendeServiceauftragFelder({ kundeId: 'k-1', serviceempfaenger: '   ', einsatzadresse: 'x', telefonnummer: 'x', wartungsart: 'x', auftragsfrist: '2026-12-01' });
  assert(fehlend.includes('Serviceempfänger'), 'reine Leerzeichen dürfen nicht als Wert gelten');
});

pruefe('G5: anlagenId/Anlagendetails sind KEIN Pflichtfeld (bewusst keine automatische Anlagenzuordnung in dieser Phase)', () => {
  const auftrag = {
    kundeId: 'k-1', serviceempfaenger: 'x', einsatzadresse: 'x', telefonnummer: 'x', wartungsart: 'x', auftragsfrist: '2026-12-01',
    anlagenId: '', herstellerUndAnlagentyp: '',
  };
  assert(fehlendeServiceauftragFelder(auftrag).length === 0, 'eine fehlende Anlagenzuordnung darf hier nicht als Datenfehler gemeldet werden');
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
