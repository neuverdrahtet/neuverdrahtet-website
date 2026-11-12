// Einsatzgebiet, Entfernung, Anfahrtszone, Terminvorschläge und Dublettenschlüssel.
//
// Reines ES-Modul ohne Abhängigkeiten: wird im Browser (Online-Buchung) UND
// in Node (Build und Tests) verwendet. Keine Daten verlassen den Browser –
// es findet bewusst KEIN Geocoding über Drittanbieter statt (Datenschutz).
//
// STATUS: implementiert und per Unit-Test geprüft. Die PLZ-Bereiche sind eine
// Näherung (Stand: eigene Zusammenstellung) und müssen vor dem Go-live gegen
// amtliche PLZ-Daten abgeglichen werden. Unbekannte PLZ werden NICHT
// abgelehnt, sondern zur manuellen Prüfung markiert.

/** Städte und Gemeinden im Einsatzgebiet (Mittelpunktkoordinaten, gerundet). */
export const ORTE = [
  { name: 'Essen', slug: 'essen', lat: 51.4556, lon: 7.0116, plz: [[45127, 45359]], kreis: 'kreisfreie Stadt' },
  { name: 'Mülheim an der Ruhr', slug: 'muelheim-an-der-ruhr', lat: 51.4275, lon: 6.8825, plz: [[45468, 45481]], kreis: 'kreisfreie Stadt' },
  { name: 'Oberhausen', slug: 'oberhausen', lat: 51.4963, lon: 6.8638, plz: [[46045, 46149]], kreis: 'kreisfreie Stadt' },
  { name: 'Gelsenkirchen', slug: 'gelsenkirchen', lat: 51.5177, lon: 7.0857, plz: [[45879, 45899]], kreis: 'kreisfreie Stadt' },
  { name: 'Bottrop', slug: 'bottrop', lat: 51.5236, lon: 6.9285, plz: [[46236, 46244]], kreis: 'kreisfreie Stadt' },
  { name: 'Duisburg', slug: 'duisburg', lat: 51.4344, lon: 6.7623, plz: [[47051, 47279]], kreis: 'kreisfreie Stadt' },
  { name: 'Bochum', slug: 'bochum', lat: 51.4818, lon: 7.2162, plz: [[44787, 44894]], kreis: 'kreisfreie Stadt' },
  { name: 'Herne', slug: 'herne', lat: 51.5386, lon: 7.2257, plz: [[44623, 44653]], kreis: 'kreisfreie Stadt' },
  { name: 'Gladbeck', slug: 'gladbeck', lat: 51.5711, lon: 6.9853, plz: [[45964, 45968]], kreis: 'Kreis Recklinghausen' },
  { name: 'Recklinghausen', slug: 'recklinghausen', lat: 51.6141, lon: 7.1979, plz: [[45657, 45665]], kreis: 'Kreis Recklinghausen' },
  { name: 'Castrop-Rauxel', slug: 'castrop-rauxel', lat: 51.5503, lon: 7.3127, plz: [[44575, 44581]], kreis: 'Kreis Recklinghausen' },
  { name: 'Velbert', slug: 'velbert', lat: 51.3398, lon: 7.0435, plz: [[42549, 42555]], kreis: 'Kreis Mettmann' },
  { name: 'Hattingen', slug: 'hattingen', lat: 51.3987, lon: 7.1857, plz: [[45525, 45529]], kreis: 'Ennepe-Ruhr-Kreis' },
  { name: 'Herten', slug: 'herten', lat: 51.5958, lon: 7.1406, plz: [[45699, 45701]], kreis: 'Kreis Recklinghausen' },
  { name: 'Marl', slug: 'marl', lat: 51.6567, lon: 7.0904, plz: [[45768, 45772]], kreis: 'Kreis Recklinghausen' },
  { name: 'Dorsten', slug: 'dorsten', lat: 51.6604, lon: 6.9642, plz: [[46282, 46286]], kreis: 'Kreis Recklinghausen' },
  { name: 'Datteln', slug: 'datteln', lat: 51.6539, lon: 7.3416, plz: [[45711, 45711]], kreis: 'Kreis Recklinghausen' },
  { name: 'Oer-Erkenschwick', slug: 'oer-erkenschwick', lat: 51.6422, lon: 7.2508, plz: [[45739, 45739]], kreis: 'Kreis Recklinghausen' },
  { name: 'Waltrop', slug: 'waltrop', lat: 51.6236, lon: 7.3963, plz: [[45731, 45731]], kreis: 'Kreis Recklinghausen' },
  { name: 'Haltern am See', slug: 'haltern-am-see', lat: 51.7425, lon: 7.1844, plz: [[45721, 45721]], kreis: 'Kreis Recklinghausen' },
  { name: 'Dinslaken', slug: 'dinslaken', lat: 51.5623, lon: 6.7431, plz: [[46535, 46539]], kreis: 'Kreis Wesel' },
  { name: 'Voerde (Niederrhein)', slug: 'voerde', lat: 51.597, lon: 6.687, plz: [[46562, 46562]], kreis: 'Kreis Wesel' },
  { name: 'Hünxe', slug: 'huenxe', lat: 51.645, lon: 6.767, plz: [[46569, 46569]], kreis: 'Kreis Wesel' },
  { name: 'Schermbeck', slug: 'schermbeck', lat: 51.695, lon: 6.874, plz: [[46514, 46514]], kreis: 'Kreis Wesel' },
  { name: 'Moers', slug: 'moers', lat: 51.4513, lon: 6.6264, plz: [[47441, 47447]], kreis: 'Kreis Wesel' },
  { name: 'Rheinberg', slug: 'rheinberg', lat: 51.546, lon: 6.601, plz: [[47495, 47495]], kreis: 'Kreis Wesel' },
  { name: 'Kamp-Lintfort', slug: 'kamp-lintfort', lat: 51.5, lon: 6.54, plz: [[47475, 47475]], kreis: 'Kreis Wesel' },
  { name: 'Neukirchen-Vluyn', slug: 'neukirchen-vluyn', lat: 51.444, lon: 6.548, plz: [[47506, 47506]], kreis: 'Kreis Wesel' },
  { name: 'Krefeld', slug: 'krefeld', lat: 51.3388, lon: 6.5853, plz: [[47798, 47839]], kreis: 'kreisfreie Stadt' },
  { name: 'Ratingen', slug: 'ratingen', lat: 51.2973, lon: 6.8493, plz: [[40878, 40885]], kreis: 'Kreis Mettmann' },
  { name: 'Heiligenhaus', slug: 'heiligenhaus', lat: 51.3268, lon: 6.9711, plz: [[42579, 42579]], kreis: 'Kreis Mettmann' },
  { name: 'Wülfrath', slug: 'wuelfrath', lat: 51.2822, lon: 7.0386, plz: [[42489, 42489]], kreis: 'Kreis Mettmann' },
  { name: 'Mettmann', slug: 'mettmann', lat: 51.2504, lon: 6.975, plz: [[40822, 40822]], kreis: 'Kreis Mettmann' },
  { name: 'Erkrath', slug: 'erkrath', lat: 51.224, lon: 6.908, plz: [[40699, 40699]], kreis: 'Kreis Mettmann' },
  { name: 'Haan', slug: 'haan', lat: 51.193, lon: 7.013, plz: [[42781, 42781]], kreis: 'Kreis Mettmann' },
  { name: 'Hilden', slug: 'hilden', lat: 51.1714, lon: 6.9394, plz: [[40721, 40724]], kreis: 'Kreis Mettmann' },
  { name: 'Düsseldorf', slug: 'duesseldorf', lat: 51.2277, lon: 6.7735, plz: [[40210, 40629]], kreis: 'kreisfreie Stadt' },
  { name: 'Meerbusch', slug: 'meerbusch', lat: 51.256, lon: 6.689, plz: [[40667, 40670]], kreis: 'Rhein-Kreis Neuss' },
  { name: 'Neuss', slug: 'neuss', lat: 51.2042, lon: 6.6879, plz: [[41460, 41472]], kreis: 'Rhein-Kreis Neuss' },
  { name: 'Wuppertal', slug: 'wuppertal', lat: 51.2562, lon: 7.1508, plz: [[42103, 42399]], kreis: 'kreisfreie Stadt' },
  { name: 'Sprockhövel', slug: 'sprockhoevel', lat: 51.3467, lon: 7.2448, plz: [[45549, 45549]], kreis: 'Ennepe-Ruhr-Kreis' },
  { name: 'Witten', slug: 'witten', lat: 51.4437, lon: 7.3353, plz: [[58452, 58456]], kreis: 'Ennepe-Ruhr-Kreis' },
  { name: 'Herdecke', slug: 'herdecke', lat: 51.3997, lon: 7.43, plz: [[58313, 58313]], kreis: 'Ennepe-Ruhr-Kreis' },
  { name: 'Wetter (Ruhr)', slug: 'wetter', lat: 51.3881, lon: 7.395, plz: [[58300, 58300]], kreis: 'Ennepe-Ruhr-Kreis' },
  { name: 'Schwelm', slug: 'schwelm', lat: 51.296, lon: 7.293, plz: [[58332, 58332]], kreis: 'Ennepe-Ruhr-Kreis' },
  { name: 'Gevelsberg', slug: 'gevelsberg', lat: 51.319, lon: 7.338, plz: [[58285, 58285]], kreis: 'Ennepe-Ruhr-Kreis' },
  { name: 'Dortmund', slug: 'dortmund', lat: 51.5136, lon: 7.4653, plz: [[44135, 44388]], kreis: 'kreisfreie Stadt' },
  { name: 'Lünen', slug: 'luenen', lat: 51.616, lon: 7.528, plz: [[44532, 44536]], kreis: 'Kreis Unna' },
];

