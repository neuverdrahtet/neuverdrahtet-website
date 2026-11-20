// Seitengenerator BERGER SERVICE SOLUTIONS.
// Ausführen: node berger-service-solutions/src/build.mjs
// Erzeugt public/*.html, sitemap.xml, robots.txt, llms.txt sowie
// docs/generiert/*.md (Keyword-Matrix, rechtliche Prüfpunkte) aus den Daten in src/daten.
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, copyFileSync } from 'node:fs';
import { CONFIG, offeneKonfigurationspunkte, buchungsEndpunkt } from './config.mjs';
import { BEREICHE, PROZESSE } from './daten/bereiche.mjs';
import { LEISTUNGEN_ELEKTRO } from './daten/leistungen-elektro.mjs';
import { LEISTUNGEN_HANDWERK, LEISTUNGEN_BODEN } from './daten/leistungen-handwerk.mjs';
import { LEISTUNGEN_OBJEKT, LEISTUNGEN_RUECKBAU } from './daten/leistungen-objekt-rueckbau.mjs';
import { ORTSSEITEN } from './daten/orte-seiten.mjs';
import { FOTOS, FOTO, VORHER_NACHHER, GALERIE_START, GEWERBE_FOTOS } from './daten/fotos.mjs';
import { ORTE, pruefeEinsatzgebiet } from '../public/assets/js/einsatzgebiet-logik.mjs';
import {
  esc, absUrl, icon, navigation, fuss, layout, brotkrumenJsonLd, unternehmenJsonLd,
  faqJsonLd, faqHtml, MARKE,
} from './bausteine.mjs';

const WURZEL = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC = path.join(WURZEL, 'public');
const DOCS_GEN = path.join(WURZEL, 'docs', 'generiert');

export const LEISTUNGEN = [...LEISTUNGEN_ELEKTRO, ...LEISTUNGEN_HANDWERK, ...LEISTUNGEN_BODEN, ...LEISTUNGEN_OBJEKT, ...LEISTUNGEN_RUECKBAU];
const NACH_SLUG = Object.fromEntries(LEISTUNGEN.map((l) => [l.slug, l]));
const NACH_BEREICH = Object.fromEntries(BEREICHE.map((b) => [b.id, LEISTUNGEN.filter((l) => l.bereich === b.id)]));
const BEREICH = Object.fromEntries(BEREICHE.map((b) => [b.id, b]));
const ORT = Object.fromEntries(ORTE.map((o) => [o.slug, o]));
const ortName = (slug) => ORT[slug]?.name || slug;
const optEG = { zentrum: CONFIG.einsatzgebiet.zentrum, radiusKm: CONFIG.einsatzgebiet.radiusKm, strassenFaktor: CONFIG.einsatzgebiet.strassenFaktor, durchschnittKmh: CONFIG.einsatzgebiet.durchschnittKmh, zonen: CONFIG.einsatzgebiet.zonen };
const anfahrt = (slug) => pruefeEinsatzgebiet({ plz: String(ORT[slug].plz[0][0]), ort: ORT[slug].name }, optEG);

const KOPF = navigation(NACH_BEREICH);
const FUSS = fuss(NACH_BEREICH, ORTSSEITEN, ortName);
const ORG = unternehmenJsonLd(ORTE);
const seiten = [];

function seite(opts) {
  const html = layout({ ...opts, kopf: KOPF, fussHtml: FUSS, jsonld: [ORG, ...(opts.jsonld || [])] });
  seiten.push({ pfad: opts.pfad, titel: opts.titel, beschreibung: opts.beschreibung, noindex: !!opts.noindex, prioritaet: opts.prioritaet ?? 0.6 });
  writeFileSync(path.join(PUBLIC, opts.pfad), html);
}

const buchungsLink = (l) => `buchen.html?leistung=${encodeURIComponent(l.slug)}`;
const buchungsKnopf = (l, klasse = 'knopf knopf-akzent') => l.buchung === 'direkt'
  ? `<a class="${klasse}" href="${buchungsLink(l)}">${icon('kalender')}Termin online buchen</a>`
  : `<a class="${klasse}" href="${buchungsLink(l)}">${icon('dokument')}Angebot anfragen</a>`;
const buchungsEtikett = (l) => l.buchung === 'direkt'
  ? '<span class="etikett etikett-direkt">Direkt buchbar</span>'
  : '<span class="etikett">Besichtigung & Angebot</span>';

// ---------------------------------------------------------------------------
// Projektfotos
// ---------------------------------------------------------------------------
const fotoPfad = (id, groesse) => `assets/img/projekte/${id}-${groesse}.webp`;
function bild(f, { sizes = '(min-width: 1000px) 33vw, (min-width: 700px) 50vw, 100vw', lazy = true, klasse = '' } = {}) {
  return `<img${klasse ? ` class="${klasse}"` : ''} src="${fotoPfad(f.id, 'klein')}" srcset="${fotoPfad(f.id, 'klein')} ${f.kb}w, ${fotoPfad(f.id, 'gross')} ${f.b}w" sizes="${sizes}" width="${f.b}" height="${f.h}" alt="${esc(f.alt)}"${lazy ? ' loading="lazy" decoding="async"' : ''}>`;
}
function galerie(fotos, titel = 'Aus unseren Projekten', text = 'Eigene Fotos von unseren Baustellen – ohne Stockbilder.') {
  if (!fotos.length) return '';
  return `<section class="abschnitt" aria-labelledby="galerie-titel"><div class="huelle"><h2 id="galerie-titel">${esc(titel)}</h2><p class="unterzeile">${esc(text)}</p>
<div class="galerie">${fotos.map((f) => `<figure class="foto ${f.h > f.b ? 'foto-hoch' : ''}"><a href="${fotoPfad(f.id, 'gross')}">${bild(f)}</a><figcaption>${esc(f.titel)}</figcaption></figure>`).join('')}</div></div></section>`;
}
function vorherNachherHtml() {
  const v = VORHER_NACHHER;
  return `<section class="abschnitt abschnitt-hell" aria-labelledby="vn-titel"><div class="huelle"><h2 id="vn-titel">${esc(v.titel)}</h2><p class="unterzeile">${esc(v.text)}</p>
<div class="vorher-nachher"><figure class="foto"><span class="vn-etikett">Vorher</span>${bild(v.vorher, { sizes: '(min-width: 900px) 50vw, 100vw' })}</figure><figure class="foto"><span class="vn-etikett vn-nachher">Nachher</span>${bild(v.nachher, { sizes: '(min-width: 900px) 50vw, 100vw' })}</figure></div></div></section>`;
}
const fotosFuer = (slugs) => FOTOS.filter((f) => f.leistungen.some((s) => slugs.includes(s)));

function karte(l) {
  return `<article class="karte"><h3><a href="${l.slug}.html">${esc(l.name)}</a></h3><p>${esc(l.kurz)}</p><p class="karte-fuss">${buchungsEtikett(l)}<span class="mehr">Mehr erfahren ${icon('pfeil')}</span></p></article>`;
}

function liste(items, klasse = 'hakenliste') {
  return `<ul class="${klasse}">${items.map((i) => `<li>${icon('haken')}<span>${esc(i)}</span></li>`).join('')}</ul>`;
}

function ablaufHtml(prozessId, titel) {
  const p = PROZESSE[prozessId];
  return `<section class="abschnitt abschnitt-hell" aria-labelledby="ablauf-${prozessId}"><div class="huelle"><h2 id="ablauf-${prozessId}">${esc(titel || 'So läuft Ihr Auftrag ab')}</h2><p class="unterzeile">Prozess „${esc(p.name)}“</p><ol class="ablauf" style="--spalten: ${({ 5: 5, 6: 3, 7: 4, 8: 4 })[p.schritte.length] || Math.min(p.schritte.length, 4)}">${p.schritte.map(([t, d], i) => `<li><span class="ablauf-nr">${i + 1}</span><div><h3>${esc(t)}</h3><p>${esc(d)}</p></div></li>`).join('')}</ol></div></section>`;
}

function ctaBand(text = 'Beschreiben Sie Ihr Vorhaben – wir melden uns mit einem Termin- oder Angebotsvorschlag.', l = null) {
  return `<section class="cta-band"><div class="huelle cta-innen"><div><h2>Bereit für den nächsten Schritt?</h2><p>${esc(text)}</p></div><div class="knopf-gruppe">${l ? buchungsKnopf(l) : `<a class="knopf knopf-akzent" href="buchen.html">${icon('kalender')}Online buchen oder anfragen</a>`}<a class="knopf knopf-hell" href="kontakt.html">Kontakt</a></div></div></section>`;
}

function einsatzgebietPruefer() {
  return `<form class="eg-pruefer" data-eg-pruefer novalidate>
  <label for="eg-plz">Liegt Ihre Adresse im Einsatzgebiet?</label>
  <div class="eg-zeile"><input id="eg-plz" name="plz" inputmode="numeric" autocomplete="postal-code" pattern="[0-9]{5}" maxlength="5" placeholder="PLZ, z. B. 45127" required><button class="knopf knopf-akzent" type="submit">Prüfen</button></div>
  <p class="eg-ergebnis" aria-live="polite"></p>
</form>`;
}

