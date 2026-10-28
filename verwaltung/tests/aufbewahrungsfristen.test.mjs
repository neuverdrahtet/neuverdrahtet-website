// Echter Regressionstest gegen den tatsächlichen Code (verwaltung/js/db.js,
// reiner Import, keine Kopie) für die P0-Sicherheitskorrektur vom
// 28.10.2026 (Master-Audit, Bericht 03, Risiko #1): Aufbewahrungspflichtige
// Belege (Rechnungen/Gutschriften/Ausgaben/Mahnungen) dürfen nicht mehr
// pauschal nach 30 Tagen im Papierkorb endgültig gelöscht werden.
//
// Ausführen: node verwaltung/tests/aufbewahrungsfristen.test.mjs
// hardRemove()/get() werden hier bewusst NICHT importiert und aufgerufen -
// unter FIREBASE_ENABLED lösen sie echte Firestore-Zugriffe (inkl.
// Echtzeit-Listener) gegen das Live-Projekt aus, was in dieser Testdatei
// (ohne Emulator, ohne Anmeldung) weder gewollt noch sicher ist (Vorgabe:
// keine produktiven Datenbankzugriffe). Die Fristlogik selbst ist reine
// Funktionslogik ohne I/O und wird hier vollständig isoliert geprüft; ein
// Test gegen einen echten/emulierten Datensatz gehört nach firestore-tests/.
import { trashTageFuer, fruehesterEndgueltigLoeschZeitpunkt, istEndgueltigLoeschbar } from '../js/db.js';

let bestanden = 0, fehlgeschlagen = 0;
function pruefe(name, fn) {
  try { fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

const TAGE_PRO_JAHR = 365.25;
const ZEHN_JAHRE_TAGE = Math.ceil(10 * TAGE_PRO_JAHR);

pruefe('A1: Rechnungen/Gutschriften/Ausgaben haben die 10-Jahres-GoBD-Frist', () => {
  assert(trashTageFuer('rechnungen') === ZEHN_JAHRE_TAGE, 'rechnungen');
  assert(trashTageFuer('gutschriften') === ZEHN_JAHRE_TAGE, 'gutschriften');
  assert(trashTageFuer('ausgaben') === ZEHN_JAHRE_TAGE, 'ausgaben');
});

pruefe('A2: Mahnungen haben (bis zur Klärung mit dem Steuerberater) ebenfalls die lange Frist', () => {
  assert(trashTageFuer('mahnungen') === ZEHN_JAHRE_TAGE, 'mahnungen');
});

pruefe('A3: Alle übrigen Papierkorb-Stores bleiben bei 30 Tagen', () => {
  for (const store of ['kunden', 'projekte', 'aufgaben', 'mitarbeiter', 'geraete', 'flotten', 'katalog', 'angebote', 'zeiterfassung', 'vorlagen', 'lieferanten', 'subunternehmer']) {
    assert(trashTageFuer(store) === 30, store);
  }
});

pruefe('A4: Unbekannter Store fällt auf den 30-Tage-Standard zurück', () => {
  assert(trashTageFuer('irgendwas-unbekanntes') === 30);
});

pruefe('A5: fruehesterEndgueltigLoeschZeitpunkt ist null ohne _geloeschtAm', () => {
  assert(fruehesterEndgueltigLoeschZeitpunkt('rechnungen', {}) === null);
  assert(fruehesterEndgueltigLoeschZeitpunkt('rechnungen', null) === null);
});

pruefe('A6: Eine vor 29 Tagen gelöschte Rechnung ist NICHT löschbar (GoBD-Frist: 10 Jahre)', () => {
  const vor29Tagen = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString();
  assert(istEndgueltigLoeschbar('rechnungen', { _geloescht: true, _geloeschtAm: vor29Tagen }) === false);
});

pruefe('A7: Ein vor 29 Tagen gelöschter Kunde IST löschbar (Standardfrist 30 Tage noch nicht erreicht -> erst ab Tag 30)', () => {
  const vor31Tagen = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  assert(istEndgueltigLoeschbar('kunden', { _geloescht: true, _geloeschtAm: vor31Tagen }) === true);
});

pruefe('A8: Ein vor 9 Tagen gelöschter Kunde ist NOCH NICHT löschbar', () => {
  const vor9Tagen = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString();
  assert(istEndgueltigLoeschbar('kunden', { _geloescht: true, _geloeschtAm: vor9Tagen }) === false);
});

pruefe('A9: Eine erst vor 1 Tag gelöschte Rechnung ist weit von der 10-Jahres-Frist entfernt', () => {
  const grenze = fruehesterEndgueltigLoeschZeitpunkt('rechnungen', { _geloeschtAm: new Date().toISOString() });
  const jahreBisGrenze = (grenze.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * TAGE_PRO_JAHR);
  assert(jahreBisGrenze > 9.9 && jahreBisGrenze < 10.1, `erwartet ~10 Jahre, war ${jahreBisGrenze}`);
});

pruefe('A10: eine Rechnung genau an der 10-Jahres-Grenze ist noch nicht löschbar, einen Tag später schon', () => {
  const genauZehnJahre = new Date(Date.now() - ZEHN_JAHRE_TAGE * 24 * 60 * 60 * 1000 + 60 * 1000).toISOString(); // 1 Minute VOR Ablauf
  const knappDrueber = new Date(Date.now() - (ZEHN_JAHRE_TAGE + 1) * 24 * 60 * 60 * 1000).toISOString();
  assert(istEndgueltigLoeschbar('rechnungen', { _geloescht: true, _geloeschtAm: genauZehnJahre }) === false, 'knapp vor Ablauf');
  assert(istEndgueltigLoeschbar('rechnungen', { _geloescht: true, _geloeschtAm: knappDrueber }) === true, 'einen Tag nach Ablauf');
});

pruefe('A11: eine VERSENDETE Rechnung ist auch nach Ablauf der 10-Jahres-Frist nie löschbar (nur Storno)', () => {
  const laengstAbgelaufen = new Date(Date.now() - (ZEHN_JAHRE_TAGE + 365) * 24 * 60 * 60 * 1000).toISOString();
  assert(istEndgueltigLoeschbar('rechnungen', { _geloescht: true, _geloeschtAm: laengstAbgelaufen, versendet: true }) === false, 'versendet + Frist abgelaufen -> trotzdem nicht löschbar');
});

pruefe('A12: eine NICHT versendete Rechnung (Entwurf) folgt weiterhin der normalen 10-Jahres-Frist', () => {
  const laengstAbgelaufen = new Date(Date.now() - (ZEHN_JAHRE_TAGE + 365) * 24 * 60 * 60 * 1000).toISOString();
  assert(istEndgueltigLoeschbar('rechnungen', { _geloescht: true, _geloeschtAm: laengstAbgelaufen, versendet: false }) === true);
});

console.log(`--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
if (fehlgeschlagen > 0) process.exit(1);
