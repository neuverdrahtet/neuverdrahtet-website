import { getAll, put, remove, getSettings, KALK_KATEGORIEN } from '../db.js';
import { uid, escapeHtml, formatCurrency, formatDate, todayISO, compressImage, toast } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import { openBelegImport } from '../belegimport.js';
import { createBulkSelect } from '../bulkselect.js';
import { analyzeBeleg } from '../ai.js';
import { FIREBASE_ENABLED, uploadBlobToStorage, deleteBlobFromStorage } from '../blobstore.js';

export const KATEGORIEN = ['Material', 'Werkzeug/Maschinen', 'Fahrzeug/Sprit', 'Miete', 'Versicherung', 'Büro/Verwaltung', 'Personal', 'Sonstiges'];
const KALK_KATEGORIEN_AUSGABEN = KALK_KATEGORIEN.filter((k) => k.id !== 'lohn');

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
    reader.readAsDataURL(blob);
  });
}

export async function render(container) {
  let [ausgaben, settings, projekte, kunden] = await Promise.all([getAll('ausgaben'), getSettings(), getAll('projekte'), getAll('kunden')]);
  const projekteById = Object.fromEntries(projekte.map((p) => [p.id, p]));
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));
  ausgaben.sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));
  let filtered = ausgaben;
  const bulk = createBulkSelect('ausgaben', { label: 'Ausgaben' });

  container.innerHTML = `
    <div class="view-header">
      <h1>Ausgaben</h1>
      <div class="actions">
        <button class="btn" id="btn-beleg-import">⇪ Belege importieren (ZIP)</button>
        <button class="btn" id="btn-beleg-scan">📷 Beleg scannen</button>
        <input type="file" id="beleg-scan-input" accept="image/*" capture="environment" hidden>
        <button class="btn btn-primary" id="btn-new">+ Ausgabe erfassen</button>
      </div>
    </div>
    <div class="search-bar">
      <input type="search" id="search" placeholder="Suche nach Beschreibung/Lieferant ...">
      <select id="filter-kategorie"><option value="">Alle Kategorien</option>${KATEGORIEN.map((k) => `<option value="${k}">${k}</option>`).join('')}</select>
      <select id="filter-kunde"><option value="">Alle Kunden</option>${kunden.map((k) => `<option value="${k.id}">${escapeHtml(k.firma)}</option>`).join('')}</select>
    </div>
    <div id="table-host"></div>
  `;
  const tableHost = container.querySelector('#table-host');

  function applyFilter() {
    const q = container.querySelector('#search').value.trim().toLowerCase();
    const kategorie = container.querySelector('#filter-kategorie').value;
    const kundeId = container.querySelector('#filter-kunde').value;
    filtered = ausgaben.filter((a) => {
      if (kategorie && a.kategorie !== kategorie) return false;
      if (kundeId && a.kundeId !== kundeId) return false;
      if (!q) return true;
      return [a.beschreibung, a.lieferant, kundenById[a.kundeId]?.firma].filter(Boolean).join(' ').toLowerCase().includes(q);
    });
    renderTable();
  }

  function renderTable() {
    if (filtered.length === 0) {
      tableHost.innerHTML = `<div class="empty-state">Noch keine Ausgaben erfasst.</div>`;
      return;
    }
    const summe = filtered.reduce((s, a) => s + (a.betragBrutto || 0), 0);
    tableHost.innerHTML = `
      <p class="hint">Summe: ${formatCurrency(summe)}</p>
      ${bulk.barHtml()}
      <table class="data-table">
        <thead><tr>${bulk.headerCell()}<th>Datum</th><th>Kategorie</th><th>Beschreibung</th><th>Kunde</th><th>Projekt</th><th class="text-right">Betrag (brutto)</th><th></th></tr></thead>
        <tbody>
          ${filtered.map((a) => `
            <tr data-id="${a.id}">
              ${bulk.rowCell(a.id)}
              <td>${formatDate(a.datum)}</td>
              <td><span class="badge">${escapeHtml(a.kategorie)}</span></td>
              <td>${escapeHtml(a.beschreibung || '')}</td>
              <td>${escapeHtml(kundenById[a.kundeId]?.firma || '')}</td>
              <td>${escapeHtml(projekteById[a.projektId]?.titel || '')}</td>
              <td class="text-right">${formatCurrency(a.betragBrutto)}</td>
              <td>${a.beleg ? '📎' : ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    tableHost.querySelectorAll('tbody tr').forEach((row) => {
      row.addEventListener('click', () => openForm(ausgaben.find((a) => a.id === row.dataset.id)));
    });
    bulk.wire(tableHost, {
      onChange: renderTable,
      onDeleted: (ids) => {
        ausgaben = ausgaben.filter((a) => !ids.includes(a.id));
        filtered = filtered.filter((a) => !ids.includes(a.id));
        renderTable();
      },
    });
  }

  container.querySelector('#search').addEventListener('input', applyFilter);
  container.querySelector('#filter-kategorie').addEventListener('change', applyFilter);
  container.querySelector('#filter-kunde').addEventListener('change', applyFilter);
  container.querySelector('#btn-new').addEventListener('click', () => openForm());
  container.querySelector('#btn-beleg-import').addEventListener('click', () => {
    openBelegImport({ onImported: () => render(container) });
  });

  const belegScanInput = container.querySelector('#beleg-scan-input');
  container.querySelector('#btn-beleg-scan').addEventListener('click', () => belegScanInput.click());
  belegScanInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    belegScanInput.value = '';
    if (!file) return;
    const scanBtn = container.querySelector('#btn-beleg-scan');
    scanBtn.disabled = true;
    scanBtn.textContent = 'Beleg wird analysiert ...';
    try {
      const belegBlob = await compressImage(file, { maxWidth: 1400 });
      const imageDataUrl = await blobToDataUrl(await compressImage(file, { maxWidth: 1000, quality: 0.7 }));
      let prefill = { beleg: belegBlob };
      try {
        const result = await analyzeBeleg({ imageDataUrl, kategorien: KATEGORIEN });
        const kategorie = KATEGORIEN.includes(result.kategorie) ? result.kategorie : 'Sonstiges';
        const unsicher = !result.lesbar || !result.kategorieSicher;
        const datum = /^\d{4}-\d{2}-\d{2}$/.test(result.datum || '') ? result.datum : todayISO();
        const steuersatz = [0, 7, 19].includes(Number(result.steuersatz)) ? Number(result.steuersatz) : 19;
        prefill = {
          ...prefill,
          datum,
          kategorie,
          beschreibung: `${unsicher ? '⚠️ Bitte prüfen: ' : ''}${result.beschreibung || ''}`.trim(),
          lieferant: result.haendler || '',
          betragNetto: Number(result.betragNetto) || 0,
          steuersatz,
          betragBrutto: calcBrutto(Number(result.betragNetto) || 0, steuersatz),
        };
        toast(unsicher ? 'Beleg gescannt – bitte Angaben prüfen' : 'Beleg erkannt', unsicher ? 'info' : 'success');
      } catch (err) {
        toast(`KI-Erkennung fehlgeschlagen (${err.message}) – bitte manuell ausfüllen`, 'danger');
      }
      openForm(null, { prefill });
    } catch (err) {
      toast(err.message, 'danger');
    }
    scanBtn.disabled = false;
    scanBtn.textContent = '📷 Beleg scannen';
  });

  function calcBrutto(netto, steuersatz) {
    return Math.round(Number(netto) * (1 + Number(steuersatz) / 100) * 100) / 100;
  }

  function openForm(a, { prefill } = {}) {
    const isEdit = !!a;
    const data = a || {
      id: uid(), datum: todayISO(), kategorie: KATEGORIEN[0], beschreibung: '', lieferant: '',
      betragNetto: 0, steuersatz: settings.standardSteuersatz, betragBrutto: 0, bezahltMit: 'überweisung', beleg: null,
      projektId: '', kundeId: '', kalkKategorie: '',
      ...prefill,
    };
    const { body, close } = openModal({
      title: isEdit ? 'Ausgabe bearbeiten' : 'Neue Ausgabe',
      bodyHtml: `
        <form id="ausgabe-form">
          <div class="form-grid">
            <div class="field"><label>Datum</label><input type="date" name="datum" value="${data.datum}"></div>
            <div class="field"><label>Kategorie</label>
              <select name="kategorie">${KATEGORIEN.map((k) => `<option value="${k}" ${k === data.kategorie ? 'selected' : ''}>${k}</option>`).join('')}</select>
            </div>
            <div class="field col-span-2"><label>Beschreibung</label><input name="beschreibung" value="${escapeHtml(data.beschreibung || '')}"></div>
            <div class="field"><label>Lieferant</label><input name="lieferant" value="${escapeHtml(data.lieferant || '')}"></div>
            <div class="field"><label>Bezahlt mit</label>
              <select name="bezahltMit">
                <option value="überweisung" ${data.bezahltMit === 'überweisung' ? 'selected' : ''}>Überweisung</option>
                <option value="karte" ${data.bezahltMit === 'karte' ? 'selected' : ''}>Karte</option>
                <option value="bar" ${data.bezahltMit === 'bar' ? 'selected' : ''}>Bar</option>
                <option value="lastschrift" ${data.bezahltMit === 'lastschrift' ? 'selected' : ''}>Lastschrift</option>
              </select>
            </div>
            <div class="field"><label>Betrag netto (€)</label><input type="number" step="0.01" min="0" name="betragNetto" value="${data.betragNetto}"></div>
            <div class="field"><label>USt.-Satz (%)</label>
              <select name="steuersatz">
                <option value="19" ${Number(data.steuersatz) === 19 ? 'selected' : ''}>19%</option>
                <option value="7" ${Number(data.steuersatz) === 7 ? 'selected' : ''}>7%</option>
                <option value="0" ${Number(data.steuersatz) === 0 ? 'selected' : ''}>0%</option>
              </select>
            </div>
            <div class="field"><label>Kunde</label>
              <select name="kundeId" id="ausgabe-kunde"><option value="">– keinem Kunden zugeordnet –</option>${kunden.map((k) => `<option value="${k.id}" ${k.id === data.kundeId ? 'selected' : ''}>${escapeHtml(k.firma)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Projekt / Auftrag (für Nachkalkulation)</label>
              <select name="projektId" id="ausgabe-projekt"><option value="">– keinem Projekt zugeordnet –</option>${projekte.map((p) => `<option value="${p.id}" data-kunde="${p.kundeId || ''}" ${p.id === data.projektId ? 'selected' : ''}>${escapeHtml(p.titel)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Kalkulations-Kategorie</label>
              <select name="kalkKategorie" id="ausgabe-kalkkategorie" ${data.projektId ? '' : 'disabled'}>
                <option value="">–</option>
                ${KALK_KATEGORIEN_AUSGABEN.map((k) => `<option value="${k.id}" ${k.id === data.kalkKategorie ? 'selected' : ''}>${escapeHtml(k.titel)}</option>`).join('')}
              </select>
            </div>
            <div class="field col-span-2"><label>Beleg (Foto oder PDF)</label>
              <input type="file" accept="image/*,application/pdf" id="beleg-input">
              <div id="beleg-preview">${data.beleg ? '<a href="#" class="btn btn-sm" id="beleg-view-link">📎 Beleg ansehen</a>' : ''}</div>
            </div>
          </div>
          <div class="modal-actions">
            ${isEdit ? '<button type="button" class="btn btn-danger" id="btn-delete">Löschen</button>' : ''}
            <span class="spacer"></span>
            <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Speichern</button>
          </div>
        </form>
      `,
    });

    body.querySelector('#ausgabe-projekt').addEventListener('change', (e) => {
      body.querySelector('#ausgabe-kalkkategorie').disabled = !e.target.value;
      const kundeSelect = body.querySelector('#ausgabe-kunde');
      const projektKundeId = e.target.selectedOptions[0]?.dataset.kunde || '';
      if (projektKundeId && !kundeSelect.value) kundeSelect.value = projektKundeId;
    });

    // newBelegBlob ist nur gesetzt, wenn der Nutzer gerade eine neue Datei
    // ausgewählt hat (entweder über den Datei-Input oder - noch nicht
    // gespeichert - über den "Beleg scannen"-Vorschlag). Ein bereits
    // gespeicherter Beleg im Firebase-Modus liegt als {url,path,...} vor,
    // kein Blob - der wird beim Speichern unverändert übernommen.
    let newBelegBlob = data.beleg instanceof Blob ? data.beleg : null;
    const belegViewLink = body.querySelector('#beleg-view-link');
    if (belegViewLink) {
      belegViewLink.addEventListener('click', (e) => {
        e.preventDefault();
        if (data.beleg?.url) {
          window.open(data.beleg.url, '_blank', 'noopener');
        } else if (data.beleg instanceof Blob) {
          const url = URL.createObjectURL(data.beleg);
          window.open(url, '_blank', 'noopener');
          setTimeout(() => URL.revokeObjectURL(url), 10000);
        }
      });
    }
    body.querySelector('#beleg-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        newBelegBlob = file.type === 'application/pdf' ? file : await compressImage(file, { maxWidth: 1400 });
        body.querySelector('#beleg-preview').innerHTML = '<span class="badge badge-success">Beleg hinzugefügt (wird beim Speichern übernommen)</span>';
      } catch (err) {
        toast(err.message, 'danger');
      }
    });

    body.querySelector('#btn-cancel').addEventListener('click', close);
    if (isEdit) {
      body.querySelector('#btn-delete').addEventListener('click', async () => {
        if (!confirmDelete('Ausgabe wirklich löschen?')) return;
        await remove('ausgaben', data.id);
        if (data.beleg?.path) await deleteBlobFromStorage(data.beleg.path);
        toast('Ausgabe gelöscht');
        close();
        render(container);
      });
    }
    body.querySelector('#ausgabe-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      updated.datum = fd.get('datum') || data.datum;
      updated.kategorie = fd.get('kategorie') || KATEGORIEN[0];
      updated.beschreibung = (fd.get('beschreibung') || '').toString().trim();
      updated.lieferant = (fd.get('lieferant') || '').toString().trim();
      updated.bezahltMit = fd.get('bezahltMit') || 'überweisung';
      updated.betragNetto = Number(fd.get('betragNetto')) || 0;
      updated.steuersatz = Number(fd.get('steuersatz')) || 0;
      updated.betragBrutto = calcBrutto(updated.betragNetto, updated.steuersatz);
      if (newBelegBlob) {
        updated.beleg = FIREBASE_ENABLED ? await uploadBlobToStorage(`ausgaben/${data.id}`, newBelegBlob) : newBelegBlob;
      } else {
        updated.beleg = data.beleg || null;
      }
      updated.projektId = fd.get('projektId') || '';
      updated.kundeId = fd.get('kundeId') || '';
      updated.kalkKategorie = updated.projektId ? (fd.get('kalkKategorie') || '') : '';
      await put('ausgaben', updated);
      toast(isEdit ? 'Ausgabe aktualisiert' : 'Ausgabe erfasst', 'success');
      close();
      render(container);
    });
  }

  renderTable();
}
