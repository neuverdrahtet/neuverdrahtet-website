// Kontoauszug-Import: liest eine von der Bank exportierte CSV-Datei ein.
// Bank-CSV-Formate unterscheiden sich stark (Sparkasse/DKB/comdirect/N26 ...),
// daher kein Rate-Raten einzelner Bankformate, sondern ein echter, für
// Anführungszeichen sicherer CSV-Parser (Verwendungszwecke enthalten oft
// eingebettete Kommas/Semikolons) plus eine Spalten-Zuordnung, die der
// Nutzer einmalig einstellt (siehe views/buchhaltung.js).

/** Errät das wahrscheinlichste Trennzeichen aus der Kopfzeile (häufigstes von ; , Tab). */
export function erkenneDelimiter(erstZeile) {
  const kandidaten = [';', ',', '\t'];
  let best = ';';
  let bestCount = -1;
  for (const d of kandidaten) {
    const count = (erstZeile.match(new RegExp(d === '\t' ? '\\t' : '\\' + d, 'g')) || []).length;
    if (count > bestCount) { bestCount = count; best = d; }
  }
  return best;
}

/** Anführungszeichen-fester CSV-Parser (RFC4180-artig: "" als escaped Quote). */
export function parseCsv(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const normalisiert = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < normalisiert.length; i++) {
    const c = normalisiert[i];
    if (inQuotes) {
      if (c === '"') {
        if (normalisiert[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field.trim());
      field = '';
    } else if (c === '\n') {
      row.push(field.trim());
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field.trim());
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ''));
}

/** Deutsches Zahlenformat ("1.234,56" / "-12,50" / "(12,50)") in eine Zahl umwandeln. */
export function parseGermanNumber(str) {
  if (str == null) return 0;
  let s = String(str).trim();
  if (!s) return 0;
  const negativ = /^-/.test(s) || /^\(.*\)$/.test(s);
  s = s.replace(/^[+\-]/, '').replace(/[()]/g, '').trim();
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  const n = Number(s);
  if (Number.isNaN(n)) return 0;
  return negativ ? -n : n;
}

/** Deutsches Datumsformat (TT.MM.JJJJ) oder bereits-ISO (JJJJ-MM-TT) in ISO-Datum umwandeln. */
export function parseGermanDatum(str) {
  const s = String(str || '').trim();
  const dmj = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (dmj) {
    let [, d, m, y] = dmj;
    if (y.length === 2) y = (Number(y) > 50 ? '19' : '20') + y;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  return '';
}

/** Dedup-Schlüssel für eine importierte Buchung (verhindert Duplikate bei überlappenden Re-Importen). */
export function bankbuchungSchluessel({ datum, betrag, verwendungszweck }) {
  return `${datum}|${Number(betrag).toFixed(2)}|${(verwendungszweck || '').trim().toLowerCase()}`;
}

/** Wandelt geparste CSV-Zeilen (per Spalten-Mapping) in Bankbuchungs-Objekte um. */
export function zeilenZuBuchungen(rows, header, mapping) {
  const idxDatum = header.indexOf(mapping.datum);
  const idxBetrag = header.indexOf(mapping.betrag);
  const idxVerwendungszweck = mapping.verwendungszweck ? header.indexOf(mapping.verwendungszweck) : -1;
  const idxEmpfaenger = mapping.empfaenger ? header.indexOf(mapping.empfaenger) : -1;
  const buchungen = [];
  for (const row of rows) {
    const datum = parseGermanDatum(row[idxDatum]);
    const betrag = parseGermanNumber(row[idxBetrag]);
    if (!datum || !betrag) continue;
    buchungen.push({
      datum,
      betrag: Math.round(betrag * 100) / 100,
      verwendungszweck: idxVerwendungszweck >= 0 ? (row[idxVerwendungszweck] || '') : '',
      empfaenger: idxEmpfaenger >= 0 ? (row[idxEmpfaenger] || '') : '',
    });
  }
  return buchungen;
}
