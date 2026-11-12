// HTML-Bausteine: Layout, Kopf, Navigation, Fußzeile, Icons, strukturierte Daten.
import { CONFIG } from './config.mjs';
import { BEREICHE } from './daten/bereiche.mjs';

export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const absUrl = (pfad) => `${CONFIG.website.url.replace(/\/$/, '')}/${pfad === 'index.html' ? '' : pfad}`;

export const MARKE = 'Berger Service Solutions';

export function seitenTitel(titel) {
  const mitMarke = `${titel} | ${MARKE}`;
  return mitMarke.length <= 70 ? mitMarke : titel;
}

// ---------------------------------------------------------------------------
// Icons (inline SVG, currentColor, dekorativ)
// ---------------------------------------------------------------------------
const PFADE = {
  blitz: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  kelle: '<path d="M3 21l7-7"/><path d="M14 4l6 6-8 8-6-6z"/><path d="M14 4l2-2 6 6-2 2"/>',
  haus: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  kiste: '<path d="M3 7l9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/>',
  kalender: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  pin: '<path d="M12 22s7-7.2 7-13a7 7 0 1 0-14 0c0 5.8 7 13 7 13z"/><circle cx="12" cy="9" r="2.5"/>',
  haken: '<path d="M5 12l5 5 9-11"/>',
  telefon: '<path d="M5 3h4l2 5-3 2a12 12 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A18 18 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  dokument: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h8M9 17h8"/>',
  pfeil: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  menue: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  schliessen: '<path d="M6 6l12 12M18 6 6 18"/>',
  schild: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  personen: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15 20a5 5 0 0 1 6-4.8"/>',
  whatsapp: '<path d="M4 20l1.3-4A8 8 0 1 1 8 18.7z"/><path d="M9 9c0 3 3 6 6 6l1-1.5-2-1-1 1c-1-.5-2-1.5-2.5-2.5l1-1-1-2z"/>',
};
export const icon = (name, klasse = 'icon') =>
  `<svg class="${klasse}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${PFADE[name] || ''}</svg>`;

const LOGO = `<svg class="logo-zeichen" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="9" fill="var(--marke)"/><path d="M12 9h10a6 6 0 0 1 2.2 11.6A6.5 6.5 0 0 1 22.5 31H12z" fill="none" stroke="var(--akzent)" stroke-width="3.2" stroke-linejoin="round"/><path d="M12 20h10" stroke="var(--akzent)" stroke-width="3.2"/></svg>`;

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
export function navigation(leistungenNachBereich) {
  const spalten = BEREICHE.map((b) => {
    const items = (leistungenNachBereich[b.id] || []).filter((l) => !l.eltern)
      .map((l) => `<li><a href="${l.slug}.html">${esc(l.name)}</a></li>`).join('');
    return `<div class="mega-spalte"><a class="mega-titel" href="${b.slug}.html">${icon(b.icon)}<span>${esc(b.name)}</span></a><ul>${items}</ul></div>`;
  }).join('');
  return `
<header class="kopf" id="kopf">
  <div class="huelle kopf-innen">
    <a class="logo" href="index.html" aria-label="${esc(CONFIG.firma.name)} – Startseite">${LOGO}<span class="logo-text"><strong>BERGER</strong><small>SERVICE SOLUTIONS</small></span></a>
    <button class="nav-schalter" type="button" aria-expanded="false" aria-controls="hauptnav"><span class="nur-sr">Menü öffnen</span>${icon('menue')}</button>
    <nav class="hauptnav" id="hauptnav" aria-label="Hauptnavigation">
      <ul class="nav-liste">
        <li class="hat-mega">
          <button class="mega-schalter" type="button" aria-expanded="false" aria-controls="mega">Leistungen</button>
          <div class="mega" id="mega"><div class="mega-raster">${spalten}</div><a class="mega-alle" href="leistungen.html">Alle Leistungen im Überblick ${icon('pfeil')}</a></div>
        </li>
        <li><a href="einsatzgebiet.html">Einsatzgebiet</a></li>
        <li><a href="hausverwaltungen.html">Hausverwaltungen</a></li>
        <li><a href="ablauf.html">So arbeiten wir</a></li>
        <li><a href="ueber-uns.html">Über uns</a></li>
        <li><a href="kontakt.html">Kontakt</a></li>
      </ul>
      <a class="knopf knopf-akzent nav-cta" href="buchen.html">${icon('kalender')}Online buchen</a>
    </nav>
  </div>
</header>`;
}