// ---------------------------------------------------------------------------
// Startseite
// ---------------------------------------------------------------------------
function startseite() {
  const bereichKarten = BEREICHE.map((b) => {
    const top = NACH_BEREICH[b.id].filter((l) => !l.eltern).slice(0, 6);
    return `<article class="bereich-karte bereich-${b.id}">
      <div class="bereich-kopf">${icon(b.icon, 'icon icon-gross')}<h3><a href="${b.slug}.html">${esc(b.name)}</a></h3></div>
      <p>${esc(b.kurz)}</p>
      <ul class="link-liste">${top.map((l) => `<li><a href="${l.slug}.html">${esc(l.name)}</a></li>`).join('')}</ul>
      <a class="mehr" href="${b.slug}.html">Zum Bereich ${icon('pfeil')}</a>
    </article>`;
  }).join('');
  const direkt = LEISTUNGEN.filter((l) => l.buchung === 'direkt');
  const faq = [
    ['Welche Leistungen bietet BERGER SERVICE SOLUTIONS an?', 'Vier Bereiche: Elektrotechnik mit Prüfung und Wartung, Handwerk und Sanierung inklusive Bodenlegearbeiten, Hausmeister- und Objektservice sowie Entrümpelung, Haushaltsauflösung und Rückbau.'],
    ['In welchem Gebiet sind Sie tätig?', 'Unser Standort ist Essen. Das reguläre Einsatzgebiet umfasst einen Radius von rund 50 Kilometern – unter anderem Mülheim an der Ruhr, Oberhausen, Duisburg, Gelsenkirchen, Bottrop, Gladbeck, Bochum, Herne, Recklinghausen, Castrop-Rauxel, Velbert und Hattingen.'],
    ['Welche Leistungen kann ich direkt online buchen?', `Standardleistungen wie ${direkt.map((l) => l.name).join(', ')}. Individuelle Projekte fragen Sie online an; danach folgen Besichtigung und Angebot.`],
    ['Wie schnell erhalte ich eine Rückmeldung?', 'Wir prüfen jede Anfrage persönlich. Online gebuchte Termine gelten erst nach unserer Bestätigung als verbindlich.'],
    ['Arbeiten Sie auch für Hausverwaltungen und Gewerbe?', 'Ja. Für Hausverwaltungen, Vermieter und Unternehmen bieten wir wiederkehrende Leistungen mit festen Intervallen, Checklisten und digitalen Leistungsnachweisen.'],
  ];
  const inhalt = `
<section class="held">
  <div class="huelle held-raster">
    <div>
      <p class="dachzeile">${esc(CONFIG.firma.slogan)}</p>
      <h1>Elektrotechnik, Sanierung, Objektservice und Entrümpelung – in Essen und 50 km Umkreis</h1>
      <p class="held-text">Ein Betrieb, ein Ansprechpartner, klare Abläufe: Wir prüfen und warten elektrische Anlagen, sanieren Wohnungen und Bäder, verlegen Böden, betreuen Objekte und räumen Wohnungen besenrein.</p>
      <div class="knopf-gruppe"><a class="knopf knopf-akzent knopf-gross" href="buchen.html">${icon('kalender')}Termin online buchen</a><a class="knopf knopf-hell knopf-gross" href="buchen.html?art=anfrage">${icon('dokument')}Projekt anfragen</a></div>
      <ul class="held-punkte"><li>${icon('haken')}Prüf- und Wartungstermine direkt buchbar</li><li>${icon('haken')}Schriftliche Angebote nach Besichtigung</li><li>${icon('haken')}Digitale Dokumentation jedes Einsatzes</li></ul>
    </div>
    <div class="held-seite"><picture><source media="(min-width: 960px)" srcset="assets/img/logo-dunkel.webp"><img class="held-logo" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" width="900" height="330" alt=""></picture><div class="held-karte">${einsatzgebietPruefer()}<p class="klein">Die Prüfung läuft vollständig in Ihrem Browser. Es werden keine Daten übertragen.</p></div></div>
  </div>
</section>
<section class="abschnitt" aria-labelledby="bereiche-titel"><div class="huelle">
  <h2 id="bereiche-titel">Unsere vier Leistungsbereiche</h2>
  <p class="unterzeile">Von der Elektroprüfung bis zur besenreinen Übergabe – abgestimmt und aus einer Hand.</p>
  <div class="raster raster-2">${bereichKarten}</div>
</div></section>
<section class="abschnitt abschnitt-hell" aria-labelledby="direkt-titel"><div class="huelle">
  <h2 id="direkt-titel">Direkt online buchbar</h2>
  <p class="unterzeile">Standardleistungen mit planbarer Dauer buchen Sie ohne Umweg. Die Bestätigung erfolgt nach Kalenderabgleich.</p>
  <div class="raster raster-3">${direkt.map(karte).join('')}</div>
</div></section>
${galerie(GALERIE_START.map((id) => FOTO[id]), 'Einblicke in unsere Arbeit', 'Echte Fotos von unseren Baustellen: Zählerschränke, Photovoltaik mit Speicher, Elektroinstallation, Bad, Boden und Sanierung.')}
${vorherNachherHtml()}
<section class="abschnitt" aria-labelledby="warum-titel"><div class="huelle">
  <h2 id="warum-titel">Warum ein Betrieb für mehrere Gewerke?</h2>
  <div class="raster raster-4 vorteile">
    <div>${icon('personen', 'icon icon-gross')}<h3>Ein Ansprechpartner</h3><p>Elektro, Renovierung, Reinigung und Räumung werden nicht zwischen mehreren Firmen hin- und hergereicht.</p></div>
    <div>${icon('dokument', 'icon icon-gross')}<h3>Nachvollziehbare Angebote</h3><p>Nach Besichtigung und Aufmaß erhalten Sie ein schriftliches Angebot mit klaren Positionen.</p></div>
    <div>${icon('schild', 'icon icon-gross')}<h3>Dokumentiert und geprüft</h3><p>Prüfprotokolle, Fotos und Leistungsnachweise werden digital der Auftragsakte zugeordnet.</p></div>
    <div>${icon('kalender', 'icon icon-gross')}<h3>Feste Abläufe</h3><p>Für Wartung, Sanierung, Objektservice und Entrümpelung gibt es je einen definierten Prozess.</p></div>
  </div>
</div></section>
<section class="abschnitt abschnitt-dunkel" aria-labelledby="zielgruppen-titel"><div class="huelle">
  <h2 id="zielgruppen-titel">Für wen wir arbeiten</h2>
  <div class="raster raster-3">
    <div class="zielgruppe"><h3>Privatkunden</h3><p>Eigentümer und Mieter mit Reparatur-, Prüf- oder Renovierungsbedarf – vom Störungstermin bis zur Badsanierung.</p><a class="mehr" href="leistungen.html">Leistungen ansehen ${icon('pfeil')}</a></div>
    <div class="zielgruppe"><h3>Vermieter & Hausverwaltungen</h3><p>Objektbetreuung, Mieterwechsel, Prüfungen und Renovierungen mit festen Intervallen und digitalen Nachweisen.</p><a class="mehr" href="hausverwaltungen.html">Für Hausverwaltungen ${icon('pfeil')}</a></div>
    <div class="zielgruppe"><h3>Gewerbe</h3><p>DGUV-V3-Prüfungen, Wartung, Büroreinigung, Umbauten und Räumungen – planbar und dokumentiert.</p><a class="mehr" href="gewerbekunden.html">Für Gewerbekunden ${icon('pfeil')}</a></div>
  </div>
</div></section>
<section class="abschnitt" aria-labelledby="region-titel"><div class="huelle">
  <h2 id="region-titel">Einsatzgebiet: Essen und rund 50 Kilometer Umkreis</h2>
  <p class="unterzeile">Wir sind in ${ORTE.length} Städten und Gemeinden zwischen Niederrhein, Ruhrgebiet und Bergischem Land unterwegs.</p>
  <ul class="orte-wolke">${ORTSSEITEN.map((o) => `<li><a href="einsatzgebiet-${o.slug}.html">${esc(ortName(o.slug))}</a></li>`).join('')}<li><a href="einsatzgebiet.html">alle ${ORTE.length} Orte</a></li></ul>
</div></section>
${faqHtml(faq)}
${ctaBand()}`;
  seite({
    pfad: 'index.html',
    titel: 'Handwerk, Elektro & Objektservice in Essen | BERGER',
    beschreibung: 'BERGER SERVICE SOLUTIONS in Essen: Elektrotechnik, DGUV V3, Wartung, Sanierung, Bodenleger, Hausmeisterservice und Entrümpelung im Umkreis von 50 km.',
    inhalt,
    prioritaet: 1.0,
    jsonld: [{ '@type': 'WebSite', '@id': absUrl('index.html') + '#website', url: absUrl('index.html'), name: CONFIG.firma.name, inLanguage: 'de-DE', publisher: { '@id': ORG['@id'] } }, faqJsonLd(faq)],
    skripte: ['assets/js/einsatzgebiet-pruefer.mjs'],
  });
}

// ---------------------------------------------------------------------------
// Leistungsübersicht und Bereichsseiten
// ---------------------------------------------------------------------------
function leistungsuebersicht() {
  const inhalt = `
<section class="seitenkopf"><div class="huelle"><h1>Alle Leistungen im Überblick</h1><p class="lead">Vier Leistungsbereiche, ${LEISTUNGEN.length} Fachthemen – von der DGUV-V3-Prüfung bis zur Haushaltsauflösung. Direkt buchbare Standardleistungen sind gekennzeichnet.</p></div></section>
${BEREICHE.map((b) => `<section class="abschnitt" aria-labelledby="b-${b.id}"><div class="huelle"><h2 id="b-${b.id}"><a href="${b.slug}.html">${esc(b.name)}</a></h2><p class="unterzeile">${esc(b.kurz)}</p><div class="raster raster-3">${NACH_BEREICH[b.id].map(karte).join('')}</div></div></section>`).join('')}
${ctaBand()}`;
  seite({ pfad: 'leistungen.html', titel: 'Leistungen: Elektro, Sanierung, Objektservice, Entrümpelung', beschreibung: 'Alle Leistungen in Essen und Umgebung: Elektrotechnik, Prüfung, Wartung, Sanierung, Bodenleger, Hausmeisterservice, Reinigung, Entrümpelung und Rückbau.', inhalt, krumen: [['Leistungen', 'leistungen.html']], jsonld: [brotkrumenJsonLd([['Leistungen', 'leistungen.html']])], prioritaet: 0.9 });
}

function bereichsseite(b) {
  const leistungen = NACH_BEREICH[b.id];
  const prozessIds = [...new Set(leistungen.map((l) => l.prozess))];
  const faq = leistungen.filter((l) => !l.eltern).slice(0, 6).map((l) => l.faq[0]);
  const krumen = [['Leistungen', 'leistungen.html'], [b.kurzname, `${b.slug}.html`]];
  const inhalt = `
<section class="seitenkopf seitenkopf-${b.id}"><div class="huelle"><p class="dachzeile">${icon(b.icon)} Leistungsbereich</p><h1>${esc(b.h1)}</h1>${b.intro.map((p) => `<p class="lead">${esc(p)}</p>`).join('')}<div class="knopf-gruppe"><a class="knopf knopf-akzent" href="buchen.html?bereich=${b.id}">${icon('kalender')}Buchen oder anfragen</a></div></div></section>
<section class="abschnitt"><div class="huelle"><h2>Leistungen im Bereich ${esc(b.kurzname)}</h2><div class="raster raster-3">${leistungen.map(karte).join('')}</div></div></section>
${galerie(fotosFuer(leistungen.map((l) => l.slug)).slice(0, 6))}
<section class="abschnitt abschnitt-hell"><div class="huelle schmal"><h2>Für wen?</h2>${liste(b.zielgruppen)}</div></section>
${prozessIds.map((id) => ablaufHtml(id, `Ablauf: ${PROZESSE[id].name}`)).join('')}
${faqHtml(faq)}
${ctaBand()}`;
  seite({ pfad: `${b.slug}.html`, titel: b.title, beschreibung: b.description, inhalt, krumen, prioritaet: 0.9, jsonld: [brotkrumenJsonLd(krumen), faqJsonLd(faq), {
    '@type': 'OfferCatalog', name: b.name, itemListElement: leistungen.map((l) => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: l.name, url: absUrl(`${l.slug}.html`) } })),
  }] });
}

