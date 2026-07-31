import { getAll, put, remove, getSettings, setSettings, resolveMarkeSettings, STEUERARTEN } from '../db.js';
import { uid, escapeHtml, formatCurrency, formatDate, todayISO, addDays, nextDailyNummer, toast, calcTotals, nimmDokumentVorbelegung } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import { createPositionsEditor } from '../positions.js';
import { printHtml, buildDocHtml } from '../pdf.js';
import { buildDocPdfBlob } from '../docpdf.js';
import { openEmailComposer } from '../emailsend.js';
import { sendDocumentViaWhatsApp } from '../whatsapp.js';
import { generateAngebotFromStichpunkte } from '../ai.js';
import { mountTextbausteinPicker } from '../textbausteine.js';
import { createBulkSelect } from '../bulkselect.js';
import { buildGaebBlob, gaebFilename, parseGaebXml } from '../gaeb.js';
import { mountSignaturePad } from '../signature.js';

const STATUS_LABEL = {
  entwurf: 'Entwurf', versendet: 'Versendet', angenommen: 'Angenommen', abgelehnt: 'Abgelehnt',
};
const STATUS_BADGE = {
  entwurf: 'badge', versendet: 'badge-accent', angenommen: 'badge-success', abgelehnt: 'badge-danger',
};
const GRUENDE_ABLEHNUNG = [
  { id: 'preis', titel: 'Preis zu hoch' },
  { id: 'konkurrenz', titel: 'Anderer Anbieter beauftragt' },
  { id: 'verschoben', titel: 'Projekt verschoben / auf Eis gelegt' },
  { id: 'entfaellt', titel: 'Projekt entfällt' },
  { id: 'keine_rueckmeldung', titel: 'Keine Rückmeldung vom Kunden' },
  { id: 'sonstiges', titel: 'Sonstiges' },
];

