// Test des PHP-Empfangs der Online-Buchung (public/api/anfrage.php) mit echtem
// PHP-Server. E-Mails werden über ein Ersatz-sendmail in Dateien geschrieben.
// Wird übersprungen (0 Tests), wenn kein php installiert ist.
// Ausführen: node berger-service-solutions/tests/php-anfrage.test.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { bauen } from '../src/build.mjs';

let ok = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); ok++; console.log(`  ✓ ${name}`); } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message.split('\n')[0]}`); }
}

if (spawnSync('php', ['-v']).status !== 0) {
  console.log('php nicht installiert – Test übersprungen.');
  console.log('\n--- Ergebnis: 0 bestanden, 0 fehlgeschlagen ---');
  process.exit(0);
}

bauen();
const PUBLIC = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'public');
const tmp = mkdtempSync(path.join(tmpdir(), 'bss-php-'));
const POST = path.join(tmp, 'post'); const DATEN = path.join(tmp, 'daten');
spawnSync('mkdir', ['-p', POST]);
const sendmail = path.join(tmp, 'sendmail.sh');
writeFileSync(sendmail, `#!/bin/sh\ncat > "${POST}/mail-$(date +%s%N).eml"\n`);
chmodSync(sendmail, 0o755);
const einstellungen = path.join(tmp, 'einstellungen.php');
function schreibeEinstellungen(extra = '', limit = 50) {
  const basis = readFileSync(path.join(PUBLIC, 'api', 'einstellungen.php'), 'utf8')
    .replace("'empfaenger' => null", "'empfaenger' => 'buero@example.org'")
    .replace("'absender' => null", "'absender' => 'website@example.org'")
    .replace("'ratenLimit' => 5", `'ratenLimit' => ${limit}`)
    .replace('return [', `return [\n  'datenVerzeichnis' => '${DATEN}',${extra}`);
  writeFileSync(einstellungen, basis);
}
schreibeEinstellungen();