export const ZENTRUM = { name: 'Essen', lat: 51.4513, lon: 7.0138 };

export const STANDARD_ZONEN = [
  { id: 'A', bisKm: 10, label: 'Zone A – Essen und direkte Umgebung', pauschaleEuro: null },
  { id: 'B', bisKm: 25, label: 'Zone B – Nachbarstädte', pauschaleEuro: null },
  { id: 'C', bisKm: 40, label: 'Zone C – erweitertes Ruhrgebiet', pauschaleEuro: null },
  { id: 'D', bisKm: 50, label: 'Zone D – Randbereich des Einsatzgebiets', pauschaleEuro: null },
];

/** Luftlinie in km (Haversine). */
export function luftlinieKm(a, b) {
  const R = 6371;
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Normalisiert einen Ortsnamen für Vergleiche ("Mülheim a. d. Ruhr" ~ "muelheim an der ruhr"). */
export function normalisiereOrt(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/\ba\.\s*d\.\s*/g, 'an der ')
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function ortZuPlz(plz) {
  const n = Number(String(plz || '').trim());
  if (!Number.isInteger(n) || String(plz).trim().length !== 5) return null;
  return ORTE.find((o) => o.plz.some(([von, bis]) => n >= von && n <= bis)) || null;
}

export function ortZuName(name) {
  const n = normalisiereOrt(name);
  if (!n) return null;
  return ORTE.find((o) => {
    const on = normalisiereOrt(o.name);
    return on === n || n.startsWith(on + ' ') || on.startsWith(n + ' ') || o.slug.replace(/-/g, ' ') === n;
  }) || null;
}

export function zoneFuerKm(km, zonen = STANDARD_ZONEN) {
  return zonen.find((z) => km <= z.bisKm) || null;
}

/**
 * Prüft eine Einsatzadresse (PLZ + Ort) gegen das Einsatzgebiet.
 * Ergebnis-Status:
 *  - "im-gebiet"       : bekannter Ort, innerhalb Radius
 *  - "ausserhalb"      : bekannter Ort, außerhalb Radius (Anfrage trotzdem möglich)
 *  - "manuell-pruefen" : PLZ/Ort nicht in der hinterlegten Liste
 *  - "ungueltig"       : PLZ formal ungültig
 */
export function pruefeEinsatzgebiet({ plz, ort }, optionen = {}) {
  const zentrum = optionen.zentrum || ZENTRUM;
  const radiusKm = optionen.radiusKm ?? 50;
  const faktor = optionen.strassenFaktor ?? 1.3;
  const kmh = optionen.durchschnittKmh ?? 38;
  const zonen = optionen.zonen || STANDARD_ZONEN;
  const hinweise = [];

  if (!/^\d{5}$/.test(String(plz || '').trim())) {
    return { status: 'ungueltig', hinweise: ['Bitte eine fünfstellige Postleitzahl angeben.'] };
  }
  const nachPlz = ortZuPlz(plz);
  const nachName = ortZuName(ort);
  if (nachPlz && nachName && nachPlz.slug !== nachName.slug) {
    hinweise.push(`PLZ ${plz} gehört nach unserer Liste zu ${nachPlz.name}, angegeben ist „${ort}“. Bitte prüfen Sie die Angaben.`);
  }
  const treffer = nachPlz || nachName;
  if (!treffer) {
    return {
      status: 'manuell-pruefen',
      hinweise: ['Diesen Ort haben wir nicht automatisch zugeordnet. Wir prüfen das Einsatzgebiet persönlich und melden uns.'],
    };
  }
  const luftlinie = luftlinieKm(zentrum, treffer);
  const strasseKm = Math.round(luftlinie * faktor);
  const fahrzeitMin = Math.round((strasseKm / kmh) * 60 + 5);
  const zone = zoneFuerKm(luftlinie, zonen);
  const imGebiet = luftlinie <= radiusKm;
  return {
    status: imGebiet ? 'im-gebiet' : 'ausserhalb',
    ort: treffer.name,
    ortSlug: treffer.slug,
    luftlinieKm: Math.round(luftlinie * 10) / 10,
    strasseKmGeschaetzt: strasseKm,
    fahrzeitMinGeschaetzt: fahrzeitMin,
    zone: imGebiet && zone ? zone.id : null,
    zoneLabel: imGebiet && zone ? zone.label : 'außerhalb des regulären Einsatzgebiets',
    pauschaleEuro: imGebiet && zone ? zone.pauschaleEuro : null,
    hinweise: imGebiet
      ? hinweise
      : [...hinweise, 'Die Adresse liegt außerhalb unseres regulären Einsatzradius. Größere Aufträge prüfen wir gerne individuell.'],
  };
}

// ---------------------------------------------------------------------------
// Feiertage NRW und Terminvorschläge
// ---------------------------------------------------------------------------

/** Ostersonntag nach dem Gaußschen Algorithmus (anonymer gregorianischer Algorithmus). */
export function ostersonntag(jahr) {
  const a = jahr % 19, b = Math.floor(jahr / 100), c = jahr % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monat = Math.floor((h + l - 7 * m + 114) / 31);
  const tag = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(jahr, monat - 1, tag));
}

