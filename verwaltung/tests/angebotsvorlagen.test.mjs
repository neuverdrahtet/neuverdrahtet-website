// Echter Browser-Test für die neue addPositionen()-API in
// verwaltung/js/positions.js (Grundlage für "Komplette Vorlage laden" in
// Angebote) - lädt das echte Modul in einem headless Chromium, blockt jede
// Firebase/Google-Netzwerkanfrage (siehe browser-smoke.test.mjs) und prüft
// echtes DOM-Verhalten, keine Mocks der eigentlichen Logik.
//
// Ausführen: node verwaltung/tests/angebotsvorlagen.test.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const verwaltungDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

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
      } catch {
        res.writeHead(404); res.end('Not found');
      }
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
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH && fsSync.existsSync(vorinstalliertesChromium)
    ? { executablePath: vorinstalliertesChromium }
    : {},
);

const harnessHtml = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="pos-host"></div>
<script type="module">
  import { createPositionsEditor } from '/js/positions.js';
  window.__editor = createPositionsEditor({
    host: document.getElementById('pos-host'),
    katalog: [],
    positionen: [],
    defaultSteuersatz: 19,
  });
  window.__ready = true;
</script>
</body></html>`;

await pruefe('A1: addPositionen() fügt Positionen aus einer Vorlage dem posState hinzu und rendert sie ins DOM', async () => {
  const page = await browser.newPage();
  await page.route(/^https?:\/\/.*\.(googleapis|google|firebaseapp|gstatic|firebaseio)\.com.*/, (route) => route.abort());
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.route('**/harness.html', (route) => route.fulfill({ contentType: 'text/html', body: harnessHtml }));
  await page.goto(`http://127.0.0.1:${port}/harness.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, { timeout: 10000 });

  const vorPos = await page.evaluate(() => window.__editor.getPositionen().length);
  assert(vorPos === 0, `erwartet 0 Positionen vor addPositionen(), erhalten ${vorPos}`);

  await page.evaluate(() => {
    window.__editor.addPositionen([
      { bezeichnung: 'E-Check Wohnung', einheit: 'Pauschal', menge: 1, einzelpreis: 150, steuersatz: 19 },
      { bezeichnung: 'Steckdosen tauschen', einheit: 'Stück', menge: 5, einzelpreis: 25, steuersatz: 19 },
    ]);
  });

  const nachPos = await page.evaluate(() => window.__editor.getPositionen());
  assert(nachPos.length === 2, `erwartet 2 Positionen nach addPositionen(), erhalten ${nachPos.length}`);
  assert(nachPos.every((p) => !!p.id), 'jede eingefügte Position muss eine eigene id bekommen');
  assert(nachPos[0].id !== nachPos[1].id, 'eingefügte Positionen müssen unterschiedliche ids haben');

  // Jede Position rendert 2 <tr>: die Hauptzeile + eine Langtext-Zeile
  // (siehe positions.js render()) - hier zählt nur die Hauptzeile.
  const domRows = await page.evaluate(() => document.querySelectorAll('#pos-host tbody tr[data-i]:not(.row-langtext)').length);
  assert(domRows === 2, `erwartet 2 gerenderte Positions-Hauptzeilen im DOM, erhalten ${domRows}`);

  assert(pageErrors.length === 0, `keine uncaught JS-Fehler erwartet, gefunden: ${pageErrors.join('; ')}`);
  await page.close();
});

await pruefe('A2: addPositionen() mit leerer/undefinierter Liste verändert den Bestand nicht und wirft nicht', async () => {
  const page = await browser.newPage();
  await page.route(/^https?:\/\/.*\.(googleapis|google|firebaseapp|gstatic|firebaseio)\.com.*/, (route) => route.abort());
  await page.route('**/harness.html', (route) => route.fulfill({ contentType: 'text/html', body: harnessHtml }));
  await page.goto(`http://127.0.0.1:${port}/harness.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, { timeout: 10000 });

  await page.evaluate(() => { window.__editor.addPositionen(); });
  const anzahl = await page.evaluate(() => window.__editor.getPositionen().length);
  assert(anzahl === 0, `erwartet 0 Positionen nach addPositionen() ohne Argument, erhalten ${anzahl}`);
  await page.close();
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
await browser.close();
server.close();
process.exit(fehlgeschlagen > 0 ? 1 : 0);
