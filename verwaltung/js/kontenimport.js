// Import eines lexoffice-"Kontenexports" (CSV je Zeitraum, eine Zeile pro
// Buchungszeile auf einem Konto - ein realer Vorgang taucht deshalb auf
// mehreren Konten je einmal auf, siehe erkenneVorgaenge()). Anders als der
// Belege-Import (siehe belegimport.js, liest einzelne Beleg-Dateien) wird
// hier das komplette bisherige Journal aus lexoffice ausgewertet und daraus
// echte Rechnungen/Ausgaben inkl. Verbuchung rekonstruiert.
import { getAll, put, getSettings } from './db.js';
import { uid, escapeHtml, formatCurrency, formatDate, toast, readTextAutoEncoding, farbeAusText, addDays } from './utils.js';
import { openModal } from './ui.js';
import { readZipEntries } from './zipreader.js';
import { parseCsv, erkenneDelimiter, parseGermanNumber, parseGermanDatum } from './bankimport.js';
import { findMatchingKunde, guessAusgabenKategorie } from './belegimport.js';
import * as journal from './journal.js';

const KUNDEN_FARBEN = ['#6b7280', '#2b7fd6', '#1f8a4c', '#f0a020', '#8e44ad', '#c0392b', '#14b8a6', '#e91e8c'];

// Lohn/Personal-Konten fließen nicht in Ausgaben, sondern brauchen eigene
// Lohnbuchungen (mehrzeilig, keine einzelne Gegenpartei) - hier bewusst nicht
// automatisch übernommen.
const LOHN_KONTEN = new Set(['4120', '4130', '1740', '1741', '1742', '1755']);
// Privatentnahmen/Spenden sind keine Betriebsausgaben.
const PRIVAT_KONTEN = new Set(['1800', '1840']);
const ERLOES_KONTEN = new Set(['8200', '8320', '8400']);
// 27/320/420/490 sehen wie Anlagevermögen-Kontonummern aus (SKR03), werden in
// der Praxis aber oft für sofort abgeschriebene Kleinbeträge (Software-Abos,
// Werkzeug, Reinigung) genutzt - hier wie normale Ausgaben behandelt.
function istAufwandKonto(k) {
  return (/^[34]/.test(k) && !LOHN_KONTEN.has(k)) || ['27', '320', '420', '490'].includes(k);
}

export function parseKontenCsv(text) {
  const erstZeile = text.split(/\r?\n/)[0] || '';
  const delimiter = erkenneDelimiter(erstZeile);
  const rows = parseCsv(text, delimiter);
  if (rows.length < 2) return [];
  const header = rows[0];
  const idx = (name) => header.indexOf(name);
  const iKonto = idx('Konto'); const iBez = idx('Kontobezeichnung'); const iDatum = idx('Datum');
  const iBeleg = idx('Belegnummer'); const iText = idx('Text'); const iGegen = idx('Gegenkonto');
  const iSoll = idx('Soll'); const iHaben = idx('Haben'); const iSteuer = idx('Steuer');
  if (iKonto < 0 || iDatum < 0 || iSoll < 0 || iHaben < 0) return null;
  return rows.slice(1).map((r) => ({
    konto: r[iKonto] || '', kontobezeichnung: r[iBez] || '', datum: parseGermanDatum(r[iDatum]),
    belegnummer: (r[iBeleg] || '').trim(), text: r[iText] || '', gegenkonto: r[iGegen] || '',
    soll: parseGermanNumber(r[iSoll]), haben: parseGermanNumber(r[iHaben]), steuer: parseGermanNumber(r[iSteuer]),
  })).filter((r) => r.konto && r.datum);
}

function nettoHaben(rows) { return Math.round(rows.reduce((s, r) => s + r.haben - r.soll, 0) * 100) / 100; }
function nettoSoll(rows) { return Math.round(rows.reduce((s, r) => s + r.soll - r.haben, 0) * 100) / 100; }