const isoTag = (d) => d.toISOString().slice(0, 10);
const plusTage = (d, n) => new Date(d.getTime() + n * 86400000);

/** Gesetzliche Feiertage in Nordrhein-Westfalen als Set von "YYYY-MM-DD". */
export function feiertageNRW(jahr) {
  const o = ostersonntag(jahr);
  const fix = (m, t) => isoTag(new Date(Date.UTC(jahr, m - 1, t)));
  return new Set([
    fix(1, 1), isoTag(plusTage(o, -2)), isoTag(plusTage(o, 1)), fix(5, 1),
    isoTag(plusTage(o, 39)), isoTag(plusTage(o, 50)), isoTag(plusTage(o, 60)),
    fix(10, 3), fix(11, 1), fix(12, 25), fix(12, 26),
  ]);
}

export function istWerktag(datum) {
  const tag = datum.getUTCDay();
  if (tag === 0 || tag === 6) return false;
  return !feiertageNRW(datum.getUTCFullYear()).has(isoTag(datum));
}

/**
 * Erzeugt vorläufige Terminvorschläge (Mo–Fr, ohne NRW-Feiertage).
 * Die echte Verfügbarkeit wird erst nach dem Absenden mit dem Werkora-Kalender
 * abgeglichen (Schnittstelle GEPLANT, siehe docs/05-werkora-datenmodell-schnittstellen.md).
 */
