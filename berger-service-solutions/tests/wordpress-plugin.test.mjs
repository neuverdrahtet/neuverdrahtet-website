// Test des WordPress-Must-Use-Plugins (Paket für IONOS Managed WordPress).
// Simuliert WordPress: jede Anfrage läuft über einen Router, der wie WordPress
// das Plugin lädt und sonst "WORDPRESS" ausgibt. Übersprungen ohne php.
// Ausführen: node berger-service-solutions/tests/wordpress-plugin.test.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { paketieren } from '../src/paket.mjs';

let ok = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); ok++; console.log(`  ✓ ${name}`); } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message.split('\n')[0]}`); }
}
if (spawnSync('php', ['-v']).status !== 0 || spawnSync('zip', ['-v']).status !== 0) {
  console.log('php oder zip nicht installiert – Test übersprungen.');
  console.log('\n--- Ergebnis: 0 bestanden, 0 fehlgeschlagen ---');
  process.exit(0);
}

const { wpVerzeichnis } = paketieren();
const tmp = mkdtempSync(path.join(tmpdir(), 'bss-wp-'));
const POST = path.join(tmp, 'post');
spawnSync('mkdir', ['-p', POST, path.join(tmp, 'docroot')]);
const sendmail = path.join(tmp, 'sendmail.sh');
writeFileSync(sendmail, `#!/bin/sh\ncat > "${POST}/mail-$(date +%s%N).eml"\n`);
chmodSync(sendmail, 0o755);
const einstellungen = path.join(tmp, 'einstellungen.php');
writeFileSync(einstellungen, readFileSync(path.join(wpVerzeichnis, 'bss-website', 'api', 'einstellungen.php'), 'utf8')
  .replace(/'empfaenger' => [^,\n]+/, "'empfaenger' => 'buero@example.org'")
  .replace(/'absender' => [^,\n]+/, "'absender' => 'website@example.org'")
  .replace('return [', `return [\n  'datenVerzeichnis' => '${path.join(tmp, 'daten')}',`));
const router = path.join(tmp, 'router.php');
writeFileSync(router, `<?php
define('ABSPATH', __DIR__ . '/');
define('WP_CONTENT_DIR', ${JSON.stringify(wpVerzeichnis)});
function is_admin() { return false; }
include WP_CONTENT_DIR . '/mu-plugins/bss-website.php';
header('Content-Type: text/plain'); echo 'WORDPRESS';
`);