export async function render(container) {
  let [angebote, kunden, projekte, katalog, settings, vorlagen, textbausteine, marken] = await Promise.all([
    getAll('angebote'), getAll('kunden'), getAll('projekte'), getAll('katalog'), getSettings(), getAll('vorlagen'), getAll('textbausteine'), getAll('marken'),
  ]);
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));
  const markenById = Object.fromEntries(marken.map((m) => [m.id, m]));
  angebote.sort((a, b) => (b.nummer || '').localeCompare(a.nummer || ''));
  let filtered = angebote;
  const bulk = createBulkSelect('angebote', { label: 'Angebote' });

  container.innerHTML = `
    <div class="view-header">
      <h1>Angebote</h1>
      <div class="actions">
        <button class="btn" id="btn-gaeb-import">📥 GAEB-LV importieren</button>
        <button class="btn btn-primary" id="btn-new">+ Neues Angebot</button>
      </div>
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
              <td><span class="badge ${STATUS_BADGE[a.status] || 'badge'}" ${a.status === 'abgelehnt' && (a.ablehnungsgrund || a.ablehnungsgrundText) ? `title="${escapeHtml([GRUENDE_ABLEHNUNG.find((g) => g.id === a.ablehnungsgrund)?.titel, a.ablehnungsgrundText].filter(Boolean).join(' – '))}"` : ''}>${STATUS_LABEL[a.status] || a.status}</span></td>
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
  container.querySelector('#btn-gaeb-import').addEventListener('click', () => openGaebImport());

  function openGaebImport() {
    const { body, close } = openModal({
      title: 'GAEB-Leistungsverzeichnis importieren',
      bodyHtml: `
        <p class="hint">GAEB-DA-XML-Datei (.x83/.d83/.xml) eines Architekten/Ausschreibers wählen - Positionen (Menge, Einheit, Text) werden als neues Angebot ohne Preise angelegt, die Preise kalkulierst du danach selbst.</p>
        <div class="field"><label>GAEB-Datei</label><input type="file" id="gaeb-file" accept=".x83,.d83,.xml,application/xml,text/xml"></div>
        <div class="modal-actions">
          <span class="spacer"></span>
          <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
        </div>
      `,
    });
    body.querySelector('#btn-cancel').addEventListener('click', close);
    body.querySelector('#gaeb-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      const { positionen, projektName, error } = parseGaebXml(text);
      if (error || positionen.length === 0) {
        toast(error || 'Keine Positionen in dieser Datei gefunden.', 'danger');
        return;
      }
      close();
      openForm(null, { positionen, betreff: projektName ? `Leistungsverzeichnis: ${projektName}` : '' });
    });
  }

  // Kommt der Nutzer über den "+ Angebot"-Schnellknopf aus der Projekt-Akte,
  // liegt hier eine Vorbelegung bereit - Formular direkt vorausgefüllt öffnen.
  const angebotVorbelegung = nimmDokumentVorbelegung();
  if (angebotVorbelegung) openForm(null, angebotVorbelegung);

  function openForm(a, prefill) {
    const isEdit = !!a;
    const data = a || {
      id: uid(), nummer: '', kundeId: prefill?.kundeId || '', projektId: prefill?.projektId || '', datum: todayISO(),
      gueltigBis: addDays(todayISO(), settings.angebotGueltigTage || 30),
      status: 'entwurf', betreff: prefill?.betreff || '', notizen: '', positionen: prefill?.positionen || [], createdAt: new Date().toISOString(),
      steuerart: settings.kleinunternehmer ? 'kleinunternehmer' : 'regel',
      unterschriftKunde: '', ablehnungsgrund: '', ablehnungsgrundText: '',
    };

    const suggestedNummer = !isEdit
      ? nextDailyNummer(settings.angebotPrefix, { datum: settings.angebotNummerDatum, zaehler: settings.angebotNummerZaehler }).nummer
      : '';

    const { body, close } = openModal({
      title: isEdit ? `Angebot ${data.nummer}` : 'Neues Angebot',
      wide: true,
      bodyHtml: `
        <form id="ang-form">
          <div class="form-grid">
            <div class="field"><label>Nummer</label><input name="nummer" value="${escapeHtml(data.nummer || suggestedNummer)}"></div>
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
              <select name="status" id="f-status">${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${k === data.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
            </div>
            <div class="col-span-2" id="ablehnung-grund-section" ${data.status === 'abgelehnt' ? '' : 'hidden'}>
              <div class="field">
                <label>Grund der Ablehnung</label>
                <select name="ablehnungsgrund">${GRUENDE_ABLEHNUNG.map((g) => `<option value="${g.id}" ${g.id === data.ablehnungsgrund ? 'selected' : ''}>${escapeHtml(g.titel)}</option>`).join('')}</select>
                <input type="text" name="ablehnungsgrundText" value="${escapeHtml(data.ablehnungsgrundText || '')}" placeholder="Notiz (optional)" style="margin-top:6px">
              </div>
            </div>` : ''}
          </div>
          <div class="divider"></div>
          <div class="flex-row" style="margin-bottom:10px">
            <button type="button" class="btn btn-sm" id="btn-ki-erstellen">✨ Mit KI aus Stichpunkten erstellen</button>
          </div>
          <div id="pos-host"></div>
          <div id="tb-picker-host"></div>
          <div class="field col-span-2" style="margin-top:10px"><label>Notizen / Schlusstext</label><textarea name="notizen">${escapeHtml(data.notizen || '')}</textarea></div>
          <div class="divider"></div>
          <h2 style="font-size:14px;margin:0 0 8px">Unterschrift Kunde (Angebotsannahme)</h2>
          <p class="hint">Der Kunde kann direkt hier auf dem Bildschirm/Tablet unterschreiben. Beim Ausdrucken erscheint zusätzlich immer eine leere Unterschriftslinie zum handschriftlichen Unterschreiben.</p>
          <div id="sig-host"></div>
          <div class="modal-actions">
            ${isEdit ? '<button type="button" class="btn btn-danger" id="btn-delete">Löschen</button>' : ''}
            ${isEdit ? '<button type="button" class="btn" id="btn-print">Drucken / PDF</button>' : ''}
            ${isEdit ? '<button type="button" class="btn" id="btn-gaeb-export" title="Bepreistes Leistungsverzeichnis im GAEB-Format">GAEB exportieren</button>' : ''}
            ${isEdit && data.kundeId ? '<button type="button" class="btn" id="btn-email">Per E-Mail senden</button>' : ''}
            ${isEdit && kundenById[data.kundeId]?.telefon ? '<button type="button" class="btn" id="btn-whatsapp">📱 WhatsApp</button>' : ''}
            ${isEdit && data.status !== 'abgelehnt' ? '<button type="button" class="btn" id="btn-to-ab">→ Auftragsbestätigung erstellen</button>' : ''}
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

    const sigHost = body.querySelector('#sig-host');
    let sigPad = null;
    let sigDataUrl = data.unterschriftKunde || '';
    function renderSig() {
      if (sigDataUrl) {
        sigPad = null;
        sigHost.innerHTML = `
          <div class="field">
            <img src="${sigDataUrl}" alt="Unterschrift Kunde" style="max-width:260px;max-height:110px;border:1px solid var(--border);border-radius:6px;background:#fff;display:block">
            <button type="button" class="btn btn-sm" id="btn-sig-neu" style="margin-top:6px;align-self:flex-start">Neu unterschreiben</button>
          </div>
        `;
        sigHost.querySelector('#btn-sig-neu').addEventListener('click', () => { sigDataUrl = ''; renderSig(); });
      } else {
        sigPad = mountSignaturePad(sigHost, {});
      }
    }
    renderSig();

    if (isEdit) {
      body.querySelector('#f-status').addEventListener('change', (e) => {
        body.querySelector('#ablehnung-grund-section').hidden = e.target.value !== 'abgelehnt';
      });
    }

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
        if (!confirmDelete(`Angebot ${data.nummer} in den Papierkorb verschieben?`)) return;
        await remove('angebote', data.id);
        toast('Angebot in den Papierkorb verschoben');
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
          settings: getEffectiveSettings(), art: 'Angebot', nummer: data.nummer, datum: data.datum,
          refLabel: 'Gültig bis', refValue: formatDate(data.gueltigBis),
          kunde: kundenById[data.kundeId], betreff: data.betreff,
          projekt: projekte.find((p) => p.id === data.projektId)?.titel || '',
          introText: 'vielen Dank für Ihre Anfrage. Gerne unterbreiten wir Ihnen folgendes Angebot:',
          positionen: editor.getPositionen(), totals,
          steuerHinweis: STEUERARTEN.find((s) => s.id === data.steuerart)?.hinweis || '',
          closingText: (data.notizen || '') + '\n\nWir freuen uns auf Ihren Auftrag.',
          zeigeUnterschriftsfeld: true,
          unterschriftKunde: sigDataUrl || (sigPad && !sigPad.isEmpty() ? sigPad.getDataUrl() : null),
        };
      }
      body.querySelector('#btn-print').addEventListener('click', () => {
        printHtml(buildDocHtml(docOpts()), settings);
      });
      body.querySelector('#btn-gaeb-export').addEventListener('click', () => {
        const opts = docOpts();
        const blob = buildGaebBlob({
          projektName: opts.betreff || opts.projekt || data.nummer, nummer: data.nummer, datum: data.datum,
          positionen: opts.positionen, settings: opts.settings,
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = gaebFilename(data.nummer);
        a.click();
        URL.revokeObjectURL(url);
      });
      const emailBtn = body.querySelector('#btn-email');
      if (emailBtn) {
        emailBtn.addEventListener('click', () => {
          const kunde = kundenById[data.kundeId];
          openEmailComposer({
            to: kunde?.email || '',
            subject: `Angebot ${data.nummer}${data.betreff ? ' – ' + data.betreff : ''}`,
            bodyText: `Hallo${kunde?.ansprechpartner ? ' ' + kunde.ansprechpartner : ''},\n\nanbei erhalten Sie unser Angebot ${data.nummer}.\n\nMit freundlichen Grüßen\n${getEffectiveSettings().firmenname}`,
            filename: `Angebot-${data.nummer}.pdf`,
            buildPdfBlob: () => buildDocPdfBlob(docOpts()),
          });
        });
      }
      const whatsappBtn = body.querySelector('#btn-whatsapp');
      if (whatsappBtn) {
        whatsappBtn.addEventListener('click', async () => {
          const kunde = kundenById[data.kundeId];
          sendDocumentViaWhatsApp({
            phone: kunde?.telefon,
            text: `Hallo${kunde?.ansprechpartner ? ' ' + kunde.ansprechpartner : ''}, anbei unser Angebot ${data.nummer}. Die PDF-Datei wurde gerade heruntergeladen – bitte hier im Chat anhängen. Viele Grüße, ${getEffectiveSettings().firmenname}`,
            pdfBlob: await buildDocPdfBlob(docOpts()),
            filename: `Angebot-${data.nummer}.pdf`,
          });
        });
      }
      const toAbBtn = body.querySelector('#btn-to-ab');
      if (toAbBtn) {
        toAbBtn.addEventListener('click', async () => {
          const totals = editor.getTotals();
          const abSettings = await getSettings();
          const { nummer, datum: nDatum, zaehler: nZaehler } = nextDailyNummer(
            abSettings.auftragsbestaetigungPrefix, { datum: abSettings.auftragsbestaetigungNummerDatum, zaehler: abSettings.auftragsbestaetigungNummerZaehler }
          );
          const auftragsbestaetigung = {
            id: uid(), nummer, kundeId: data.kundeId, projektId: data.projektId, angebotId: data.id,
            datum: todayISO(), status: 'entwurf', betreff: data.betreff, notizen: data.notizen, steuerart: data.steuerart || 'regel',
            positionen: editor.getPositionen().map((p) => ({ ...p, id: uid() })),
            netto: totals.netto, steuer: totals.steuer, brutto: totals.brutto,
            createdAt: new Date().toISOString(),
          };
          await put('auftragsbestaetigungen', auftragsbestaetigung);
          await setSettings({ auftragsbestaetigungNummerDatum: nDatum, auftragsbestaetigungNummerZaehler: nZaehler });
          toast('Auftragsbestätigung aus Angebot erstellt', 'success');
          close();
          window.location.hash = '#/auftragsbestaetigung';
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
            id: uid(), nummer, kundeId: data.kundeId, projektId: data.projektId, angebotId: data.id,
            datum: todayISO(), faelligAm: addDays(todayISO(), rSettings.zahlungszielTage || 14),
            status: 'offen', betreff: data.betreff, notizen: data.notizen, steuerart: data.steuerart || 'regel',
            positionen: editor.getPositionen(), netto: totals.netto, steuer: totals.steuer, brutto: totals.brutto,
            createdAt: new Date().toISOString(),
          };
          await put('rechnungen', rechnung);
          await setSettings({ rechnungNummerDatum: nDatum, rechnungNummerZaehler: nZaehler });
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
      updated.nummer = (fd.get('nummer') || '').toString().trim();
      updated.kundeId = fd.get('kundeId') || '';
      updated.projektId = fd.get('projektId') || '';
      updated.datum = fd.get('datum') || todayISO();
      updated.gueltigBis = fd.get('gueltigBis') || '';
      updated.betreff = (fd.get('betreff') || '').toString().trim();
      updated.notizen = (fd.get('notizen') || '').toString().trim();
      updated.steuerart = fd.get('steuerart') || 'regel';
      if (isEdit) {
        updated.status = fd.get('status') || data.status;
        if (updated.status === 'abgelehnt') {
          updated.ablehnungsgrund = fd.get('ablehnungsgrund') || '';
          updated.ablehnungsgrundText = (fd.get('ablehnungsgrundText') || '').toString().trim();
        } else {
          updated.ablehnungsgrund = '';
          updated.ablehnungsgrundText = '';
        }
      }
      if (!updated.kundeId) { toast('Bitte einen Kunden wählen', 'danger'); return; }
      updated.unterschriftKunde = sigDataUrl || (sigPad && !sigPad.isEmpty() ? sigPad.getDataUrl() : '');

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
          currentSettings.angebotPrefix, { datum: currentSettings.angebotNummerDatum, zaehler: currentSettings.angebotNummerZaehler }
        );
        if (!updated.nummer) updated.nummer = autoNummer;
        await setSettings({ angebotNummerDatum: nDatum, angebotNummerZaehler: nZaehler });
      }

      await put('angebote', updated);
      toast(isEdit ? 'Angebot aktualisiert' : 'Angebot angelegt', 'success');
      close();
      render(container);
    });
  }

  renderTable();
}
