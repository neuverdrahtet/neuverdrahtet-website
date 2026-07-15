import { uid, calcTotals, formatCurrency, escapeHtml, toast } from './utils.js';
import { put } from './db.js';

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

export function createPositionsEditor({ host, katalog, positionen, defaultSteuersatz = 19, vorlagen = [] }) {
  let posState = (positionen || []).map((p) => ({ ...p, id: p.id || uid() }));

  function render() {
    const totals = calcTotals(posState);
    host.innerHTML = `
      <table class="pos-table">
        <thead><tr>
          <th class="col-posnr">Pos.</th><th>Bezeichnung</th><th class="col-menge">Menge</th><th>Einheit</th>
          <th class="col-preis">Einzelpreis</th><th class="col-steuer">USt.%</th><th class="col-sum">Summe</th><th class="col-del"></th>
        </tr></thead>
        <tbody>
          ${posState.map((p, i) => `
            <tr data-i="${i}">
              <td class="col-posnr"><input class="f-posnr" value="${escapeHtml(p.posNr || String(i + 1))}" title="z.B. 1.1 oder 2.3 für Unterpositionen"></td>
              <td><input class="f-bez" value="${escapeHtml(p.bezeichnung || '')}" placeholder="Bezeichnung"></td>
              <td class="col-menge"><input class="f-menge" type="number" step="0.01" value="${p.menge ?? 1}"></td>
              <td><input class="f-einheit" value="${escapeHtml(p.einheit || '')}"></td>
              <td class="col-preis"><input class="f-preis" type="number" step="0.01" value="${p.einzelpreis ?? 0}"></td>
              <td class="col-steuer"><input class="f-steuer" type="number" step="1" value="${p.steuersatz ?? defaultSteuersatz}"></td>
              <td class="col-sum">${formatCurrency((Number(p.menge) || 0) * (Number(p.einzelpreis) || 0))}</td>
              <td class="col-del"><button type="button" class="btn btn-sm btn-ghost btn-remove-pos" title="Entfernen">✕</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="flex-row flex-wrap" style="margin-bottom:14px">
        <select class="f-katalog-select">
          <option value="">Aus Katalog wählen ...</option>
          ${katalog.map((k) => `<option value="${k.id}">${escapeHtml(k.bezeichnung)} (${formatCurrency(k.preis)})</option>`).join('')}
        </select>
        <button type="button" class="btn btn-sm" id="btn-add-katalog">+ übernehmen</button>
        <button type="button" class="btn btn-sm" id="btn-add-manual">+ freie Position</button>
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

    host.querySelectorAll('tbody tr').forEach((row) => {
      const i = Number(row.dataset.i);
      row.querySelector('.f-posnr').addEventListener('input', (e) => { posState[i].posNr = e.target.value; });
      row.querySelector('.f-bez').addEventListener('input', (e) => { posState[i].bezeichnung = e.target.value; });
      row.querySelector('.f-einheit').addEventListener('input', (e) => { posState[i].einheit = e.target.value; });
      row.querySelector('.f-menge').addEventListener('input', (e) => { posState[i].menge = Number(e.target.value); updateSum(row, i); });
      row.querySelector('.f-preis').addEventListener('input', (e) => { posState[i].einzelpreis = Number(e.target.value); updateSum(row, i); });
      row.querySelector('.f-steuer').addEventListener('input', (e) => { posState[i].steuersatz = Number(e.target.value); refreshTotalsOnly(); });
      row.querySelector('.btn-remove-pos').addEventListener('click', () => { posState.splice(i, 1); render(); });
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
  };
}
