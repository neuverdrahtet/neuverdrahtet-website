import { getAll, put, getSettings } from './db.js';
import { uid, escapeHtml, formatDate, toast } from './utils.js';
import { openModal } from './ui.js';
import { saveDokument } from './dokumente.js';
import { readZipEntries } from './zipreader.js';
import { FIREBASE_ENABLED, uploadBlobToStorage } from './blobstore.js';

const LIEFERANT_KATEGORIE_MAP = [
  { match: /hornbach|baumarkt|obi\b|bauhaus/i, kategorie: 'Material' },
  { match: /sammellieferant|elektro.?gro[ßs]handel|sonepar|rexel/i, kategorie: 'Material' },
  { match: /werkzeug/i, kategorie: 'Werkzeug/Maschinen' },
  { match: /esso|aral|shell|tankstelle|tanken/i, kategorie: 'Fahrzeug/Sprit' },
  { match: /haufe|lexware|software|abo\b/i, kategorie: 'Büro/Verwaltung' },
  { match: /aok|barmer|techniker|tk\b|dak|ikk|knappschaft|krankenkasse|berufsgenossenschaft/i, kategorie: 'Personal' },
  { match: /versicherung/i, kategorie: 'Versicherung' },
  { match: /miete|vermietung/i, kategorie: 'Miete' },
];

function guessAusgabenKategorie(lieferant) {
  const hit = LIEFERANT_KATEGORIE_MAP.find((m) => m.match.test(lieferant));
  return hit ? hit.kategorie : 'Sonstiges';
}

/** Parst Dateinamen im lexoffice-BelegExport-Format: {datum}_{Ausgabe|Einnahme}_{belegnummer}_{lieferant/kunde}[_N].pdf */
export function parseBelegFilename(filename) {
  const base = filename.replace(/\.pdf$/i, '');
  const parts = base.split('_');
  if (parts.length < 4) return null;
  const [datum, typRaw] = parts;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) return null;
  if (!/^(ausgabe|einnahme)$/i.test(typRaw)) return null;
  let belegnummer, name;
  if (parts.length >= 5 && /^\d+$/.test(parts[parts.length - 1])) {
    belegnummer = parts[2];
    name = parts.slice(3, parts.length - 1).join('_');
  } else {
    belegnummer = parts[2];
    name = parts.slice(3).join('_');
  }
  return { datum, typ: typRaw.toLowerCase(), belegnummer, name: name.trim() };
}

function normalizeName(s) {
  return (s || '').toLowerCase().replace(/[^a-zäöüß0-9]/g, '');
}

/** Findet einen bestehenden Kunden per Name; berücksichtigt "Nachname-Vorname"-Dateinamen. */
export function findMatchingKunde(kunden, rawName) {
  const spaced = rawName.replace(/-/g, ' ').trim();
  const parts = spaced.split(/\s+/).filter(Boolean);
  const variants = new Set([spaced]);
  if (parts.length === 2) variants.add(`${parts[1]} ${parts[0]}`);
  const normVariants = Array.from(variants).map(normalizeName);
  return kunden.find((k) => {
    const firmaN = normalizeName(k.firma);
    const apN = normalizeName(k.ansprechpartner);
    return normVariants.includes(firmaN) || (apN && normVariants.includes(apN));
  }) || null;
}