const port = await new Promise((r) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const server = spawn('php', ['-d', `sendmail_path=${sendmail}`, '-d', 'upload_max_filesize=20M', '-d', 'post_max_size=40M', '-S', `127.0.0.1:${port}`, '-t', PUBLIC], { env: { ...process.env, BSS_EINSTELLUNGEN: einstellungen }, stdio: 'ignore' });
const URL_ = `http://127.0.0.1:${port}/api/anfrage.php`;
for (let i = 0; i < 50; i++) { try { await fetch(URL_); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }

const mails = () => readdirSync(POST).sort().map((f) => readFileSync(path.join(POST, f), 'utf8'));
const leeren = () => { for (const f of readdirSync(POST)) rmSync(path.join(POST, f)); };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

function lead(aenderungen = {}) {
  const l = {
    schemaVersion: 'bss-lead/1', idempotenzSchluessel: `test-${Math.random().toString(16).slice(2)}`, erstelltAm: new Date().toISOString(),
    quelle: { kanal: 'website', seite: 'buchen.html', kampagne: null }, vorgangsart: 'buchung',
    leistung: { slug: 'dguv-v3-pruefung', name: 'manipuliert', bereich: 'elektro', prozess: 'wartung' },
    einsatzort: { strasse: 'Rüttenscheider Straße', hausnummer: '120', plz: '45131', ort: 'Essen', zusatz: null, einsatzgebiet: { status: 'im-gebiet', zone: 'A' } },
    rechnungsadresse: null,
    kunde: { typ: 'gewerbe', firma: 'Muster GmbH', vorname: 'Erika', nachname: 'Musterfrau', telefon: '+492011234567', email: 'erika@example.de', bevorzugterKontaktweg: 'email' },
    details: { beschreibung: 'Prüfung aller ortsveränderlichen Geräte im Büro.', anzahlGeraete: 45, anlage: null, flaecheM2: null },
    termin: { art: 'slot', datum: '2026-12-01', zeit: '08:00', status: 'vorlaeufig' },
    dateien: [], einwilligungen: { datenschutz: { erteilt: true }, whatsapp: { erteilt: false } },
    dubletten: { person: 'a'.repeat(64), email: null, telefon: null, adresse: null },
    spamSchutz: { honeypot: '', ausfuellzeitMs: 25000 },
  };
  return structuredClone({ ...l, ...aenderungen });
}
async function senden(l, dateien = [], header = {}) {
  const fd = new FormData();
  fd.append('lead', new Blob([JSON.stringify(l)], { type: 'application/json' }), 'lead.json');
  for (const [name, inhalt, typ] of dateien) fd.append('dateien[]', new Blob([inhalt], { type: typ }), name);
  const res = await fetch(URL_, { method: 'POST', body: fd, headers: { Origin: `http://127.0.0.1:${port}`, 'Idempotency-Key': l.idempotenzSchluessel, ...header } });
  return { status: res.status, json: await res.json() };
}

try {
  await test('gültige Direktbuchung mit Foto: E-Mail ans Büro und Bestätigung an den Kunden', async () => {
    leeren();
    const r = await senden(lead(), [['Zählerschrank Foto.png', PNG, 'image/png']]);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.match(r.json.vorgangsnummer, /^W-\d{8}-[0-9A-F]{6}$/);
    const m = mails(); assert.equal(m.length, 2);
    const buero = m.find((x) => /^To: buero@example\.org/m.test(x));
    const kunde = m.find((x) => /^To: erika@example\.de/m.test(x));
    assert.ok(buero && kunde, 'Empfänger');
    assert.match(buero, /Reply-To: erika@example\.de/);
    assert.match(buero, /filename="Z-hlerschrank-Foto\.png"|filename="Zhlerschrank-Foto\.png"|filename="[^"]+\.png"/);
    assert.match(buero, /filename="lead-W-\d{8}-[0-9A-F]{6}\.json"/);
    const text = Buffer.from(buero.split('Content-Transfer-Encoding: base64')[1].split('--=_bss_')[0].replace(/\s/g, ''), 'base64').toString('utf8');
    assert.match(text, /NEUE TERMINBUCHUNG/); assert.match(text, /DGUV-V3-Prüfung/); assert.doesNotMatch(text, /manipuliert/);
    assert.match(text, /Zone A/); assert.match(text, /Anzahl Geräte: 45/);
    const kText = Buffer.from(kunde.split('Content-Transfer-Encoding: base64')[1].replace(/\s/g, ''), 'base64').toString('utf8');
    assert.match(kText, new RegExp(r.json.vorgangsnummer)); assert.doesNotMatch(kText, /Erika|Musterfrau|ortsveränderlichen/);
  });

  await test('gleicher Idempotenzschlüssel: gleiche Vorgangsnummer, keine zweite E-Mail', async () => {
    leeren();
    const l = lead();
    const a = await senden(l); const b = await senden(l);
    assert.equal(a.json.vorgangsnummer, b.json.vorgangsnummer); assert.equal(b.json.status, 'bereits-eingegangen');
    assert.equal(mails().length, 2);
  });

  await test('Pflichtfelder werden serverseitig geprüft (E-Mail, Datenschutz, Leistung, Slot)', async () => {
    leeren();
    const l = lead(); l.kunde.email = 'kein-mail'; l.einwilligungen.datenschutz.erteilt = false; l.leistung.slug = 'gibt-es-nicht';
    const r = await senden(l);
    assert.equal(r.status, 400); for (const k of ['email', 'datenschutz', 'leistung']) assert.ok(r.json.fehler[k], k);
    const l2 = lead(); l2.termin.datum = null; const r2 = await senden(l2);
    assert.ok(r2.json.fehler.slot);
    assert.equal(mails().length, 0);
  });

  await test('Header-Injection über die E-Mail-Adresse wird abgewiesen', async () => {
    const l = lead(); l.kunde.email = 'a@b.de\r\nBcc: opfer@example.com';
    const r = await senden(l); assert.equal(r.status, 400); assert.ok(r.json.fehler.email);
  });

  await test('getarnte Datei (Text als .jpg) wird abgewiesen', async () => {
    leeren();
    const r = await senden(lead(), [['foto.jpg', Buffer.from('<?php echo 1; ?>'), 'image/jpeg']]);
    assert.equal(r.status, 400); assert.match(r.json.fehler.dateien, /Format/); assert.equal(mails().length, 0);
  });

  await test('Bot (zu schnell ausgefüllt): Antwort 200, aber keine E-Mail', async () => {
    leeren();
    const r = await senden(lead({ spamSchutz: { honeypot: '', ausfuellzeitMs: 800 } }));
    assert.equal(r.status, 200); assert.equal(mails().length, 0);
  });

  await test('fremde Herkunft (Origin) wird abgewiesen, GET liefert 405', async () => {
    const r = await senden(lead(), [], { Origin: 'https://boese.example' }); assert.equal(r.status, 403);
    const g = await fetch(URL_); assert.equal(g.status, 405);
  });

  await test('Rate-Limit greift nach der eingestellten Anzahl', async () => {
    schreibeEinstellungen('', 2);
    rmSync(path.join(DATEN, 'rate'), { recursive: true, force: true });
    const s = [await senden(lead()), await senden(lead()), await senden(lead())].map((x) => x.status);
    assert.deepEqual(s, [200, 200, 429]);
    schreibeEinstellungen();
  });

  await test('ohne Empfänger-Adresse: 503 "noch nicht eingerichtet"', async () => {
    writeFileSync(einstellungen, readFileSync(einstellungen, 'utf8').replace("'empfaenger' => 'buero@example.org'", "'empfaenger' => null"));
    const r = await senden(lead()); assert.equal(r.status, 503);
    schreibeEinstellungen();
  });

  await test('Datenverzeichnis ist per .htaccess gesperrt, speichert keine Anfragen', async () => {
    assert.match(readFileSync(path.join(DATEN, '.htaccess'), 'utf8'), /Require all denied/);
    const alles = spawnSync('find', [DATEN, '-type', 'f']).stdout.toString();
    assert.doesNotMatch(alles, /Musterfrau/);
    const inhalt = spawnSync('grep', ['-r', 'Musterfrau', DATEN]).stdout.toString();
    assert.equal(inhalt, '');
  });
} finally {
  server.kill();
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n--- Ergebnis: ${ok} bestanden, ${fail} fehlgeschlagen ---`);
process.exitCode = fail ? 1 : 0;