/**
 * Gruppiert alle Zeilen (über mehrere CSV-Dateien/Zeiträume hinweg - eine
 * Korrekturbuchung kann eine Belegnummer aus dem Vorjahr erneut aufgreifen)
 * zu realen Vorgängen und rekonstruiert daraus Einnahmen/Ausgaben. Ein Netto
 * von 0 je Konto (z.B. Neubuchung + Storno gleichen sich aus) bedeutet: der
 * Vorgang wurde in lexoffice selbst wieder rückgängig gemacht und wird hier
 * übersprungen, statt als leere/falsche Buchung angelegt zu werden.
 */
export function analysiereKontenexport(alleRows) {
  const kontoMap = new Map();
  for (const r of alleRows) if (!kontoMap.has(r.konto)) kontoMap.set(r.konto, r.kontobezeichnung);

  const gruppen = new Map();
  for (const r of alleRows) {
    const key = r.belegnummer ? `B:${r.belegnummer}` : `DT:${r.datum}|${r.text}`;
    if (!gruppen.has(key)) gruppen.set(key, []);
    gruppen.get(key).push(r);
  }

  const einnahmen = [];
  const ausgaben = [];
  const uebersprungen = [];
  let stornoCount = 0;

  for (const [key, rows] of gruppen) {
    const konten = rows.map((r) => r.konto);
    const belegnummer = key.startsWith('B:') ? key.slice(2) : '';
    if (konten.some((k) => LOHN_KONTEN.has(k))) {
      uebersprungen.push({ key, belegnummer, grund: 'Lohn/Personal', datum: rows[0].datum, text: rows[0].text });
      continue;
    }
    if (konten.some((k) => PRIVAT_KONTEN.has(k))) {
      uebersprungen.push({ key, belegnummer, grund: 'Privatentnahme/Spende', datum: rows[0].datum, text: rows[0].text });
      continue;
    }
    if (konten.some((k) => ERLOES_KONTEN.has(k))) {
      const erlosRows = rows.filter((r) => ERLOES_KONTEN.has(r.konto));
      const netto = nettoHaben(erlosRows);
      if (Math.abs(netto) < 0.01) { stornoCount++; continue; }
      const steuersatz = erlosRows[0].steuer || 0;
      const steuer = Math.round(netto * steuersatz) / 100;
      const kunde = kontoMap.get(erlosRows[0].gegenkonto) || erlosRows[0].text;
      const forderungRest = nettoSoll(rows.filter((r) => r.konto === '1400'));
      const zahlung = rows.find((r) => /Zahlungseing/i.test(r.text));
      einnahmen.push({
        key, belegnummer, datum: erlosRows[0].datum, kunde, netto, steuersatz, steuer,
        brutto: Math.round((netto + steuer) * 100) / 100,
        bezahlt: Math.abs(forderungRest) < 0.01, bezahltAm: zahlung?.datum || '',
      });
      continue;
    }
    if (konten.some((k) => istAufwandKonto(k))) {
      const aufwandRows = rows.filter((r) => istAufwandKonto(r.konto));
      const netto = nettoSoll(aufwandRows);
      if (Math.abs(netto) < 0.01) { stornoCount++; continue; }
      const steuersatz = aufwandRows[0].steuer || 0;
      const steuer = Math.round(netto * steuersatz) / 100;
      const lieferant = kontoMap.get(aufwandRows[0].gegenkonto) || aufwandRows[0].text;
      const verbindlichkeitRest = nettoHaben(rows.filter((r) => r.konto === '1600'));
      const zahlung = rows.find((r) => /Zahlungsausg/i.test(r.text));
      ausgaben.push({
        key, belegnummer, datum: aufwandRows[0].datum, lieferant, konto: aufwandRows[0].konto,
        netto, steuersatz, steuer, brutto: Math.round((netto + steuer) * 100) / 100,
        bezahlt: Math.abs(verbindlichkeitRest) < 0.01, bezahltAm: zahlung?.datum || aufwandRows[0].datum,
      });
      continue;
    }
    uebersprungen.push({ key, belegnummer, grund: 'Nicht automatisch zuordenbar (z.B. Darlehen/reine Bilanzbuchung)', datum: rows[0].datum, text: rows[0].text });
  }

  einnahmen.sort((a, b) => a.datum.localeCompare(b.datum));
  ausgaben.sort((a, b) => a.datum.localeCompare(b.datum));
  uebersprungen.sort((a, b) => a.datum.localeCompare(b.datum));
  return { einnahmen, ausgaben, uebersprungen, stornoCount };
}

