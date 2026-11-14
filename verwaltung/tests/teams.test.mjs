// Echter Browser-Test für verwaltung/js/views/teams.js (Teams & Kolonnen) -
// lädt das ECHTE Modul (reiner Import, keine Kopie) in einem echten,
// headless Chromium (Playwright), zusammen mit den ECHTEN utils.js/ui.js/
// bulkselect.js. Nur js/db.js wird durch einen winzigen In-Memory-Stub
// ersetzt (Teams/Mitarbeiter aus einem Fake statt Firestore/IndexedDB) -
// sonst würde render() echte Netzwerkanfragen an das produktive Firebase-
// Projekt auslösen (siehe firebase-config.js), was dieser Test laut
// Projektvorgabe ("keine echten Dienste nutzen") nicht darf. Lücke aus dem
// Mitarbeiter-Bereich-Audit (14.11.2026) - vorher keine dedizierten Tests.
//
// Ausführen: node verwaltung/tests/teams.test.mjs
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

// Stub für js/db.js - enthält genau die Exporte, die teams.js und seine
// (echten) Importe utils.js/ui.js/bulkselect.js tatsächlich brauchen.
const DB_STUB = `
globalThis.__fakeDb = globalThis.__fakeDb || {};
globalThis.__puts = globalThis.__puts || [];
globalThis.__removes = globalThis.__removes || [];
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
  globalThis.__removes.push({ storeName, key });
}
export async function getSettings() { return {}; }
export async function setSettings() {}
export function isTrashStore() { return false; }
export const GEWERKE = [];
`;

const harnessHtml = (fakeDb) => `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="host"></div>
<script type="module">
  globalThis.__fakeDb = ${JSON.stringify(fakeDb)};
  const { render } = await import('/js/views/teams.js');
  await render(document.getElementById('host'));
  window.__ready = true;
</script>
</body></html>`;

async function ladeSeite(fakeDb) {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('dialog', (d) => d.accept());
  await page.route(/\/js\/db\.js(\?.*)?$/, (route) => route.fulfill({ contentType: 'text/javascript', body: DB_STUB }));
  await page.route(/\/harness\.html(\?.*)?$/, (route) => route.fulfill({ contentType: 'text/html', body: harnessHtml(fakeDb) }));
  await page.goto(`http://127.0.0.1:${port}/harness.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, { timeout: 10000 });
  if (pageErrors.length) throw new Error('JS-Fehler: ' + pageErrors.join('; '));
  return page;
}

await pruefe('T1: ohne Teams wird der Leerzustand angezeigt, keine Tabelle', async () => {
  const page = await ladeSeite({ teams: [], mitarbeiter: [] });
  assert(await page.locator('.empty-state').isVisible(), 'Leerzustand muss sichtbar sein');
  assert(await page.locator('table.data-table').count() === 0, 'ohne Teams darf keine Tabelle gerendert werden');
  await page.close();
});

await pruefe('T2: ein Team mit zwei Mitgliedern zeigt beide Namen kommagetrennt in der Tabelle', async () => {
  const page = await ladeSeite({
    mitarbeiter: [{ id: 'm1', name: 'Max Muster' }, { id: 'm2', name: 'Erika Beispiel' }],
    teams: [{ id: 't1', name: 'Kolonne 1', mitarbeiterIds: ['m1', 'm2'] }],
  });
  const zeile = await page.locator('table.data-table tbody tr').textContent();
  assert(zeile.includes('Max Muster') && zeile.includes('Erika Beispiel'), `erwartet beide Namen in der Zeile, war "${zeile}"`);
  await page.close();
});

await pruefe('T3: ein neues Team mit zwei ausgewählten Mitgliedern wird mit genau diesen mitarbeiterIds gespeichert', async () => {
  const page = await ladeSeite({ mitarbeiter: [{ id: 'm1', name: 'Max Muster' }, { id: 'm2', name: 'Erika Beispiel' }], teams: [] });
  await page.locator('#btn-new').click();
  await page.locator('input[name="name"]').fill('Kolonne Nord');
  await page.locator('.f-mitglied').nth(0).check();
  await page.locator('.f-mitglied').nth(1).check();
  await page.locator('button[type="submit"]').click();
  await page.waitForFunction(() => globalThis.__puts && globalThis.__puts.length === 1, { timeout: 5000 });
  const puts = await page.evaluate(() => globalThis.__puts);
  assert(puts[0].storeName === 'teams', `erwartet Speicherung in "teams", war "${puts[0].storeName}"`);
  assert(puts[0].value.name === 'Kolonne Nord', `erwartet Name "Kolonne Nord", war "${puts[0].value.name}"`);
  assert(puts[0].value.mitarbeiterIds.length === 2 && puts[0].value.mitarbeiterIds.includes('m1') && puts[0].value.mitarbeiterIds.includes('m2'),
    `erwartet beide Mitarbeiter-IDs, war ${JSON.stringify(puts[0].value.mitarbeiterIds)}`);
  await page.close();
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
await browser.close();
server.close();
process.exit(fehlgeschlagen > 0 ? 1 : 0);
