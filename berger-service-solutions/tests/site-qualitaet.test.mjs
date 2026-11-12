// Qualitätsprüfung der generierten Website (SEO, Struktur, Links, Inhalte).
// Baut die Seiten neu und prüft anschließend public/.
// Ausführen: node berger-service-solutions/tests/site-qualitaet.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bauen } from '../src/build.mjs';
import { offeneKonfigurationspunkte, CONFIG } from '../src/config.mjs';

const PUBLIC = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'public');
let ok = 0, fail = 0;
function test(name, fn) {
  try { fn(); ok++; console.log(`  ✓ ${name}`); } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message.split('\n').join('\n    ')}`); }
}

const { leistungen } = bauen();
const dateien = readdirSync(PUBLIC).filter((f) => f.endsWith('.html'));
const html = Object.fromEntries(dateien.map((f) => [f, readFileSync(path.join(PUBLIC, f), 'utf8')]));
const erstes = (s, re) => (s.match(re) || [])[1];
const titel = (s) => erstes(s, /<title>([^<]*)<\/title>/)?.replace(/&amp;/g, '&');
const beschreibung = (s) => erstes(s, /<meta name="description" content="([^"]*)"/);
const text = (s) => s.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<header[\s\S]*?<\/header>/, ' ').replace(/<footer[\s\S]*?<\/footer>/, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
const indexierbar = dateien.filter((f) => !['impressum.html', 'datenschutz.html', '404.html'].includes(f));

console.log(`Seiten: ${dateien.length}`);
test('mindestens 60 Seiten erzeugt', () => assert.ok(dateien.length >= 60, String(dateien.length)));
test('jede Leistung hat eine eigene Seite', () => { for (const l of leistungen) assert.ok(html[`${l.slug}.html`], l.slug); });
test('Bodenlegearbeiten: Hub-Seite mit mindestens 4 Unterseiten und allen geforderten Themen', () => {
  const unter = leistungen.filter((l) => l.eltern === 'bodenlegearbeiten');
  assert.ok(unter.length >= 4);
  const t = text(html['bodenlegearbeiten.html']).toLowerCase();
  for (const begriff of ['vinyl', 'laminat', 'designboden', 'pvc', 'teppichboden', 'parkett', 'entfernung alter', 'untergrundvorbereitung', 'spachtel', 'sockelleisten', 'bodenrenovierung']) assert.ok(t.includes(begriff), begriff);
});

test('Titel: vorhanden, eindeutig, max. 70 Zeichen', () => {
  const gesehen = new Map();
  for (const [f, s] of Object.entries(html)) {
    const t = titel(s); assert.ok(t, `${f}: kein Titel`); assert.ok(t.length <= 70, `${f}: ${t.length} Zeichen`);
    assert.ok(!gesehen.has(t), `doppelt: ${f} / ${gesehen.get(t)}`); gesehen.set(t, f);
  }
});
test('Meta-Description: vorhanden, eindeutig, 70–160 Zeichen', () => {
  const gesehen = new Map();
  for (const f of indexierbar) {
    const d = beschreibung(html[f]); assert.ok(d, `${f}: fehlt`);
    const len = d.replace(/&[a-z]+;/g, 'x').length;
    assert.ok(len >= 70 && len <= 160, `${f}: ${len} Zeichen`);
    assert.ok(!gesehen.has(d), `doppelt: ${f} / ${gesehen.get(d)}`); gesehen.set(d, f);
  }
});
test('genau eine H1 pro Seite, H1 eindeutig', () => {
  const gesehen = new Map();
  for (const [f, s] of Object.entries(html)) {
    const h1 = s.match(/<h1[\s>]/g) || []; assert.equal(h1.length, 1, `${f}: ${h1.length} H1`);
    const t = erstes(s, /<h1[^>]*>([\s\S]*?)<\/h1>/);
    assert.ok(!gesehen.has(t), `doppelt: ${f} / ${gesehen.get(t)}`); gesehen.set(t, f);
  }
});
test('canonical absolut und passend zur Datei', () => {
  for (const [f, s] of Object.entries(html)) {
    const c = erstes(s, /<link rel="canonical" href="([^"]+)"/);
    assert.ok(c?.startsWith(CONFIG.website.url), f);
    assert.ok(f === 'index.html' ? c.endsWith('/') : c.endsWith('/' + f), `${f}: ${c}`);
  }
});
test('robots-Meta entspricht Go-live-Schalter', () => {
  for (const [f, s] of Object.entries(html)) {
    const r = erstes(s, /<meta name="robots" content="([^"]+)"/);
    if (!CONFIG.website.indexierbar) assert.match(r, /noindex/, f);
    else if (indexierbar.includes(f)) assert.match(r, /^index/, f);
  }
});
test('JSON-LD ist gültiges JSON und enthält das Unternehmen', () => {
  for (const [f, s] of Object.entries(html)) {
    const roh = erstes(s, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    const j = JSON.parse(roh);
    assert.ok(j['@graph'].some((n) => n['@type'] === 'HomeAndConstructionBusiness'), f);
    for (const n of j['@graph']) assert.ok(n && n['@type'], `${f}: Knoten ohne @type`);
  }
});
test('Leistungsseiten: Service-, FAQPage- und BreadcrumbList-Schema', () => {
  for (const l of leistungen) {
    const j = JSON.parse(erstes(html[`${l.slug}.html`], /<script type="application\/ld\+json">([\s\S]*?)<\/script>/));
    const typen = j['@graph'].map((n) => n['@type']);
    for (const t of ['Service', 'FAQPage', 'BreadcrumbList']) assert.ok(typen.includes(t), `${l.slug}: ${t}`);
  }
});
test('keine erfundene Adresse/Telefonnummer in strukturierten Daten, solange nicht konfiguriert', () => {
  const j = JSON.parse(erstes(html['index.html'], /<script type="application\/ld\+json">([\s\S]*?)<\/script>/));
  const org = j['@graph'].find((n) => n['@type'] === 'HomeAndConstructionBusiness');
  if (!CONFIG.kontakt.strasse) assert.equal(org.address, undefined);
  if (!CONFIG.kontakt.telefon) assert.equal(org.telephone, undefined);
  if (!CONFIG.kontakt.telefon) for (const [f, s] of Object.entries(html)) assert.ok(!/href="tel:/.test(s), `${f}: tel-Link ohne Nummer`);
});

test('alle internen Links und Assets existieren', () => {
  const fehler = [];
  for (const [f, s] of Object.entries(html)) {
    for (const m of s.matchAll(/(?:href|src)="([^"#]+)(?:#[^"]*)?"/g)) {
      const ziel = m[1];
      if (/^(https?:|mailto:|tel:|data:)/.test(ziel)) continue;
      const pfad = ziel.split('?')[0];
      if (!existsSync(path.join(PUBLIC, pfad))) fehler.push(`${f} → ${ziel}`);
    }
  }
  assert.deepEqual(fehler, []);
});
test('Anker auf Seiten existieren', () => {
  for (const [f, s] of Object.entries(html)) {
    for (const m of s.matchAll(/href="#([^"]+)"/g)) assert.ok(s.includes(`id="${m[1]}"`), `${f}: #${m[1]}`);
  }
});
test('jede indexierbare Seite ist intern verlinkt (keine Waisen)', () => {
  const verlinkt = new Set();
  for (const s of Object.values(html)) for (const m of s.matchAll(/href="([^"#?]+\.html)/g)) verlinkt.add(m[1]);
  for (const f of indexierbar) assert.ok(verlinkt.has(f), f);
});
test('Sitemap enthält genau die indexierbaren Seiten', () => {
  const sm = readFileSync(path.join(PUBLIC, 'sitemap.xml'), 'utf8');
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal(locs.length, indexierbar.length);
  assert.equal(new Set(locs).size, locs.length);
});
test('robots.txt passt zum Go-live-Schalter', () => {
  const r = readFileSync(path.join(PUBLIC, 'robots.txt'), 'utf8');
  if (CONFIG.website.indexierbar) assert.match(r, /Sitemap:/); else assert.match(r, /Disallow: \/\n/);
});
test('llms.txt vorhanden und verweist auf alle Leistungen', () => {
  const t = readFileSync(path.join(PUBLIC, 'llms.txt'), 'utf8');
  for (const l of leistungen) assert.ok(t.includes(`${l.slug}.html`), l.slug);
});

test('Ortsseiten: keine Beinahe-Duplikate (Jaccard der Wort-Trigramme < 0,6)', () => {
  const orte = dateien.filter((f) => /^einsatzgebiet-.+\.html$/.test(f));
  assert.ok(orte.length >= 13, String(orte.length));
  const trigramme = (s) => { const w = text(s).toLowerCase().split(' '); const set = new Set(); for (let i = 0; i < w.length - 2; i++) set.add(w.slice(i, i + 3).join(' ')); return set; };
  const sets = Object.fromEntries(orte.map((f) => [f, trigramme(html[f])]));
  let max = 0, paar = '';
  for (let i = 0; i < orte.length; i++) for (let j = i + 1; j < orte.length; j++) {
    const a = sets[orte[i]], b = sets[orte[j]];
    let inter = 0; for (const x of a) if (b.has(x)) inter++;
    const jac = inter / (a.size + b.size - inter);
    if (jac > max) { max = jac; paar = `${orte[i]} / ${orte[j]}`; }
  }
  console.log(`    höchste Ähnlichkeit: ${max.toFixed(2)} (${paar})`);
  assert.ok(max < 0.6, `${paar}: ${max.toFixed(2)}`);
});
test('Leistungsseiten haben ausreichend eigenen Inhalt (≥ 350 Wörter)', () => {
  for (const l of leistungen) {
    const n = text(html[`${l.slug}.html`]).split(' ').length;
    assert.ok(n >= 350, `${l.slug}: ${n} Wörter`);
  }
});
test('keine internen Prüfvermerke, Garantien oder Ranking-Versprechen im Seitentext', () => {
  const verboten = [/\bOFFEN\b/, /\(intern\)/i, /garantiert/i, /platz 1/i, /\bnr\.\s?1\b/i, /bester? (elektriker|handwerker|anbieter)/i, /\d+\s?(\+\s?)?zufriedene kunden/i, /\bseit \d{4}\b/i, /sterne?-bewertung/i];
  for (const [f, s] of Object.entries(html)) for (const re of verboten) assert.ok(!re.test(text(s)), `${f}: ${re}`);
});
test('Barrierefreiheit: lang, Viewport, Sprungmarke, Labels für Formularfelder', () => {
  for (const [f, s] of Object.entries(html)) {
    assert.match(s, /<html lang="de">/, f); assert.match(s, /name="viewport"/, f); assert.match(s, /class="sprungmarke"/, f);
    for (const m of s.matchAll(/<(?:input|select|textarea)\b([^>]*)>/g)) {
      const attrs = m[1]; if (/type="(hidden|radio|checkbox|submit)"/.test(attrs)) continue;
      const id = erstes(attrs, /id="([^"]+)"/); assert.ok(id && s.includes(`for="${id}"`), `${f}: Feld ohne Label (${attrs.trim().slice(0, 40)})`);
    }
  }
});
test('Buchungsseite: Katalog-JSON enthält alle Leistungen, direkte Buchung nur für Standardleistungen', () => {
  const k = JSON.parse(erstes(html['buchen.html'], /<script type="application\/json" id="katalog">([\s\S]*?)<\/script>/));
  assert.equal(k.leistungen.length, leistungen.length);
  const direkt = k.leistungen.filter((l) => l.buchung === 'direkt');
  assert.ok(direkt.length >= 4);
  for (const l of direkt) assert.ok(['wartung', 'service'].includes(l.prozess), l.slug);
});

const offen = offeneKonfigurationspunkte();
console.log(`\nOffene Konfigurationspunkte vor Go-live (${offen.length}):\n  - ${offen.join('\n  - ')}`);
console.log(`\n--- Ergebnis: ${ok} bestanden, ${fail} fehlgeschlagen ---`);
process.exitCode = fail ? 1 : 0;
