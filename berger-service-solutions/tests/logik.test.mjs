// Unit-Tests: Einsatzgebiet, Feiertage, Terminvorschläge, Validierung, Dubletten, Lead-Payload.
// Ausführen: node berger-service-solutions/tests/logik.test.mjs
import assert from 'node:assert/strict';
import {
  ORTE, pruefeEinsatzgebiet, ortZuPlz, ortZuName, luftlinieKm, ZENTRUM, feiertageNRW, ostersonntag,
  terminvorschlaege, istWerktag, normalisiereTelefon, validiereKontakt, validiereAdresse, dublettenSchluessel,
} from '../public/assets/js/einsatzgebiet-logik.mjs';
import { validiereSchritt, baueLead, pruefeDateien, zusatzfelder, SCHEMA_VERSION } from '../public/assets/js/buchung-kern.mjs';

let ok = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); ok++; console.log(`  ✓ ${name}`); } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

console.log('Einsatzgebiet');
await test('alle hinterlegten Orte liegen innerhalb von 50 km Luftlinie', () => {
  for (const o of ORTE) assert.ok(luftlinieKm(ZENTRUM, o) <= 50, `${o.name}: ${luftlinieKm(ZENTRUM, o).toFixed(1)} km`);
});
await test('die 14 in der Projektanweisung genannten Städte sind enthalten', () => {
  for (const n of ['Essen', 'Gelsenkirchen', 'Oberhausen', 'Mülheim an der Ruhr', 'Duisburg', 'Bottrop', 'Gladbeck', 'Recklinghausen', 'Herne', 'Castrop-Rauxel', 'Bochum', 'Velbert', 'Hattingen']) {
    assert.ok(ORTE.some((o) => o.name === n), n);
  }
});
await test('PLZ-Bereiche überschneiden sich nicht', () => {
  const bereiche = ORTE.flatMap((o) => o.plz.map(([v, b]) => ({ o: o.name, v, b }))).sort((a, b) => a.v - b.v);
  for (let i = 1; i < bereiche.length; i++) assert.ok(bereiche[i].v > bereiche[i - 1].b, `${bereiche[i - 1].o} / ${bereiche[i].o}`);
});
await test('PLZ 45127 → Essen, Zone A', () => {
  const r = pruefeEinsatzgebiet({ plz: '45127', ort: 'Essen' });
  assert.equal(r.status, 'im-gebiet'); assert.equal(r.ort, 'Essen'); assert.equal(r.zone, 'A');
});
await test('PLZ 45879 → Gelsenkirchen, Zone A/B', () => {
  const r = pruefeEinsatzgebiet({ plz: '45879', ort: 'Gelsenkirchen' });
  assert.equal(r.status, 'im-gebiet'); assert.ok(['A', 'B'].includes(r.zone));
});
await test('Dortmund liegt in einer äußeren Zone', () => {
  const r = pruefeEinsatzgebiet({ plz: '44135', ort: 'Dortmund' });
  assert.equal(r.status, 'im-gebiet'); assert.ok(['C', 'D'].includes(r.zone));
});
await test('Köln (unbekannte PLZ) → manuell prüfen, nicht abgelehnt', () => {
  assert.equal(pruefeEinsatzgebiet({ plz: '50667', ort: 'Köln' }).status, 'manuell-pruefen');
});
await test('Ort außerhalb des Radius → "ausserhalb" mit Hinweis', () => {
  const r = pruefeEinsatzgebiet({ plz: '45127', ort: 'Essen' }, { radiusKm: 0.1 });
  assert.equal(r.status, 'ausserhalb'); assert.equal(r.zone, null); assert.ok(r.hinweise.length > 0);
});
await test('ungültige PLZ', () => { assert.equal(pruefeEinsatzgebiet({ plz: '4512', ort: '' }).status, 'ungueltig'); });
await test('Widerspruch PLZ/Ort erzeugt Hinweis', () => {
  const r = pruefeEinsatzgebiet({ plz: '45127', ort: 'Bochum' });
  assert.ok(r.hinweise.some((h) => h.includes('Essen')));
});
await test('Ortsnamen-Normalisierung', () => {
  assert.equal(ortZuName('Mülheim a. d. Ruhr')?.slug, 'muelheim-an-der-ruhr');
  assert.equal(ortZuName('muelheim an der ruhr')?.slug, 'muelheim-an-der-ruhr');
  assert.equal(ortZuPlz('46244')?.name, 'Bottrop');
});