const port = await new Promise((r) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const server = spawn('php', ['-d', `sendmail_path=${sendmail}`, '-S', `127.0.0.1:${port}`, '-t', path.join(tmp, 'docroot'), router], { env: { ...process.env, BSS_EINSTELLUNGEN: einstellungen }, stdio: 'ignore' });
const B = `http://127.0.0.1:${port}`;
for (let i = 0; i < 50; i++) { try { await (await fetch(B)).arrayBuffer(); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
const holen = async (p, opt) => { const r = await fetch(B + p, opt); return { s: r.status, t: r.headers.get('content-type') || '', h: r.headers, body: await r.text() }; };

try {
  await test('Startseite und Unterseiten werden aus wp-content/bss-website ausgeliefert', async () => {
    const r = await holen('/'); assert.equal(r.s, 200); assert.match(r.t, /text\/html/); assert.match(r.body, /BERGER/);
    const u = await holen('/bodenlegearbeiten.html'); assert.equal(u.s, 200); assert.match(u.body, /<h1[^>]*>Bodenleger/);
  });
  await test('Seiten verweisen für Bilder/CSS/Skripte direkt auf wp-content, alle Ziele existieren', async () => {
    const html = (await holen('/')).body;
    assert.match(html, /url\(\/wp-content\/bss-website\/assets\/fonts\/inter-var\.woff2\)/);
    assert.match(html, /src="\/wp-content\/bss-website\/assets\/img\/logo-hell\.webp"/);
    assert.doesNotMatch(html, /(["\s,])assets\//);
    const { existsSync } = await import('node:fs');
    for (const m of html.matchAll(/(?:src|href)="\/wp-content\/bss-website\/([^"?#]+)"/g)) assert.ok(existsSync(path.join(wpVerzeichnis, 'bss-website', m[1])), m[1]);
    for (const m of html.matchAll(/srcset="([^"]+)"/g)) for (const teil of m[1].split(',')) assert.match(teil.trim(), /^\/wp-content\/bss-website\/assets\//);
  });
  await test('richtige Dateitypen (CSS, JS-Module, WebP, Schrift)', async () => {
    assert.match((await holen('/assets/css/style.css')).t, /text\/css/);
    assert.match((await holen('/assets/js/buchung.mjs')).t, /text\/javascript/);
    assert.match((await holen('/assets/img/logo-hell.webp')).t, /image\/webp/);
    assert.match((await holen('/assets/fonts/inter-var.woff2')).t, /font\/woff2/);
  });
  await test('unbekannte Adresse: eigene 404-Seite mit Status 404', async () => {
    const r = await holen('/gibt-es-nicht'); assert.equal(r.s, 404); assert.match(r.body, /Seite nicht gefunden/);
  });
  await test('WordPress-Verwaltung bleibt erreichbar', async () => {
    for (const p of ['/wp-admin/', '/wp-login.php', '/wp-json/wp/v2/', '/?rest_route=/']) assert.equal((await holen(p)).body, 'WORDPRESS', p);
  });
  await test('kein Zugriff außerhalb des Website-Ordners oder auf interne Dateien', async () => {
    for (const p of ['/../../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/.htaccess', '/api/einstellungen.php', '/api/daten/salt', '/assets/../../mu-plugins/bss-website.php']) {
      const r = await holen(p); assert.equal(r.s, 404, p); assert.doesNotMatch(r.body, /root:|<\?php|empfaenger/, p);
    }
  });
  await test('Suchmaschinen-Sperre per Header solange noindex, Caching mit 304', async () => {
    const r = await holen('/'); assert.match(r.h.get('x-robots-tag') || '', /noindex/);
    const lm = r.h.get('last-modified'); const c = await holen('/', { headers: { 'If-Modified-Since': lm } }); assert.equal(c.s, 304);
  });
  await test('Online-Buchung über das Plugin: E-Mail mit Anhang wird versendet', async () => {
    const lead = {
      schemaVersion: 'bss-lead/1', idempotenzSchluessel: 'wp-test-12345678', quelle: { kanal: 'website' }, vorgangsart: 'anfrage',
      leistung: { slug: 'badsanierung' }, einsatzort: { strasse: 'Musterweg', hausnummer: '7', plz: '45879', ort: 'Gelsenkirchen', einsatzgebiet: { status: 'im-gebiet', zone: 'A' } },
      kunde: { typ: 'privat', vorname: 'Max', nachname: 'Muster', telefon: '+49209123456', email: 'max@example.de', bevorzugterKontaktweg: 'telefon' },
      details: { beschreibung: 'Bad ca. 6 m², bodengleiche Dusche gewünscht.' }, termin: { art: 'wunsch', datum: null, zeitfenster: 'egal' },
      einwilligungen: { datenschutz: { erteilt: true }, whatsapp: { erteilt: false } }, dubletten: {}, spamSchutz: { honeypot: '', ausfuellzeitMs: 30000 },
    };
    const fd = new FormData();
    fd.append('lead', new Blob([JSON.stringify(lead)], { type: 'application/json' }), 'lead.json');
    fd.append('dateien[]', new Blob([Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF')], { type: 'application/pdf' }), 'grundriss.pdf');
    const r = await fetch(`${B}/api/anfrage.php`, { method: 'POST', body: fd, headers: { Origin: B } });
    const j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j));
    const mails = readdirSync(POST).map((f) => readFileSync(path.join(POST, f), 'utf8'));
    assert.equal(mails.length, 2); assert.ok(mails.some((m) => /filename="grundriss\.pdf"/.test(m)));
  });
} finally {
  server.kill();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n--- Ergebnis: ${ok} bestanden, ${fail} fehlgeschlagen ---`);
process.exitCode = fail ? 1 : 0;