export function brotkrumen(krumen) {
  if (!krumen || krumen.length === 0) return '';
  const alle = [['Startseite', 'index.html'], ...krumen];
  const li = alle.map(([name, url], i) => i === alle.length - 1
    ? `<li aria-current="page">${esc(name)}</li>`
    : `<li><a href="${url}">${esc(name)}</a></li>`).join('');
  return `<nav class="brotkrumen huelle" aria-label="Brotkrumen"><ol>${li}</ol></nav>`;
}

export function brotkrumenJsonLd(krumen) {
  const alle = [['Startseite', 'index.html'], ...krumen];
  return {
    '@type': 'BreadcrumbList',
    itemListElement: alle.map(([name, url], i) => ({ '@type': 'ListItem', position: i + 1, name, item: absUrl(url) })),
  };
}

export function fuss(leistungenNachBereich, orteSeiten, ortName) {
  const k = CONFIG.kontakt;
  const kontaktZeilen = [
    k.strasse ? `${esc(k.strasse)}<br>${esc(k.plz || '')} ${esc(k.ort)}` : esc(k.ort) + ', ' + esc(k.region),
    k.telefon ? `<a href="tel:${esc(k.telefon.replace(/\s/g, ''))}">${esc(k.telefon)}</a>` : '',
    k.email ? `<a href="mailto:${esc(k.email)}">${esc(k.email)}</a>` : '',
  ].filter(Boolean).map((z) => `<li>${z}</li>`).join('');
  const bereiche = BEREICHE.map((b) => `<li><a href="${b.slug}.html">${esc(b.kurzname)}</a></li>`).join('');
  const orte = orteSeiten.map((o) => `<li><a href="einsatzgebiet-${o.slug}.html">${esc(ortName(o.slug))}</a></li>`).join('');
  return `
<footer class="fuss">
  <div class="huelle fuss-raster">
    <div>
      <p class="fuss-marke">${esc(CONFIG.firma.name)}</p>
      <p class="fuss-slogan">${esc(CONFIG.firma.slogan)}</p>
      <ul class="fuss-liste">${kontaktZeilen}</ul>
      <a class="knopf knopf-akzent" href="buchen.html">${icon('kalender')}Termin oder Angebot anfragen</a>
    </div>
    <div><p class="fuss-titel">Leistungsbereiche</p><ul class="fuss-liste">${bereiche}<li><a href="bodenlegearbeiten.html">Bodenlegearbeiten</a></li><li><a href="leistungen.html">Alle Leistungen</a></li></ul></div>
    <div><p class="fuss-titel">Einsatzgebiet</p><ul class="fuss-liste fuss-orte">${orte}<li><a href="einsatzgebiet.html">Alle Orte im 50-km-Radius</a></li></ul></div>
    <div><p class="fuss-titel">Unternehmen</p><ul class="fuss-liste"><li><a href="ueber-uns.html">Über uns</a></li><li><a href="ablauf.html">So arbeiten wir</a></li><li><a href="hausverwaltungen.html">Für Hausverwaltungen</a></li><li><a href="gewerbekunden.html">Für Gewerbekunden</a></li><li><a href="faq.html">Häufige Fragen</a></li><li><a href="kontakt.html">Kontakt</a></li><li><a href="impressum.html">Impressum</a></li><li><a href="datenschutz.html">Datenschutz</a></li></ul></div>
  </div>
  <div class="huelle fuss-unten"><p>© ${new Date().getFullYear()} ${esc(CONFIG.firma.name)} · Essen · Einsatzgebiet rund 50 km um Essen</p></div>
</footer>
<div class="mobil-leiste" role="navigation" aria-label="Schnellzugriff">
  ${k.telefon ? `<a href="tel:${esc(k.telefon.replace(/\s/g, ''))}">${icon('telefon')}Anrufen</a>` : `<a href="kontakt.html">${icon('mail')}Kontakt</a>`}
  ${k.whatsapp ? `<a href="https://wa.me/${esc(k.whatsapp)}" rel="noopener">${icon('whatsapp')}WhatsApp</a>` : ''}
  <a class="mobil-cta" href="buchen.html">${icon('kalender')}Online buchen</a>
</div>`;
}

