// Reine Logik-Tests für baueAnhaengeAusSettings()/baueStundennachweisAnhang()
// aus verwaltung/js/agbAnhang.js (14.11.2026, "AGB/Widerrufsbelehrung/
// Stundennachweis/Berichte automatisch mitversenden"). Deckt NICHT
// ermittleDokumentAnhaenge()/listeBerichte()/holeDokumentBlob() ab - die
// brauchen getSettings()/getAll() aus db.js (Firestore/IndexedDB) bzw. einen
// echten Fetch und damit einen Browser, genau wie erzeugeGirocodeDataUrl() in
// girocode.js nicht hier, sondern nur die reine Logik getestet wird.
//
// Ausführen: node verwaltung/tests/agb-anhang.test.mjs
import { baueAnhaengeAusSettings, baueStundennachweisAnhang } from '../js/agbAnhang.js';

let bestanden = 0, fehlgeschlagen = 0;
function pruefe(name, fn) {
  try { fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

const settings = { agbText: '## §1\nText', widerrufText: '## Widerrufsrecht\nText' };

pruefe('A1: agb=true, widerruf=true mit beiden Texten gefüllt liefert beide Anhänge in der richtigen Reihenfolge', () => {
  const anhaenge = baueAnhaengeAusSettings({ agb: true, widerruf: true, settings });
  assert(anhaenge.length === 2, `erwartet 2 Anhänge, erhalten ${anhaenge.length}`);
  assert(anhaenge[0].titel === 'Allgemeine Geschäftsbedingungen', `erwartet AGB zuerst, war "${anhaenge[0].titel}"`);
  assert(anhaenge[1].titel === 'Widerrufsbelehrung', `erwartet Widerruf zweitens, war "${anhaenge[1].titel}"`);
  assert(anhaenge[0].text === settings.agbText);
  assert(anhaenge[1].text === settings.widerrufText);
});

pruefe('A2: agb=false, widerruf=false liefert keinen Anhang', () => {
  const anhaenge = baueAnhaengeAusSettings({ agb: false, widerruf: false, settings });
  assert(anhaenge.length === 0, `erwartet 0 Anhänge, erhalten ${anhaenge.length}`);
});

pruefe('A3: nur agb=true liefert nur die AGB', () => {
  const anhaenge = baueAnhaengeAusSettings({ agb: true, widerruf: false, settings });
  assert(anhaenge.length === 1, `erwartet 1 Anhang, erhalten ${anhaenge.length}`);
  assert(anhaenge[0].titel === 'Allgemeine Geschäftsbedingungen');
});

pruefe('A4: nur widerruf=true liefert nur die Widerrufsbelehrung', () => {
  const anhaenge = baueAnhaengeAusSettings({ agb: true, widerruf: false, settings: { ...settings, agbText: '' } });
  assert(anhaenge.length === 0, 'leerer agbText darf trotz agb=true keinen Anhang erzeugen');
});

pruefe('A5: agb=true aber agbText ist leer/nur Leerzeichen liefert trotzdem keinen AGB-Anhang (kein leeres PDF-Kapitel)', () => {
  const anhaenge = baueAnhaengeAusSettings({ agb: true, widerruf: true, settings: { agbText: '   \n  ', widerrufText: settings.widerrufText } });
  assert(anhaenge.length === 1, `erwartet nur den Widerruf-Anhang, erhalten ${anhaenge.length}`);
  assert(anhaenge[0].titel === 'Widerrufsbelehrung');
});

pruefe('A6: fehlende Settings-Felder (undefined) werfen nicht und liefern keine Anhänge', () => {
  const anhaenge = baueAnhaengeAusSettings({ agb: true, widerruf: true, settings: {} });
  assert(anhaenge.length === 0, `erwartet 0 Anhänge bei undefined-Texten, erhalten ${anhaenge.length}`);
});

pruefe('S1: ohne Einträge liefert baueStundennachweisAnhang() null (kein leerer Anhang)', () => {
  const anhang = baueStundennachweisAnhang({ eintraege: [] });
  assert(anhang === null, 'erwartet null bei leeren Einträgen');
  assert(baueStundennachweisAnhang({ eintraege: undefined }) === null, 'erwartet null bei undefined');
});

pruefe('S2: Einträge werden nach Datum sortiert und die Dauer korrekt in Stunden umgerechnet', () => {
  const anhang = baueStundennachweisAnhang({
    eintraege: [
      { datum: '2026-11-12', taetigkeit: 'baustelle', beschreibung: 'Montage', dauerMinuten: 90 },
      { datum: '2026-11-10', taetigkeit: 'buero', beschreibung: 'Angebot', dauerMinuten: 30 },
    ],
  });
  assert(anhang.titel === 'Stundennachweis');
  assert(anhang.tabelle.rows.length === 2, `erwartet 2 Zeilen, erhalten ${anhang.tabelle.rows.length}`);
  assert(anhang.tabelle.rows[0][2] === 'Angebot', `erwartet den 10.11. zuerst (sortiert), Zeile war ${JSON.stringify(anhang.tabelle.rows[0])}`);
  assert(anhang.tabelle.rows[0][3] === '0,50 h', `erwartet "0,50 h" für 30 Minuten, erhalten "${anhang.tabelle.rows[0][3]}"`);
  assert(anhang.tabelle.rows[1][3] === '1,50 h', `erwartet "1,50 h" für 90 Minuten, erhalten "${anhang.tabelle.rows[1][3]}"`);
});

pruefe('S3: die Gesamtsumme addiert alle Einträge, unabhängig von der Sortierung', () => {
  const anhang = baueStundennachweisAnhang({
    eintraege: [
      { datum: '2026-11-10', taetigkeit: 'baustelle', dauerMinuten: 60 },
      { datum: '2026-11-11', taetigkeit: 'baustelle', dauerMinuten: 45 },
    ],
  });
  assert(anhang.tabelle.summeText === 'Gesamt: 1,75 Stunden', `erwartet "Gesamt: 1,75 Stunden", erhalten "${anhang.tabelle.summeText}"`);
});

pruefe('S4: ein unbekannter Tätigkeits-Code wird als Fallback-Text übernommen statt zu werfen', () => {
  const anhang = baueStundennachweisAnhang({ eintraege: [{ datum: '2026-11-10', taetigkeit: 'nicht-existent-xyz', dauerMinuten: 60 }] });
  assert(anhang.tabelle.rows[0][1] === 'nicht-existent-xyz', `erwartet den rohen Code als Fallback, erhalten "${anhang.tabelle.rows[0][1]}"`);
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
