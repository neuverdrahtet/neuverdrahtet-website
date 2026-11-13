// Echter Browser-Test für den Staging-Umschalter in firebase-config.js
// (Maßnahme 7, Schritt 6, 13.11.2026) - lädt das echte Modul in einem
// headless Chromium, kein Mock der eigentlichen Logik. Prüft die Verdrahtung
// (URL-Parameter -> localStorage -> firebaseConfig) auf 127.0.0.1. Die
// sicherheitskritische Regel selbst (NIE auf der echten Produktionsdomain
// aktivieren) prüft staging-schalter-logik.test.mjs als reinen Node-Test -
// eine echte Netzwerk-Navigation zu "neuverdrahtet.com" scheitert in dieser
// Sandbox am Egress-Proxy, unabhängig vom Code selbst.
//
// Ausführen: node verwaltung/tests/staging-schalter.test.mjs
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
<script type="module">
  import { firebaseConfig } from '/js/firebase-config.js';
  window.__config = firebaseConfig;
  window.__ready = true;
</script>
</body></html>`;

async function ladeSeite(url) {
  const page = await browser.newPage();
  await page.route(/^https?:\/\/.*\.(googleapis|google|firebaseapp|gstatic|firebaseio)\.com.*/, (route) => route.abort());
  await page.route(/\/harness\.html(\?.*)?$/, (route) => route.fulfill({ contentType: 'text/html', body: harnessHtml }));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, { timeout: 10000 });
  return page;
}

await pruefe('S1: ohne "?staging"-Parameter liefert firebaseConfig die Produktions-Werte', async () => {
  const page = await ladeSeite(`http://127.0.0.1:${port}/harness.html`);
  const projectId = await page.evaluate(() => window.__config.projectId);
  assert(projectId === 'neuverdrahtet-verwaltung', `erwartet Produktions-Projekt-ID, erhalten "${projectId}"`);
  await page.close();
});

await pruefe('S2: "?staging=1" auf einer Nicht-Produktionsdomain aktiviert die Staging-Konfiguration', async () => {
  const page = await ladeSeite(`http://127.0.0.1:${port}/harness.html?staging=1`);
  const projectId = await page.evaluate(() => window.__config.projectId);
  assert(projectId === 'neuverdrahtet-staging', `erwartet Staging-Projekt-ID, erhalten "${projectId}"`);
  await page.close();
});

await pruefe('S3: die Aktivierung bleibt nach einem erneuten Laden ohne Parameter bestehen (localStorage)', async () => {
  const page = await ladeSeite(`http://127.0.0.1:${port}/harness.html?staging=1`);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, { timeout: 10000 });
  const projectId = await page.evaluate(() => window.__config.projectId);
  assert(projectId === 'neuverdrahtet-staging', `erwartet weiterhin Staging-Projekt-ID nach Reload, erhalten "${projectId}"`);
  await page.close();
});

await pruefe('S4: "?staging=0" deaktiviert den Staging-Modus wieder dauerhaft', async () => {
  const page = await ladeSeite(`http://127.0.0.1:${port}/harness.html?staging=1`);
  await page.close();
  const page2 = await ladeSeite(`http://127.0.0.1:${port}/harness.html?staging=0`);
  const projectId = await page2.evaluate(() => window.__config.projectId);
  assert(projectId === 'neuverdrahtet-verwaltung', `erwartet Produktions-Projekt-ID nach "?staging=0", erhalten "${projectId}"`);
  await page2.close();
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
await browser.close();
server.close();
process.exit(fehlgeschlagen > 0 ? 1 : 0);