console.log('Feiertage und Termine');
await test('Ostersonntag 2026 = 5. April, 2027 = 28. März', () => {
  assert.equal(ostersonntag(2026).toISOString().slice(0, 10), '2026-04-05');
  assert.equal(ostersonntag(2027).toISOString().slice(0, 10), '2027-03-28');
});
await test('NRW-Feiertage 2026 enthalten Fronleichnam und Allerheiligen', () => {
  const f = feiertageNRW(2026);
  assert.ok(f.has('2026-06-04')); assert.ok(f.has('2026-11-01')); assert.ok(f.has('2026-05-14')); assert.equal(f.size, 11);
});
await test('Terminvorschläge: nur Werktage, Vorlauf eingehalten', () => {
  const heute = new Date(Date.UTC(2026, 11, 22)); // Di vor Weihnachten
  const t = terminvorschlaege({ heute, vorlaufWerktage: 2, horizontTage: 14 });
  assert.ok(t.length > 0);
  for (const tag of t) assert.ok(istWerktag(new Date(tag.datum + 'T00:00:00Z')), tag.datum);
  assert.ok(!t.some((x) => ['2026-12-25', '2026-12-26', '2026-12-22', '2026-12-23'].includes(x.datum)));
  assert.equal(t[0].datum, '2026-12-24');
});

console.log('Validierung und Dubletten');
await test('Telefonnormalisierung', () => {
  assert.equal(normalisiereTelefon('0201 / 123 456'), '+49201123456');
  assert.equal(normalisiereTelefon('0049 201 123456'), '+49201123456');
  assert.equal(normalisiereTelefon('+49 (201) 123456'), '+49201123456');
});
await test('Kontaktvalidierung', () => {
  assert.deepEqual(validiereKontakt({ vorname: 'A', nachname: 'B', email: 'a@b.de', telefon: '0201 123456' }), {});
  const f = validiereKontakt({ vorname: '', nachname: 'B', email: 'kein-mail', telefon: '12' });
  assert.ok(f.vorname && f.email && f.telefon);
});
await test('Adressvalidierung inkl. Hausnummern mit Zusatz', () => {
  assert.deepEqual(validiereAdresse({ strasse: 'Rüttenscheider Straße', hausnummer: '12a', plz: '45130', ort: 'Essen' }), {});
  assert.deepEqual(validiereAdresse({ strasse: 'Hauptstr.', hausnummer: '3-5', plz: '45127', ort: 'Essen' }), {});
  assert.ok(validiereAdresse({ strasse: 'X', hausnummer: 'abc', plz: '1', ort: '' }).hausnummer);
});
await test('Dublettenschlüssel unabhängig von Schreibweise', async () => {
  const a = await dublettenSchluessel({ email: 'Max@Example.de ', telefon: '0201 123456', adresse: { plz: '45127', strasse: 'Hauptstraße', hausnummer: '1 A' } });
  const b = await dublettenSchluessel({ email: 'max@example.de', telefon: '+49201123456', adresse: { plz: '45127', strasse: 'Hauptstr.', hausnummer: '1a' } });
  assert.equal(a.person, b.person); assert.equal(a.adresse, b.adresse); assert.match(a.email, /^[0-9a-f]{64}$/);
});

