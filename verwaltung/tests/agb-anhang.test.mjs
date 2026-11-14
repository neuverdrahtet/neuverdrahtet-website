// Reine Logik-Tests für baueAnhaengeAusSettings() aus verwaltung/js/agbAnhang.js
// (14.11.2026, "AGB/Widerrufsbelehrung automatisch mitversenden"). Deckt
// NICHT ermittleDokumentAnhaenge() ab - das braucht getSettings() aus db.js
// (Firestore/IndexedDB) und damit einen Browser, genau wie erzeugeGirocodeDataUrl()
// in girocode.js nicht hier, sondern nur die reine Logik getestet wird.
//
// Ausführen: node verwaltung/tests/agb-anhang.test.mjs
import { baueAnhaengeAusSettings } from '../js/agbAnhang.js';

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

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
