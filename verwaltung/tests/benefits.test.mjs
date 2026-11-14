// Echter Browser-Test für verwaltung/js/views/benefits.js (Mitarbeiter-
// Benefits & Gesamtkosten) - lädt das ECHTE Modul (reiner Import, keine
// Kopie) in einem echten, headless Chromium (Playwright), zusammen mit den
// ECHTEN utils.js/ui.js/auth.js/mitarbeiterkosten.js. Nur js/db.js wird
// durch einen winzigen In-Memory-Stub ersetzt (gleiches Muster wie
// teams.test.mjs) - sonst würde render() echte Netzwerkanfragen an das
// produktive Firebase-Projekt auslösen. Prüft insbesondere, dass die
// Gesamtkosten-Berechnung (berechneGesamtkosten aus mitarbeiterkosten.js,
// bereits durch mitarbeiterkosten.test.mjs abgedeckt) über die komplette
// echte Rendering-Pipeline korrekt verdrahtet ist. Lücke aus dem
// Mitarbeiter-Bereich-Audit (14.11.2026) - vorher keine dedizierten Tests.
//
// Ausführen: node verwaltung/tests/benefits.test.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const verwaltungDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };

function startStaticServer(rootDir) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent(req.url.split('?')[0]);
        const filePath = path.join(rootDir, urlPath === '/' ? 'index.html' : urlPath);
        if (!filePath.startsWith(rootDir)) { res.writeHead(403); res.end(); return; }
        const data = await readFile(filePath);
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      } catch { res.writeHead(404); res.end('Not found'); }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

let bestanden = 0, fehlgeschlagen = 0;
async function pruefe(name, fn) {
  try { await fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

const server = await startStaticServer(verwaltungDir);
const { port } = server.address();
const vorinstalliertesChromium = '/opt/pw-browsers/chromium';
const browser = await chromium.launch(fsSync.existsSync(vorinstalliertesChromium) ? { executablePath: vorinstalliertesChromium } : {});

// Stub für js/db.js - enthält genau die Exporte, die benefits.js und seine
// (echten) Importe utils.js/ui.js/auth.js tatsächlich brauchen.
const DB_STUB = `
globalThis.__fakeDb = globalThis.__fakeDb || {};
globalThis.__puts = globalThis.__puts || [];
export async function getAll(storeName) { return (globalThis.__fakeDb[storeName] || []).slice(); }
export async function put(storeName, value) {
  globalThis.__fakeDb[storeName] = globalThis.__fakeDb[storeName] || [];
  const list = globalThis.__fakeDb[storeName];
  const idx = list.findIndex((r) => r.id === value.id);
  if (idx === -1) list.push(value); else list[idx] = value;
  globalThis.__puts.push({ storeName, value });
}
export async function remove(storeName, key) {
  globalThis.__fakeDb[storeName] = (globalThis.__fakeDb[storeName] || []).filter((r) => r.id !== key);
}
export async function getSettings() { return {}; }
export async function setSettings() {}
export function isTrashStore() { return false; }
export const GEWERKE = [];
export const BENEFIT_TYPEN = [{ id: 'bike', titel: 'Fahrrad-Leasing' }, { id: 'tanken', titel: 'Tankgutschein' }];
`;

const harnessHtml = (fakeDb, role) => `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="host"></div>
<script type="module">
  globalThis.__fakeDb = ${JSON.stringify(fakeDb)};
  sessionStorage.setItem('nv-unlocked-session', JSON.stringify({ role: ${JSON.stringify(role)} }));
  const { render } = await import('/js/views/benefits.js');
  await render(document.getElementById('host'));
  window.__ready = true;
</script>
</body></html>`;

async function ladeSeite(fakeDb, role = 'admin') {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('dialog', (d) => d.accept());
  await page.route(/\/js\/db\.js(\?.*)?$/, (route) => route.fulfill({ contentType: 'text/javascript', body: DB_STUB }));
  await page.route(/\/harness\.html(\?.*)?$/, (route) => route.fulfill({ contentType: 'text/html', body: harnessHtml(fakeDb, role) }));
  await page.goto(`http://127.0.0.1:${port}/harness.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, { timeout: 10000 });
  if (pageErrors.length) throw new Error('JS-Fehler: ' + pageErrors.join('; '));
  return page;
}

await pruefe('B1: ohne zugewiesene Benefits wird der Leerzustand angezeigt', async () => {
  const page = await ladeSeite({ mitarbeiter: [{ id: 'm1', name: 'Max Muster', gehaltMonatlich: 3000 }] });
  assert(await page.locator('#benefits-host .empty-state').isVisible(), 'Leerzustand für Benefits muss sichtbar sein');
  await page.close();
});

await pruefe('B2: die Gesamtkosten-Tabelle zeigt für einen Mitarbeiter mit Festgehalt + vollem Monatsbenefit die korrekte Summe (Festgehalt + Benefit, ohne Lohnnebenkosten)', async () => {
  // Heute (Testlaufzeit) liegt nach dem 2026-01-01-Beginn, daher ist der
  // Benefit im laufenden Monat voll aktiv (wie BK1 in mitarbeiterkosten.test.mjs) ->
  // erwartet 3000 (Festgehalt) + 30 (Benefit) + 0 (keine Reisekosten) = 3030.
  const page = await ladeSeite({
    mitarbeiter: [{ id: 'm1', name: 'Max Muster', gehaltMonatlich: 3000 }],
    mitarbeiterBenefits: [{ id: 'b1', mitarbeiterId: 'm1', benefitTyp: 'bike', bezeichnung: 'Trek', arbeitgeberKostenMonatlich: 30, beginnDatum: '2026-01-01', endeDatum: '' }],
  });
  const text = (await page.locator('#gesamtkosten-host table tbody tr').textContent()).replace(/\s/g, '');
  assert(text.includes('MaxMuster'), `erwartet Namen in der Zeile, war "${text}"`);
  assert(/3\.?030,00/.test(text), `erwartet Gesamtsumme 3030,00 in der Zeile, war "${text}"`);
  await page.close();
});

await pruefe('B3: ein neu zugewiesener Benefit wird mit korrekt in eine Zahl umgewandelten Arbeitgeberkosten gespeichert', async () => {
  const page = await ladeSeite({ mitarbeiter: [{ id: 'm1', name: 'Max Muster', gehaltMonatlich: 3000 }], mitarbeiterBenefits: [] });
  await page.locator('#btn-new-benefit').click();
  await page.locator('select[name="mitarbeiterId"]').selectOption('m1');
  await page.locator('select[name="benefitTyp"]').selectOption('tanken');
  await page.locator('input[name="arbeitgeberKostenMonatlich"]').fill('44.50');
  await page.locator('input[name="beginnDatum"]').fill('2026-01-01');
  await page.locator('button[type="submit"]').click();
  await page.waitForFunction(() => globalThis.__puts && globalThis.__puts.length === 1, { timeout: 5000 });
  const puts = await page.evaluate(() => globalThis.__puts);
  assert(puts[0].storeName === 'mitarbeiterBenefits', `erwartet Speicherung in "mitarbeiterBenefits", war "${puts[0].storeName}"`);
  assert(puts[0].value.mitarbeiterId === 'm1' && puts[0].value.benefitTyp === 'tanken');
  assert(puts[0].value.arbeitgeberKostenMonatlich === 44.5, `erwartet Zahl 44.5, war ${JSON.stringify(puts[0].value.arbeitgeberKostenMonatlich)}`);
  await page.close();
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
await browser.close();
server.close();
process.exit(fehlgeschlagen > 0 ? 1 : 0);