// ---------------------------------------------------------------------------
// Strukturierte Daten
// ---------------------------------------------------------------------------
export function unternehmenJsonLd(orte) {
  const k = CONFIG.kontakt;
  const org = {
    '@type': 'HomeAndConstructionBusiness',
    '@id': absUrl('index.html') + '#unternehmen',
    name: CONFIG.firma.name,
    alternateName: MARKE,
    slogan: CONFIG.firma.slogan,
    url: absUrl('index.html'),
    logo: absUrl('assets/img/logo.svg'),
    image: absUrl('assets/img/og-bild.png'),
    description: 'Elektrotechnik, Prüfung und Wartung, Handwerk und Sanierung inklusive Bodenlegearbeiten, Hausmeister- und Objektservice sowie Entrümpelung und Rückbau in Essen und im Umkreis von rund 50 Kilometern.',
    areaServed: [
      { '@type': 'GeoCircle', geoMidpoint: { '@type': 'GeoCoordinates', latitude: CONFIG.einsatzgebiet.zentrum.lat, longitude: CONFIG.einsatzgebiet.zentrum.lon }, geoRadius: String(CONFIG.einsatzgebiet.radiusKm * 1000) },
      ...orte.map((o) => ({ '@type': 'City', name: o.name })),
    ],
    knowsAbout: ['Elektroinstallation', 'DGUV-V3-Prüfung', 'Wärmepumpenwartung', 'Klimaanlagenwartung', 'Photovoltaik', 'Wallbox', 'Badsanierung', 'Bodenlegearbeiten', 'Hausmeisterservice', 'Gebäudereinigung', 'Winterdienst', 'Entrümpelung', 'Haushaltsauflösung', 'Rückbau'],
  };
  if (k.strasse && k.plz) {
    org.address = { '@type': 'PostalAddress', streetAddress: k.strasse, postalCode: k.plz, addressLocality: k.ort, addressRegion: k.region, addressCountry: k.land };
  }
  if (k.telefon) org.telephone = k.telefon;
  if (k.email) org.email = k.email;
  if (k.oeffnungszeiten?.length) {
    const tagMap = { Mo: 'Monday', Di: 'Tuesday', Mi: 'Wednesday', Do: 'Thursday', Fr: 'Friday', Sa: 'Saturday', So: 'Sunday' };
    org.openingHoursSpecification = k.oeffnungszeiten.map((z) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: z.tage.map((t) => tagMap[t]), opens: z.von, closes: z.bis }));
  }
  return org;
}

export function faqJsonLd(faq) {
  if (!faq?.length) return null;
  return {
    '@type': 'FAQPage',
    mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  };
}

export function faqHtml(faq, titel = 'Häufige Fragen') {
  if (!faq?.length) return '';
  return `<section class="abschnitt" aria-labelledby="faq-titel"><div class="huelle schmal"><h2 id="faq-titel">${esc(titel)}</h2><div class="faq">${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div></div></section>`;
}

// ---------------------------------------------------------------------------
// Seitengerüst
// ---------------------------------------------------------------------------
export function layout({ pfad, titel, beschreibung, inhalt, krumen = [], jsonld = [], noindex = false, skripte = [], kopf, fussHtml, ogTyp = 'website' }) {
  const indexierbar = CONFIG.website.indexierbar && !noindex;
  const graph = { '@context': 'https://schema.org', '@graph': jsonld.filter(Boolean) };
  const vollTitel = seitenTitel(titel);
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(vollTitel)}</title>
<meta name="description" content="${esc(beschreibung)}">
<meta name="robots" content="${indexierbar ? 'index, follow, max-image-preview:large' : 'noindex, nofollow'}">
<link rel="canonical" href="${esc(absUrl(pfad))}">
<meta property="og:type" content="${ogTyp}">
<meta property="og:locale" content="de_DE">
<meta property="og:site_name" content="${esc(CONFIG.firma.name)}">
<meta property="og:title" content="${esc(vollTitel)}">
<meta property="og:description" content="${esc(beschreibung)}">
<meta property="og:url" content="${esc(absUrl(pfad))}">
<meta property="og:image" content="${esc(absUrl('assets/img/og-bild.png'))}">
<meta name="theme-color" content="#0f2233">
<link rel="icon" href="assets/img/favicon.svg" type="image/svg+xml">
<link rel="preload" href="assets/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="assets/css/style.css">
<script type="application/ld+json">${JSON.stringify(graph).replace(/</g, '\\u003c')}</script>
</head>
<body>
<a class="sprungmarke" href="#inhalt">Zum Inhalt springen</a>
${CONFIG.website.indexierbar ? '' : '<div class="status-band" role="note">Prototyp – Inhalte und Kontaktdaten werden vor der Veröffentlichung final geprüft.</div>'}
${kopf}
${brotkrumen(krumen)}
<main id="inhalt">
${inhalt}
</main>
${fussHtml}
<script src="assets/js/main.js" defer></script>
${skripte.map((s) => `<script type="module" src="${s}"></script>`).join('\n')}
</body>
</html>
`;
}
