import { uid, calcTotals, formatCurrency, escapeHtml, toast, katalogOptionsHtml, excelFileToCsvText } from './utils.js';
import { put, GEWERKE } from './db.js';
import { openModal } from './ui.js';

function parseNumber(str) {
  const n = Number(String(str ?? '').trim().replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function parsePositionenCsv(text, defaultSteuersatz) {
  const delimiter = text.split('\n')[0].includes(';') ? ';' : ',';
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows = [];
  const errors = [];
  for (const line of lines) {
    const cols = line.split(delimiter).map((c) => c.trim());
    if (/^kurztext$/i.test(cols[0] || '') || /^bezeichnung$/i.test(cols[0] || '')) continue;
    const [bezeichnung, mengeRaw, einheit, preisRaw, ustRaw, beschreibung] = cols;
    if (!bezeichnung) { errors.push(line); continue; }
    rows.push({
      id: uid(), bezeichnung, beschreibung: beschreibung || '',
      menge: mengeRaw ? parseNumber(mengeRaw) : 1, einheit: einheit || '',
      einzelpreis: parseNumber(preisRaw), steuersatz: ustRaw ? parseNumber(ustRaw) : defaultSteuersatz,
    });
  }
  return { rows, errors };
}

function totalsHtml(totals) {
  const steuerRows = Object.entries(totals.steuerGruppen)
    .filter(([rate]) => Number(rate) > 0)
    .map(([rate, netto]) => `<div class="row"><span>zzgl. ${rate}% USt.</span><span>${formatCurrency(netto * (Number(rate) / 100))}</span></div>`)
    .join('');
  return `
    <div class="row"><span>Netto</span><span>${formatCurrency(totals.netto)}</span></div>
    ${steuerRows}
    <div class="row grand"><span>Gesamt</span><span>${formatCurrency(totals.brutto)}</span></div>
  `;
}

export function createPositionsEditor({ host, katalog, positionen, defaultSteuersatz = 19, vorlagen = [], readOnly = false }) {
  let posState = (positionen || []).map((p) => ({ ...p, id: p.id || uid() }));
  let gewerkFilter = '';

  function katalogAuswahlHtml() {
    const gefiltert = gewerkFilter ? katalog.filter((k) => k.gewerk === gewerkFilter) : katalog;
    return `<option value="">Aus Katalog wählen ...</option>${katalogOptionsHtml(gefiltert, (k) => `${escapeHtml(k.bezeichnung)} (${formatCurrency(k.preis)})`)}`;
  }

  function render() {
    const totals = calcTotals(posState);
    if (readOnly) {
      host.innerHTML = `
        <p class="hint">🔒 Diese Rechnung wurde bereits versendet und ist zur GoBD-konformen Nachvollziehbarkeit gesperrt. Änderungen nur über eine Stornorechnung.</p>
        <table class="pos-table">
          <thead><tr>
            <th class="col-posnr">Pos.</th><th>Kurztext</th><th class="col-menge">Menge</th><th>Einheit</th>
            <th class="col-preis">Einzelpreis</th><th class="col-steuer">USt.%</th><th class="col-sum">Summe</th>
          </tr></thead>
          <tbody>
            ${posState.map((p, i) => `
              <tr>
                <td class="col-posnr">${escapeHtml(p.posNr || String(i + 1))}</td>
                <td>${escapeHtml(p.bezeichnung || '')}</td>
                <td class="col-menge">${p.menge ?? 1}</td>
                <td>${escapeHtml(p.einheit || '')}</td>
                <td class="col-preis">${formatCurrency(p.einzelpreis)}</td>
                <td class="col-steuer">${p.steuersatz ?? defaultSteuersatz}%</td>
                <td class="col-sum">${formatCurrency((Number(p.menge) || 0) * (Number(p.einzelpreis) || 0))}</td>
              </tr>
              ${p.beschreibung ? `<tr class="row-langtext"><td></td><td colspan="6">${escapeHtml(p.beschreibung)}</td></tr>` : ''}
            `).join('')}
          </tbody>
        </table>
        <div class="totals-box">${totalsHtml(totals)}</div>
      `;
      return;
    }
    host.innerHTML = `
      <table class="pos-table">
        <thead><tr>
          <th class="col-posnr">Pos.</th><th>Kurztext</th><th class="col-menge">Menge</th><th>Einheit</th>
          <th class="col-preis">Einzelpreis</th><th class="col-steuer">USt.%</th><th class="col-sum">Summe</th><th class="col-del"></th>
        </tr></thead>
        <tbody>
          ${posState.map((p, i) => `
            <tr data-i="${i}">
              <td class="col-posnr"><input class="f-posnr" value="${escapeHtml(p.posNr || String(i + 1))}" title="z.B. 1.1 oder 2.3 für Unterpositionen"></td>
              <td><input class="f-bez" value="${escapeHtml(p.bezeichnung || '')}" placeholder="Kurztext"></td>
              <td class="col-menge"><input class="f-menge" type="number" step="0.01" value="${p.menge ?? 1}"></td>
              <td><input class="f-einheit" value="${escapeHtml(p.einheit || '')}"></td>
              <td class="col-preis"><input class="f-preis" type="number" step="0.01" value="${p.einzelpreis ?? 0}"></td>
              <td class="col-steuer"><input class="f-steuer" type="number" step="1" value="${p.steuersatz ?? defaultSteuersatz}"></td>
              <td class="col-sum">${formatCurrency((Number(p.menge) || 0) * (Number(p.einzelpreis) || 0))}</td>
              <td class="col-del"><button type="button" class="btn btn-sm btn-ghost btn-remove-pos" title="Entfernen">✕</button></td>
            </tr>
            <tr class="row-langtext" data-i="${i}">
              <td></td>
              <td colspan="7"><textarea class="f-langtext" rows="2" placeholder="Langtext / ausführliche Beschreibung (optional, erscheint z.B. im PDF)">${escapeHtml(p.beschreibung || '')}</textarea></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="flex-row flex-wrap" style="margin-bottom:14px">
        <select class="f-gewerk-filter" title="Gewerk zum Filtern wählen" style="max-width:190px">
          <option value="">Alle Gewerke</option>
          ${GEWERKE.map((g) => `<option value="${g.id}" ${gewerkFilter === g.id ? 'selected' : ''}>${escapeHtml(g.titel)}</option>`).join('')}
        </select>
        <select class="f-katalog-select">
          ${katalogAuswahlHtml()}
        </select>
        <button type="button" class="btn btn-sm" id="btn-add-katalog">+ übernehmen</button>
        <button type="button" class="btn btn-sm" id="btn-add-manual">+ freie Position</button>
        <button type="button" class="btn btn-sm" id="btn-import-positionen">⇪ aus CSV/Excel importieren</button>
        ${vorlagen.length ? `
          <select class="f-vorlage-select">
            <option value="">Vorlage einfügen ...</option>
            ${vorlagen.map((v) => `<option value="${v.id}">${escapeHtml(v.name)}</option>`).join('')}
          </select>
          <button type="button" class="btn btn-sm" id="btn-add-vorlage">+ einfügen</button>
        ` : ''}
        <button type="button" class="btn btn-sm btn-ghost" id="btn-save-vorlage">Als Vorlage speichern</button>
      </div>
      <div class="totals-box">${totalsHtml(totals)}</div>
    `;

    host.querySelectorAll('tbody tr:not(.row-langtext)').forEach((row) => {
      const i = Number(row.dataset.i);
      row.querySelector('.f-posnr').addEventListener('input', (e) => { posState[i].posNr = e.target.value; });
      row.querySelector('.f-bez').addEventListener('input', (e) => { posState[i].bezeichnung = e.target.value; });
      row.querySelector('.f-einheit').addEventListener('input', (e) => { posState[i].einheit = e.target.value; });
      row.querySelector('.f-menge').addEventListener('input', (e) => { posState[i].menge = Number(e.target.value); updateSum(row, i); });
      row.querySelector('.f-preis').addEventListener('input', (e) => { posState[i].einzelpreis = Number(e.target.value); updateSum(row, i); });
      row.querySelector('.f-steuer').addEventListener('input', (e) => { posState[i].steuersatz = Number(e.target.value); refreshTotalsOnly(); });
      row.querySelector('.btn-remove-pos').addEventListener('click', () => { posState.splice(i, 1); render(); });
    });
    host.querySelectorAll('tr.row-langtext').forEach((row) => {
      const i = Number(row.dataset.i);
      row.querySelector('.f-langtext').addEventListener('input', (e) => { posState[i].beschreibung = e.target.value; });
    });

    host.querySelector('.f-gewerk-filter').addEventListener('change', (e) => {
      gewerkFilter = e.target.value;
      host.querySelector('.f-katalog-select').innerHTML = katalogAuswahlHtml();
    });

    host.querySelector('#btn-add-katalog').addEventListener('click', () => {
      const select = host.querySelector('.f-katalog-select');
      const item = katalog.find((k) => k.id === select.value);
      if (!item) return;
      posState.push({
        id: uid(), katalogId: item.id, bezeichnung: item.bezeichnung, beschreibung: item.beschreibung || '',
        einheit: item.einheit, menge: 1, einzelpreis: item.preis, steuersatz: item.steuersatz,
      });
      render();
    });
    host.querySelector('#btn-add-manual').addEventListener('click', () => {
      posState.push({ id: uid(), bezeichnung: '', einheit: '', menge: 1, einzelpreis: 0, steuersatz: defaultSteuersatz });
      render();
    });
    host.querySelector('#btn-import-positionen').addEventListener('click', () => openImportModal());

    const vorlageBtn = host.querySelector('#btn-add-vorlage');
    if (vorlageBtn) {
      vorlageBtn.addEventListener('click', () => {
        const select = host.querySelector('.f-vorlage-select');
        const vorlage = vorlagen.find((v) => v.id === select.value);
        if (!vorlage) return;
        for (const p of vorlage.positionen || []) {
          posState.push({ ...p, id: uid() });
        }
        render();
      });
    }

    host.querySelector('#btn-save-vorlage').addEventListener('click', async () => {
      if (posState.length === 0) { toast('Keine Positionen zum Speichern vorhanden', 'danger'); return; }
      const name = window.prompt('Name für die neue Vorlage:');
      if (!name || !name.trim()) return;
      await put('vorlagen', { id: uid(), name: name.trim(), positionen: posState.map((p) => ({ ...p, id: uid() })) });
      toast('Vorlage gespeichert', 'success');
    });

    function openImportModal() {
      const { body, close } = openModal({
        title: 'Positionen aus CSV/Excel importieren',
        wide: true,
        bodyHtml: `
          <p class="hint">CSV oder Excel (.xlsx/.xls) einfügen/wählen. Spalten: <code>Kurztext;Menge;Einheit;Einzelpreis;USt;Langtext</code> (Langtext optional) – nur Kurztext ist Pflicht. Wird an die bestehenden Positionen angehängt. Eine optionale Kopfzeile wird erkannt.</p>
          <div class="field" style="margin-bottom:10px">
            <label>CSV- oder Excel-Datei</label>
            <input type="file" id="import-file" accept=".csv,.xlsx,.xls,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel">
          </div>
          <div class="field">
            <label>oder CSV-Text einfügen</label>
            <textarea id="import-text" style="min-height:160px;font-family:monospace" placeholder="Kabel NYM-J 3x1,5mm²;50;m;1,20;19
Steckdose montieren;4;Std.;65;19"></textarea>
          </div>
          <div id="import-preview" class="text-mute" style="margin-top:8px"></div>
          <div class="modal-actions">
            <span class="spacer"></span>
            <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
            <button type="button" class="btn btn-primary" id="btn-do-import">Importieren</button>
          </div>
        `,
      });
      body.querySelector('#btn-cancel').addEventListener('click', close);
      body.querySelector('#import-file').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const isExcel = /\.xlsx?$/i.test(file.name);
        try {
          body.querySelector('#import-text').value = isExcel ? await excelFileToCsvText(file) : await file.text();
        } catch (err) {
          toast(err.message, 'danger');
        }
      });
      body.querySelector('#btn-do-import').addEventListener('click', () => {
        const text = body.querySelector('#import-text').value;
        const { rows, errors } = parsePositionenCsv(text, defaultSteuersatz);
        if (rows.length === 0) {
          body.querySelector('#import-preview').textContent = 'Keine gültigen Zeilen gefunden.';
          return;
        }
        posState.push(...rows);
        toast(`${rows.length} Position(en) importiert${errors.length ? `, ${errors.length} Zeile(n) übersprungen` : ''}`, 'success');
        close();
        render();
      });
    }

    function updateSum(row, i) {
      const p = posState[i];
      row.querySelector('.col-sum').textContent = formatCurrency((Number(p.menge) || 0) * (Number(p.einzelpreis) || 0));
      refreshTotalsOnly();
    }
    function refreshTotalsOnly() {
      host.querySelector('.totals-box').innerHTML = totalsHtml(calcTotals(posState));
    }
  }

  render();

  return {
    getPositionen: () => posState,
    getTotals: () => calcTotals(posState),
    refresh: () => render(),
  };
}