export function terminvorschlaege({ heute = new Date(), vorlaufWerktage = 2, horizontTage = 28, slotZeiten = ['08:00', '10:30', '13:30'] } = {}) {
  let d = new Date(Date.UTC(heute.getUTCFullYear(), heute.getUTCMonth(), heute.getUTCDate()));
  let vorlauf = 0;
  while (vorlauf < vorlaufWerktage) { d = plusTage(d, 1); if (istWerktag(d)) vorlauf++; }
  const ende = plusTage(new Date(Date.UTC(heute.getUTCFullYear(), heute.getUTCMonth(), heute.getUTCDate())), horizontTage);
  const tage = [];
  for (; d <= ende; d = plusTage(d, 1)) {
    if (istWerktag(d)) tage.push({ datum: isoTag(d), slots: [...slotZeiten] });
  }
  return tage;
}

// ---------------------------------------------------------------------------
// Validierung und Dublettenschlüssel
// ---------------------------------------------------------------------------

export function normalisiereTelefon(tel) {
  let t = String(tel || '').replace(/[^\d+]/g, '');
  if (t.startsWith('00')) t = '+' + t.slice(2);
  if (t.startsWith('0')) t = '+49' + t.slice(1);
  if (!t.startsWith('+') && t.length > 0) t = '+' + t;
  return t;
}

