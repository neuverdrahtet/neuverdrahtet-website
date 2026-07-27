import { getAll, put, remove, getSettings, setSettings, STEUERARTEN } from '../db.js';
import { uid, escapeHtml, formatCurrency, formatDate, todayISO, addDays, nextDailyNummer, toast, calcTotals } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import { createPositionsEditor } from '../positions.js';
import { printHtml, buildDocHtml } from '../pdf.js';
import { buildDocPdfBlob } from '../docpdf.js';
import { openEmailComposer } from '../emailsend.js';
import { sendDocumentViaWhatsApp } from '../whatsapp.js';
import { generateAngebotFromStichpunkte } from '../ai.js';
import { mountTextbausteinPicker } from '../textbausteine.js';
import { createBulkSelect } from '../bulkselect.js';

const STATUS_LABEL = { offen: 'Offen', teilbezahlt: 'Teilbezahlt', bezahlt: 'Bezahlt', storniert: 'Storniert' };
const STATUS_BADGE = { offen: 'badge-warn', teilbezahlt: 'badge-accent', bezahlt: 'badge-success', storniert: 'badge-danger' };
const RECHNUNGSTYP_LABEL = { rechnung: 'Rechnung', abschlag: 'Abschlagsrechnung' };

export async function render(container) {
  let [rechnungen, kunden, projekte, katalog, settings, zeiterfassung, vorlagen, textbausteine] = await Promise.all([
    getAll('rechnungen'), getAll('kunden'), getAll('projekte'), getAll('katalog'), getSettings(), getAll('zeiterfassung'), getAll('vorlagen'), getAll('textbausteine'),
  ]);
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));
  rechnungen.sort((a, b) => (b.nummer || '').localeCompare(a.nummer || ''));
  let filtered = rechnungen;
  const today = todayISO();
  const bulk = createBulkSelect('rechnungen', { label: 'Rechnungen' });

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
      ${bulk.barHtml()}
      <table class="data-table">
        <thead><tr>${bulk.headerCell()}<th>Nummer</th><th>Kunde</th><th>Typ</th><th>Datum</th><th>Fällig am</th><th>Status</th><th class="text-right">Brutto</th></tr></thead>
        <tbody>
          ${filtered.map((r) => {
            const overdue = (r.status === 'offen' || r.status === 'teilbezahlt') && r.faelligAm && r.faelligAm < today;
            const abschlagsSumme = (r.verrechneteAbschlaege || []).reduce((s, a) => s + (a.betrag || 0), 0);
            return `
            <tr data-id="${r.id}">
              ${bulk.rowCell(r.id, !!r.versendet)}
              <td>${escapeHtml(r.nummer)}</td>
              <td>${escapeHtml(kundenById[r.kundeId]?.firma || '')}</td>
              <td><span class="badge ${r.rechnungstyp === 'abschlag' ? 'badge-warn' : ''}">${escapeHtml(RECHNUNGSTYP_LABEL[r.rechnungstyp] || 'Rechnung')}</span>${r.verrechnetIn ? `<div class="text-mute" style="font-size:11px">verrechnet in ${escapeHtml(r.verrechnetIn)}</div>` : ''}</td>
              <td>${formatDate(r.datum)}</td>
              <td>${formatDate(r.faelligAm)}</td>
              <td>
                <span class="badge ${STATUS_BADGE[r.status] || 'badge'}">${STATUS_LABEL[r.status] || r.status}</span>
                ${overdue ? '<span class="badge badge-danger">überfällig</span>' : ''}
              </td>
              <td class="text-right">${formatCurrency(r.brutto)}${abschlagsSumme ? `<div class="text-mute" style="font-size:11px">Rest: ${formatCurrency(r.brutto - abschlagsSumme)}</div>` : ''}</td>
            </tr>
          `; }).join('')}
        </tbody>
      </table>
    `;
    tableHost.querySelectorAll('tbody tr').forEach((row) => {
      row.addEventListener('click', () => openForm(rechnungen.find((r) => r.id === row.dataset.id)));
    });
    bulk.wire(tableHost, {
      onChange: renderTable,
      onDeleted: (ids) => {
        rechnungen = rechnungen.filter((r) => !ids.includes(r.id));
        filtered = filtered.filter((r) => !ids.includes(r.id));
        renderTable();
      },
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
      versendet: false, versendetAm: '', stornoVonNummer: '', storniertDurchNummer: '',
      steuerart: settings.kleinunternehmer ? 'kleinunternehmer' : 'regel',
      rechnungstyp: 'rechnung', verrechneteAbschlaege: [], verrechnetIn: '',
    };
    const locked = isEdit && !!data.versendet;
    const abschlaegeChecked = new Set((data.verrechneteAbschlaege || []).map((a) => a.rechnungId));
    const suggestedNummer = !isEdit
      ? nextDailyNummer(settings.rechnungPrefix, { datum: settings.rechnungNummerDatum, zaehler: settings.rechnungNummerZaehler }).nummer
      : '';

    const { body, close } = openModal({
      title: isEdit ? `Rechnung ${data.nummer}` : 'Neue Rechnung',
      wide: true,
      bodyHtml: `
        <form id="re-form">
          ${locked ? `<p class="hint">🔒 Versendet am ${formatDate(data.versendetAm)} – gesperrt (GoBD). ${data.stornoVonNummer ? `Stornorechnung zu ${escapeHtml(data.stornoVonNummer)}.` : ''} ${data.storniertDurchNummer ? `Storniert durch ${escapeHtml(data.storniertDurchNummer)}.` : ''}</p>` : ''}
          <div class="form-grid">
            <div class="field"><label>Nummer</label><input name="nummer" value="${escapeHtml(data.nummer || suggestedNummer)}" ${locked ? 'disabled' : ''}></div>
            <div class="field"><label>Kunde *</label>
              <select name="kundeId" required ${locked ? 'disabled' : ''}><option value="">– wählen –</option>${kunden.map((k) => `<option value="${k.id}" ${k.id === data.kundeId ? 'selected' : ''}>${escapeHtml(k.firma)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Projekt</label>
              <select name="projektId" ${locked ? 'disabled' : ''}><option value="">–</option>${projekte.map((p) => `<option value="${p.id}" ${p.id === data.projektId ? 'selected' : ''}>${escapeHtml(p.titel)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Rechnungsdatum</label><input type="date" name="datum" value="${data.datum}" ${locked ? 'disabled' : ''}></div>
            <div class="field"><label>Fällig am</label><input type="date" name="faelligAm" value="${data.faelligAm}" ${locked ? 'disabled' : ''}></div>
            <div class="field col-span-2"><label>Betreff</label><input name="betreff" value="${escapeHtml(data.betreff || '')}" ${locked ? 'disabled' : ''}></div>
            <div class="field"><label>Steuerart</label>
              <select name="steuerart" id="f-steuerart" ${locked ? 'disabled' : ''}>${STEUERARTEN.map((s) => `<option value="${s.id}" ${s.id === (data.steuerart || 'regel') ? 'selected' : ''}>${escapeHtml(s.titel)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Rechnungsart</label>
              <select name="rechnungstyp" id="f-rechnungstyp" ${locked ? 'disabled' : ''}>
                <option value="rechnung" ${(data.rechnungstyp || 'rechnung') === 'rechnung' ? 'selected' : ''}>Rechnung / Schlussrechnung</option>
                <option value="abschlag" ${data.rechnungstyp === 'abschlag' ? 'selected' : ''}>Abschlagsrechnung</option>
              </select>
            </div>
            ${isEdit ? `
              <div class="field"><label>Status</label>
                <select name="status">${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${k === data.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
              </div>
              <div class="field"><label>Bezahlt am</label><input type="date" name="bezahltAm" value="${data.bezahltAm || ''}"></div>
            ` : ''}
          </div>
          <div class="divider"></div>
          ${!locked ? `
            <div class="flex-row flex-wrap" style="margin-bottom:10px">
              <button type="button" class="btn btn-sm" id="btn-zeit-uebernehmen">⏱️ Offene Zeiterfassung übernehmen</button>
              <button type="button" class="btn btn-sm" id="btn-ki-erstellen">✨ Mit KI aus Stichpunkten erstellen</button>
            </div>
          ` : ''}
          <div id="pos-host"></div>
          ${!locked ? '<div id="tb-picker-host"></div>' : ''}
          <div id="abschlaege-host"></div>
          <div class="field col-span-2" style="margin-top:10px"><label>Notizen</label><textarea name="notizen" ${locked ? 'disabled' : ''}>${escapeHtml(data.notizen || '')}</textarea></div>
          <div class="modal-actions">
            ${isEdit && !locked ? '<button type="button" class="btn btn-danger" id="btn-delete">Löschen</button>' : ''}
            ${isEdit && locked && data.status !== 'storniert' ? '<button type="button" class="btn btn-danger" id="btn-storno">Stornieren</button>' : ''}
            ${isEdit ? '<button type="button" class="btn" id="btn-print">Drucken / PDF</button>' : ''}
            ${isEdit && data.kundeId ? '<button type="button" class="btn" id="btn-email">Per E-Mail senden</button>' : ''}
            ${isEdit && kundenById[data.kundeId]?.telefon ? '<button type="button" class="btn" id="btn-whatsapp">📱 WhatsApp</button>' : ''}
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
      readOnly: locked,
    });

    if (!locked) {
      mountTextbausteinPicker(body.querySelector('#tb-picker-host'), {
        textbausteine, kategorie: 'rechnung',
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

      function renderAbschlaegeHost() {
        const host = body.querySelector('#abschlaege-host');
        const typ = body.querySelector('#f-rechnungstyp').value;
        const projektId = body.querySelector('select[name="projektId"]').value;
        if (typ !== 'rechnung') { host.innerHTML = ''; return; }
        const kandidaten = rechnungen.filter((r) =>
          r.rechnungstyp === 'abschlag' && r.id !== data.id && r.status !== 'storniert' &&
          (!projektId || r.projektId === projektId) && (!r.verrechnetIn || r.verrechnetIn === data.nummer)
        );
        if (kandidaten.length === 0) { host.innerHTML = ''; return; }
        host.innerHTML = `
          <div class="divider"></div>
          <h2 style="font-size:13px;margin:0 0 8px">Abschlagszahlungen berücksichtigen (Schlussrechnung)</h2>
          <div class="tag-list">
            ${kandidaten.map((r) => `
              <label class="field-checkbox" style="border:1px solid var(--border);border-radius:8px;padding:5px 10px;">
                <input type="checkbox" class="abschlag-check" value="${r.id}" ${abschlaegeChecked.has(r.id) ? 'checked' : ''}>
                ${escapeHtml(r.nummer)} · ${formatCurrency(r.brutto)}
              </label>
            `).join('')}
          </div>
        `;
        host.querySelectorAll('.abschlag-check').forEach((chk) => {
          chk.addEventListener('change', () => {
            if (chk.checked) abschlaegeChecked.add(chk.value);
            else abschlaegeChecked.delete(chk.value);
          });
        });
      }
      renderAbschlaegeHost();
      body.querySelector('#f-rechnungstyp').addEventListener('change', renderAbschlaegeHost);
      body.querySelector('select[name="projektId"]').addEventListener('change', renderAbschlaegeHost);
      body._getAbschlaegeChecked = () => Array.from(abschlaegeChecked);
    }

    let uebernommeneZeitIds = [];
    if (!locked) {
      body.querySelector('#btn-ki-erstellen').addEventListener('click', async () => {
        const stichpunkte = window.prompt('Stichpunkte für die Rechnung:');
        if (!stichpunkte || !stichpunkte.trim()) return;
        const btn = body.querySelector('#btn-ki-erstellen');
        btn.disabled = true;
        btn.textContent = 'KI erstellt Vorschlag ...';
        try {
          const kundeId = body.querySelector('select[name="kundeId"]').value;
          const kunde = kundenById[kundeId];
          const result = await generateAngebotFromStichpunkte({ stichpunkte, kundeName: kunde?.firma, katalog });
          if (result.betreff) body.querySelector('input[name="betreff"]').value = result.betreff;
          if (result.einleitung) {
            const notizenField = body.querySelector('textarea[name="notizen"]');
            notizenField.value = result.einleitung + (notizenField.value ? '\n\n' + notizenField.value : '');
          }
          const neuePositionen = [...editor.getPositionen(), ...(result.positionen || []).map((p) => ({ ...p, id: uid() }))];
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

      body.querySelector('#btn-zeit-uebernehmen').addEventListener('click', async () => {
        const projektId = body.querySelector('select[name="projektId"]').value;
        if (!projektId) { toast('Bitte zuerst ein Projekt wählen', 'danger'); return; }
        const offen = zeiterfassung.filter((z) => z.projektId === projektId && !z.abgerechnet);
        if (offen.length === 0) { toast('Keine offenen Zeiten für dieses Projekt', 'info'); return; }
        const totalMinutes = offen.reduce((s, z) => s + (z.dauerMinuten || 0), 0);
        const stunden = Math.round((totalMinutes / 60) * 100) / 100;
        const projekt = projekte.find((p) => p.id === projektId);
        const neuePositionen = [...editor.getPositionen(), {
          id: uid(), bezeichnung: `Arbeitszeit ${projekt?.titel || ''}`, beschreibung: '',
          einheit: 'Std.', menge: stunden, einzelpreis: settings.stundensatz || 0, steuersatz: settings.standardSteuersatz,
        }];
        uebernommeneZeitIds = offen.map((z) => z.id);
        Object.assign(editor, createPositionsEditor({
          host: body.querySelector('#pos-host'), katalog, positionen: neuePositionen, defaultSteuersatz: settings.standardSteuersatz, vorlagen,
        }));
        toast(`${stunden} Std. aus ${offen.length} Zeiteinträgen übernommen`, 'success');
      });
    }

    body.querySelector('#btn-cancel').addEventListener('click', close);
    if (isEdit) {
      const deleteBtn = body.querySelector('#btn-delete');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
          if (!confirmDelete(`Rechnung ${data.nummer} wirklich löschen?`)) return;
          await remove('rechnungen', data.id);
          toast('Rechnung gelöscht');
          close();
          render(container);
        });
      }
      const stornoBtn = body.querySelector('#btn-storno');
      if (stornoBtn) {
        stornoBtn.addEventListener('click', async () => {
          if (!confirmDelete(`Stornorechnung zu ${data.nummer} erstellen? Die Positionen werden mit negativem Betrag als neue, eigenständige Rechnung angelegt.`)) return;
          const currentSettings = await getSettings();
          const { nummer: stornoNummer, datum: nDatum, zaehler: nZaehler } = nextDailyNummer(
            currentSettings.rechnungPrefix, { datum: currentSettings.rechnungNummerDatum, zaehler: currentSettings.rechnungNummerZaehler }
          );
          await setSettings({ rechnungNummerDatum: nDatum, rechnungNummerZaehler: nZaehler });
          const stornoPositionen = data.positionen.map((p) => ({ ...p, id: uid(), menge: -(Number(p.menge) || 0) }));
          const stornoTotals = calcTotals(stornoPositionen);
          const storno = {
            id: uid(), nummer: stornoNummer, kundeId: data.kundeId, projektId: data.projektId, angebotId: null,
            datum: todayISO(), faelligAm: todayISO(), status: 'bezahlt', betreff: `Stornorechnung zu ${data.nummer}`,
            notizen: '', positionen: stornoPositionen, bezahltAm: todayISO(), createdAt: new Date().toISOString(),
            versendet: true, versendetAm: new Date().toISOString(), stornoVonNummer: data.nummer, storniertDurchNummer: '',
            netto: stornoTotals.netto, steuer: stornoTotals.steuer, brutto: stornoTotals.brutto,
          };
          await put('rechnungen', storno);
          await put('rechnungen', { ...data, status: 'storniert', storniertDurchNummer: stornoNummer });
          toast(`Stornorechnung ${stornoNummer} angelegt`, 'success');
          close();
          render(container);
        });
      }
      function docOpts() {
        const totals = editor.getTotals();
        const istAbschlag = data.rechnungstyp === 'abschlag';
        return {
          settings, art: istAbschlag ? 'Abschlagsrechnung' : 'Rechnung', nummer: data.nummer, datum: data.datum,
          refLabel: 'Zahlbar bis', refValue: formatDate(data.faelligAm),
          kunde: kundenById[data.kundeId], betreff: data.betreff,
          projekt: projekte.find((p) => p.id === data.projektId)?.titel || '',
          introText: 'wir bedanken uns für Ihren Auftrag und stellen Ihnen wie folgt in Rechnung:',
          positionen: editor.getPositionen(), totals,
          steuerHinweis: STEUERARTEN.find((s) => s.id === data.steuerart)?.hinweis || '',
          closingText: (data.notizen || '') + `\n\nBitte überweisen Sie den Rechnungsbetrag bis zum ${formatDate(data.faelligAm)} auf unser unten genanntes Konto.`,
          abschlaege: !istAbschlag && data.verrechneteAbschlaege?.length ? data.verrechneteAbschlaege : undefined,
        };
      }
      async function markVersendetUndSperren() {
        if (data.versendet) return;
        const persisted = { ...data, versendet: true, versendetAm: new Date().toISOString() };
        await put('rechnungen', persisted);
        Object.assign(data, persisted);
        toast('Rechnung wurde versendet und ist nun GoBD-gesperrt (nur noch per Storno korrigierbar).', 'info');
        close();
        openForm({ ...data });
      }
      body.querySelector('#btn-print').addEventListener('click', async () => {
        printHtml(buildDocHtml(docOpts()), settings);
        if (!locked) await markVersendetUndSperren();
      });
      const emailBtn = body.querySelector('#btn-email');
      if (emailBtn) {
        emailBtn.addEventListener('click', async () => {
          const kunde = kundenById[data.kundeId];
          openEmailComposer({
            to: kunde?.email || '',
            subject: `Rechnung ${data.nummer}${data.betreff ? ' – ' + data.betreff : ''}`,
            bodyText: `Hallo${kunde?.ansprechpartner ? ' ' + kunde.ansprechpartner : ''},\n\nanbei erhalten Sie unsere Rechnung ${data.nummer}, fällig am ${formatDate(data.faelligAm)}.\n\nMit freundlichen Grüßen\n${settings.firmenname}`,
            filename: `Rechnung-${data.nummer}.pdf`,
            buildPdfBlob: () => buildDocPdfBlob(docOpts()),
          });
          if (!locked) await markVersendetUndSperren();
        });
      }
      const whatsappBtn = body.querySelector('#btn-whatsapp');
      if (whatsappBtn) {
        whatsappBtn.addEventListener('click', async () => {
          const kunde = kundenById[data.kundeId];
          sendDocumentViaWhatsApp({
            phone: kunde?.telefon,
            text: `Hallo${kunde?.ansprechpartner ? ' ' + kunde.ansprechpartner : ''}, anbei unsere Rechnung ${data.nummer} (fällig am ${formatDate(data.faelligAm)}). Die PDF-Datei wurde gerade heruntergeladen – bitte hier im Chat anhängen. Viele Grüße, ${settings.firmenname}`,
            pdfBlob: buildDocPdfBlob(docOpts()),
            filename: `Rechnung-${data.nummer}.pdf`,
          });
          if (!locked) await markVersendetUndSperren();
        });
      }
    }

    body.querySelector('#re-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      if (!locked) {
        updated.nummer = (fd.get('nummer') || '').toString().trim();
        updated.kundeId = fd.get('kundeId') || '';
        updated.projektId = fd.get('projektId') || '';
        updated.datum = fd.get('datum') || todayISO();
        updated.faelligAm = fd.get('faelligAm') || '';
        updated.betreff = (fd.get('betreff') || '').toString().trim();
        updated.notizen = (fd.get('notizen') || '').toString().trim();
        updated.steuerart = fd.get('steuerart') || 'regel';
        updated.rechnungstyp = fd.get('rechnungstyp') || 'rechnung';
      }
      if (isEdit) {
        updated.status = fd.get('status') || data.status;
        updated.bezahltAm = fd.get('bezahltAm') || '';
      }
      if (!updated.kundeId) { toast('Bitte einen Kunden wählen', 'danger'); return; }

      if (updated.steuerart && updated.steuerart !== 'regel') {
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
          currentSettings.rechnungPrefix, { datum: currentSettings.rechnungNummerDatum, zaehler: currentSettings.rechnungNummerZaehler }
        );
        if (!updated.nummer) updated.nummer = autoNummer;
        await setSettings({ rechnungNummerDatum: nDatum, rechnungNummerZaehler: nZaehler });
      }

      if (!locked) {
        const previousIds = (data.verrechneteAbschlaege || []).map((a) => a.rechnungId);
        if (updated.rechnungstyp === 'rechnung') {
          const checkedIds = body._getAbschlaegeChecked ? body._getAbschlaegeChecked() : [];
          updated.verrechneteAbschlaege = checkedIds.map((id) => {
            const ar = rechnungen.find((r) => r.id === id);
            return { rechnungId: id, nummer: ar?.nummer || '', betrag: ar?.brutto || 0 };
          });
          for (const id of checkedIds) {
            if (previousIds.includes(id)) continue;
            const ar = rechnungen.find((r) => r.id === id);
            if (ar) await put('rechnungen', { ...ar, verrechnetIn: updated.nummer });
          }
          for (const id of previousIds) {
            if (checkedIds.includes(id)) continue;
            const ar = rechnungen.find((r) => r.id === id);
            if (ar) await put('rechnungen', { ...ar, verrechnetIn: '' });
          }
        } else {
          updated.verrechneteAbschlaege = [];
          for (const id of previousIds) {
            const ar = rechnungen.find((r) => r.id === id);
            if (ar) await put('rechnungen', { ...ar, verrechnetIn: '' });
          }
        }
      }

      await put('rechnungen', updated);
      for (const zid of uebernommeneZeitIds) {
        const z = zeiterfassung.find((e) => e.id === zid);
        if (z) await put('zeiterfassung', { ...z, abgerechnet: true });
      }
      toast(isEdit ? 'Rechnung aktualisiert' : 'Rechnung angelegt', 'success');
      close();
      render(container);
    });
  }

  renderTable();
}
