// Echter Browser-Test für renderTabbedView() aus verwaltung/js/tabbedView.js
// (14.11.2026, "zusammengefasste Navigationspunkte" wie Aufträge & Service,
// Dokumente, Finanzen - siehe die neuen Views unter views/auftraegeService.js
// usw.). Deckt die sicherheitsrelevante Eigenschaft ab: ein Reiter, auf den
// die aktuelle Rolle laut ROUTE_ROLLEN (db.js, hasRouteAccess) keinen Zugriff
// hat, wird nicht angezeigt UND nicht gerendert - sonst könnte z.B. eine
// Büro-Rolle über einen zusammengefassten Reiter an admin-only Daten
// (Buchhaltung/Auswertungen) kommen. Nutzt echte, unveränderte
// hasRouteAccess()/getSession()-Implementierungen (kein Mock davon), nur die
// drei Tab-Render-Funktionen selbst sind Test-Fakes statt echter Views.
//
// Ausführen: node verwaltung/tests/tabbed-view.test.mjs
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

const harnessHtml = (role) => `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="host"></div>
<script type="module">
  sessionStorage.setItem('nv-unlocked-session', JSON.stringify({ role: ${JSON.stringify(role)} }));
  const { renderTabbedView } = await import('/js/tabbedView.js');
  window.__calls = [];
  // Reiter-ids entsprechen absichtlich echten ROUTE_ROLLEN-Schlüsseln aus
  // db.js (ausgaben: admin+büro, buchhaltung/auswertungen: nur admin) - die
  // Rollenprüfung in renderTabbedView() läuft gegen die ECHTE db.js.
  const tabs = [
    { id: 'ausgaben', label: 'Ausgaben', render: (host) => { host.textContent = 'AUSGABEN'; window.__calls.push('ausgaben'); } },
    { id: 'buchhaltung', label: 'Buchhaltung', render: (host) => { host.textContent = 'BUCHHALTUNG'; window.__calls.push('buchhaltung'); } },
    { id: 'auswertungen', label: 'Auswertungen', render: (host) => { host.textContent = 'AUSWERTUNGEN'; window.__calls.push('auswertungen'); } },
  ];
  await renderTabbedView(document.getElementById('host'), null, { titel: 'Finanzen', tabs });
  window.__ready = true;
</script>
</body></html>`;

async function ladeSeite(role) {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.route(/\/harness\.html(\?.*)?$/, (route) => route.fulfill({ contentType: 'text/html', body: harnessHtml(role) }));
  await page.goto(`http://127.0.0.1:${port}/harness.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, { timeout: 10000 });
  if (pageErrors.length) throw new Error('JS-Fehler: ' + pageErrors.join('; '));
  return page;
}

await pruefe('T1 (Sicherheit): Rolle "buero" sieht nur den Ausgaben-Reiter - buchhaltung/auswertungen sind admin-only und werden weder angezeigt noch gerendert', async () => {
  const page = await ladeSeite('buero');
  const tabButtons = await page.locator('.tab-item').allTextContents();
  assert(tabButtons.length === 1, `erwartet 1 sichtbaren Reiter für buero, erhalten ${tabButtons.length} (${tabButtons.join(',')})`);
  assert(tabButtons[0] === 'Ausgaben', `erwartet "Ausgaben", war "${tabButtons[0]}"`);
  const calls = await page.evaluate(() => window.__calls);
  assert(calls.length === 1 && calls[0] === 'ausgaben', `erwartet nur ausgaben gerendert, erhalten ${JSON.stringify(calls)}`);
  await page.close();
});

await pruefe('T2: Rolle "admin" sieht alle drei Reiter, aber nur der erste wird initial gerendert (lazy)', async () => {
  const page = await ladeSeite('admin');
  const tabButtons = await page.locator('.tab-item').allTextContents();
  assert(tabButtons.length === 3, `erwartet 3 sichtbare Reiter für admin, erhalten ${tabButtons.length}`);
  const calls = await page.evaluate(() => window.__calls);
  assert(calls.length === 1 && calls[0] === 'ausgaben', `erwartet nur den ersten Reiter initial gerendert, erhalten ${JSON.stringify(calls)}`);
  await page.close();
});

await pruefe('T3: Klick auf einen anderen Reiter lädt ihn genau einmal (lazy, nicht erneut bei zweitem Klick) und markiert ihn aktiv', async () => {
  const page = await ladeSeite('admin');
  await page.locator('.tab-item', { hasText: 'Buchhaltung' }).click();
  const host = await page.locator('#host div[id^="tv-tab-"]:not([hidden])').textContent();
  assert(host === 'BUCHHALTUNG', `erwartet sichtbares Panel "BUCHHALTUNG", war "${host}"`);
  const aktivLabel = await page.locator('.tab-item.active').textContent();
  assert(aktivLabel === 'Buchhaltung', `erwartet "Buchhaltung" als aktiv, war "${aktivLabel}"`);
  await page.locator('.tab-item', { hasText: 'Buchhaltung' }).click();
  const calls = await page.evaluate(() => window.__calls);
  assert(calls.filter((c) => c === 'buchhaltung').length === 1, `erwartet Buchhaltung nur 1x gerendert trotz 2. Klick, erhalten ${JSON.stringify(calls)}`);
  await page.close();
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
await browser.close();
server.close();
process.exit(fehlgeschlagen > 0 ? 1 : 0);
