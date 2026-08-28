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

// SKR03/04-Kontonummern (grobe Erstziffern) -> Werkora-Kategorie, für den
// DATEV/Lexware-"Belege Online"-XML-Export (siehe parseDatevLedgerXml unten).
// Kontonummer ist zuverlässiger als der Lieferantenname, deshalb hier Priorität.
const KONTO_KATEGORIE_MAP = [
  { match: /^30\d\d$/, kategorie: 'Material' },
  { match: /^4210$/, kategorie: 'Miete' },
  { match: /^4230$/, kategorie: 'Miete' },
  { match: /^4250$/, kategorie: 'Miete' },
  { match: /^4530$/, kategorie: 'Fahrzeug/Sprit' },
  { match: /^460\d$/, kategorie: 'Werbung/Marketing' },
  { match: /^480[56]$/, kategorie: 'Büro/Verwaltung' },
  { match: /^492\d$/, kategorie: 'Büro/Verwaltung' },
  { match: /^497\d$/, kategorie: 'Büro/Verwaltung' },
  { match: /^4980$/, kategorie: 'Werkzeug/Maschinen' },
  { match: /^4900$/, kategorie: 'Sonstiges' },
  { match: /^62\d\d$/, kategorie: 'Personal' },
  { match: /^436\d$/, kategorie: 'Versicherung' },
];

function guessKategorieAusKonto(accountNo, lieferant) {
  const hit = KONTO_KATEGORIE_MAP.find((m) => m.match.test(String(accountNo || '')));
  return hit ? hit.kategorie : guessAusgabenKategorie(lieferant);
}

/**
 * Parst eine einzelne DATEV/Lexware-"Belege Online"-XML-Datei (LedgerImport,
 * Format-Version 5.0). Enthält je Beleg Datum/Betrag/Konto/Lieferant direkt
 * als Klartext-Felder - zuverlässiger als der Dateiname. Gibt null zurück,
 * wenn es kein accountsPayableLedger-Eintrag (Kreditoren-/Ausgabenbeleg) ist
 * (z.B. Erlös-/Einnahmenbelege werden hier bewusst nicht verarbeitet).
 */
