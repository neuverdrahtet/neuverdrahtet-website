import { getAll, put, remove, getSettings, setSettings, resolveMarkeSettings, STEUERARTEN } from '../db.js';
import { uid, escapeHtml, formatCurrency, formatDate, todayISO, addDays, nextDailyNummer, toast, calcTotals } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import { createPositionsEditor } from '../positions.js';
import { printHtml, buildDocHtml } from '../pdf.js';
import { buildDocPdfBlob } from '../docpdf.js';
import { openEmailComposer } from '../emailsend.js';
import { sendDocumentViaWhatsApp } from '../whatsapp.js';
import { mountTextbausteinPicker } from '../textbausteine.js';
import { createBulkSelect } from '../bulkselect.js';

const STATUS_LABEL = { entwurf: 'Entwurf', versendet: 'Versendet', bestaetigt: 'Bestätigt' };
const STATUS_BADGE = { entwurf: 'badge', versendet: 'badge-accent', bestaetigt: 'badge-success' };

export async function render(container) {
  let [dokumente, kunden, projekte, katalog, settings, vorlagen, textbausteine, angebote, marken] = await Promise.all([
    getAll('auftragsbestaetigungen'), getAll('kunden'), getAll('projekte'), getAll('katalog'), getSettings(), getAll('vorlagen'), getAll('textbausteine'), getAll('angebote'), getAll('marken'),
  ]);
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));
  const markenById = Object.fromEntries(marken.map((m) => [m.id, m]));
  dokumente.sort((a, b) => (b.nummer || '').localeCompare(a.nummer || ''));
  let filtered = dokumente;
  const bulk = createBulkSelect('auftragsbestaetigungen', { label: 'Auftragsbestätigungen' });

  container.innerHTML = `
    <div class="view-header">
      <h1>Auftragsbestätigungen</h1>
      <div class="actions"><button class="btn btn-primary" id="btn-new">+ Neue Auftragsbestätigung</button></div>
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
    filtered = dokumente.filter((a) => {
      if (status && a.status !== status) return false;
      if (!q) return true;
      return [a.nummer, kundenById[a.kundeId]?.firma].filter(Boolean).join(' ').toLowerCase().includes(q);
    });
    renderTable();
  }

  function renderTable() {
    if (filtered.length === 0) {
      tableHost.innerHTML = `<div class="empty-state">Noch keine Auftragsbestätigungen erstellt.</div>`;
      return;
    }
    tableHost.innerHTML = `
      ${bulk.barHtml()}
      <table class="data-table">
        <thead><tr>${bulk.headerCell()}<th>Nummer</th><th>Kunde</th><th>Datum</th><th>Status</th><th class="text-right">Brutto</th></tr></thead>
        <tbody>
          ${filtered.map((a) => `
            <tr data-id="${a.id}">
              ${bulk.rowCell(a.id)}
              <td>${escapeHtml(a.nummer)}</td>
              <td>${escapeHtml(kundenById[a.kundeId]?.firma || '')}</td>
              <td>${formatDate(a.datum)}</td>
              <td><span class="badge ${STATUS_BADGE[a.status] || 'badge'}">${STATUS_LABEL[a.status] || a.status}</span></td>
              <td class="text-right">${formatCurrency(a.brutto)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    tableHost.querySelectorAll('tbody tr').forEach((row) => {
      row.addEventListener('click', () => openForm(dokumente.find((a) => a.id === row.dataset.id)));
    });
    bulk.wire(tableHost, {
      onChange: renderTable,
      onDeleted: (ids) => {
        dokumente = dokumente.filter((a) => !ids.includes(a.id));
        filtered = filtered.filter((a) => !ids.includes(a.id));
        renderTable();
      },
    });
  }

  container.querySelector('#search').addEventListener('input', applyFilter);
  container.querySelector('#status-filter').addEventListener('change', applyFilter);
  container.querySelector('#btn-new').addEventListener('click', () => openForm());

  function openForm(a, ausAngebot) {
    const isEdit = !!a;
    const data = a || {
      id: uid(), nummer: '', kundeId: ausAngebot?.kundeId || '', projektId: ausAngebot?.projektId || '', datum: todayISO(),
      status: 'entwurf', betreff: ausAngebot?.betreff || '', notizen: ausAngebot?.notizen || '',
      positionen: ausAngebot ? ausAngebot.positionen.map((p) => ({ ...p, id: uid() })) : [],
      angebotId: ausAngebot?.id || '', createdAt: new Date().toISOString(),
      steuerart: ausAngebot?.steuerart || (settings.kleinunternehmer ? 'kleinunternehmer' : 'regel'),
    };

    const suggestedNummer = !isEdit
      ? nextDailyNummer(settings.auftragsbestaetigungPrefix, { datum: settings.auftragsbestaetigungNummerDatum, zaehler: settings.auftragsbestaetigungNummerZaehler }).nummer
      : '';

    const { body, close } = openModal({
      title: isEdit ? `Auftragsbestätigung ${data.nummer}` : 'Neue Auftragsbestätigung',
      wide: true,
      bodyHtml: `
        <form id="ab-form">
          <div class="form-grid">
            <div class="field"><label>Nummer</label><input name="nummer" value="${escapeHtml(data.nummer || suggestedNummer)}"></div>
            <div class="field"><label>Kunde *</label>
              <select name="kundeId" required><option value="">– wählen –</option>${kunden.map((k) => `<option value="${k.id}" ${k.id === data.kundeId ? 'selected' : ''}>${escapeHtml(k.firma)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Projekt</label>
              <select name="projektId"><option value="">–</option>${projekte.map((p) => `<option value="${p.id}" ${p.id === data.projektId ? 'selected' : ''}>${escapeHtml(p.titel)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Datum</label><input type="date" name="datum" value="${data.datum}"></div>
            <div class="field col-span-2"><label>Betreff</label><input name="betreff" value="${escapeHtml(data.betreff || '')}" placeholder="z.B. Auftragsbestätigung Elektroinstallation"></div>
            <div class="field col-span-2"><label>Steuerart</label>
              <select name="steuerart" id="f-steuerart">${STEUERARTEN.map((s) => `<option value="${s.id}" ${s.id === (data.steuerart || 'regel') ? 'selected' : ''}>${escapeHtml(s.titel)}</option>`).join('')}</select>
            </div>
            ${isEdit ? `<div class="field"><label>Status</label>
              <select name="status">${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${k === data.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
            </div>` : ''}
          </div>
          <div class="divider"></div>
          <div id="pos-host"></div>
          <div id="tb-picker-host"></div>
          <div class="field col-span-2" style="margin-top:10px"><label>Notizen</label><textarea name="notizen">${escapeHtml(data.notizen || '')}</textarea></div>
          <div class="modal-actions">
            ${isEdit ? '<button type="button" class="btn btn-danger" id="btn-delete">Löschen</button>' : ''}
            ${isEdit ? '<button type="button" class="btn" id="btn-print">Drucken / PDF</button>' : ''}
            ${isEdit && data.kundeId ? '<button type="button" class="btn" id="btn-email">Per E-Mail senden</button>' : ''}
            ${isEdit && kundenById[data.kundeId]?.telefon ? '<button type="button" class="btn" id="btn-whatsapp">📱 WhatsApp</button>' : ''}
            ${isEdit ? '<button type="button" class="btn" id="btn-to-rechnung">→ Rechnung erstellen</button>' : ''}
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

    body.querySelector('#btn-cancel').addEventListener('click', close);
    if (isEdit) {
      body.querySelector('#btn-delete').addEventListener('click', async () => {
        if (!confirmDelete(`Auftragsbestätigung ${data.nummer} wirklich löschen?`)) return;
        await remove('auftragsbestaetigungen', data.id);
        toast('Auftragsbestätigung gelöscht');
        close();
        render(container);
      });
      function getEffectiveSettings() {
        const projekt = projekte.find((p) => p.id === data.projektId);
        return resolveMarkeSettings(settings, markenById[projekt?.markeId]);
      }
      function docOpts() {
        const totals = editor.getTotals();
        return {
          settings: getEffectiveSettings(), art: 'Auftragsbestätigung', nummer: data.nummer, datum: data.datum,
          kunde: kundenById[data.kundeId], betreff: data.betreff,
          projekt: projekte.find((p) => p.id === data.projektId)?.titel || '',
          introText: 'vielen Dank für Ihren Auftrag. Wir bestätigen hiermit folgende Leistungen:',
          positionen: editor.getPositionen(), totals,
          steuerHinweis: STEUERARTEN.find((s) => s.id === data.steuerart)?.hinweis || '',
          closingText: (data.notizen || '') + '\n\nWir freuen uns auf die Zusammenarbeit.',
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
            subject: `Auftragsbestätigung ${data.nummer}${data.betreff ? ' – ' + data.betreff : ''}`,
            bodyText: `Hallo${kunde?.ansprechpartner ? ' ' + kunde.ansprechpartner : ''},\n\nanbei erhalten Sie unsere Auftragsbestätigung ${data.nummer}.\n\nMit freundlichen Grüßen\n${getEffectiveSettings().firmenname}`,
            filename: `Auftragsbestaetigung-${data.nummer}.pdf`,
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
            text: `Hallo${kunde?.ansprechpartner ? ' ' + kunde.ansprechpartner : ''}, anbei unsere Auftragsbestätigung ${data.nummer}. Die PDF-Datei wurde gerade heruntergeladen – bitte hier im Chat anhängen. Viele Grüße, ${getEffectiveSettings().firmenname}`,
            pdfBlob: buildDocPdfBlob(docOpts()),
            filename: `Auftragsbestaetigung-${data.nummer}.pdf`,
          });
        });
      }
      const toRechnungBtn = body.querySelector('#btn-to-rechnung');
      if (toRechnungBtn) {
        toRechnungBtn.addEventListener('click', async () => {
          const totals = editor.getTotals();
          const rSettings = await getSettings();
          const { nummer, datum: nDatum, zaehler: nZaehler } = nextDailyNummer(
            rSettings.rechnungPrefix, { datum: rSettings.rechnungNummerDatum, zaehler: rSettings.rechnungNummerZaehler }
          );
          const rechnung = {
            id: uid(), nummer, kundeId: data.kundeId, projektId: data.projektId, auftragsbestaetigungId: data.id,
            datum: todayISO(), faelligAm: addDays(todayISO(), rSettings.zahlungszielTage || 14),
            status: 'offen', betreff: data.betreff, notizen: data.notizen, steuerart: data.steuerart || 'regel',
            positionen: editor.getPositionen(), netto: totals.netto, steuer: totals.steuer, brutto: totals.brutto,
            createdAt: new Date().toISOString(),
          };
          await put('rechnungen', rechnung);
          await setSettings({ rechnungNummerDatum: nDatum, rechnungNummerZaehler: nZaehler });
          toast('Rechnung aus Auftragsbestätigung erstellt', 'success');
          close();
          window.location.hash = '#/rechnungen';
        });
      }
    }

    body.querySelector('#ab-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      updated.nummer = (fd.get('nummer') || '').toString().trim();
      updated.kundeId = fd.get('kundeId') || '';
      updated.projektId = fd.get('projektId') || '';
      updated.datum = fd.get('datum') || todayISO();
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
        const { nummer: autoNummer, datum: nDatum, zaehler: nZaehler } = nextDailyNummer(
          currentSettings.auftragsbestaetigungPrefix, { datum: currentSettings.auftragsbestaetigungNummerDatum, zaehler: currentSettings.auftragsbestaetigungNummerZaehler }
        );
        if (!updated.nummer) updated.nummer = autoNummer;
        await setSettings({ auftragsbestaetigungNummerDatum: nDatum, auftragsbestaetigungNummerZaehler: nZaehler });
      }

      await put('auftragsbestaetigungen', updated);
      toast(isEdit ? 'Auftragsbestätigung aktualisiert' : 'Auftragsbestätigung angelegt', 'success');
      close();
      render(container);
    });
  }

  renderTable();
}
