import { getAll, put, remove, getSettings, setSettings } from '../db.js';
import { uid, escapeHtml, formatCurrency, formatDate, todayISO, addDays, nextNummer, toast, calcTotals } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import { createPositionsEditor } from '../positions.js';
import { printHtml, buildDocHtml } from '../pdf.js';
import { buildDocPdfBlob } from '../docpdf.js';
import { openEmailComposer } from '../emailsend.js';

const STATUS_LABEL = { offen: 'Offen', teilbezahlt: 'Teilbezahlt', bezahlt: 'Bezahlt', storniert: 'Storniert' };
const STATUS_BADGE = { offen: 'badge-warn', teilbezahlt: 'badge-accent', bezahlt: 'badge-success', storniert: 'badge-danger' };

export async function render(container) {
  let [rechnungen, kunden, projekte, katalog, settings] = await Promise.all([
    getAll('rechnungen'), getAll('kunden'), getAll('projekte'), getAll('katalog'), getSettings(),
  ]);
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));
  rechnungen.sort((a, b) => (b.nummer || '').localeCompare(a.nummer || ''));
  let filtered = rechnungen;
  const today = todayISO();

  container.innerHTML = `
    <div class="view-header">
      <h1>Rechnungen</h1>
      <div class="actions"><button class="btn btn-primary" id="btn-new">+ Neue Rechnung</button></div>
    </div>
    <div class="search-bar">
      <input type="search" id="search" placeholder="Suche nach Nummer oder Kunde ...">
      <select id="status-filter">
        <option value="">Alle Status</option>
        ${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
      </select>
    </div>
    <div id="table-host"></div>
  `;
  const tableHost = container.querySelector('#table-host');

  function applyFilter() {
    const q = container.querySelector('#search').value.trim().toLowerCase();
    const status = container.querySelector('#status-filter').value;
    filtered = rechnungen.filter((r) => {
      if (status && r.status !== status) return false;
      if (!q) return true;
      return [r.nummer, kundenById[r.kundeId]?.firma].filter(Boolean).join(' ').toLowerCase().includes(q);
    });
    renderTable();
  }

  function renderTable() {
    if (filtered.length === 0) {
      tableHost.innerHTML = `<div class="empty-state">Noch keine Rechnungen erstellt.</div>`;
      return;
    }
    tableHost.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Nummer</th><th>Kunde</th><th>Datum</th><th>Fällig am</th><th>Status</th><th class="text-right">Brutto</th></tr></thead>
        <tbody>
          ${filtered.map((r) => {
            const overdue = (r.status === 'offen' || r.status === 'teilbezahlt') && r.faelligAm && r.faelligAm < today;
            return `
            <tr data-id="${r.id}">
              <td>${escapeHtml(r.nummer)}</td>
              <td>${escapeHtml(kundenById[r.kundeId]?.firma || '')}</td>
              <td>${formatDate(r.datum)}</td>
              <td>${formatDate(r.faelligAm)}</td>
              <td>
                <span class="badge ${STATUS_BADGE[r.status] || 'badge'}">${STATUS_LABEL[r.status] || r.status}</span>
                ${overdue ? '<span class="badge badge-danger">überfällig</span>' : ''}
              </td>
              <td class="text-right">${formatCurrency(r.brutto)}</td>
            </tr>
          `; }).join('')}
        </tbody>
      </table>
    `;
    tableHost.querySelectorAll('tbody tr').forEach((row) => {
      row.addEventListener('click', () => openForm(rechnungen.find((r) => r.id === row.dataset.id)));
    });
  }

  container.querySelector('#search').addEventListener('input', applyFilter);
  container.querySelector('#status-filter').addEventListener('change', applyFilter);
  container.querySelector('#btn-new').addEventListener('click', () => openForm());

  function openForm(r) {
    const isEdit = !!r;
    const data = r || {
      id: uid(), nummer: '', kundeId: '', projektId: '', angebotId: null, datum: todayISO(),
      faelligAm: addDays(todayISO(), settings.zahlungszielTage || 14),
      status: 'offen', betreff: '', notizen: '', positionen: [], bezahltAm: '', createdAt: new Date().toISOString(),
    };

    const { body, close } = openModal({
      title: isEdit ? `Rechnung ${data.nummer}` : 'Neue Rechnung',
      wide: true,
      bodyHtml: `
        <form id="re-form">
          <div class="form-grid">
            <div class="field"><label>Kunde *</label>
              <select name="kundeId" required><option value="">– wählen –</option>${kunden.map((k) => `<option value="${k.id}" ${k.id === data.kundeId ? 'selected' : ''}>${escapeHtml(k.firma)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Projekt</label>
              <select name="projektId"><option value="">–</option>${projekte.map((p) => `<option value="${p.id}" ${p.id === data.projektId ? 'selected' : ''}>${escapeHtml(p.titel)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Rechnungsdatum</label><input type="date" name="datum" value="${data.datum}"></div>
            <div class="field"><label>Fällig am</label><input type="date" name="faelligAm" value="${data.faelligAm}"></div>
            <div class="field col-span-2"><label>Betreff</label><input name="betreff" value="${escapeHtml(data.betreff || '')}"></div>
            ${isEdit ? `
              <div class="field"><label>Status</label>
                <select name="status">${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${k === data.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
              </div>
              <div class="field"><label>Bezahlt am</label><input type="date" name="bezahltAm" value="${data.bezahltAm || ''}"></div>
            ` : ''}
          </div>
          <div class="divider"></div>
          <div id="pos-host"></div>
          <div class="field col-span-2" style="margin-top:10px"><label>Notizen</label><textarea name="notizen">${escapeHtml(data.notizen || '')}</textarea></div>
          <div class="modal-actions">
            ${isEdit ? '<button type="button" class="btn btn-danger" id="btn-delete">Löschen</button>' : ''}
            ${isEdit ? '<button type="button" class="btn" id="btn-print">Drucken / PDF</button>' : ''}
            ${isEdit && data.kundeId ? '<button type="button" class="btn" id="btn-email">Per E-Mail senden</button>' : ''}
            <span class="spacer"></span>
            <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Speichern</button>
          </div>
        </form>
      `,
    });

    const editor = createPositionsEditor({
      host: body.querySelector('#pos-host'),
      katalog,
      positionen: data.positionen,
      defaultSteuersatz: settings.standardSteuersatz,
    });

    body.querySelector('#btn-cancel').addEventListener('click', close);
    if (isEdit) {
      body.querySelector('#btn-delete').addEventListener('click', async () => {
        if (!confirmDelete(`Rechnung ${data.nummer} wirklich löschen?`)) return;
        await remove('rechnungen', data.id);
        toast('Rechnung gelöscht');
        close();
        render(container);
      });
      function docOpts() {
        const totals = editor.getTotals();
        return {
          settings, art: 'Rechnung', nummer: data.nummer, datum: data.datum,
          refLabel: 'Zahlbar bis', refValue: formatDate(data.faelligAm),
          kunde: kundenById[data.kundeId], betreff: data.betreff,
          introText: 'wir bedanken uns für Ihren Auftrag und stellen Ihnen wie folgt in Rechnung:',
          positionen: editor.getPositionen(), totals,
          closingText: (data.notizen || '') + `\n\nBitte überweisen Sie den Rechnungsbetrag bis zum ${formatDate(data.faelligAm)} auf unser unten genanntes Konto.`,
        };
      }
      body.querySelector('#btn-print').addEventListener('click', () => {
        printHtml(buildDocHtml(docOpts()));
      });
      const emailBtn = body.querySelector('#btn-email');
      if (emailBtn) {
        emailBtn.addEventListener('click', () => {
          const kunde = kundenById[data.kundeId];
          openEmailComposer({
            to: kunde?.email || '',
            subject: `Rechnung ${data.nummer}${data.betreff ? ' – ' + data.betreff : ''}`,
            bodyText: `Hallo${kunde?.ansprechpartner ? ' ' + kunde.ansprechpartner : ''},\n\nanbei erhalten Sie unsere Rechnung ${data.nummer}, fällig am ${formatDate(data.faelligAm)}.\n\nMit freundlichen Grüßen\n${settings.firmenname}`,
            filename: `Rechnung-${data.nummer}.pdf`,
            buildPdfBlob: () => buildDocPdfBlob(docOpts()),
          });
        });
      }
    }

    body.querySelector('#re-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      updated.kundeId = fd.get('kundeId') || '';
      updated.projektId = fd.get('projektId') || '';
      updated.datum = fd.get('datum') || todayISO();
      updated.faelligAm = fd.get('faelligAm') || '';
      updated.betreff = (fd.get('betreff') || '').toString().trim();
      updated.notizen = (fd.get('notizen') || '').toString().trim();
      if (isEdit) {
        updated.status = fd.get('status') || data.status;
        updated.bezahltAm = fd.get('bezahltAm') || '';
      }
      if (!updated.kundeId) { toast('Bitte einen Kunden wählen', 'danger'); return; }

      updated.positionen = editor.getPositionen();
      const totals = calcTotals(updated.positionen);
      updated.netto = totals.netto;
      updated.steuer = totals.steuer;
      updated.brutto = totals.brutto;

      if (!isEdit) {
        const currentSettings = await getSettings();
        updated.nummer = nextNummer(currentSettings.rechnungPrefix, currentSettings.naechsteRechnungNr);
        await setSettings({ naechsteRechnungNr: currentSettings.naechsteRechnungNr + 1 });
      }

      await put('rechnungen', updated);
      toast(isEdit ? 'Rechnung aktualisiert' : 'Rechnung angelegt', 'success');
      close();
      render(container);
    });
  }

  renderTable();
}