async function ladeDateiAlsCsvTexte(file) {
  if (/\.zip$/i.test(file.name)) {
    const entries = await readZipEntries(file);
    const csvEntries = entries.filter((e) => /\.csv$/i.test(e.name));
    const texte = [];
    for (const e of csvEntries) texte.push(await (await e.getBlob('text/csv')).text());
    return texte;
  }
  return [await readTextAutoEncoding(file)];
}

export function openKontenImport({ onImported } = {}) {
  const { body, close } = openModal({
    title: 'Kontenexport importieren (lexoffice)',
    wide: true,
    bodyHtml: `
      <p class="hint">Importiert einen kompletten lexoffice-"Kontenexport" (CSV oder ZIP mit CSV, eine Datei pro Zeitraum - mehrere Dateien gleichzeitig auswählbar). Anders als der normale Belege-Import wird hier das komplette bisherige Journal ausgewertet: Einnahmen werden als bezahlte/offene Rechnungen, Ausgaben als Ausgaben-Einträge angelegt und automatisch korrekt verbucht. Lohn-, Privatentnahme- und sonstige reine Bilanzbuchungen (z.B. Darlehen) werden nicht automatisch übernommen und müssen ggf. manuell nachgetragen werden. Vor dem eigentlichen Import siehst du erst eine Zusammenfassung zur Kontrolle.</p>
      <div class="field" style="margin-bottom:10px">
        <label>Kontenexport-Datei(en)</label>
        <input type="file" id="konten-datei-input" accept=".csv,.zip,application/zip,text/csv" multiple>
      </div>
      <div id="konten-import-vorschau"></div>
      <div class="modal-actions">
        <span class="spacer"></span>
        <button type="button" class="btn" id="btn-cancel">Schließen</button>
        <button type="button" class="btn btn-primary" id="btn-konten-import-start" hidden>Jetzt importieren</button>
      </div>
    `,
  });
  body.querySelector('#btn-cancel').addEventListener('click', close);
  const fileInput = body.querySelector('#konten-datei-input');
  const vorschauHost = body.querySelector('#konten-import-vorschau');
  const startBtn = body.querySelector('#btn-konten-import-start');
  let analyse = null;

  fileInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    vorschauHost.innerHTML = '<p class="text-mute">Lese Dateien ...</p>';
    startBtn.hidden = true;
    try {
      let alleRows = [];
      for (const file of files) {
        const texte = await ladeDateiAlsCsvTexte(file);
        for (const text of texte) {
          const rows = parseKontenCsv(text);
          if (rows === null) { throw new Error(`"${file.name}" sieht nicht wie ein lexoffice-Kontenexport aus (erwartete Spalten nicht gefunden).`); }
          alleRows = alleRows.concat(rows);
        }
      }
      analyse = analysiereKontenexport(alleRows);
      const summeEinnahmen = analyse.einnahmen.reduce((s, i) => s + i.brutto, 0);
      const summeAusgaben = analyse.ausgaben.reduce((s, i) => s + i.brutto, 0);
      const bezahltEinnahmen = analyse.einnahmen.filter((i) => i.bezahlt).length;
      const bezahltAusgaben = analyse.ausgaben.filter((i) => i.bezahlt).length;
      vorschauHost.innerHTML = `
        <div class="card">
          <p>✅ <strong>${analyse.einnahmen.length} Einnahme(n)</strong> über insgesamt ${formatCurrency(summeEinnahmen)} werden als Rechnungen angelegt und verbucht (${bezahltEinnahmen} bezahlt, ${analyse.einnahmen.length - bezahltEinnahmen} noch offen).</p>
          <p>✅ <strong>${analyse.ausgaben.length} Ausgabe(n)</strong> über insgesamt ${formatCurrency(summeAusgaben)} werden angelegt und verbucht (${bezahltAusgaben} bezahlt, ${analyse.ausgaben.length - bezahltAusgaben} noch offen).</p>
          ${analyse.stornoCount ? `<p class="text-mute">${analyse.stornoCount} Korrekturbuchung(en) automatisch erkannt und ignoriert (heben sich gegenseitig auf, keine Auswirkung).</p>` : ''}
          ${analyse.uebersprungen.length ? `
            <p>⚠️ <strong>${analyse.uebersprungen.length} Vorgang/Vorgänge</strong> nicht automatisch übernommen - bitte bei Bedarf manuell in der Buchhaltung nachtragen:</p>
            <ul class="cal-event-list">
              ${analyse.uebersprungen.slice(0, 30).map((u) => `<li><span>${formatDate(u.datum)} · ${escapeHtml(u.text || u.belegnummer)}</span><span class="text-mute">${escapeHtml(u.grund)}</span></li>`).join('')}
              ${analyse.uebersprungen.length > 30 ? `<li><span class="text-mute">… und ${analyse.uebersprungen.length - 30} weitere</span></li>` : ''}
            </ul>
          ` : ''}
        </div>
      `;
      startBtn.hidden = analyse.einnahmen.length === 0 && analyse.ausgaben.length === 0;
    } catch (err) {
      vorschauHost.innerHTML = `<p class="text-mute">Fehler: ${escapeHtml(err.message)}</p>`;
      analyse = null;
    }
  });

  startBtn.addEventListener('click', async () => {
    if (!analyse) return;
    startBtn.disabled = true;
    startBtn.textContent = 'Importiere ...';
    try {
      const [kunden, rechnungenBestehend, ausgabenBestehend, settings] = await Promise.all([
        getAll('kunden'), getAll('rechnungen'), getAll('ausgaben'), getSettings(),
      ]);
      const rechnungenNummernSet = new Set(rechnungenBestehend.map((r) => (r.nummer || '').trim().toLowerCase()).filter(Boolean));
      const ausgabenSchluesselSet = new Set(ausgabenBestehend.map((a) => a.importKontenexportKey).filter(Boolean));

      let einnahmenNeu = 0;
      let einnahmenUebersprungen = 0;
      let kundenAngelegt = 0;
      for (const item of analyse.einnahmen) {
        const nummerNorm = (item.belegnummer || item.key).trim().toLowerCase();
        if (rechnungenNummernSet.has(nummerNorm)) { einnahmenUebersprungen++; continue; }
        let kunde = findMatchingKunde(kunden, item.kunde);
        if (!kunde && item.kunde) {
          kunde = {
            id: uid(), firma: item.kunde, ansprechpartner: '', strasse: '', plz: '', ort: '', telefon: '', email: '',
            notizen: 'Automatisch angelegt beim Kontenexport-Import.', kundennummer: '', istPrivatperson: false,
            farbe: farbeAusText(item.kunde, KUNDEN_FARBEN), status: 'kunde',
          };
          await put('kunden', kunde);
          kunden.push(kunde);
          kundenAngelegt++;
        }
        if (!kunde) { einnahmenUebersprungen++; continue; }
        const rechnung = {
          id: uid(), nummer: item.belegnummer || item.key, kundeId: kunde.id, projektId: '', angebotId: null, auftragsbestaetigungId: null,
          datum: item.datum, leistungsdatum: item.datum,
          faelligAm: item.bezahlt ? item.datum : addDays(item.datum, settings.zahlungszielTage || 14),
          status: item.bezahlt ? 'bezahlt' : 'offen', bezahltAm: item.bezahlt ? (item.bezahltAm || item.datum) : '',
          betreff: `Rechnung ${item.belegnummer || ''} (Import aus lexoffice-Kontenexport)`,
          notizen: 'Automatisch importiert aus lexoffice-Kontenexport.',
          positionen: [{ id: uid(), bezeichnung: `Leistung ${item.belegnummer || ''}`.trim(), beschreibung: '', menge: 1, einheit: 'Psch.', einzelpreis: item.netto, steuersatz: item.steuersatz }],
          netto: item.netto, steuer: item.steuer, brutto: item.brutto,
          createdAt: new Date().toISOString(), versendet: true, versendetAm: item.datum,
          stornoVonNummer: '', storniertDurchNummer: '',
          steuerart: settings.kleinunternehmer ? 'kleinunternehmer' : 'regel', rechnungstyp: 'rechnung',
          verrechneteAbschlaege: [], verrechnetIn: '', skontoProzent: 0, skontoTage: 0,
          zahlungsart: 'ueberweisung', unterschriftKunde: '', unterschriftMitarbeiter: '',
        };
        await put('rechnungen', rechnung);
        rechnungenNummernSet.add(nummerNorm);
        try { await journal.syncBuchungFuerRechnung(rechnung, settings); } catch { /* Buchung ist Komfort, darf Import nicht abbrechen */ }
        einnahmenNeu++;
      }

      let ausgabenNeu = 0;
      let ausgabenUebersprungen = 0;
      for (const item of analyse.ausgaben) {
        if (ausgabenSchluesselSet.has(item.key)) { ausgabenUebersprungen++; continue; }
        const ausgabeId = uid();
        const ausgabe = {
          id: ausgabeId, datum: item.datum, kategorie: guessAusgabenKategorie(item.lieferant),
          beschreibung: `Import aus lexoffice-Kontenexport${item.belegnummer ? ` (${item.belegnummer})` : ''}`,
          lieferant: item.lieferant, betragNetto: item.netto, steuersatz: item.steuersatz, betragBrutto: item.brutto,
          bezahltMit: 'überweisung', beleg: null, projektId: '', kundeId: '', kalkKategorie: '',
          bezahlstatus: item.bezahlt ? 'bezahlt' : 'offen', faelligAm: item.bezahlt ? '' : item.datum,
          bezahltAm: item.bezahlt ? (item.bezahltAm || item.datum) : '', istInvestition: false,
          importKontenexportKey: item.key,
        };
        await put('ausgaben', ausgabe);
        ausgabenSchluesselSet.add(item.key);
        try { await journal.syncBuchungFuerAusgabe(ausgabe, settings); } catch { /* Buchung ist Komfort, darf Import nicht abbrechen */ }
        ausgabenNeu++;
      }

      vorschauHost.innerHTML = `
        <div class="card">
          <p>✅ ${einnahmenNeu} Einnahme(n) als Rechnung angelegt und verbucht${einnahmenUebersprungen ? ` (${einnahmenUebersprungen} bereits vorhanden, übersprungen)` : ''}</p>
          <p>✅ ${ausgabenNeu} Ausgabe(n) angelegt und verbucht${ausgabenUebersprungen ? ` (${ausgabenUebersprungen} bereits vorhanden, übersprungen)` : ''}</p>
          ${kundenAngelegt ? `<p>✅ ${kundenAngelegt} neue(r) Kunde(n) automatisch angelegt</p>` : ''}
        </div>
      `;
      startBtn.hidden = true;
      fileInput.value = '';
      toast('Kontenexport-Import abgeschlossen', 'success');
      if (onImported) onImported();
    } catch (err) {
      toast(err.message, 'danger');
      startBtn.disabled = false;
      startBtn.textContent = 'Jetzt importieren';
    }
  });
}
