// Parst DATANORM-Preislisten (Format 4/5, semikolon-getrennte "A"-Sätze),
// wie sie Elektro-/Baustoff-Großhändler (Sonepar, Rexel, ...) für ihren
// Artikelstamm bereitstellen. Deckt den in der Praxis üblichen Aufbau der
// Artikelsätze ab; einzelne Großhändler weichen in Detailfeldern ab, daher
// werden nicht auswertbare Zeilen übersprungen statt den ganzen Import
// abzubrechen - die Vorschau vor dem Import zeigt betroffene Zeilen an.

const ME_MAP = {
  stk: 'Stk.', st: 'Stk.', stck: 'Stk.', pce: 'Stk.',
  m: 'm', ltm: 'm', lfm: 'm',
  m2: 'm²', qm: 'm²',
  m3: 'm³', cbm: 'm³',
  kg: 'kg', t: 't', ltr: 'ltr', l: 'ltr',
  std: 'Std.', h: 'Std.', tag: 'Tag',
  pak: 'Paket', pk: 'Paket', sat: 'Satz', rl: 'Rolle', rol: 'Rolle',
};

function mapEinheit(code) {
  return ME_MAP[(code || '').trim().toLowerCase()] || (code || 'Stk.').trim();
}

/**
 * DATANORM-Preise stehen je nach Exporteinstellung entweder mit Komma/Punkt
 * als Dezimaltrennzeichen oder - klassisch - als Ganzzahl mit fest zwei
 * impliziten Nachkommastellen da (Cent-Konvention, z.B. "12500" für 125,00 €
 * und "895" für 8,95 €) - unabhängig von der Ziffernanzahl.
 */
function parsePreis(raw) {
  const s = (raw || '').trim();
  if (!s) return 0;
  if (/[.,]/.test(s)) {
    const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
    const n = Number(normalized);
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n / 100 : 0;
}

export function parseDatanorm(text, { standardSteuersatz = 19 } = {}) {
  const rows = [];
  const errors = [];
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const satzart = line.slice(0, 1).toUpperCase();
    if (satzart !== 'A') continue;
    const cols = line.split(';').map((c) => c.trim());
    // A;Artikelnummer;Matchcode;Kurztext1;Kurztext2;Preis;Preiseinheit;Rabattgruppe;Einheit;Warengruppe;...
    const [, artikelnummer, , kurztext1, kurztext2, preisRaw, , , einheitRaw] = cols;
    const bezeichnung = [kurztext1, kurztext2].filter(Boolean).join(' ').trim();
    if (!bezeichnung || !artikelnummer) { errors.push(line); continue; }
    rows.push({
      id: undefined,
      typ: 'artikel',
      bezeichnung,
      beschreibung: `Lieferanten-Art.-Nr.: ${artikelnummer}`,
      einheit: mapEinheit(einheitRaw),
      preis: parsePreis(preisRaw),
      steuersatz: standardSteuersatz,
      lieferantenArtikelnummer: artikelnummer,
    });
  }
  return { rows, errors };
}

/** Liest eine DATANORM-Datei robust als Latin-1 ein (klassische Kodierung des Formats). */
export async function readDatanormFile(file) {
  const buf = await file.arrayBuffer();
  return new TextDecoder('iso-8859-1').decode(buf);
}
