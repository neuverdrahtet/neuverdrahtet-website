import { getAll, put, remove, getSettings, setSettings, STEUERARTEN } from '../db.js';
import { uid, escapeHtml, formatCurrency, formatDate, todayISO, addDays, nextNummer, toast, calcTotals } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import { createPositionsEditor } from '../positions.js';
import { printHtml, buildDocHtml } from '../pdf.js';
import { buildDocPdfBlob } from '../docpdf.js';
import { openEmailComposer } from '../emailsend.js';
import { sendDocumentViaWhatsApp } from '../whatsapp.js';
import { generateAngebotFromStichpunkte } from '../ai.js';
import { mountTextbausteinPicker } from '../textbausteine.js';
import { createBulkSelect } from '../bulkselect.js';

const STATUS_LABEL = {
  entwurf: 'Entwurf', versendet: 'Versendet', angenommen: 'Angenommen', abgelehnt: 'Abgelehnt',
};
const STATUS_BADGE = {
  entwurf: 'badge', versendet: 'badge-accent', angenommen: 'badge-success', abgelehnt: 'badge-danger',
};

export async function render(container) {
  let [angebote, kunden, projekte, katalog, settings, vorlagen, textbausteine] = await Promise.all([
    getAll('angebote'), getAll('kunden'), getAll('projekte'), getAll('katalog'), getSettings(), getAll('vorlagen'), getAll('textbausteine'),
  ]);
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));
  angebote.sort((a, b) => (b.nummer || '').localeCompare(a.nummer || ''));
  let filtered = angebote;
  const bulk = createBulkSelect('angebote', { label: 'Angebote' });

  container.innerHTML = `
    <div class="view-header">
      <h1>Angebote</h1>
      <div class="actions"><button class="btn btn-primary" id="btn-new">+ Neues Angebot</button></div>
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
    filtered = angebote.filter((a) => {
      if (status && a.status !== status) return false;
      if (!q) return true;
      return [a.nummer, kundenById[a.kundeId]?.firma].filter(Boolean).join(' ').toLowerCase().includes(q);
    });
    renderTable();
  }

  function renderTable() {
    if (filtered.length === 0) {
      tableHost.innerHTML = `<div class="empty-state">Noch keine Angebote erstellt.</div>`;
      return;
    }
    tableHost.innerHTML = `
      ${bulk.barHtml()}
      <table class="data-table">
        <thead><tr>${bulk.headerCell()}<th>Nummer</th><th>Kunde</th><th>Datum</th><th>Gültig bis</th><th>Status</th><th class="text-right">Brutto</th></tr></thead>
        <tbody>
          ${filtered.map((a) => `
            <tr data-id="${a.id}">
              ${bulk.rowCell(a.id)}
              <td>${escapeHtml(a.nummer)}</td>
              <td>${escapeHtml(kundenById[a.kundeId]?.firma || '')}</td>
              <td>${formatDate(a.datum)}</td>
              <td>${formatDate(a.gueltigBis)}</td>
              <td><span class="badge ${STATUS_BADGE[a.status] || 'badge'}">${STATUS_LABEL[a.status] || a.status}</span></td>
              <td class="text-right">${formatCurrency(a.brutto)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    tableHost.querySelectorAll('tbody tr').forEach((row) => {
      row.addEventListener('click', () => openForm(angebote.find((a) => a.id === row.dataset.id)));
    });
    bulk.wire(tableHost, {
      onChange: renderTable,
      onDeleted: (ids) => {
        angebote = angebote.filter((a) => !ids.includes(a.id));
        filtered = filtered.filter((a) => !ids.includes(a.id));
        renderTable();
      },
    });
  }

  container.querySelector('#search').addEventListener('input', applyFilter);
  container.querySelector('#status-filter').addEventListener('change', applyFilter);
  container.querySelector('#btn-new').addEventListener('click', () => openForm());

  function openForm(a) {
    const isEdit = !!a;
    const data = a || {
      id: uid(), nummer: '', kundeId: '', projektId: '', datum: todayISO(),
      gueltigBis: addDays(todayISO(), settings.angebotGueltigTage || 30),
      status: 'entwurf', betreff: '', notizen: '', positionen: [], createdAt: new Date().toISOString(),
      steuerart: settings.kleinunternehmer ? 'kleinunternehmer' : 'regel',
    };

    const { body, close } = openModal({
      title: isEdit ? `Angebot ${data.nummer}` : 'Neues Angebot',
      wide: true,
      bodyHtml: `
        <form id="ang-form">
          <div class="form-grid">
            <div class="field"><label>Kunde *</label>
              <select name="kundeId" required><option value="">– wählen –</option>${kunden.map((k) => `<option value="${k.id}" ${k.id === data.kundeId ? 'selected' : ''}>${escapeHtml(k.firma)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Projekt</label>
              <select name="projektId"><option value="">–</option>${projekte.map((p) => `<option value="${p.id}" ${p.id === data.projektId ? 'selected' : ''}>${escapeHtml(p.titel)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Datum</label><input type="date" name="datum" value="${data.datum}"></div>
            <div class="field"><label>Gültig bis</label><input type="date" name="gueltigBis" value="${data.gueltigBis}"></div>
            <div class="field col-span-2"><label>Betreff</label><input name="betreff" value="${escapeHtml(data.betreff || '')}" placeholder="z.B. Angebot für Elektroinstallation"></div>
            <div class="field col-span-2"><label>Steuerart</label>
              <select name="steuerart" id="f-steuerart">${STEUERARTEN.map((s) => `<option value="${s.id}" ${s.id === (data.steuerart || 'regel') ? 'selected' : ''}>${escapeHtml(s.titel)}</option>`).join('')}</select>
            </div>
            ${isEdit ? `<div class="field"><label>Status</label>
              <select name="status">${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${k === data.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
            </div>` : ''}
          </div>
          <div class="divider"></div>
          <div class="flex-row" style="margin-bottom:10px">
            <button type="button" class="btn btn-sm" id="btn-ki-erstellen">✨ Mit KI aus Stichpunkten erstellen</button>
          </div>
          <div id="pos-host"></div>
          <div id="tb-picker-host"></div>
          <div class="field col-span-2" style="margin-top:10px"><label>Notizen / Schlusstext</label><textarea name="notizen">${escapeHtml(data.notizen || '')}</textarea></div>
          <div class="modal-actions">
            ${isEdit ? '<button type="button" class="btn btn-danger" id="btn-delete">Löschen</button>' : ''}
            ${isEdit ? '<button type="button" class="btn" id="btn-print">Drucken / PDF</button>' : ''}
            ${isEdit && data.kundeId ? '<button type="button" class="btn" id="btn-email">Per E-Mail senden</button>' : ''}
            ${isEdit && kundenById[data.kundeId]?.telefon ? '<button type="button" class="btn" id="btn-whatsapp">📱 WhatsApp</button>' : ''}
            ${isEdit && data.status !== 'abgelehnt' ? '<button type="button" class="btn" id="btn-to-rechnung">→ Rechnung erstellen</button>' : ''}
            <span class="spacer"></span>
            <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Speichern</button>
          </div>
        </form>
      `,
    });

let editor = createPositionsEditor({
      host: body.querySelector('#pos-host'),
      katalog,
      positionen: data.positionen,
      defaultSteuersatz: settings.standardSteuersatz,
      vorlagen,
    });

    mountTextbausteinPicker(body.querySelector('#tb-picker-host'), {
      textbausteine, kategorie: 'angebot',
      onInsert: (text) => {
        const field = body.querySelector('textarea[name="notizen"]');
        field.value = field.value ? field.value + '\n\n' + text : text;
      },
    });

    body.querySelector('#f-steuerart').addEventListener('change', (e) => {
      if (e.target.value !== 'regel') {
        for (const p of editor.getPositionen()) p.steuersatz = 0;
        editor.refresh();
      }
    });

    body.querySelector('#btn-ki-erstellen').addEventListener('click', async () => {
      const stichpunkte = window.prompt('Stichpunkte für das Angebot (z.B. "3 Steckdosen Wohnzimmer, 1 neuer Sicherungskasten, Verkabelung Garage"):');
      if (!stichpunkte || !stichpunkte.trim()) return;
      const btn = body.querySelector('#btn-ki-erstellen');
      btn.disabled = true;
      btn.textContent = 'KI erstellt Vorschlag ...';
      try {
        const kundeId = body.querySelector('select[name="kundeId"]').value;
        const kunde = kundenById[kundeId];
        const result = await generateAngebotFromStichpunkte({
          stichpunkte, kundeName: kunde?.firma, katalog,
        });
        if (result.betreff) body.querySelector('input[name="betreff"]').value = result.betreff;
        if (result.einleitung) {
          const notizenField = body.querySelector('textarea[name="notizen"]');
          notizenField.value = result.einleitung + (notizenField.value ? '\n\n' + notizenField.value : '');
        }
        const neuePositionen = [
          ...editor.getPositionen(),
          ...(result.positionen || []).map((p) => ({ ...p, id: uid() })),
        ];
        editor = createPositionsEditor({
          host: body.querySelector('#pos-host'), katalog, positionen: neuePositionen,
          defaultSteuersatz: settings.standardSteuersatz, vorlagen,
        });
        toast(`${(result.positionen || []).length} Positionen von der KI übernommen`, 'success');
      } catch (err) {
        toast(err.message, 'danger');
      }
      btn.disabled = false;
      btn.textContent = '✨ Mit KI aus Stichpunkten erstellen';
    });

    body.querySelector('#btn-cancel').addEventListener('click', close);
    if (isEdit) {
      body.querySelector('#btn-delete').addEventListener('click', async () => {
        if (!confirmDelete(`Angebot ${data.nummer} wirklich löschen?`)) return;
        await remove('angebote', data.id);
        toast('Angebot gelöscht');
        close();
        render(container);
      });
      function docOpts() {
        const totals = editor.getTotals();
        return {
          settings, art: 'Angebot', nummer: data.nummer, datum: data.datum,
          refLabel: 'Gültig bis', refValue: formatDate(data.gueltigBis),
          kunde: kundenById[data.kundeId], betreff: data.betreff,
          projekt: projekte.find((p) => p.id === data.projektId)?.titel || '',
          introText: 'vielen Dank für Ihre Anfrage. Gerne unterbreiten wir Ihnen folgendes Angebot:',
          positionen: editor.getPositionen(), totals,
          steuerHinweis: STEUERARTEN.find((s) => s.id === data.steuerart)?.hinweis || '',
          closingText: (data.notizen || '') + '\n\nWir freuen uns auf Ihren Auftrag.',
        };
      }
      body.querySelector('#btn-print').addEventListener('click', () => {
        printHtml(buildDocHtml(docOpts()), settings);
      });
      const emailBtn = body.querySelector('#btn-email');
      if (emailBtn) {
        emailBtn.addEventListener('click', () => {
          const kunde = kundenById[data.kundeId];
          openEmailComposer({
            to: kunde?.email || '',
            subject: `Angebot ${data.nummer}${data.betreff ? ' – ' + data.betreff : ''}`,
            bodyText: `Hallo${kunde?.ansprechpartner ? ' ' + kunde.ansprechpartner : ''},\n\nanbei erhalten Sie unser Angebot ${data.nummer}.\n\nMit freundlichen Grüßen\n${settings.firmenname}`,
            filename: `Angebot-${data.nummer}.pdf`,
            buildPdfBlob: () => buildDocPdfBlob(docOpts()),
          });
        });
      }
      const whatsappBtn = body.querySelector('#btn-whatsapp');
      if (whatsappBtn) {
        whatsappBtn.addEventListener('click', () => {
          const kunde = kundenById[data.kundeId];
          sendDocumentViaWhatsApp({
            phone: kunde?.telefon,
            text: `Hallo${kunde?.ansprechpartner ? ' ' + kunde.ansprechpartner : ''}, anbei unser Angebot ${data.nummer}. Die PDF-Datei wurde gerade heruntergeladen – bitte hier im Chat anhängen. Viele Grüße, ${settings.firmenname}`,
            pdfBlob: buildDocPdfBlob(docOpts()),
            filename: `Angebot-${data.nummer}.pdf`,
          });
        });
      }
      const toRechnungBtn = body.querySelector('#btn-to-rechnung');
      if (toRechnungBtn) {
        toRechnungBtn.addEventListener('click', async () => {
          const totals = editor.getTotals();
          const rSettings = await getSettings();
          const nummer = nextNummer(rSettings.rechnungPrefix, rSettings.naechsteRechnungNr);
          const rechnung = {
            id: uid(), nummer, kundeId: data.kundeId, projektId: data.projektId, angebotId: data.id,
            datum: todayISO(), faelligAm: addDays(todayISO(), rSettings.zahlungszielTage || 14),
            status: 'offen', betreff: data.betreff, notizen: data.notizen, steuerart: data.steuerart || 'regel',
            positionen: editor.getPositionen(), netto: totals.netto, steuer: totals.steuer, brutto: totals.brutto,
            createdAt: new Date().toISOString(),
          };
          await put('rechnungen', rechnung);
          await setSettings({ naechsteRechnungNr: rSettings.naechsteRechnungNr + 1 });
          toast('Rechnung aus Angebot erstellt', 'success');
          close();
          window.location.hash = '#/rechnungen';
        });
      }
    }

    body.querySelector('#ang-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      updated.kundeId = fd.get('kundeId') || '';
      updated.projektId = fd.get('projektId') || '';
      updated.datum = fd.get('datum') || todayISO();
      updated.gueltigBis = fd.get('gueltigBis') || '';
      updated.betreff = (fd.get('betreff') || '').toString().trim();
      updated.notizen = (fd.get('notizen') || '').toString().trim();
      updated.steuerart = fd.get('steuerart') || 'regel';
      if (isEdit) updated.status = fd.get('status') || data.status;
      if (!updated.kundeId) { toast('Bitte einen Kunden wählen', 'danger'); return; }

      if (updated.steuerart !== 'regel') {
        for (const p of editor.getPositionen()) p.steuersatz = 0;
      }
      updated.positionen = editor.getPositionen();
      const totals = calcTotals(updated.positionen);
      updated.netto = totals.netto;
      updated.steuer = totals.steuer;
      updated.brutto = totals.brutto;

      if (!isEdit) {
        const currentSettings = await getSettings();
        updated.nummer = nextNummer(currentSettings.angebotPrefix, currentSettings.naechsteAngebotNr);
        await setSettings({ naechsteAngebotNr: currentSettings.naechsteAngebotNr + 1 });
      }

      await put('angebote', updated);
      toast(isEdit ? 'Angebot aktualisiert' : 'Angebot angelegt', 'success');
      close();
      render(container);
    });
  }

  renderTable();
}