console.log('Buchungskern');
const LEISTUNG_DIREKT = { slug: 'dguv-v3-pruefung', name: 'DGUV-V3-Prüfung', bereich: 'elektro', buchung: 'direkt', dauerMin: 180, prozess: 'wartung' };
const LEISTUNG_ANFRAGE = { slug: 'badsanierung', name: 'Badsanierung', bereich: 'handwerk', buchung: 'anfrage', prozess: 'handwerk' };
const basis = { leistung: 'dguv-v3-pruefung', strasse: 'Hauptstraße', hausnummer: '1', plz: '45127', ort: 'Essen', beschreibung: 'Prüfung von ca. 40 Bürogeräten', vorname: 'Max', nachname: 'Muster', telefon: '0201 123456', email: 'max@example.de', datenschutz: true, slot: '2026-12-01T08:00', kundentyp: 'gewerbe', firma: 'Muster GmbH', kontaktweg: 'email' };
await test('Schritt 3: Direktbuchung verlangt Slot', () => {
  assert.ok(validiereSchritt(3, { ...basis, slot: '' }, { leistung: LEISTUNG_DIREKT }).slot);
  assert.deepEqual(validiereSchritt(3, basis, { leistung: LEISTUNG_DIREKT }), {});
});
await test('Schritt 3: Anfrage-Wunschtermin muss Werktag in der Zukunft sein', () => {
  const heute = new Date(Date.UTC(2026, 10, 12));
  assert.ok(validiereSchritt(3, { ...basis, wunschtermin: '2026-11-01' }, { leistung: LEISTUNG_ANFRAGE, heute }).wunschtermin);
  assert.ok(validiereSchritt(3, { ...basis, wunschtermin: '2026-11-15' }, { leistung: LEISTUNG_ANFRAGE, heute }).wunschtermin); // Sonntag
  assert.deepEqual(validiereSchritt(3, { ...basis, wunschtermin: '2026-11-17' }, { leistung: LEISTUNG_ANFRAGE, heute }), {});
});
await test('Schritt 2: abweichende Rechnungsadresse wird geprüft', () => {
  const f = validiereSchritt(2, { ...basis, rechnungAbweichend: true }, {});
  assert.ok(f.rName && f.rStrasse && f.rPlz);
});
await test('Schritt 5: Datenschutz-Einwilligung Pflicht', () => {
  assert.ok(validiereSchritt(5, { ...basis, datenschutz: false }).datenschutz);
});
await test('Dateiprüfung: Typ, Größe, Anzahl', () => {
  assert.equal(pruefeDateien([{ name: 'a.jpg', type: 'image/jpeg', size: 1000 }]), null);
  assert.match(pruefeDateien([{ name: 'a.exe', type: 'application/x-msdownload', size: 10 }]), /Format/);
  assert.match(pruefeDateien([{ name: 'a.pdf', type: 'application/pdf', size: 11 * 1024 * 1024 }]), /MB/);
  assert.match(pruefeDateien(Array.from({ length: 7 }, (_, i) => ({ name: `${i}.png`, type: 'image/png', size: 1 }))), /höchstens/);
});
await test('Zusatzfelder passend zur Leistung', () => {
  assert.deepEqual(zusatzfelder('dguv-v3-pruefung'), ['geraete']);
  assert.ok(zusatzfelder('vinyl-designboden-verlegen').includes('flaeche'));
});
await test('Lead-Payload: Direktbuchung vollständig und normalisiert', async () => {
  const lead = await baueLead(basis, { leistung: LEISTUNG_DIREKT, idempotenzSchluessel: 'abc', jetzt: new Date('2026-11-12T10:00:00Z'), dateien: [{ name: 'foto.jpg', type: 'image/jpeg', size: 1234 }] });
  assert.equal(lead.schemaVersion, SCHEMA_VERSION);
  assert.equal(lead.vorgangsart, 'buchung');
  assert.equal(lead.kunde.telefon, '+49201123456');
  assert.equal(lead.termin.datum, '2026-12-01'); assert.equal(lead.termin.zeit, '08:00'); assert.equal(lead.termin.status, 'vorlaeufig');
  assert.equal(lead.einsatzort.einsatzgebiet.zone, 'A');
  assert.equal(lead.rechnungsadresse, null);
  assert.equal(lead.dateien[0].groesseBytes, 1234);
  assert.equal(lead.einwilligungen.datenschutz.erteilt, true);
  assert.match(lead.dubletten.person, /^[0-9a-f]{64}$/);
});
await test('Lead-Payload entspricht dem JSON-Schema (Pflichtfelder)', async () => {
  const { readFile } = await import('node:fs/promises');
  const schema = JSON.parse(await readFile(new URL('../docs/schemas/lead.schema.json', import.meta.url)));
  const lead = await baueLead({ ...basis, leistung: 'badsanierung', wunschtermin: '2026-11-17' }, { leistung: LEISTUNG_ANFRAGE, idempotenzSchluessel: 'x' });
  for (const k of schema.required) assert.ok(k in lead, `Pflichtfeld fehlt: ${k}`);
  for (const [k, def] of Object.entries(schema.properties)) {
    if (def.required) for (const u of def.required) assert.ok(lead[k] === null || u in lead[k], `${k}.${u} fehlt`);
  }
  assert.equal(lead.vorgangsart, 'anfrage'); assert.equal(lead.termin.art, 'wunsch');
});

console.log(`\n--- Ergebnis: ${ok} bestanden, ${fail} fehlgeschlagen ---`);
process.exitCode = fail ? 1 : 0;