export function parseDatevLedgerXml(xmlText) {
  if (!/<LedgerImport[\s>]/.test(xmlText)) return null;
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) return null;
  const payable = doc.querySelector('accountsPayableLedger');
  const receivable = doc.querySelector('accountsReceivableLedger');
  const ledger = payable || receivable;
  if (!ledger) return null;
  const get = (tag) => ledger.querySelector(tag)?.textContent?.trim() || '';
  return {
    typ: payable ? 'ausgabe' : 'einnahme',
    datum: get('date'), betrag: Number(get('amount')) || 0, steuersatz: Number(get('tax')) || 0,
    accountNo: get('accountNo'), accountName: get('accountName'),
    gegenpartei: payable ? get('supplierName') : get('customerName'),
    beschreibung: get('bookingText') || get('information'), belegnummer: get('invoiceId'),
  };
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
      <p class="hint">Importiert einen Belege-Export im ZIP-Format - erkennt automatisch zwei Formate: lexoffice-Export (PDF-Dateinamen wie "2025-01-01_Ausgabe_123_Lieferant.pdf"; Betrag muss danach geprüft/eingetragen werden) und DATEV/Lexware "Belege Online" (XML+PDF je Beleg; Datum/Betrag/Kategorie werden direkt aus dem XML übernommen). Belege vom Typ "Einnahme" (eigene Rechnungen, bei beiden Formaten) werden - sofern ein PDF dabei ist - dem passenden Kunden als Dokument zugeordnet, sofern ein Kunde mit passendem Namen existiert. Bereits vorhandene Ausgaben mit gleichem Datum/Betrag/Lieferant werden übersprungen (keine Duplikate).</p>
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
      const [kunden, ausgabenBestehend, settings, entries] = await Promise.all([
        getAll('kunden'), getAll('ausgaben'), getSettings(), readZipEntries(selectedFile),
      ]);
      const dupKey = (datum, betrag, lieferant) => `${datum}|${Number(betrag).toFixed(2)}|${(lieferant || '').trim().toLowerCase()}`;
      const bestehendeSchluessel = new Set(ausgabenBestehend.map((a) => dupKey(a.datum, a.betragBrutto, a.lieferant)));

      const xmlEntriesByBasename = new Map();
      for (const e of entries) {
        if (/\.xml$/i.test(e.name) && !/(^|\/)document\.xml$/i.test(e.name)) {
          xmlEntriesByBasename.set(e.name.replace(/\.xml$/i, ''), e);
        }
      }
      const pdfEntriesByBasename = new Map();
      for (const e of entries) {
        if (/\.pdf$/i.test(e.name)) pdfEntriesByBasename.set(e.name.replace(/\.pdf$/i, ''), e);
      }

      let ausgabenCount = 0;
      let zugeordnetCount = 0;
      let duplikateUebersprungen = 0;
      const unzugeordnet = [];
      let uebersprungen = 0;

      // --- Format 1: DATEV/Lexware "Belege Online" (XML je Beleg, PDF optional) ---
      for (const [basename, xmlEntry] of xmlEntriesByBasename) {
        const xmlText = await (await xmlEntry.getBlob('application/xml')).text();
        const parsed = parseDatevLedgerXml(xmlText);
        if (!parsed || !parsed.datum || !parsed.betrag) continue;
        const pdfEntry = pdfEntriesByBasename.get(basename);

        if (parsed.typ === 'einnahme') {
          // Einnahmen-Beleg (Kundenrechnung): keine Ausgabe, sondern - falls ein
          // PDF dabei ist und ein passender Kunde gefunden wird - als Dokument
          // in der Kundenakte ablegen. Ohne PDF gibt es nichts abzulegen.
          if (!pdfEntry) continue;
          const kunde = findMatchingKunde(kunden, parsed.gegenpartei);
          if (!kunde) { unzugeordnet.push(`${parsed.gegenpartei} (${basename}.pdf)`); continue; }
          const blob = await pdfEntry.getBlob('application/pdf');
          await saveDokument({
            bezugTyp: 'kunde', bezugId: kunde.id, kategorie: 'rechnung',
            name: `Rechnung ${parsed.belegnummer || basename} - ${formatDate(parsed.datum)}.pdf`,
            mime: 'application/pdf', blob,
          });
          zugeordnetCount++;
          continue;
        }

        if (bestehendeSchluessel.has(dupKey(parsed.datum, parsed.betrag, parsed.gegenpartei))) {
          duplikateUebersprungen++;
          continue;
        }
        const blob = pdfEntry ? await pdfEntry.getBlob('application/pdf') : null;
        const ausgabeId = uid();
        const betragNetto = parsed.steuersatz ? Math.round((parsed.betrag / (1 + parsed.steuersatz / 100)) * 100) / 100 : parsed.betrag;
        const ausgabe = {
          id: ausgabeId, datum: parsed.datum, kategorie: guessKategorieAusKonto(parsed.accountNo, parsed.gegenpartei),
          beschreibung: parsed.beschreibung || `Beleg ${parsed.belegnummer}`,
          lieferant: parsed.gegenpartei, betragNetto, steuersatz: parsed.steuersatz || (settings.standardSteuersatz ?? 19),
          betragBrutto: parsed.betrag, bezahltMit: 'überweisung',
          beleg: blob ? (FIREBASE_ENABLED ? await uploadBlobToStorage(`ausgaben/${ausgabeId}`, blob) : blob) : null,
          projektId: '', kundeId: '', kalkKategorie: '', bezahlstatus: '', faelligAm: '', bezahltAm: parsed.datum, istInvestition: false,
        };
        await put('ausgaben', ausgabe);
        bestehendeSchluessel.add(dupKey(ausgabe.datum, ausgabe.betragBrutto, ausgabe.lieferant));
        ausgabenCount++;
      }

      // --- Format 2: lexoffice-Export (PDF-Dateiname kodiert Datum/Typ/Lieferant) ---
      const pdfEntries = entries.filter((e) => /\.pdf$/i.test(e.name) && !xmlEntriesByBasename.has(e.name.replace(/\.pdf$/i, '')));

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
          <p>✅ ${ausgabenCount} Ausgabe(n) importiert</p>
          <p>✅ ${zugeordnetCount} Rechnung(en) passenden Kunden zugeordnet</p>
          ${duplikateUebersprungen ? `<p class="text-mute">${duplikateUebersprungen} Beleg(e) übersprungen (Datum/Betrag/Lieferant stimmt mit bereits vorhandener Ausgabe überein).</p>` : ''}
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
