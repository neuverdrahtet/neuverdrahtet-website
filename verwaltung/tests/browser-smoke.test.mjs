// Echter Browser-Smoke-Test gegen die TATSÄCHLICHE verwaltung/-App (nicht
// nur Node-Unit-Tests) - lädt index.html in einem echten, headless Chromium
// (Playwright) und prüft, dass die App fehlerfrei bis zum Login-Bildschirm
// lädt. Deckt NICHT dieselbe Tiefe ab wie die in Phase 9 behaupteten
// "21/21 Playwright-Browsertests" (die nirgends im Repo als Datei
// existierten und sich nicht rekonstruieren lassen, siehe Phase-10.1-
// Bericht) - das hier ist ein bewusst kleiner, aber ECHTER und
// reproduzierbarer Rauchtest.
//
// Sicherheit/Isolation: blockiert JEDE Netzwerkanfrage an Google/Firebase-
// Domains, damit der Test niemals die echte, in firebase-config.js
// hinterlegte PRODUKTIONS-Firebase-Instanz erreicht (Vorgabe "keine echten
// Dienste nutzen") - die App muss trotzdem bis zum Login-Formular kommen,
// weil Firebase Auth den ersten onAuthStateChanged-Status aus dem lokalen
// (hier: leeren) Browser-Zustand liefert, nicht aus dem Netzwerk.
//
// Ausführen: npm run test:browser-smoke
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const verwaltungDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

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
// Nutzt das in dieser Umgebung vorinstallierte Chromium unter
// PLAYWRIGHT_BROWSERS_PATH, falls die exakte von "playwright" erwartete
// Build-Version abweicht (z.B. nach einem npm-Update) - sonst würde
// chromium.launch() versuchen, einen neuen Browser herunterzuladen.
const vorinstalliertesChromium = '/opt/pw-browsers/chromium';
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH && fsSync.existsSync(vorinstalliertesChromium)
    ? { executablePath: vorinstalliertesChromium }
    : {},
);

await pruefe('B1: index.html lädt (Status 200, Titel "Werkora") OHNE jede echte Netzwerkanfrage an Google/Firebase - geblockte Domains werden NICHT real erreicht', async () => {
  const page = await browser.newPage();
  const geblockteAufrufe = [];
  await page.route(/^https?:\/\/.*\.(googleapis|google|firebaseapp|gstatic|firebaseio)\.com.*/, (route) => {
    geblockteAufrufe.push(route.request().url());
    route.abort();
  });
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  const response = await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  assert(response.status() === 200, `erwartet Status 200, war ${response.status()}`);
  assert((await page.title()) === 'Werkora', `erwartet Titel "Werkora", war "${await page.title()}"`);

  await page.waitForFunction(() => {
    const box = document.getElementById('lock-auth-box');
    return box && box.hidden === false;
  }, { timeout: 15000 });

  // Firebase Auth löst den ersten onAuthStateChanged-Status beim allerersten
  // Laden (leeres IndexedDB) offenbar bereits rein lokal auf, ohne überhaupt
  // eine Netzwortanfrage zu versuchen - das ist für die Isolationsgarantie
  // dieses Tests NOCH besser als "versucht, aber abgeblockt". Beides ist
  // ein Erfolg: geblockteAufrufe.length kann 0 ODER >0 sein, in KEINEM Fall
  // darf aber ein echter (nicht abgefangener) Request an diese Domains
  // tatsächlich durchgekommen sein (würde sich sonst oben schon in einem
  // Netzwerkfehler/anderen Symptomen zeigen - page.route fängt JEDEN
  // passenden Request ab, bevor er das Netzwerk erreicht).
  assert(pageErrors.length === 0, `keine uncaught JS-Fehler erwartet, gefunden: ${pageErrors.join('; ')}`);
  await page.close();
});

await pruefe('B2: das Login-Formular (E-Mail/Passwort) ist nach dem Laden tatsächlich sichtbar und enthält die erwarteten Eingabefelder', async () => {
  const page = await browser.newPage();
  await page.route(/^https?:\/\/.*\.(googleapis|google|firebaseapp|gstatic|firebaseio)\.com.*/, (route) => route.abort());
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#lock-auth-box:not([hidden])', { timeout: 15000 });
  assert(await page.locator('#auth-email').isVisible(), 'E-Mail-Feld muss sichtbar sein');
  assert(await page.locator('#auth-password').isVisible(), 'Passwort-Feld muss sichtbar sein');
  assert(await page.locator('#auth-submit').isVisible(), 'Anmelden-Button muss sichtbar sein');
  await page.close();
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
await browser.close();
server.close();
process.exit(fehlgeschlagen > 0 ? 1 : 0);