export function normalisiereEmail(mail) {
  return String(mail || '').trim().toLowerCase();
}

export function normalisiereStrasse(strasse) {
  return normalisiereOrt(strasse)
    .replace(/\bstrasse\b|\bstr\b/g, 'str')
    .replace(/(\w)strasse\b/g, '$1str')
    .replace(/\s+/g, '');
}

export function validiereKontakt(d) {
  const fehler = {};
  if (!String(d.vorname || '').trim()) fehler.vorname = 'Bitte den Vornamen angeben.';
  if (!String(d.nachname || '').trim()) fehler.nachname = 'Bitte den Nachnamen angeben.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalisiereEmail(d.email))) fehler.email = 'Bitte eine gültige E-Mail-Adresse angeben.';
  const tel = normalisiereTelefon(d.telefon);
  if (!/^\+\d{8,15}$/.test(tel)) fehler.telefon = 'Bitte eine gültige Telefonnummer angeben.';
  return fehler;
}

export function validiereAdresse(a) {
  const fehler = {};
  if (String(a.strasse || '').trim().length < 3) fehler.strasse = 'Bitte Straße angeben.';
  if (!/^\d+\s*[a-zA-Z]?([-/]\s*\d+\s*[a-zA-Z]?)?$/.test(String(a.hausnummer || '').trim())) fehler.hausnummer = 'Bitte eine gültige Hausnummer angeben (z. B. 12 oder 12a).';
  if (!/^\d{5}$/.test(String(a.plz || '').trim())) fehler.plz = 'Bitte eine fünfstellige PLZ angeben.';
  if (String(a.ort || '').trim().length < 2) fehler.ort = 'Bitte den Ort angeben.';
  return fehler;
}

/**
 * Dublettenschlüssel: identische Personen/Adressen erzeugen identische
 * Schlüssel, unabhängig von Groß-/Kleinschreibung, Leerzeichen und
 * Telefonformat. Werkora prüft serverseitig gegen bestehende Kunden
 * (E-Mail ODER Telefon) und Objekte (Adressschlüssel).
 */
export function dublettenMerkmale({ email, telefon, adresse }) {
  return {
    email: normalisiereEmail(email),
    telefon: normalisiereTelefon(telefon),
    adresse: adresse ? `${String(adresse.plz || '').trim()}|${normalisiereStrasse(adresse.strasse)}|${String(adresse.hausnummer || '').toLowerCase().replace(/\s+/g, '')}` : '',
  };
}

export async function sha256Hex(text) {
  const daten = new TextEncoder().encode(text);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', daten);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function dublettenSchluessel(eingabe) {
  const m = dublettenMerkmale(eingabe);
  return {
    person: await sha256Hex(`${m.email}|${m.telefon}`),
    email: m.email ? await sha256Hex(m.email) : null,
    telefon: m.telefon ? await sha256Hex(m.telefon) : null,
    adresse: m.adresse ? await sha256Hex(m.adresse) : null,
  };
}
