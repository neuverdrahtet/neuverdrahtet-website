// Browser-Test (Playwright/Chromium): Online-Buchung end-to-end im Demo-Modus,
// Navigation mobil, kein horizontales Scrollen, keine JavaScript-Fehler.
// Ausführen: node berger-service-solutions/tests/browser/buchung-e2e.test.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { starteServer } from '../hilfen/server.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
let ok = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); ok++; console.log(`  ✓ ${name}`); } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message.split('\n')[0]}`); }
}

const { server, basis } = await starteServer();
const browser = await chromium.launch();
const jsFehler = [];
async function neueSeite(opts = {}) {
  const page = await browser.newPage(opts);
  page.on('pageerror', (e) => jsFehler.push(`${page.url()}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') jsFehler.push(`${page.url()}: ${m.text()}`); });
  return page;
}

try {
  await test('Direktbuchung DGUV V3: vollständiger Durchlauf mit Prüfschritt und Bestätigung', async () => {
    const page = await neueSeite({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${basis}/buchen.html?leistung=dguv-v3-pruefung`);
    assert.equal(await page.inputValue('#f-leistung'), 'dguv-v3-pruefung');
    await page.click('[data-weiter]');
    // Fehlervalidierung Schritt 2
    await page.click('[data-weiter]');
    assert.match(await page.textContent('[data-fehler="strasse"]'), /Straße/);
    assert.equal(await page.getAttribute('#f-strasse', 'aria-invalid'), 'true');
    await page.fill('#f-strasse', 'Rüttenscheider Straße');
    await page.fill('#f-hausnummer', '120');
    await page.fill('#f-plz', '45131');
    await page.locator('#f-plz').blur();
    assert.equal(await page.inputValue('#f-ort'), 'Essen', 'Ort aus PLZ ergänzt');
    assert.match(await page.textContent('[data-eg-box]'), /Zone A/);
    await page.click('[data-weiter]');
    assert.equal(await page.isVisible('[data-zusatzfeld="geraete"]'), true);
    await page.fill('#f-beschreibung', 'Prüfung aller ortsveränderlichen Geräte im Büro.');
    await page.fill('#f-geraete', '45');
    await page.click('[data-weiter]');
    assert.match(await page.textContent('[data-fehler="slot"]'), /Wunschtermin/);
    await page.locator('.slot-zeiten label').first().click();
    await page.click('[data-weiter]');
    await page.selectOption('#f-kundentyp', 'gewerbe');
    await page.fill('#f-firma', 'Muster GmbH');
    await page.fill('#f-vorname', 'Erika');
    await page.fill('#f-nachname', 'Musterfrau');
    await page.fill('#f-telefon', '0201 1234567');
    await page.fill('#f-email', 'erika@example.de');
    await page.click('[data-weiter]');
    const zusammenfassung = await page.textContent('[data-zusammenfassung]');
    for (const t of ['DGUV-V3-Prüfung', 'Rüttenscheider Straße 120, 45131 Essen', 'Zone A', 'Muster GmbH', 'erika@example.de', '45']) assert.ok(zusammenfassung.includes(t), t);
    await page.click('[data-absenden]');
    assert.match(await page.textContent('[data-fehler="datenschutz"]'), /Datenschutz/);
    await page.check('input[name="datenschutz"]');
    await page.click('[data-absenden]');
    await page.waitForSelector('.bestaetigung');
    const best = await page.textContent('.bestaetigung');
    assert.match(best, /DEMO-\d{8}-[0-9A-F]{4}/);
    assert.match(best, /Demo-Modus/);
    await page.close();
  });

  await test('Anfrage Badsanierung: Änderung aus der Zusammenfassung, abweichende Rechnungsadresse', async () => {
    const page = await neueSeite({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${basis}/buchen.html?leistung=badsanierung&ort=gelsenkirchen`);
    assert.equal(await page.inputValue('#f-ort'), 'Gelsenkirchen');
    await page.click('[data-weiter]');
    await page.fill('#f-strasse', 'Musterweg');
    await page.fill('#f-hausnummer', '7b');
    await page.fill('#f-plz', '45879');
    await page.check('#f-rechnung-abw');
    await page.click('[data-weiter]');
    assert.match(await page.textContent('[data-fehler="rName"]'), /Rechnungsempfänger/);
    await page.fill('#f-r-name', 'Hausverwaltung Beispiel');
    await page.fill('#f-r-strasse', 'Verwaltungsstraße');
    await page.fill('#f-r-hausnummer', '1');
    await page.fill('#f-r-plz', '45127');
    await page.fill('#f-r-ort', 'Essen');
    await page.click('[data-weiter]');
    assert.equal(await page.isVisible('[data-termin-anfrage]'), true);
    assert.equal(await page.isVisible('[data-termin-direkt]'), false);
    await page.fill('#f-beschreibung', 'Bad ca. 6 m², Wanne raus, bodengleiche Dusche gewünscht.');
    await page.click('[data-weiter]');
    await page.fill('#f-vorname', 'Max'); await page.fill('#f-nachname', 'Muster');
    await page.fill('#f-telefon', '+49 209 123456'); await page.fill('#f-email', 'max@example.de');
    await page.check('input[name="kontaktweg"][value="whatsapp"]');
    await page.click('[data-weiter]');
    assert.equal(await page.isVisible('[data-whatsapp-einwilligung]'), true);
    await page.click('[data-zusammenfassung] h3:nth-of-type(1) button');
    assert.equal(await page.isVisible('[data-schritt="1"]'), true);
    for (let i = 0; i < 4; i++) await page.click('[data-weiter]');
    assert.match(await page.textContent('[data-zusammenfassung]'), /Hausverwaltung Beispiel/);
    await page.check('input[name="datenschutz"]');
    await page.click('[data-absenden]');
    await page.waitForSelector('.bestaetigung');
    assert.match(await page.textContent('.bestaetigung'), /Besichtigung/);
    await page.close();
  });

  await test('Einsatzgebietsprüfer auf der Startseite', async () => {
    const page = await neueSeite();
    await page.goto(`${basis}/index.html`);
    await page.fill('#eg-plz', '44787');
    await page.click('[data-eg-pruefer] button');
    assert.match(await page.textContent('.eg-ergebnis'), /Bochum liegt in unserem Einsatzgebiet/);
    await page.fill('#eg-plz', '50667');
    await page.click('[data-eg-pruefer] button');
    assert.match(await page.textContent('.eg-ergebnis'), /persönlich/);
    await page.close();
  });

  await test('Mobil (390 px): Menü öffnet/schließt, Megamenü, keine horizontale Scrollleiste auf allen Seiten', async () => {
    const page = await neueSeite({ viewport: { width: 390, height: 844 } });
    await page.goto(`${basis}/index.html`);
    assert.equal(await page.isVisible('#hauptnav'), false);
    await page.click('.nav-schalter');
    assert.equal(await page.isVisible('#hauptnav'), true);
    await page.click('.mega-schalter');
    assert.equal(await page.isVisible('#mega a[href="bodenlegearbeiten.html"]'), true);
    // Menü muss den Bildschirm bis unten füllen und darf nicht abgeschnitten sein
    const imMenue = await page.evaluate(() => [300, 600, 780].every((y) => document.getElementById('hauptnav').contains(document.elementFromPoint(195, y))));
    assert.equal(imMenue, true, 'mobiles Menü wird abgeschnitten');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    assert.equal(await page.isVisible('#hauptnav'), false);
    const zuBreit = [];
    for (const f of readdirSync(PUBLIC).filter((x) => x.endsWith('.html'))) {
      await page.goto(`${basis}/${f}`);
      const w = await page.evaluate(() => document.documentElement.scrollWidth);
      if (w > 390) zuBreit.push(`${f}: ${w}px`);
    }
    assert.deepEqual(zuBreit, []);
    await page.close();
  });

  await test('Buchungsformular mobil: nur ein Navigationsknopf je Richtung sichtbar', async () => {
    const page = await neueSeite({ viewport: { width: 390, height: 844 } });
    await page.goto(`${basis}/buchen.html`);
    assert.equal(await page.isVisible('[data-zurueck]'), false);
    assert.equal(await page.isVisible('[data-absenden]'), false);
    assert.equal(await page.isVisible('[data-weiter]'), true);
    await page.close();
  });

  await test('keine JavaScript-Fehler auf allen besuchten Seiten', async () => { assert.deepEqual(jsFehler, []); });
} finally {
  await browser.close();
  server.close();
}

console.log(`\n--- Ergebnis: ${ok} bestanden, ${fail} fehlgeschlagen ---`);
process.exitCode = fail ? 1 : 0;