// ---------------------------------------------------------------------------
// Leistungsseite
// ---------------------------------------------------------------------------
function leistungsseite(l) {
  const b = BEREICH[l.bereich];
  const eltern = l.eltern ? NACH_SLUG[l.eltern] : null;
  const krumen = [['Leistungen', 'leistungen.html'], [b.kurzname, `${b.slug}.html`], ...(eltern ? [[eltern.name, `${eltern.slug}.html`]] : []), [l.name, `${l.slug}.html`]];
  const unterseiten = LEISTUNGEN.filter((x) => x.eltern === l.slug);
  const verwandt = (l.verwandt || []).map((s) => NACH_SLUG[s]).filter(Boolean);
  const abschnitte = (l.abschnitte || []).map((a) => {
    let h = `<section class="abschnitt"${a.id ? ` id="${a.id}"` : ''}><div class="huelle schmal"><h2>${esc(a.h2)}</h2>`;
    (a.p || []).forEach((p) => { h += `<p>${esc(p)}</p>`; });
    if (a.liste) h += liste(a.liste);
    if (a.nach) h += `<p>${esc(a.nach)}</p>`;
    if (a.tabelle) {
      h += `<div class="tabelle-huelle"><table><thead><tr>${a.tabelle.kopf.map((k) => `<th scope="col">${esc(k)}</th>`).join('')}</tr></thead><tbody>${a.tabelle.zeilen.map((z) => `<tr>${z.map((c, i) => i === 0 ? `<th scope="row">${esc(c)}</th>` : `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    }
    return h + '</div></section>';
  }).join('');
  const orteLinks = ORTSSEITEN.filter((o) => o.schwerpunkte.includes(l.slug));
  const inhalt = `
<section class="seitenkopf seitenkopf-${l.bereich}"><div class="huelle seitenkopf-raster">
  <div><p class="dachzeile">${icon(b.icon)} ${esc(b.name)}</p><h1>${esc(l.h1)}</h1>${l.intro.map((p) => `<p class="lead">${esc(p)}</p>`).join('')}
  <div class="knopf-gruppe">${buchungsKnopf(l)}<a class="knopf knopf-hell" href="#leistungsumfang">Leistungsumfang</a></div></div>
  <aside class="infokasten" aria-label="Auf einen Blick"><p class="infokasten-titel">Auf einen Blick</p><dl>
    <dt>Buchung</dt><dd>${l.buchung === 'direkt' ? 'Direkt online buchbar' : 'Anfrage, Besichtigung, schriftliches Angebot'}</dd>
    <dt>Ablauf</dt><dd>${esc(PROZESSE[l.prozess].name)}</dd>
    <dt>Einsatzgebiet</dt><dd>Essen und rund 50 km Umkreis</dd>
    ${l.dauerMin ? `<dt>Richtwert Termindauer</dt><dd>ca. ${Math.round(l.dauerMin / 30) / 2} Std. (abhängig vom Umfang)</dd>` : ''}
  </dl></aside>
</div></section>
<section class="abschnitt" id="leistungsumfang"><div class="huelle schmal"><h2>Leistungsumfang</h2>${liste(l.leistungen)}${unterseiten.length ? `<h3>Unsere Bodenbeläge im Detail</h3><div class="raster raster-2">${unterseiten.map(karte).join('')}</div>` : ''}</div></section>
${galerie(fotosFuer([l.slug]).slice(0, 9), `${l.name}: Aus unseren Projekten`)}
${VORHER_NACHHER.leistungen.includes(l.slug) ? vorherNachherHtml() : ''}
${abschnitte}
<section class="abschnitt abschnitt-hell"><div class="huelle schmal raster raster-2 ausgeglichen">
  <div><h2>Für wen?</h2>${liste(l.zielgruppen)}</div>
  <div><h2>Wovon der Preis abhängt</h2>${liste(l.kostenfaktoren, 'punktliste')}<p class="klein">Wir nennen keine Pauschalpreise ohne Kenntnis des Objekts. Sie erhalten ${l.buchung === 'direkt' ? 'vor dem Termin eine Preisinformation' : 'nach der Besichtigung ein schriftliches Angebot'}.</p></div>
</div></section>
${ablaufHtml(l.prozess)}
${l.hinweis ? `<section class="abschnitt"><div class="huelle schmal"><div class="hinweis" role="note">${icon('schild')}<div><p class="hinweis-titel">Qualifikation und Sicherheit</p><p>${esc(l.hinweis)}</p></div></div></div></section>` : ''}
${faqHtml(l.faq, `Häufige Fragen zu ${l.name}`)}
<section class="abschnitt abschnitt-hell"><div class="huelle">
  <h2>Passende Leistungen</h2><div class="raster raster-3">${verwandt.map(karte).join('')}</div>
  ${orteLinks.length ? `<p class="orte-hinweis">${esc(l.name)} unter anderem in: ${orteLinks.map((o) => `<a href="einsatzgebiet-${o.slug}.html">${esc(ortName(o.slug))}</a>`).join(', ')} und <a href="einsatzgebiet.html">weiteren Orten im 50-km-Umkreis</a>.</p>` : ''}
</div></section>
${ctaBand(l.buchung === 'direkt' ? 'Wählen Sie einen Wunschtermin – wir bestätigen nach Kalenderabgleich.' : 'Senden Sie uns Ihre Anfrage mit Fotos – wir vereinbaren eine Besichtigung.', l)}`;
  const service = {
    '@type': 'Service', '@id': absUrl(`${l.slug}.html`) + '#leistung', name: l.name, serviceType: l.name, description: l.description,
    url: absUrl(`${l.slug}.html`), provider: { '@id': ORG['@id'] },
    areaServed: { '@type': 'GeoCircle', geoMidpoint: { '@type': 'GeoCoordinates', latitude: CONFIG.einsatzgebiet.zentrum.lat, longitude: CONFIG.einsatzgebiet.zentrum.lon }, geoRadius: String(CONFIG.einsatzgebiet.radiusKm * 1000) },
    category: b.name,
    ...(fotosFuer([l.slug]).length ? { image: fotosFuer([l.slug]).slice(0, 9).map((f) => absUrl(fotoPfad(f.id, 'gross'))) } : {}),
    potentialAction: { '@type': 'ReserveAction', target: absUrl(buchungsLink(l)), name: l.buchung === 'direkt' ? 'Termin online buchen' : 'Angebot anfragen' },
  };
  seite({ pfad: `${l.slug}.html`, titel: l.title, beschreibung: l.description, inhalt, krumen, prioritaet: l.istHub ? 0.9 : 0.8, jsonld: [service, brotkrumenJsonLd(krumen), faqJsonLd(l.faq)] });
}

// ---------------------------------------------------------------------------
// Einsatzgebiet
// ---------------------------------------------------------------------------
function einsatzgebietHub() {
  const zeilen = ORTE.map((o) => ({ o, a: anfahrt(o.slug) })).sort((x, y) => x.a.luftlinieKm - y.a.luftlinieKm);
  const mitSeite = new Set(ORTSSEITEN.map((o) => o.slug));
  const krumen = [['Einsatzgebiet', 'einsatzgebiet.html']];
  const faq = [
    ['Wie groß ist Ihr Einsatzgebiet?', `Das reguläre Einsatzgebiet umfasst rund ${CONFIG.einsatzgebiet.radiusKm} Kilometer Luftlinie um Essen. Darin liegen unter anderem ${ORTE.length} Städte und Gemeinden aus Ruhrgebiet, Niederrhein und Bergischem Land.`],
    ['Wie werden Anfahrtskosten berechnet?', 'Das Einsatzgebiet ist in Anfahrtszonen nach Entfernung eingeteilt. Die Zone wird bei der Online-Buchung automatisch ermittelt; die Anfahrtspauschale wird in der Bestätigung bzw. im Angebot ausgewiesen.'],
    ['Arbeiten Sie auch außerhalb des Einsatzgebiets?', 'Für größere Projekte prüfen wir Einsätze außerhalb des Radius individuell. Senden Sie uns einfach eine Anfrage.'],
    ['Mein Ort ist nicht aufgeführt. Komme ich trotzdem in Frage?', 'Die Liste ist nicht abschließend. Geben Sie Ihre Postleitzahl im Prüfer ein oder senden Sie eine Anfrage – wir prüfen jede Adresse.'],
  ];
  const zonenText = CONFIG.einsatzgebiet.zonen.map((z) => `<li><strong>${esc(z.label)}</strong>: bis ${z.bisKm} km Luftlinie</li>`).join('');
  const inhalt = `
<section class="seitenkopf"><div class="huelle seitenkopf-raster"><div><h1>Einsatzgebiet: Essen und rund 50 km Umkreis</h1><p class="lead">Von Essen aus sind wir in ${ORTE.length} Städten und Gemeinden zwischen Niederrhein, Ruhrgebiet und Bergischem Land im Einsatz. Prüfen Sie Ihre Postleitzahl direkt hier.</p></div><div class="held-karte">${einsatzgebietPruefer()}</div></div></section>
<section class="abschnitt"><div class="huelle schmal"><h2>Anfahrtszonen</h2><p>Damit Fahrtzeiten und Fahrtkosten nachvollziehbar sind, teilen wir das Einsatzgebiet in Zonen nach Luftlinie zum Standort Essen ein. Die Online-Buchung ermittelt die Zone automatisch.</p><ul class="punktliste">${zonenText}</ul><p class="klein">Straßenkilometer und Fahrzeiten sind Schätzwerte. Einsätze in äußeren Zonen planen wir nach Möglichkeit gebündelt als Tourentage.</p></div></section>
<section class="abschnitt abschnitt-hell"><div class="huelle"><h2>Alle Orte im Einsatzgebiet</h2>
<div class="tabelle-huelle"><table class="orte-tabelle"><thead><tr><th scope="col">Ort</th><th scope="col">Kreis</th><th scope="col">Luftlinie</th><th scope="col">Fahrzeit ca.</th><th scope="col">Zone</th></tr></thead><tbody>
${zeilen.map(({ o, a }) => `<tr><th scope="row">${mitSeite.has(o.slug) ? `<a href="einsatzgebiet-${o.slug}.html">${esc(o.name)}</a>` : esc(o.name)}</th><td>${esc(o.kreis)}</td><td>${String(a.luftlinieKm).replace('.', ',')} km</td><td>${a.fahrzeitMinGeschaetzt} Min.</td><td>${a.zone || '–'}</td></tr>`).join('\n')}
</tbody></table></div></div></section>
${faqHtml(faq)}
${ctaBand()}`;
  seite({ pfad: 'einsatzgebiet.html', titel: 'Einsatzgebiet: Essen + 50 km – alle Orte & Zonen', beschreibung: `Einsatzgebiet Essen und rund 50 km Umkreis: ${ORTE.length} Städte von Duisburg bis Dortmund und Haltern bis Düsseldorf – mit Anfahrtszonen und PLZ-Prüfung.`, inhalt, krumen, prioritaet: 0.8, jsonld: [brotkrumenJsonLd(krumen), faqJsonLd(faq)], skripte: ['assets/js/einsatzgebiet-pruefer.mjs'] });
}

function ortsBeschreibung(o, os, schwer, istEssen) {
  const start = istEssen ? 'In allen Essener Stadtteilen' : `In ${o.name} und Stadtteilen wie ${os.stadtteile.slice(0, 2).join(' und ')}`;
  // So viele Schwerpunkte wie in 160 Zeichen passen – nie mitten im Wort abschneiden.
  for (let n = Math.min(3, schwer.length); n >= 1; n--) {
    const t = `${start}: ${schwer.slice(0, n).map((s) => s.name).join(', ')} und weitere Leistungen aus Elektro, Handwerk und Objektservice.`;
    if (t.length <= 160) return t;
  }
  return `${start}: Elektro, Sanierung, Objektservice und Entrümpelung.`;
}

function ortsseite(os) {
  const o = ORT[os.slug];
  const a = anfahrt(os.slug);
  const schwer = os.schwerpunkte.map((s) => NACH_SLUG[s]).filter(Boolean);
  const nachbarn = ORTSSEITEN.filter((x) => x.slug !== os.slug)
    .map((x) => ({ x, d: Math.hypot(ORT[x.slug].lat - o.lat, (ORT[x.slug].lon - o.lon) * 0.62) }))
    .sort((p, q) => p.d - q.d).slice(0, 4).map(({ x }) => x);
  const istEssen = os.slug === 'essen';
  const krumen = [['Einsatzgebiet', 'einsatzgebiet.html'], [o.name, `einsatzgebiet-${os.slug}.html`]];
  const faq = [
    istEssen
      ? [`Wo ist Ihr Standort in Essen?`, `Unser Unternehmenssitz ist in Essen. Von hier aus erreichen wir alle Essener Stadtteile – von ${os.stadtteile[0]} bis ${os.stadtteile[os.stadtteile.length - 1]}.`]
      : [`Kommen Sie für Aufträge nach ${o.name}?`, `Ja. ${o.name} liegt rund ${String(a.luftlinieKm).replace('.', ',')} km Luftlinie von unserem Standort in Essen entfernt und gehört zu ${a.zoneLabel}.`],
    [`Welche Anfahrtskosten fallen in ${o.name} an?`, `${o.name} liegt in ${a.zoneLabel}. Die Anfahrtspauschale dieser Zone wird bei der Online-Buchung bzw. im Angebot ausgewiesen.`],
    [`Welche Leistungen bieten Sie in ${o.name} an?`, `Alle vier Leistungsbereiche: Elektrotechnik mit Prüfung und Wartung, Handwerk und Sanierung inklusive Bodenlegearbeiten, Hausmeister- und Objektservice sowie Entrümpelung und Rückbau.`],
  ];
  const inhalt = `
<section class="seitenkopf"><div class="huelle seitenkopf-raster"><div><p class="dachzeile">${icon('pin')} Einsatzgebiet ${esc(o.kreis === 'kreisfreie Stadt' ? '' : o.kreis)}</p><h1>${istEssen ? 'Handwerk, Elektro und Objektservice in Essen' : `Elektro, Sanierung und Objektservice in ${esc(o.name)}`}</h1>${os.intro.map((p) => `<p class="lead">${esc(p)}</p>`).join('')}<div class="knopf-gruppe"><a class="knopf knopf-akzent" href="buchen.html?ort=${os.slug}">${icon('kalender')}Termin in ${esc(o.name)} anfragen</a></div></div>
<aside class="infokasten" aria-label="Anfahrt"><p class="infokasten-titel">Anfahrt ab Essen</p><dl>
  <dt>Entfernung</dt><dd>${istEssen ? 'Standort' : `ca. ${String(a.luftlinieKm).replace('.', ',')} km Luftlinie, ca. ${a.strasseKmGeschaetzt} km Straße`}</dd>
  <dt>Fahrzeit (Schätzung)</dt><dd>${istEssen ? 'je nach Stadtteil 10–30 Min.' : `ca. ${a.fahrzeitMinGeschaetzt} Minuten`}</dd>
  <dt>Anfahrtszone</dt><dd>${esc(a.zoneLabel)}</dd>
  <dt>Postleitzahlen</dt><dd>${o.plz.map(([v, b]) => v === b ? v : `${v}–${b}`).join(', ')}</dd>
</dl></aside></div></section>
<section class="abschnitt"><div class="huelle"><h2>Leistungsschwerpunkte in ${esc(o.name)}</h2><div class="raster raster-${schwer.length > 4 ? 3 : 2}">${schwer.map(karte).join('')}</div>
<p class="orte-hinweis">Selbstverständlich bieten wir in ${esc(o.name)} auch alle weiteren <a href="leistungen.html">Leistungen</a> an.</p></div></section>
<section class="abschnitt abschnitt-hell"><div class="huelle schmal"><h2>Stadtteile in ${esc(o.name)}</h2><p>Wir sind in allen Stadtteilen von ${esc(o.name)} tätig, unter anderem in:</p><ul class="orte-wolke">${os.stadtteile.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div></section>
${faqHtml(faq, `Fragen zu Einsätzen in ${o.name}`)}
<section class="abschnitt"><div class="huelle schmal"><h2>Benachbarte Einsatzorte</h2><ul class="orte-wolke">${nachbarn.map((x) => `<li><a href="einsatzgebiet-${x.slug}.html">${esc(ortName(x.slug))}</a></li>`).join('')}<li><a href="einsatzgebiet.html">alle Orte</a></li></ul></div></section>
${ctaBand(`Beschreiben Sie Ihr Vorhaben in ${o.name} – wir melden uns mit einem Termin- oder Angebotsvorschlag.`)}`;
  seite({
    pfad: `einsatzgebiet-${os.slug}.html`,
    titel: istEssen ? 'Elektriker, Handwerk & Objektservice in Essen' : `Elektro, Sanierung & Objektservice in ${o.name}`,
    beschreibung: ortsBeschreibung(o, os, schwer, istEssen),
    inhalt, krumen, prioritaet: 0.7,
    jsonld: [brotkrumenJsonLd(krumen), faqJsonLd(faq), { '@type': 'WebPage', name: `${MARKE} in ${o.name}`, about: { '@type': 'City', name: o.name, geo: { '@type': 'GeoCoordinates', latitude: o.lat, longitude: o.lon } }, provider: { '@id': ORG['@id'] } }],
  });
}

// ---------------------------------------------------------------------------
// Online-Buchung
// ---------------------------------------------------------------------------
function buchungsseite() {
  const katalog = {
    bereiche: BEREICHE.map((b) => ({ id: b.id, name: b.name })),
    leistungen: LEISTUNGEN.map((l) => ({ slug: l.slug, name: l.name, bereich: l.bereich, buchung: l.buchung, dauerMin: l.dauerMin || null, prozess: l.prozess })),
    orte: ORTE.map((o) => ({ slug: o.slug, name: o.name })),
    einsatzgebiet: optEG,
    preiseFreigegeben: CONFIG.einsatzgebiet.preiseFreigegeben,
    buchung: { ...CONFIG.buchung, email: undefined, endpunkt: buchungsEndpunkt() },
  };
  const krumen = [['Online buchen', 'buchen.html']];
  const inhalt = `
<section class="seitenkopf seitenkopf-kompakt"><div class="huelle"><h1>Termin buchen oder Angebot anfragen</h1><p class="lead">In wenigen Schritten zur Buchung: Standardleistungen buchen Sie direkt mit Wunschtermin, individuelle Projekte fragen Sie an. Vor dem Absenden prüfen Sie alle Angaben.</p></div></section>
<section class="abschnitt abschnitt-buchung"><div class="huelle buchung-raster">
<form class="buchung" id="buchung" novalidate>
  <noscript><p class="hinweis">Für die Online-Buchung wird JavaScript benötigt. Alternativ erreichen Sie uns über die <a href="kontakt.html">Kontaktseite</a>.</p></noscript>
  <ol class="schritte" aria-label="Fortschritt">
    <li data-schritt-anzeige="1" aria-current="step">Leistung</li><li data-schritt-anzeige="2">Einsatzort</li><li data-schritt-anzeige="3">Details & Termin</li><li data-schritt-anzeige="4">Kontakt</li><li data-schritt-anzeige="5">Prüfen</li>
  </ol>
  <div class="status-meldung" role="alert" aria-live="assertive" hidden></div>

  <fieldset class="schritt" data-schritt="1">
    <legend>1. Welche Leistung benötigen Sie?</legend>
    <div class="feld"><label for="f-bereich">Leistungsbereich</label><select id="f-bereich" name="bereich" required><option value="">Bitte wählen</option></select></div>
    <div class="feld"><label for="f-leistung">Leistung</label><select id="f-leistung" name="leistung" required disabled><option value="">Zuerst Bereich wählen</option></select><p class="feld-fehler" data-fehler="leistung"></p></div>
    <p class="buchungsart" data-buchungsart hidden></p>
  </fieldset>

  <fieldset class="schritt" data-schritt="2" hidden>
    <legend>2. Wo sollen die Arbeiten stattfinden?</legend>
    <div class="feld-reihe"><div class="feld feld-gross"><label for="f-strasse">Straße</label><input id="f-strasse" name="strasse" autocomplete="address-line1" required><p class="feld-fehler" data-fehler="strasse"></p></div>
    <div class="feld feld-klein"><label for="f-hausnummer">Nr.</label><input id="f-hausnummer" name="hausnummer" required><p class="feld-fehler" data-fehler="hausnummer"></p></div></div>
    <div class="feld-reihe"><div class="feld feld-klein"><label for="f-plz">PLZ</label><input id="f-plz" name="plz" inputmode="numeric" autocomplete="postal-code" maxlength="5" required><p class="feld-fehler" data-fehler="plz"></p></div>
    <div class="feld feld-gross"><label for="f-ort">Ort</label><input id="f-ort" name="ort" autocomplete="address-level2" list="orte-liste" required><datalist id="orte-liste"></datalist><p class="feld-fehler" data-fehler="ort"></p></div></div>
    <div class="feld"><label for="f-zusatz">Adresszusatz (optional)</label><input id="f-zusatz" name="adresszusatz" placeholder="z. B. Etage, Hinterhaus, Wohnung links"></div>
    <div class="eg-box" data-eg-box aria-live="polite"></div>
    <div class="feld"><label class="checkbox"><input type="checkbox" name="rechnungAbweichend" id="f-rechnung-abw"> Rechnungsadresse weicht von der Einsatzadresse ab</label></div>
    <div class="rechnungsadresse" data-rechnungsadresse hidden>
      <div class="feld"><label for="f-r-name">Rechnungsempfänger / Firma</label><input id="f-r-name" name="rName"><p class="feld-fehler" data-fehler="rName"></p></div>
      <div class="feld-reihe"><div class="feld feld-gross"><label for="f-r-strasse">Straße</label><input id="f-r-strasse" name="rStrasse"><p class="feld-fehler" data-fehler="rStrasse"></p></div><div class="feld feld-klein"><label for="f-r-hausnummer">Nr.</label><input id="f-r-hausnummer" name="rHausnummer"><p class="feld-fehler" data-fehler="rHausnummer"></p></div></div>
      <div class="feld-reihe"><div class="feld feld-klein"><label for="f-r-plz">PLZ</label><input id="f-r-plz" name="rPlz" inputmode="numeric" maxlength="5"><p class="feld-fehler" data-fehler="rPlz"></p></div><div class="feld feld-gross"><label for="f-r-ort">Ort</label><input id="f-r-ort" name="rOrt"><p class="feld-fehler" data-fehler="rOrt"></p></div></div>
    </div>
  </fieldset>

  <fieldset class="schritt" data-schritt="3" hidden>
    <legend>3. Details und Wunschtermin</legend>
    <div class="feld"><label for="f-beschreibung">Beschreibung der Arbeiten</label><textarea id="f-beschreibung" name="beschreibung" rows="5" required placeholder="Was soll gemacht werden? Größe, Zustand, Besonderheiten …"></textarea><p class="feld-hilfe" data-beschreibung-hilfe></p><p class="feld-fehler" data-fehler="beschreibung"></p></div>
    <div class="feld" data-zusatzfeld="geraete" hidden><label for="f-geraete">Ungefähre Anzahl zu prüfender Geräte</label><input id="f-geraete" name="anzahlGeraete" type="number" min="1" max="5000" inputmode="numeric"></div>
    <div class="feld" data-zusatzfeld="anlage" hidden><label for="f-anlage">Hersteller und Modell der Anlage (falls bekannt)</label><input id="f-anlage" name="anlage"></div>
    <div class="feld" data-zusatzfeld="flaeche" hidden><label for="f-flaeche">Ungefähre Fläche in m² (falls bekannt)</label><input id="f-flaeche" name="flaecheM2" type="number" min="1" max="100000" inputmode="numeric"></div>
    <div class="termin-direkt" data-termin-direkt hidden>
      <p class="feld-label" id="slot-label">Wunschtermin wählen</p>
      <div class="slot-tage" data-slot-tage role="radiogroup" aria-labelledby="slot-label"></div>
      <p class="klein">Vorläufige Terminauswahl (Mo–Fr, ohne Feiertage NRW). Verbindlich wird der Termin erst mit unserer Bestätigung nach Kalenderabgleich.</p>
      <p class="feld-fehler" data-fehler="slot"></p>
    </div>
    <div class="termin-anfrage" data-termin-anfrage hidden>
      <div class="feld-reihe"><div class="feld"><label for="f-wunsch1">Wunschtermin für die Besichtigung (optional)</label><input id="f-wunsch1" name="wunschtermin" type="date"></div>
      <div class="feld"><label for="f-zeitfenster">Bevorzugtes Zeitfenster</label><select id="f-zeitfenster" name="zeitfenster"><option value="egal">egal</option><option value="vormittag">vormittags</option><option value="nachmittag">nachmittags</option></select></div></div>
      <p class="feld-fehler" data-fehler="wunschtermin"></p>
    </div>
    <div class="feld"><label for="f-dateien">Fotos und Dokumente (optional)</label><input id="f-dateien" name="dateien" type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"><p class="feld-hilfe">Bis zu ${CONFIG.buchung.maxDateien} Dateien, je max. ${CONFIG.buchung.maxDateiMB} MB, zusammen max. ${CONFIG.buchung.maxGesamtMB} MB (JPG, PNG, WEBP, HEIC, PDF).</p><ul class="datei-liste" data-datei-liste></ul><p class="feld-fehler" data-fehler="dateien"></p></div>
  </fieldset>

  <fieldset class="schritt" data-schritt="4" hidden>
    <legend>4. Ihre Kontaktdaten</legend>
    <div class="feld"><label for="f-kundentyp">Sie sind</label><select id="f-kundentyp" name="kundentyp"><option value="privat">Privatkunde</option><option value="vermieter">Vermieter / Eigentümer</option><option value="hausverwaltung">Hausverwaltung</option><option value="gewerbe">Gewerbekunde</option></select></div>
    <div class="feld" data-firma hidden><label for="f-firma">Firma / Verwaltung</label><input id="f-firma" name="firma" autocomplete="organization"></div>
    <div class="feld-reihe"><div class="feld"><label for="f-vorname">Vorname</label><input id="f-vorname" name="vorname" autocomplete="given-name" required><p class="feld-fehler" data-fehler="vorname"></p></div>
    <div class="feld"><label for="f-nachname">Nachname</label><input id="f-nachname" name="nachname" autocomplete="family-name" required><p class="feld-fehler" data-fehler="nachname"></p></div></div>
    <div class="feld-reihe"><div class="feld"><label for="f-telefon">Telefon</label><input id="f-telefon" name="telefon" type="tel" autocomplete="tel" required><p class="feld-fehler" data-fehler="telefon"></p></div>
    <div class="feld"><label for="f-email">E-Mail</label><input id="f-email" name="email" type="email" autocomplete="email" required><p class="feld-fehler" data-fehler="email"></p></div></div>
    <fieldset class="feld kanal"><legend class="feld-label">Bevorzugter Kontaktweg</legend>
      <label class="checkbox"><input type="radio" name="kontaktweg" value="telefon" checked> Telefon</label>
      <label class="checkbox"><input type="radio" name="kontaktweg" value="email"> E-Mail</label>
      <label class="checkbox"><input type="radio" name="kontaktweg" value="whatsapp"> WhatsApp</label>
    </fieldset>
    <div class="feld honig" aria-hidden="true"><label for="f-website">Website</label><input id="f-website" name="website" tabindex="-1" autocomplete="off"></div>
  </fieldset>

  <fieldset class="schritt" data-schritt="5" hidden>
    <legend>5. Angaben prüfen und absenden</legend>
    <div class="zusammenfassung" data-zusammenfassung></div>
    <div class="feld"><label class="checkbox"><input type="checkbox" name="datenschutz" required> Ich habe die <a href="datenschutz.html" target="_blank" rel="noopener">Datenschutzerklärung</a> gelesen und bin einverstanden, dass meine Angaben zur Bearbeitung der Anfrage gespeichert und verarbeitet werden.</label><p class="feld-fehler" data-fehler="datenschutz"></p></div>
    <p class="klein">Ihre Anfrage ist unverbindlich. Ein Vertrag kommt erst mit unserer Bestätigung bzw. Ihrer Annahme unseres Angebots zustande. Es gelten unsere <a href="agb.html" target="_blank" rel="noopener">AGB</a>; Verbraucher beachten bitte die <a href="widerruf.html" target="_blank" rel="noopener">Widerrufsbelehrung</a>.</p>
    <div class="feld" data-whatsapp-einwilligung hidden><label class="checkbox"><input type="checkbox" name="whatsappEinwilligung"> Ich bin einverstanden, Terminbestätigungen und Rückfragen zu dieser Anfrage per WhatsApp zu erhalten. Widerruf jederzeit möglich.</label></div>
  </fieldset>

  <div class="schritt-navigation">
    <button type="button" class="knopf knopf-hell" data-zurueck hidden>Zurück</button>
    <button type="button" class="knopf knopf-akzent" data-weiter>Weiter</button>
    <button type="submit" class="knopf knopf-akzent" data-absenden hidden>Verbindlich absenden</button>
  </div>
</form>
<aside class="buchung-info">
  <div class="infokasten"><p class="infokasten-titel">So geht es weiter</p>
  <ol class="mini-ablauf"><li><strong>Direkt buchbare Leistungen:</strong> Sie wählen einen vorläufigen Termin, wir bestätigen nach Kalenderabgleich.</li><li><strong>Projekte:</strong> Wir melden uns zur Besichtigung und erstellen ein schriftliches Angebot.</li><li>Sie erhalten eine Eingangsbestätigung mit Vorgangsnummer.</li></ol></div>
  <div class="infokasten"><p class="infokasten-titel">Datenschutz</p><p class="klein">Ihre Angaben werden verschlüsselt übertragen und ausschließlich zur Bearbeitung Ihrer Anfrage verwendet. Die Einsatzgebietsprüfung erfolgt lokal in Ihrem Browser ohne externe Kartendienste.</p></div>
</aside>
</div></section>
<script type="application/json" id="katalog">${JSON.stringify(katalog).replace(/</g, '\\u003c')}</script>`;
  seite({ pfad: 'buchen.html', titel: 'Online buchen & Angebot anfragen', beschreibung: 'Prüf- und Wartungstermine online buchen oder Sanierung, Objektservice und Entrümpelung anfragen – mit Einsatzgebietsprüfung, Wunschtermin und Foto-Upload.', inhalt, krumen, prioritaet: 0.9, jsonld: [brotkrumenJsonLd(krumen)], skripte: ['assets/js/buchung.mjs'] });
}

// ---------------------------------------------------------------------------
// Weitere Seiten
// ---------------------------------------------------------------------------
function ablaufseite() {
  const krumen = [['So arbeiten wir', 'ablauf.html']];
  const zuordnung = { wartung: 'Prüfungen und Wartungen (z. B. DGUV V3, E-Check, Wärmepumpe, Klimaanlage)', service: 'Reparaturen und Störungsbeseitigung', handwerk: 'Handwerk, Sanierung, Bodenlegearbeiten und Elektro-Projekte', objekt: 'Hausmeister- und Objektservice', rueckbau: 'Rückbau, Entrümpelung und Haushaltsauflösung' };
  const inhalt = `
<section class="seitenkopf"><div class="huelle"><h1>So arbeiten wir: klare Abläufe für jeden Auftrag</h1><p class="lead">Jeder Leistungsbereich hat einen eigenen, festen Ablauf – von der Anfrage bis zur Rechnung. Jeder Vorgang erhält eine eindeutige Vorgangsnummer, jeder Statuswechsel wird dokumentiert.</p></div></section>
${Object.keys(PROZESSE).map((id) => ablaufHtml(id, zuordnung[id])).join('')}
<section class="abschnitt"><div class="huelle schmal"><h2>Dokumentation und Transparenz</h2><p>Fotos, Prüfprotokolle, Leistungsnachweise und Entsorgungsbelege werden digital der jeweiligen Auftrags- bzw. Objektakte zugeordnet. So ist jederzeit nachvollziehbar, was wann von wem erledigt wurde.</p><p>Weitere digitale Funktionen, etwa Statusmeldungen per Nachricht oder ein Kundenportal für Hausverwaltungen, kündigen wir erst an, wenn sie zuverlässig getestet sind.</p></div></section>
${ctaBand()}`;
  seite({ pfad: 'ablauf.html', titel: 'So arbeiten wir – Abläufe von Anfrage bis Rechnung', beschreibung: 'Feste Abläufe für Wartung und Prüfung, Sanierung, Objektservice und Entrümpelung – von der Anfrage über Angebot und Ausführung bis zur Dokumentation.', inhalt, krumen, jsonld: [brotkrumenJsonLd(krumen)] });
}

function zielgruppenseite({ pfad, titel, beschreibung, h1, intro, punkte, leistungen, faq, krumenName, fotoBlock = '' }) {
  const krumen = [[krumenName, pfad]];
  const inhalt = `
<section class="seitenkopf"><div class="huelle"><h1>${esc(h1)}</h1>${intro.map((p) => `<p class="lead">${esc(p)}</p>`).join('')}<div class="knopf-gruppe"><a class="knopf knopf-akzent" href="buchen.html?art=anfrage">${icon('dokument')}Anfrage stellen</a></div></div></section>
<section class="abschnitt"><div class="huelle"><h2>Was Sie von uns erwarten können</h2><div class="raster raster-2">${punkte.map(([t, d]) => `<div class="vorteil">${icon('haken', 'icon icon-gross')}<div><h3>${esc(t)}</h3><p>${esc(d)}</p></div></div>`).join('')}</div></div></section>
<section class="abschnitt abschnitt-hell"><div class="huelle"><h2>Passende Leistungen</h2><div class="raster raster-3">${leistungen.map((s) => karte(NACH_SLUG[s])).join('')}</div></div></section>
${fotoBlock}
${faqHtml(faq)}
${ctaBand()}`;
  seite({ pfad, titel, beschreibung, inhalt, krumen, prioritaet: 0.8, jsonld: [brotkrumenJsonLd(krumen), faqJsonLd(faq)] });
}

function ansprechpartnerKarte() {
  const name = CONFIG.firma.inhaber;
  return `<div class="ansprechpartner"><img src="assets/img/ansprechpartner.webp" width="306" height="472" alt="${esc(name ? `${name}, Inhaber von ${CONFIG.firma.name}` : `Ihr Ansprechpartner bei ${CONFIG.firma.name}`)}" loading="lazy"><div><p class="ansprechpartner-rolle">Ihr Ansprechpartner</p>${name ? `<p class="ansprechpartner-name">${esc(name)}</p><p>Inhaber</p>` : ''}<p>Persönlich erreichbar für Anfragen, Besichtigungen und Rückfragen zu laufenden Aufträgen – von der ersten Anfrage bis zur Übergabe.</p><a class="knopf knopf-akzent" href="buchen.html">${icon('kalender')}Anfrage stellen</a></div></div>`;
}

function ueberUns() {
  const krumen = [['Über uns', 'ueber-uns.html']];
  const inhalt = `
<section class="seitenkopf"><div class="huelle"><h1>Über BERGER SERVICE SOLUTIONS</h1><p class="lead">${esc(CONFIG.firma.slogan)} – drei Worte, die beschreiben, wie wir arbeiten: handwerklich sauber, serviceorientiert und mit Lösungen, die über ein einzelnes Gewerk hinausgehen.</p></div></section>
<section class="abschnitt"><div class="huelle schmal">
${ansprechpartnerKarte()}
<h2>Wer wir sind</h2><p>BERGER SERVICE SOLUTIONS ist ein Dienstleistungsunternehmen aus Essen. Wir verbinden Elektrotechnik mit Renovierung, Objektbetreuung und Entrümpelung. Für unsere Kunden bedeutet das: weniger Abstimmungsaufwand, weniger Schnittstellen und ein Ansprechpartner, der das ganze Objekt im Blick hat.</p>
<h2>Wie wir arbeiten</h2>${liste(['Feste Abläufe für jeden Leistungsbereich', 'Schriftliche Angebote nach Besichtigung und Aufmaß', 'Digitale Dokumentation mit Fotos, Protokollen und Leistungsnachweisen', 'Arbeiten in zulassungspflichtigen Gewerken nur mit entsprechender Berechtigung oder eingetragenen Partnerbetrieben', 'Keine Versprechen, die wir nicht belegen können'])}
<h2>Referenzen</h2><p>Die Fotos auf dieser Website stammen von eigenen Baustellen. Ausführliche Projektberichte mit Ort und Umfang veröffentlichen wir nur mit Zustimmung der Auftraggeber; dieser Bereich wird ergänzt, sobald freigegebene Berichte vorliegen.</p>
<h2>Qualifikationen</h2><p>Angaben zu Handwerksrolleneintragungen, Zertifizierungen und Versicherungen veröffentlichen wir hier nach Abschluss der Prüfung vollständig und mit Nachweis.</p>
</div></section>
${galerie([...GALERIE_START.map((id) => FOTO[id]), ...['bad-mosaik-doppelwaschtisch', 'dachgaube-einbaustrahler', 'dachausbau-holzoptik'].map((id) => FOTO[id])], 'Fotos von unseren Baustellen', 'Elektroinstallation, Zählerschränke, Photovoltaik, Bad, Boden, Rückbau und Sanierung.')}
${vorherNachherHtml()}
${ctaBand()}`;
  seite({ pfad: 'ueber-uns.html', titel: 'Über uns – Handwerk. Service. Lösungen.', beschreibung: 'BERGER SERVICE SOLUTIONS aus Essen verbindet Elektrotechnik, Renovierung, Objektservice und Entrümpelung – mit festen Abläufen und digitaler Dokumentation.', inhalt, krumen, jsonld: [brotkrumenJsonLd(krumen), { '@type': 'AboutPage', name: 'Über BERGER SERVICE SOLUTIONS', about: { '@id': ORG['@id'] } }] });
}

function faqSeite() {
  const krumen = [['Häufige Fragen', 'faq.html']];
  const gruppen = BEREICHE.map((b) => ({ b, fragen: NACH_BEREICH[b.id].flatMap((l) => l.faq.slice(0, 2).map((f) => [...f, l])) }));
  const alle = gruppen.flatMap((g) => g.fragen.map(([q, a]) => [q, a]));
  const inhalt = `
<section class="seitenkopf"><div class="huelle"><h1>Häufige Fragen</h1><p class="lead">Antworten auf häufige Fragen zu unseren Leistungen, zur Online-Buchung und zum Einsatzgebiet. Ausführliche Informationen finden Sie auf den jeweiligen Leistungsseiten.</p></div></section>
${gruppen.map(({ b, fragen }) => `<section class="abschnitt"><div class="huelle schmal"><h2>${esc(b.name)}</h2><div class="faq">${fragen.map(([q, a, l]) => `<details><summary>${esc(q)}</summary><p>${esc(a)} <a href="${l.slug}.html">Mehr zu ${esc(l.name)}</a></p></details>`).join('')}</div></div></section>`).join('')}
${ctaBand()}`;
  seite({ pfad: 'faq.html', titel: 'Häufige Fragen zu Elektro, Sanierung & Objektservice', beschreibung: 'Antworten auf häufige Fragen zu Elektroprüfung, Wartung, Sanierung, Bodenlegearbeiten, Hausmeisterservice, Entrümpelung, Online-Buchung und Einsatzgebiet.', inhalt, krumen, jsonld: [brotkrumenJsonLd(krumen), faqJsonLd(alle)] });
}

function kontaktSeite() {
  const k = CONFIG.kontakt;
  const krumen = [['Kontakt', 'kontakt.html']];
  const zeiten = k.oeffnungszeiten.map((z) => `<li>${esc(z.tage.join(', '))}: ${esc(z.von)}–${esc(z.bis)} Uhr</li>`).join('');
  const inhalt = `
<section class="seitenkopf"><div class="huelle"><h1>Kontakt</h1><p class="lead">Am schnellsten erreichen Sie uns über die Online-Buchung: Dort erfassen Sie alle Angaben, die wir für eine fundierte Rückmeldung brauchen.</p><div class="knopf-gruppe"><a class="knopf knopf-akzent" href="buchen.html">${icon('kalender')}Zur Online-Buchung</a></div></div></section>
<section class="abschnitt"><div class="huelle raster raster-3">
  <div class="kontakt-karte">${icon('pin', 'icon icon-gross')}<h2>Standort</h2><p>${k.strasse ? `${esc(k.strasse)}<br>${esc(k.plz)} ${esc(k.ort)}` : `${esc(k.ort)}, ${esc(k.region)}`}</p><p class="klein">Einsatzgebiet: rund ${CONFIG.einsatzgebiet.radiusKm} km um Essen</p></div>
  <div class="kontakt-karte">${icon('telefon', 'icon icon-gross')}<h2>${k.whatsapp ? 'Telefon & WhatsApp' : 'Telefon & E-Mail'}</h2>${k.telefon ? `<p><a href="tel:${esc(k.telefon.replace(/\s/g, ''))}">${esc(k.telefon)}</a></p>` : '<p>Die Telefonnummer wird in Kürze veröffentlicht.</p>'}${k.whatsapp ? `<p><a href="https://wa.me/${esc(k.whatsapp)}" rel="noopener">WhatsApp-Nachricht senden</a></p>` : ''}</div>
  <div class="kontakt-karte">${icon('kalender', 'icon icon-gross')}<h2>Erreichbarkeit</h2><ul class="einfach">${zeiten}</ul>${k.email ? `<p><a href="mailto:${esc(k.email)}">${esc(k.email)}</a></p>` : ''}</div>
</div></section>
<section class="abschnitt abschnitt-hell"><div class="huelle schmal">${ansprechpartnerKarte()}</div></section>`;
  seite({ pfad: 'kontakt.html', titel: 'Kontakt – BERGER SERVICE SOLUTIONS Essen', beschreibung: 'Kontakt zu BERGER SERVICE SOLUTIONS in Essen: Online-Buchung, Telefon, E-Mail und Erreichbarkeit für Elektro, Sanierung, Objektservice und Entrümpelung.', inhalt, krumen, jsonld: [brotkrumenJsonLd(krumen), { '@type': 'ContactPage', name: 'Kontakt', about: { '@id': ORG['@id'] } }] });
}

const fehlt = (wert, label) => wert ? esc(wert) : `<span class="platzhalter">[${esc(label)} wird ergänzt]</span>`;

function impressum() {
  const k = CONFIG.kontakt; const f = CONFIG.firma;
  const inhalt = `
<section class="seitenkopf seitenkopf-kompakt"><div class="huelle"><h1>Impressum</h1></div></section>
<section class="abschnitt"><div class="huelle schmal rechtstext">
<h2>Angaben gemäß § 5 DDG</h2>
<p>${esc(f.name)}<br>Inhaber: ${fehlt(f.inhaber, 'Inhaber')}<br>Rechtsform: ${fehlt(f.rechtsform, 'Rechtsform')}<br>${fehlt(k.strasse, 'Straße und Hausnummer')}<br>${fehlt(k.plz, 'PLZ')} ${esc(k.ort)}</p>
<h2>Kontakt</h2><p>Telefon: ${fehlt(k.telefon, 'Telefon')}<br>E-Mail: ${fehlt(k.email, 'E-Mail')}</p>
<h2>Umsatzsteuer-ID</h2><p>Umsatzsteuer-Identifikationsnummer gemäß § 27a UStG: ${fehlt(f.ustId, 'USt-IdNr., falls vorhanden')}</p>
<h2>Angaben zur Handwerksrolle und Berufsrecht</h2><p>Zuständige Kammer: ${fehlt(f.kammer, 'Handwerkskammer')}<br>Eingetragene Handwerke / Berufsbezeichnung: ${fehlt(f.handwerksrolle, 'Handwerke laut Handwerkskarte')}<br>Berufsbezeichnung verliehen in: Deutschland<br>Berufsrechtliche Regelungen: Handwerksordnung (HwO), abrufbar unter <a href="https://www.gesetze-im-internet.de/hwo/" rel="noopener">gesetze-im-internet.de/hwo</a></p>
<h2>Verbraucherstreitbeilegung</h2><p>Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>
</div></section>`;
  seite({ pfad: 'impressum.html', titel: 'Impressum', beschreibung: 'Impressum von BERGER SERVICE SOLUTIONS, Essen – Anbieterkennzeichnung, Kontakt und Angaben zur Handwerksrolle.', inhalt, krumen: [['Impressum', 'impressum.html']], noindex: true });
}

function anbieterBlock() {
  const k = CONFIG.kontakt; const f = CONFIG.firma;
  return `${esc(f.name)}<br>Inhaber: ${fehlt(f.inhaber, 'Inhaber')}<br>${fehlt(k.strasse, 'Straße und Hausnummer')}<br>${fehlt(k.plz, 'PLZ')} ${esc(k.ort)}<br>${k.telefon ? `Telefon: ${esc(k.telefon)}<br>` : ''}E-Mail: ${fehlt(k.email, 'E-Mail')}`;
}
const STAND = 'November 2026';

function datenschutz() {
  const inhalt = `
<section class="seitenkopf seitenkopf-kompakt"><div class="huelle"><h1>Datenschutzerklärung</h1></div></section>
<section class="abschnitt"><div class="huelle schmal rechtstext">
<h2>1. Verantwortlicher</h2><p>${anbieterBlock()}</p>
<p>Ein Datenschutzbeauftragter ist nicht benannt, da die gesetzlichen Voraussetzungen dafür nicht vorliegen. Bei Fragen zum Datenschutz wenden Sie sich bitte an die oben genannte E-Mail-Adresse.</p>

<h2>2. Hosting</h2><p>Diese Website wird bei der IONOS SE, Elgendorfer Str. 57, 56410 Montabaur, betrieben. Beim Aufruf der Website verarbeitet IONOS technisch notwendige Daten (IP-Adresse, Datum und Uhrzeit, aufgerufene Seite, übertragene Datenmenge, Browser und Betriebssystem), um die Website auszuliefern und vor Angriffen zu schützen. Rechtsgrundlage ist unser berechtigtes Interesse an einem sicheren und stabilen Betrieb (Art. 6 Abs. 1 lit. f DSGVO). Mit IONOS besteht ein Vertrag zur Auftragsverarbeitung nach Art. 28 DSGVO. Die Speicherdauer der Server-Logfiles richtet sich nach den Vorgaben des Hosters.</p>

<h2>3. Verschlüsselung, Cookies und externe Inhalte</h2><p>Die Übertragung erfolgt verschlüsselt (TLS/HTTPS). Diese Website setzt keine Cookies zu Analyse- oder Werbezwecken, verwendet keine Tracking- oder Analysedienste und bindet keine externen Inhalte wie Schriftarten, Karten oder Videos ein; die Schrift wird von unserem eigenen Server geladen. Die Prüfung, ob Ihre Postleitzahl im Einsatzgebiet liegt, findet ausschließlich in Ihrem Browser statt.</p>
<p>Für die Verwaltung der Website nutzen wir WordPress. Cookies der Verwaltungsoberfläche werden nur beim Login von Administratoren gesetzt, nicht für Besucher der Website.</p>

<h2>4. Online-Anfrage und Terminbuchung</h2><p>Wenn Sie über unser Formular eine Anfrage senden oder einen Termin buchen, verarbeiten wir die von Ihnen eingegebenen Daten: Name, gegebenenfalls Firma, Einsatzadresse, gegebenenfalls abweichende Rechnungsadresse, Telefonnummer, E-Mail-Adresse, gewünschte Leistung, Beschreibung, Wunschtermin, bevorzugter Kontaktweg sowie hochgeladene Fotos und Dokumente. Zweck ist die Bearbeitung Ihrer Anfrage, die Terminplanung und gegebenenfalls die Durchführung des Auftrags. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (vorvertragliche Maßnahmen bzw. Vertragserfüllung).</p>
<p>Ihre Angaben werden verschlüsselt an unseren Webserver übertragen, dort geprüft und per E-Mail über den E-Mail-Dienst von IONOS an uns weitergeleitet. Sie erhalten eine automatische Eingangsbestätigung an die angegebene E-Mail-Adresse. Auf dem Webserver selbst werden Ihre Anfragedaten nicht gespeichert.</p>
<p>Zum Schutz vor Missbrauch (z. B. automatisierten Massenanfragen) speichern wir Ihre IP-Adresse ausschließlich in gehashter, nicht rückrechenbarer Form für höchstens 10 Minuten sowie eine zufällige Kennung der Anfrage für 24 Stunden, um versehentlich doppelt gesendete Anfragen zu erkennen. Zur Vermeidung doppelter Kundendatensätze werden E-Mail-Adresse, Telefonnummer und Adresse zusätzlich als Prüfwert (Hash) übermittelt. Rechtsgrundlage ist jeweils unser berechtigtes Interesse an einem sicheren Formular und einer korrekten Kundendatenhaltung (Art. 6 Abs. 1 lit. f DSGVO).</p>

<h2>5. Kontakt per E-Mail oder Telefon</h2><p>Wenn Sie uns per E-Mail oder telefonisch kontaktieren, verarbeiten wir Ihre Angaben zur Bearbeitung Ihres Anliegens (Art. 6 Abs. 1 lit. b DSGVO bei Bezug zu einem Auftrag, sonst Art. 6 Abs. 1 lit. f DSGVO). Unser E-Mail-Postfach wird bei IONOS betrieben.</p>

<h2>6. Kommunikation per WhatsApp</h2><p>Nur wenn Sie im Formular WhatsApp als bevorzugten Kontaktweg wählen und ausdrücklich einwilligen, kontaktieren wir Sie zu Ihrer Anfrage über WhatsApp. Anbieter ist die WhatsApp Ireland Limited (Meta). Dabei können Daten, insbesondere Metadaten, auch in die USA übermittelt werden; Meta ist nach dem EU-US Data Privacy Framework zertifiziert. Rechtsgrundlage ist Ihre Einwilligung (Art. 6 Abs. 1 lit. a DSGVO), die Sie jederzeit mit Wirkung für die Zukunft widerrufen können, z. B. per E-Mail.</p>

<h2>7. Auftragsabwicklung und Aufbewahrung</h2><p>Kommt ein Auftrag zustande, speichern wir die für Angebot, Durchführung, Dokumentation und Abrechnung erforderlichen Daten. Anfragen, aus denen kein Auftrag entsteht, löschen wir spätestens zwölf Monate nach dem letzten Kontakt. Auftragsbezogene Unterlagen bewahren wir entsprechend den gesetzlichen Aufbewahrungspflichten auf (§ 147 AO, § 257 HGB: in der Regel sechs Jahre für Geschäftsbriefe, acht Jahre für Buchungsbelege und zehn Jahre für Bücher und Jahresabschlüsse) und löschen sie danach.</p>

<h2>8. Ihre Rechte</h2><p>Sie haben das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18), Datenübertragbarkeit (Art. 20) sowie das Recht, einer Verarbeitung auf Grundlage berechtigter Interessen aus Gründen Ihrer besonderen Situation zu widersprechen (Art. 21). Eine erteilte Einwilligung können Sie jederzeit widerrufen. Eine automatisierte Entscheidungsfindung findet nicht statt.</p>
<p>Sie haben außerdem das Recht, sich bei einer Datenschutz-Aufsichtsbehörde zu beschweren. Für uns zuständig ist die Landesbeauftragte für Datenschutz und Informationsfreiheit Nordrhein-Westfalen, Kavalleriestraße 2–4, 40213 Düsseldorf.</p>
<p class="klein">Stand: ${STAND}</p>
</div></section>`;
  seite({ pfad: 'datenschutz.html', titel: 'Datenschutzerklärung', beschreibung: 'Datenschutzerklärung von BERGER SERVICE SOLUTIONS zu Website, Hosting bei IONOS, Online-Anfrage, E-Mail und WhatsApp-Kommunikation.', inhalt, krumen: [['Datenschutz', 'datenschutz.html']], noindex: true });
}

function widerruf() {
  const inhalt = `
<section class="seitenkopf seitenkopf-kompakt"><div class="huelle"><h1>Widerrufsbelehrung</h1></div></section>
<section class="abschnitt"><div class="huelle schmal rechtstext">
<p>Die folgende Belehrung gilt für Verbraucher, die einen Vertrag mit uns ausschließlich über Fernkommunikationsmittel (z. B. über die Online-Buchung, per E-Mail oder Telefon) oder außerhalb unserer Geschäftsräume schließen.</p>
<h2>Widerrufsrecht</h2>
<p>Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen. Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des Vertragsabschlusses.</p>
<p>Um Ihr Widerrufsrecht auszuüben, müssen Sie uns (${anbieterBlock().replace(/<br>/g, ', ')}) mittels einer eindeutigen Erklärung (z. B. ein mit der Post versandter Brief oder eine E-Mail) über Ihren Entschluss, diesen Vertrag zu widerrufen, informieren. Sie können dafür das beigefügte Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben ist.</p>
<p>Zur Wahrung der Widerrufsfrist reicht es aus, dass Sie die Mitteilung über die Ausübung des Widerrufsrechts vor Ablauf der Widerrufsfrist absenden.</p>
<h2>Folgen des Widerrufs</h2>
<p>Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen, die wir von Ihnen erhalten haben, unverzüglich und spätestens binnen vierzehn Tagen ab dem Tag zurückzuzahlen, an dem die Mitteilung über Ihren Widerruf dieses Vertrags bei uns eingegangen ist. Für diese Rückzahlung verwenden wir dasselbe Zahlungsmittel, das Sie bei der ursprünglichen Transaktion eingesetzt haben, es sei denn, mit Ihnen wurde ausdrücklich etwas anderes vereinbart; in keinem Fall werden Ihnen wegen dieser Rückzahlung Entgelte berechnet.</p>
<p>Haben Sie verlangt, dass die Dienstleistungen während der Widerrufsfrist beginnen sollen, so haben Sie uns einen angemessenen Betrag zu zahlen, der dem Anteil der bis zu dem Zeitpunkt, zu dem Sie uns von der Ausübung des Widerrufsrechts hinsichtlich dieses Vertrags unterrichten, bereits erbrachten Dienstleistungen im Vergleich zum Gesamtumfang der im Vertrag vorgesehenen Dienstleistungen entspricht.</p>
<h2>Besondere Hinweise</h2>
<p>Ihr Widerrufsrecht erlischt bei einem Vertrag über die Erbringung von Dienstleistungen, wenn wir die Dienstleistung vollständig erbracht haben und mit der Ausführung erst begonnen haben, nachdem Sie dazu Ihre ausdrückliche Zustimmung gegeben und gleichzeitig Ihre Kenntnis davon bestätigt haben, dass Sie Ihr Widerrufsrecht bei vollständiger Vertragserfüllung durch uns verlieren.</p>
<p>Ein Widerrufsrecht besteht nicht bei Verträgen, bei denen Sie uns ausdrücklich aufgefordert haben, Sie aufzusuchen, um dringende Reparatur- oder Instandhaltungsarbeiten vorzunehmen (§ 312g Abs. 2 Nr. 11 BGB). Dies gilt nicht für weitere Leistungen, die Sie bei diesem Besuch zusätzlich verlangen.</p>
<h2>Muster-Widerrufsformular</h2>
<p>(Wenn Sie den Vertrag widerrufen wollen, dann füllen Sie bitte dieses Formular aus und senden Sie es zurück.)</p>
<p>An: ${anbieterBlock()}</p>
<p>Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen Vertrag über die Erbringung der folgenden Dienstleistung (*)<br>_____________________________________<br>Bestellt am (*) / erhalten am (*): ______________<br>Name des/der Verbraucher(s): ______________<br>Anschrift des/der Verbraucher(s): ______________<br>Unterschrift des/der Verbraucher(s) (nur bei Mitteilung auf Papier): ______________<br>Datum: ______________</p>
<p class="klein">(*) Unzutreffendes streichen.</p>
<p class="klein">Stand: ${STAND}</p>
</div></section>`;
  seite({ pfad: 'widerruf.html', titel: 'Widerrufsbelehrung', beschreibung: 'Widerrufsbelehrung und Muster-Widerrufsformular für Verbraucher bei Aufträgen an BERGER SERVICE SOLUTIONS über die Online-Buchung, per E-Mail oder Telefon.', inhalt, krumen: [['Widerrufsbelehrung', 'widerruf.html']], noindex: true });
}

function agb() {
  const p = (t) => `<p>${t}</p>`;
  const abschnitte = [
    ['1. Geltungsbereich', [`Diese Allgemeinen Geschäftsbedingungen gelten für alle Verträge zwischen ${esc(CONFIG.firma.name)}, Inhaber ${esc(CONFIG.firma.inhaber || '')}, (nachfolgend „wir“) und unseren Kunden über Leistungen aus den Bereichen Elektrotechnik, Prüfung und Wartung, Handwerk und Sanierung, Hausmeister- und Objektservice sowie Entrümpelung und Rückbau. Abweichende Bedingungen des Kunden gelten nur, wenn wir ihnen ausdrücklich zustimmen.`, 'Verbraucher ist jede natürliche Person, die einen Vertrag zu Zwecken abschließt, die überwiegend weder ihrer gewerblichen noch ihrer selbständigen beruflichen Tätigkeit zugerechnet werden können (§ 13 BGB).']],
    ['2. Vertragsschluss', ['Anfragen und Terminbuchungen über unsere Website, per E-Mail oder Telefon sind unverbindliche Anfragen des Kunden. Ein online gewählter Termin ist zunächst vorläufig.', 'Der Vertrag kommt zustande, wenn wir einen Termin oder Auftrag ausdrücklich bestätigen (z. B. per E-Mail) oder der Kunde ein schriftliches Angebot von uns annimmt. Angebote sind, soweit nicht anders angegeben, 30 Tage gültig.']],
    ['3. Leistungsumfang', ['Der Leistungsumfang ergibt sich aus der Auftragsbestätigung bzw. dem angenommenen Angebot. Zusätzliche oder geänderte Leistungen, die sich erst bei der Ausführung als notwendig herausstellen, stimmen wir vor ihrer Ausführung mit dem Kunden ab; das gilt nicht, wenn zur Abwendung einer unmittelbaren Gefahr sofortiges Handeln erforderlich ist.', 'Arbeiten in zulassungspflichtigen Handwerken führen wir im Rahmen unserer Eintragungen in die Handwerksrolle aus oder lassen sie durch eingetragene Fachbetriebe ausführen.']],
    ['4. Preise und Zahlung', ['Es gelten die im Angebot bzw. in der Auftragsbestätigung genannten Preise. Gegenüber Verbrauchern sind alle Preise Endpreise einschließlich der gesetzlichen Umsatzsteuer. Ist kein Festpreis vereinbart, wird nach tatsächlichem Aufwand (Arbeitszeit, Material, Anfahrt, Entsorgung) zu den vereinbarten Sätzen abgerechnet.', 'Rechnungen sind innerhalb von 14 Tagen nach Zugang ohne Abzug zahlbar. Bei größeren Aufträgen können Abschlagszahlungen entsprechend dem Baufortschritt vereinbart werden (§ 632a BGB).']],
    ['5. Termine und Mitwirkung des Kunden', ['Bitte sagen Sie vereinbarte Termine, die Sie nicht wahrnehmen können, möglichst frühzeitig ab.', 'Der Kunde ermöglicht den Zugang zum Einsatzort, stellt – soweit für die Arbeiten erforderlich – Strom und Wasser zur Verfügung und weist uns vor Beginn auf ihm bekannte verdeckte Leitungen, Schäden oder Schadstoffe (z. B. Asbest) hin.']],
    ['6. Abnahme', ['Werkleistungen werden nach Fertigstellung abgenommen; auf Wunsch fertigen wir ein Abnahmeprotokoll. Wegen unwesentlicher Mängel kann die Abnahme nicht verweigert werden.']],
    ['7. Eigentumsvorbehalt', ['Gelieferte und noch nicht fest eingebaute Materialien bleiben bis zur vollständigen Bezahlung unser Eigentum.']],
    ['8. Entsorgung', ['Die Entsorgung erfolgt im Umfang des Angebots über zugelassene Entsorgungsbetriebe. Gefährliche Abfälle (z. B. asbesthaltige Materialien, Chemikalien) übernehmen wir nur nach gesonderter Vereinbarung.']],
    ['9. Mängelrechte', ['Es gelten die gesetzlichen Mängelrechte.']],
    ['10. Haftung', ['Wir haften unbeschränkt bei Vorsatz und grober Fahrlässigkeit, bei Verletzung von Leben, Körper oder Gesundheit sowie nach dem Produkthaftungsgesetz. Bei leicht fahrlässiger Verletzung wesentlicher Vertragspflichten ist die Haftung auf den vertragstypischen, vorhersehbaren Schaden begrenzt. Im Übrigen ist die Haftung für leichte Fahrlässigkeit ausgeschlossen.']],
    ['11. Widerrufsrecht', ['Verbrauchern steht unter den gesetzlichen Voraussetzungen ein Widerrufsrecht zu. Einzelheiten ergeben sich aus unserer <a href="widerruf.html">Widerrufsbelehrung</a>.']],
    ['12. Streitbeilegung', ['Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.']],
    ['13. Schlussbestimmungen', ['Es gilt das Recht der Bundesrepublik Deutschland. Gegenüber Verbrauchern gilt diese Rechtswahl nur, soweit dadurch nicht zwingende Schutzvorschriften des Staates ihres gewöhnlichen Aufenthalts entzogen werden. Ist der Kunde Kaufmann, ist Gerichtsstand Essen. Sollten einzelne Bestimmungen unwirksam sein, bleibt die Wirksamkeit der übrigen Bestimmungen unberührt.']],
  ];
  const inhalt = `
<section class="seitenkopf seitenkopf-kompakt"><div class="huelle"><h1>Allgemeine Geschäftsbedingungen</h1></div></section>
<section class="abschnitt"><div class="huelle schmal rechtstext">
${abschnitte.map(([h, ps]) => `<h2>${h}</h2>${ps.map(p).join('')}`).join('\n')}
<p class="klein">Stand: ${STAND}</p>
</div></section>`;
  seite({ pfad: 'agb.html', titel: 'Allgemeine Geschäftsbedingungen (AGB)', beschreibung: 'Allgemeine Geschäftsbedingungen von BERGER SERVICE SOLUTIONS für Elektrotechnik, Sanierung, Objektservice und Entrümpelung: Vertragsschluss, Preise, Termine, Haftung.', inhalt, krumen: [['AGB', 'agb.html']], noindex: true });
}

function fehlerseite() {
  const inhalt = `<section class="seitenkopf"><div class="huelle"><h1>Seite nicht gefunden</h1><p class="lead">Die aufgerufene Seite existiert nicht oder wurde verschoben.</p><div class="knopf-gruppe"><a class="knopf knopf-akzent" href="index.html">Zur Startseite</a><a class="knopf knopf-hell" href="leistungen.html">Alle Leistungen</a></div></div></section>`;
  seite({ pfad: '404.html', titel: 'Seite nicht gefunden', beschreibung: 'Die aufgerufene Seite wurde nicht gefunden. Zur Startseite oder zur Übersicht aller Leistungen von BERGER SERVICE SOLUTIONS.', inhalt, noindex: true });
}

// ---------------------------------------------------------------------------
// Sitemap, robots.txt, llms.txt, generierte Dokumentation
// ---------------------------------------------------------------------------
function technischeDateien() {
  const heute = new Date().toISOString().slice(0, 10);
  const indexierbare = seiten.filter((s) => !s.noindex);
  writeFileSync(path.join(PUBLIC, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexierbare.map((s) => `  <url><loc>${absUrl(s.pfad)}</loc><lastmod>${heute}</lastmod><priority>${s.prioritaet.toFixed(1)}</priority></url>`).join('\n')}\n</urlset>\n`);
  // PHP-Empfang der Online-Buchung (E-Mail-Versand) für klassisches Webhosting.
  mkdirSync(path.join(PUBLIC, 'api'), { recursive: true });
  copyFileSync(path.join(WURZEL, 'src', 'php', 'anfrage.php'), path.join(PUBLIC, 'api', 'anfrage.php'));
  const phpWert = (v) => (v === null || v === undefined ? 'null' : typeof v === 'boolean' || typeof v === 'number' ? String(v) : `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`);
  const phpKatalog = LEISTUNGEN.map((l) => `    ${phpWert(l.slug)} => ['name' => ${phpWert(l.name)}, 'buchung' => ${phpWert(l.buchung)}, 'bereich' => ${phpWert(l.bereich)}],`).join('\n');
  writeFileSync(path.join(PUBLIC, 'api', 'einstellungen.php'), `<?php
// Erzeugt von src/build.mjs aus src/config.mjs – nicht von Hand ändern.
return [
  'empfaenger' => ${phpWert(CONFIG.buchung.email.empfaenger)},
  'absender' => ${phpWert(CONFIG.buchung.email.absender)},
  'kundenbestaetigung' => ${phpWert(CONFIG.buchung.email.kundenbestaetigung)},
  'firma' => ${phpWert(CONFIG.firma.name)},
  'telefon' => ${phpWert(CONFIG.kontakt.telefon)},
  'website' => ${phpWert(CONFIG.website.url)},
  'erlaubteHosts' => [${phpWert(new URL(CONFIG.website.url).host)}],
  'maxDateien' => ${CONFIG.buchung.maxDateien},
  'maxDateiMB' => ${CONFIG.buchung.maxDateiMB},
  'maxGesamtMB' => ${CONFIG.buchung.maxGesamtMB},
  'ratenLimit' => 5,
  'ratenFensterSek' => 600,
  'leistungen' => [
${phpKatalog}
  ],
];
`);
  writeFileSync(path.join(PUBLIC, 'api', '.htaccess'), '<Files "einstellungen.php">\n  Require all denied\n</Files>\n');

  // Apache-Konfiguration für klassisches Webhosting (z. B. IONOS). Wichtig: .mjs als
  // JavaScript ausliefern, sonst laden die Buchungs-Skripte im Browser nicht.
  writeFileSync(path.join(PUBLIC, '.htaccess'), `# BERGER SERVICE SOLUTIONS – erzeugt von src/build.mjs
DirectoryIndex index.html index.php
ErrorDocument 404 /404.html

AddType text/javascript .js .mjs
AddType image/webp .webp
AddType font/woff2 .woff2
AddDefaultCharset utf-8

<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteCond %{HTTPS} off
  RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
</IfModule>

<IfModule mod_headers.c>
  Header always set X-Content-Type-Options "nosniff"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
  Header always set X-Frame-Options "SAMEORIGIN"
  Header always set Permissions-Policy "camera=(), microphone=(), geolocation=()"
${CONFIG.website.indexierbar ? '' : '  # Prototyp: Suchmaschinen ausschließen, bis website.indexierbar = true\n  Header always set X-Robots-Tag "noindex, nofollow"\n'}  <FilesMatch "\\.(webp|png|jpg|ico|woff2)$">
    Header set Cache-Control "public, max-age=2592000"
  </FilesMatch>
  <FilesMatch "\\.(css|js|mjs)$">
    Header set Cache-Control "public, max-age=86400"
  </FilesMatch>
</IfModule>
`);
  writeFileSync(path.join(PUBLIC, 'robots.txt'), CONFIG.website.indexierbar
    ? `User-agent: *\nAllow: /\n\nSitemap: ${absUrl('sitemap.xml')}\n`
    : `# Prototyp: Indexierung gesperrt, bis CONFIG.website.indexierbar = true\nUser-agent: *\nDisallow: /\n`);
  const llms = `# ${CONFIG.firma.name}

> ${CONFIG.firma.slogan} Dienstleistungsunternehmen aus Essen (Nordrhein-Westfalen) für Elektrotechnik mit Prüfung und Wartung, Handwerk und Sanierung inklusive Bodenlegearbeiten, Hausmeister- und Objektservice sowie Entrümpelung, Haushaltsauflösung und Rückbau. Einsatzgebiet: rund ${CONFIG.einsatzgebiet.radiusKm} km um Essen.

Wichtige Fakten:
- Standort: Essen. Einsatzgebiet u. a.: ${ORTSSEITEN.map((o) => ortName(o.slug)).join(', ')} sowie weitere Orte im Radius (siehe Einsatzgebiet).
- Direkt online buchbar: ${LEISTUNGEN.filter((l) => l.buchung === 'direkt').map((l) => l.name).join(', ')}.
- Alle anderen Leistungen: Anfrage, Besichtigung, schriftliches Angebot.
- Arbeiten in zulassungspflichtigen Handwerken nur im Rahmen der Eintragung oder über eingetragene Partnerbetriebe.
- Es werden keine Pauschalpreise, Garantien oder Platzierungen versprochen.

## Leistungsbereiche
${BEREICHE.map((b) => `- [${b.name}](${absUrl(b.slug + '.html')}): ${b.kurz}`).join('\n')}

## Leistungen
${LEISTUNGEN.map((l) => `- [${l.name}](${absUrl(l.slug + '.html')}): ${l.kurz}`).join('\n')}

## Einsatzgebiet
- [Übersicht aller Orte und Anfahrtszonen](${absUrl('einsatzgebiet.html')})
${ORTSSEITEN.map((o) => `- [${ortName(o.slug)}](${absUrl('einsatzgebiet-' + o.slug + '.html')})`).join('\n')}

## Service
- [Online buchen oder anfragen](${absUrl('buchen.html')})
- [Abläufe](${absUrl('ablauf.html')})
- [Häufige Fragen](${absUrl('faq.html')})
- [Kontakt](${absUrl('kontakt.html')})
`;
  writeFileSync(path.join(PUBLIC, 'llms.txt'), llms);

  mkdirSync(DOCS_GEN, { recursive: true });
  const kw = `# Keyword-Matrix (generiert)

> Automatisch erzeugt aus \`src/daten/*.mjs\` durch \`src/build.mjs\`. Nicht von Hand bearbeiten.
> Suchvolumina sind nicht enthalten: Sie müssen mit einem Keyword-Tool (z. B. Google Keyword Planner, Search Console nach Go-live) erhoben werden.

| Bereich | Seite | Haupt-Keyword (Cluster-Kopf) | Neben-Keywords | Fragen (GEO/FAQ) | Suchintention |
|---|---|---|---|---|---|
${LEISTUNGEN.map((l) => `| ${BEREICH[l.bereich].kurzname} | [${l.slug}.html](../../public/${l.slug}.html) | ${l.keywords.haupt} | ${l.keywords.neben.join(', ')} | ${l.keywords.fragen.join('; ') || '–'} | ${l.keywords.intent} |`).join('\n')}

## Lokale Varianten

Jedes Haupt-Keyword wird lokal über drei Ebenen abgedeckt, ohne eigene Stadt×Leistung-Seiten:

1. Leistungsseite mit Einsatzgebiet „Essen und 50 km“ (Title/H1 mit „Essen“).
2. Ortsseiten (${ORTSSEITEN.length}) mit Leistungsschwerpunkten und Verlinkung auf die Leistungsseiten.
3. Google Business Profile mit Leistungen und Einzugsgebiet.

Ortsseiten: ${ORTSSEITEN.map((o) => ortName(o.slug)).join(', ')}.
`;
  writeFileSync(path.join(DOCS_GEN, 'keyword-matrix.md'), kw);

  const recht = `# Rechtliche und fachliche Prüfpunkte je Leistung (generiert)

> Automatisch erzeugt aus den Feldern \`hinweis\` (öffentlich) und \`intern\` (nur intern) der Leistungsdaten.
> Diese Liste ersetzt keine Rechtsberatung. Alle Punkte sind vor dem Go-live mit Handwerkskammer, Behörden bzw. Rechtsberatung zu klären.

| Leistung | Öffentlicher Hinweis auf der Website | Interner Prüfpunkt | Status |
|---|---|---|---|
${LEISTUNGEN.map((l) => `| ${l.name} | ${(l.hinweis || '–').replace(/\|/g, '/')} | ${(l.intern || '–').replace(/\|/g, '/')} | ${l.intern ? 'OFFEN' : 'allgemein'} |`).join('\n')}
`;
  writeFileSync(path.join(DOCS_GEN, 'rechtliche-pruefpunkte.md'), recht);
}

// ---------------------------------------------------------------------------
export function bauen() {
  mkdirSync(PUBLIC, { recursive: true });
  seiten.length = 0;
  startseite();
  leistungsuebersicht();
  BEREICHE.forEach(bereichsseite);
  LEISTUNGEN.forEach(leistungsseite);
  einsatzgebietHub();
  ORTSSEITEN.forEach(ortsseite);
  buchungsseite();
  ablaufseite();
  zielgruppenseite({
    pfad: 'hausverwaltungen.html', krumenName: 'Für Hausverwaltungen',
    titel: 'Für Hausverwaltungen & Vermieter – Objektservice',
    beschreibung: 'Für Hausverwaltungen und Vermieter in Essen: Hausmeisterservice, Treppenhausreinigung, Winterdienst, Mieterwechsel, Elektroprüfung und Renovierung.',
    h1: 'Ein Dienstleister für Ihre Objekte: Technik, Pflege und Mieterwechsel',
    intro: ['Hausverwaltungen koordinieren für jedes Objekt eine Vielzahl von Dienstleistern. Wir bündeln Hausmeisterservice, Reinigung, Grünpflege, Winterdienst, Elektroprüfungen, Renovierungen und Entrümpelungen – mit einer Objektakte pro Liegenschaft und digitalen Leistungsnachweisen.'],
    punkte: [['Objektakte je Liegenschaft', 'Stammdaten, Zugänge, Checklisten, Prüffristen und Historie an einem Ort.'], ['Wiederkehrende Einsätze', 'Intervalle werden automatisch geplant, Abweichungen dokumentiert.'], ['Mängel mit Foto', 'Auffälligkeiten melden wir mit Foto und Einordnung – und beheben sie nach Freigabe häufig selbst.'], ['Abrechnung nach Objekt', 'Umlagefähige und nicht umlagefähige Leistungen werden getrennt ausgewiesen.']],
    leistungen: ['hausmeisterservice', 'treppenhausreinigung', 'winterdienst', 'wohnungsuebergabe-mieterwechsel', 'renovierung-mieterwechsel', 'e-check'],
    faq: [['Können wir mehrere Objekte über einen Rahmenvertrag betreuen lassen?', 'Ja. Leistungen, Intervalle und Preise werden je Objekt in einem Leistungsverzeichnis festgelegt.'], ['Wie erhalten wir Leistungsnachweise?', 'Digital je Einsatz mit Datum, Uhrzeit, Checkliste und Fotos; gesammelt mit der Abrechnung.'], ['Wie werden Mängel gemeldet?', 'Mit Foto, Beschreibung und Dringlichkeit an den vereinbarten Ansprechpartner; Reparaturen erfolgen nach Ihrer Freigabe.']],
  });
  zielgruppenseite({
    pfad: 'gewerbekunden.html', krumenName: 'Für Gewerbekunden',
    titel: 'Für Gewerbekunden – Prüfung, Wartung, Reinigung',
    beschreibung: 'Für Gewerbekunden in Essen: DGUV-V3-Prüfung, Klima- und Wärmepumpenwartung, Büroreinigung, Umbauten und Gewerbeentrümpelung – planbar und dokumentiert.',
    h1: 'Prüfung, Wartung, Reinigung und Umbau für Gewerbekunden',
    intro: ['Für Betriebe zählen Planbarkeit und Nachweise. Wir übernehmen wiederkehrende Prüfungen und Wartungen mit Fristüberwachung, die Reinigung Ihrer Räume sowie Umbauten und Räumungen – mit festen Ansprechpartnern und vollständiger Dokumentation.'],
    punkte: [['Fristüberwachung', 'Prüf- und Wartungsfristen werden hinterlegt; wir erinnern rechtzeitig.'], ['Prüfprotokolle', 'Digitale Protokolle für Ihre Dokumentationspflichten, z. B. gegenüber Berufsgenossenschaft und Versicherer.'], ['Termine außerhalb der Kernzeiten', 'Nach Absprache auch früh morgens oder abends, damit der Betrieb weiterläuft.'], ['Ein Vertrag, mehrere Leistungen', 'Prüfung, Wartung und Reinigung in einer Vereinbarung.'], ['Umbau von Gewerbeflächen', 'Elektroinstallation und Innenausbau für Ladenlokale, Büros und Praxen – koordiniert, damit die Fläche schnell nutzbar ist.']],
    leistungen: ['elektroinstallation', 'trockenbau-innenausbau', 'dguv-v3-pruefung', 'klimaanlagenwartung', 'gebaeudereinigung', 'beleuchtungstechnik'],
    fotoBlock: galerie(GEWERBE_FOTOS, 'Projekt: Umbau eines Ladenlokals', 'Elektroinstallation und Innenausbau für ein leerstehendes Ladenlokal – hier der Ausgangszustand vor Beginn der Arbeiten.'),
    faq: [['Prüfen Sie auch außerhalb der Geschäftszeiten?', 'Nach Absprache ja.'], ['Erhalten wir ein Geräteverzeichnis?', 'Ja, mit Prüfdatum, Ergebnis und nächstem Prüftermin je Gerät.']],
  });
  ueberUns();
  faqSeite();
  kontaktSeite();
  impressum();
  datenschutz();
  agb();
  widerruf();
  fehlerseite();
  technischeDateien();
  return { seiten: [...seiten], leistungen: LEISTUNGEN };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { seiten: s } = bauen();
  console.log(`${s.length} Seiten erzeugt in ${path.relative(process.cwd(), PUBLIC)}`);
  const offen = offeneKonfigurationspunkte();
  if (offen.length) console.log(`Offene Konfigurationspunkte (${offen.length}):\n - ${offen.join('\n - ')}`);
}
