// Tests für lib/access.js - rollenbasierte Zugriffskontrolle der
// generischen Collection-API. Rein lokale Logik-Tests, keine Datenbank/kein
// Netzwerk nötig.
//
// Ausführen: node selfhost-server/tests/access.test.mjs
import { pruefeCollectionZugriff, filtereZeilenFuerRolle, istZeileErlaubt } from '../lib/access.js';

let bestanden = 0, fehlgeschlagen = 0;
function pruefe(name, fn) {
  try { fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

pruefe('admin darf jede Collection mit jeder Methode', () => {
  assert(pruefeCollectionZugriff({ role: 'admin' }, 'mitarbeiter', 'DELETE').ok === true, 'admin -> mitarbeiter DELETE sollte erlaubt sein');
  assert(pruefeCollectionZugriff({ role: 'admin' }, 'rechnungen', 'PUT').ok === true, 'admin -> rechnungen PUT sollte erlaubt sein');
});

pruefe('buero darf wie admin alles', () => {
  assert(pruefeCollectionZugriff({ role: 'buero' }, 'katalog', 'PUT').ok === true, 'buero -> katalog PUT sollte erlaubt sein');
});

pruefe('kunde darf nur lesen', () => {
  const schreibversuch = pruefeCollectionZugriff({ role: 'kunde' }, 'rechnungen', 'PUT');
  assert(schreibversuch.ok === false && schreibversuch.status === 403, 'kunde -> PUT sollte abgelehnt werden');
  const loeschversuch = pruefeCollectionZugriff({ role: 'kunde' }, 'rechnungen', 'DELETE');
  assert(loeschversuch.ok === false, 'kunde -> DELETE sollte abgelehnt werden');
});

pruefe('kunde darf nur erlaubte Collections lesen', () => {
  assert(pruefeCollectionZugriff({ role: 'kunde' }, 'rechnungen', 'GET').ok === true, 'kunde -> rechnungen GET sollte erlaubt sein');
  assert(pruefeCollectionZugriff({ role: 'kunde' }, 'kunden', 'GET').ok === true, 'kunde -> kunden GET sollte erlaubt sein (eigener Datensatz)');
  const fremdeCollection = pruefeCollectionZugriff({ role: 'kunde' }, 'mitarbeiter', 'GET');
  assert(fremdeCollection.ok === false && fremdeCollection.status === 403, 'kunde -> mitarbeiter GET sollte abgelehnt werden');
  const finanzen = pruefeCollectionZugriff({ role: 'kunde' }, 'konten', 'GET');
  assert(finanzen.ok === false, 'kunde -> konten GET sollte abgelehnt werden');
});

pruefe('mitarbeiter/techniker ohne Zugriff auf sensible Collections', () => {
  for (const rolle of ['mitarbeiter', 'techniker']) {
    const personaldaten = pruefeCollectionZugriff({ role: rolle }, 'mitarbeiter', 'GET');
    assert(personaldaten.ok === false && personaldaten.status === 403, `${rolle} -> mitarbeiter GET sollte abgelehnt werden`);
    const einkaufspreise = pruefeCollectionZugriff({ role: rolle }, 'katalog', 'GET');
    assert(einkaufspreise.ok === false, `${rolle} -> katalog GET sollte abgelehnt werden`);
    const buchhaltung = pruefeCollectionZugriff({ role: rolle }, 'buchungen', 'PUT');
    assert(buchhaltung.ok === false, `${rolle} -> buchungen PUT sollte abgelehnt werden`);
    const projekte = pruefeCollectionZugriff({ role: rolle }, 'projekte', 'GET');
    assert(projekte.ok === true, `${rolle} -> projekte GET sollte weiterhin erlaubt sein`);
  }
});

pruefe('unbekannte Rolle bekommt sicherheitshalber gar keinen Zugriff', () => {
  const ergebnis = pruefeCollectionZugriff({ role: 'irgendwas-neues' }, 'kunden', 'GET');
  assert(ergebnis.ok === false, 'unbekannte Rolle sollte abgelehnt werden, nicht standardmäßig erlaubt');
});

pruefe('filtereZeilenFuerRolle blendet fremde Kundendaten aus', () => {
  const rows = [{ id: 'r1', kundeId: 'k1' }, { id: 'r2', kundeId: 'k2' }];
  const gefiltert = filtereZeilenFuerRolle({ role: 'kunde', kundeId: 'k1' }, 'rechnungen', rows);
  assert(gefiltert.length === 1 && gefiltert[0].id === 'r1', 'nur eigene Rechnung sollte übrig bleiben');
});

pruefe('filtereZeilenFuerRolle bei Collection "kunden" filtert auf eigene id', () => {
  const rows = [{ id: 'k1', firma: 'Eigene Firma' }, { id: 'k2', firma: 'Fremde Firma' }];
  const gefiltert = filtereZeilenFuerRolle({ role: 'kunde', kundeId: 'k1' }, 'kunden', rows);
  assert(gefiltert.length === 1 && gefiltert[0].id === 'k1', 'nur der eigene Kunden-Datensatz sollte übrig bleiben');
});

pruefe('filtereZeilenFuerRolle lässt bei admin/mitarbeiter alles durch', () => {
  const rows = [{ id: 'r1', kundeId: 'k1' }, { id: 'r2', kundeId: 'k2' }];
  assert(filtereZeilenFuerRolle({ role: 'admin' }, 'rechnungen', rows).length === 2, 'admin sollte alles sehen');
  assert(filtereZeilenFuerRolle({ role: 'mitarbeiter' }, 'rechnungen', rows).length === 2, 'mitarbeiter sollte alles sehen');
});

pruefe('istZeileErlaubt verhindert gezieltes Abrufen fremder Einzeldatensätze', () => {
  assert(istZeileErlaubt({ role: 'kunde', kundeId: 'k1' }, 'rechnungen', { id: 'r1', kundeId: 'k1' }) === true, 'eigene Rechnung sollte erlaubt sein');
  assert(istZeileErlaubt({ role: 'kunde', kundeId: 'k1' }, 'rechnungen', { id: 'r2', kundeId: 'k2' }) === false, 'fremde Rechnung sollte abgelehnt werden');
  assert(istZeileErlaubt({ role: 'kunde', kundeId: undefined }, 'rechnungen', { id: 'r1', kundeId: undefined }) === false, 'ohne kundeId sollte nichts erlaubt sein (auch nicht bei zufällig gleichem undefined)');
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