export function openBelegImport({ onImported } = {}) {
  const { body, close } = openModal({
    title: 'Belege importieren (ZIP)',
    wide: true,
    bodyHtml: `
      <p class="hint">Importiert einen Belege-Export (z.B. aus lexoffice) im ZIP-Format. Dateien vom Typ "Ausgabe" werden als Ausgaben-Einträge angelegt (Kategorie wird anhand des Lieferanten geschätzt, Betrag muss danach geprüft/eingetragen werden – aus dem PDF selbst wird der Betrag nicht automatisch ausgelesen). Dateien vom Typ "Einnahme" (eigene Rechnungen) werden dem passenden Kunden als Dokument zugeordnet, sofern ein Kunde mit passendem Namen existiert.</p>
      <div class="field" style="margin-bottom:10px">
        <label>ZIP-Datei</label>
        <input type="file" id="beleg-zip-input" accept=".zip,application/zip">
      </div>
      <div id="beleg-import-result"></div>
      <div class="modal-actions">
        <span class="spacer"></span>
        <button type="button" class="btn" id="btn-cancel">Schließen</button>
        <button type="button" class="btn btn-primary" id="btn-do-beleg-import" disabled>Importieren</button>
      </div>
    `,
  });
  body.querySelector('#btn-cancel').addEventListener('click', close);
  const fileInput = body.querySelector('#beleg-zip-input');
  const importBtn = body.querySelector('#btn-do-beleg-import');
  const resultHost = body.querySelector('#beleg-import-result');
  let selectedFile = null;

  fileInput.addEventListener('change', (e) => {
    selectedFile = e.target.files[0] || null;
    importBtn.disabled = !selectedFile;
    resultHost.innerHTML = '';
  });

  importBtn.addEventListener('click', async () => {
    if (!selectedFile) return;
    importBtn.disabled = true;
    importBtn.textContent = 'Importiere ...';
    resultHost.innerHTML = '';
    try {
      const [kunden, settings, entries] = await Promise.all([getAll('kunden'), getSettings(), readZipEntries(selectedFile)]);
      const pdfEntries = entries.filter((e) => /\.pdf$/i.test(e.name));

      let ausgabenCount = 0;
      let zugeordnetCount = 0;
      const unzugeordnet = [];
      let uebersprungen = 0;

      for (const entry of pdfEntries) {
        const parsed = parseBelegFilename(entry.name);
        if (!parsed) { uebersprungen++; continue; }
        const blob = await entry.getBlob('application/pdf');

        if (parsed.typ === 'ausgabe') {
          const kategorie = guessAusgabenKategorie(parsed.name);
          const ausgabeId = uid();
          const ausgabe = {
            id: ausgabeId, datum: parsed.datum, kategorie,
            beschreibung: `Beleg ${parsed.belegnummer} – Betrag bitte prüfen (aus Import, nicht automatisch erkannt)`,
            lieferant: parsed.name, betragNetto: 0, steuersatz: settings.standardSteuersatz ?? 19, betragBrutto: 0,
            bezahltMit: 'überweisung', beleg: FIREBASE_ENABLED ? await uploadBlobToStorage(`ausgaben/${ausgabeId}`, blob) : blob,
            projektId: '', kalkKategorie: '',
          };
          await put('ausgaben', ausgabe);
          ausgabenCount++;
        } else {
          const kunde = findMatchingKunde(kunden, parsed.name);
          if (kunde) {
            await saveDokument({
              bezugTyp: 'kunde', bezugId: kunde.id, kategorie: 'rechnung',
              name: `Rechnung ${parsed.belegnummer} - ${formatDate(parsed.datum)}.pdf`,
              mime: 'application/pdf', blob,
            });
            zugeordnetCount++;
          } else {
            unzugeordnet.push(`${parsed.name} (${entry.name})`);
          }
        }
      }

      resultHost.innerHTML = `
        <div class="card">
          <p>✅ ${ausgabenCount} Ausgabe(n) importiert (Beleg angehängt, <strong>Betrag bitte prüfen</strong>)</p>
          <p>✅ ${zugeordnetCount} Rechnung(en) passenden Kunden zugeordnet</p>
          ${unzugeordnet.length ? `<p>⚠️ ${unzugeordnet.length} Rechnung(en) ohne passenden Kunden gefunden:</p><ul class="cal-event-list">${unzugeordnet.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>` : ''}
          ${uebersprungen ? `<p class="text-mute">${uebersprungen} Datei(en) mit unbekanntem Format übersprungen.</p>` : ''}
        </div>
      `;
      toast('Belege-Import abgeschlossen', 'success');
      if (onImported) onImported();
    } catch (err) {
      resultHost.innerHTML = `<p class="text-mute">Fehler: ${escapeHtml(err.message)}</p>`;
      toast(err.message, 'danger');
    }
    importBtn.disabled = false;
    importBtn.textContent = 'Importieren';
  });
}
