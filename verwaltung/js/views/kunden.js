import { getAll, put, remove, clearStore, getSettings, setSettings, BEREICHE } from '../db.js';
import { uid, escapeHtml, el, formatDate, formatCurrency, toast, excelFileToCsvText, readTextAutoEncoding, toCsv, downloadTextFile, nextDailyNummer, navigationUrl } from '../utils.js';
import { openModal, confirmDelete, attachAddressSearch } from '../ui.js';
import * as google from '../google.js';
import { openWhatsApp } from '../whatsapp.js';
import { renderDokumenteSection, KUNDE_DOKUMENT_KATEGORIEN } from '../dokumente.js';
import { createBulkSelect } from '../bulkselect.js';

const KUNDEN_FELDER = ['firma', 'ansprechpartner', 'strasse', 'plz', 'ort', 'telefon', 'email', 'notizen'];
const KUNDEN_HEADER = ['Firma/Name', 'Ansprechpartner', 'Straße', 'PLZ', 'Ort', 'Telefon', 'E-Mail', 'Notizen'];

function parseKundenCsv(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows = [];
  const errors = [];
  for (const line of lines) {
    const delimiter = line.includes(';') ? ';' : ',';
    const cols = line.split(delimiter).map((c) => c.trim());
    if (/^firma/i.test(cols[0] || '')) continue;
    const [firma, ansprechpartner, strasse, plz, ort, telefon, email, notizen] = cols;
    if (!firma) { errors.push(line); continue; }
    rows.push({
      id: uid(), firma, ansprechpartner: ansprechpartner || '', strasse: strasse || '',
      plz: plz || '', ort: ort || '', telefon: telefon || '', email: email || '', notizen: notizen || '',
    });
  }
  return { rows, errors };
}

function isLexofficeCsv(text) {
  const firstLine = (text.split(/\r?\n/)[0] || '');
  return /^kundennummer;/i.test(firstLine.trim());
}

/** lexoffice-Kontakte-Export (Kundennummer;Lieferantennummer;Firmenname;Anrede;Kontakt;Vorname;Nachname;...). */
function parseLexofficeCsv(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows = [];
  const errors = [];
  for (const line of lines) {
    const cols = line.split(';').map((c) => c.trim());
    if (/^kundennummer$/i.test(cols[0] || '')) continue;
    const [
      kundennummer, , firmenname, , kontakt, vorname, nachname, , ustId,
      , strasse1, plz1, ort1, , , , , , ,
      telefon1, telefon2, email1, email2,
      ansprechpartner1, , apVorname, apNachname, apEmail, apTelefon,
    ] = cols;
    const firma = firmenname || kontakt || [vorname, nachname].filter(Boolean).join(' ').trim();
    if (!firma) { errors.push(line); continue; }
    const ansprechpartner = ansprechpartner1 || [apVorname, apNachname].filter(Boolean).join(' ').trim();
    rows.push({
      id: uid(), firma, ansprechpartner,
      strasse: strasse1 || '', plz: plz1 || '', ort: ort1 || '',
      telefon: telefon1 || telefon2 || apTelefon || '',
      email: email1 || email2 || apEmail || '',
      notizen: ustId ? `USt-IdNr.: ${ustId}` : '',
      kundennummer: kundennummer || '',
    });
  }
  return { rows, errors };
}

export async function render(container) {
  let [kunden, projekte, spalten, kategorien, dokumente, settings, ausgaben] = await Promise.all([
    getAll('kunden'), getAll('projekte'), getAll('kanbanSpalten'), getAll('kategorien'), getAll('dokumente'), getSettings(), getAll('ausgaben'),
  ]);
  kunden.sort((a, b) => (a.firma || '').localeCompare(b.firma || ''));
  spalten.sort((a, b) => a.reihenfolge - b.reihenfolge);
  const spaltenById = Object.fromEntries(spalten.map((s) => [s.id, s]));
  const kategorienById = Object.fromEntries(kategorien.map((k) => [k.id, k]));
  let filtered = kunden;
  const bulk = createBulkSelect('kunden', { label: 'Kunden' });

  container.innerHTML = `
    <div class="view-header">
      <h1>Kunden</h1>
      <div class="actions">
        <button class="btn" id="btn-export">⇩ Export (CSV)</button>
        <button class="btn" id="btn-import">⇪ Importieren</button>
        <button class="btn btn-primary" id="btn-new">+ Neuer Kunde</button>
      </div>
    </div>
    <div class="search-bar">
      <input type="search" id="search" placeholder="Suche nach Firma, Ansprechpartner, Ort ...">
    </div>
    <div id="table-host"></div>
  `;

  const tableHost = container.querySelector('#table-host');

  function renderTable() {
    if (filtered.length === 0) {
      tableHost.innerHTML = `<div class="empty-state">Keine Kunden gefunden.</div>`;
      return;
    }
    tableHost.innerHTML = `
      ${bulk.barHtml()}
      <table class="data-table">
        <thead><tr>
          ${bulk.headerCell()}<th>Firma / Name</th><th>Ansprechpartner</th><th>Ort</th><th>Telefon</th><th>E-Mail</th>
        </tr></thead>
        <tbody>
          ${filtered.map((k) => `
            <tr data-id="${k.id}">
              ${bulk.rowCell(k.id)}
              <td>${escapeHtml(k.firma)}</td>
              <td>${escapeHtml(k.ansprechpartner || '')}</td>
              <td>${escapeHtml(k.ort || '')}</td>
              <td>${escapeHtml(k.telefon || '')}</td>
              <td>${escapeHtml(k.email || '')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    tableHost.querySelectorAll('tbody tr').forEach((row) => {
      row.addEventListener('click', () => {
        const kunde = kunden.find((k) => k.id === row.dataset.id);
        openForm(kunde);
      });
    });
    bulk.wire(tableHost, {
      onChange: renderTable,
      onDeleted: (ids) => {
        kunden = kunden.filter((k) => !ids.includes(k.id));
        filtered = filtered.filter((k) => !ids.includes(k.id));
        renderTable();
      },
    });
  }

  container.querySelector('#search').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    filtered = kunden.filter((k) =>
      [k.firma, k.ansprechpartner, k.ort, k.email, k.telefon].filter(Boolean).join(' ').toLowerCase().includes(q)
    );
    renderTable();
  });

  container.querySelector('#btn-new').addEventListener('click', () => openForm());
  container.querySelector('#btn-export').addEventListener('click', () => {
    const rows = [KUNDEN_HEADER, ...kunden.map((k) => KUNDEN_FELDER.map((f) => k[f] || ''))];
    downloadTextFile(`neuverdrahtet-kunden-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows));
    toast('Export erstellt', 'success');
  });
  container.querySelector('#btn-import').addEventListener('click', () => openImport());

  function openImport() {
    const { body, close } = openModal({
      title: 'Kunden importieren',
      wide: true,
      bodyHtml: `
        <p class="hint">CSV oder Excel (.xlsx/.xls) einfügen/wählen. Eigenes Format: <code>Firma;Ansprechpartner;Straße;PLZ;Ort;Telefon;E-Mail;Notizen</code> – nur Firma/Name ist Pflicht. Ein lexoffice-Kontakte-Export wird automatisch erkannt und passend zugeordnet. Eine optionale Kopfzeile wird erkannt.</p>
        <div class="field" style="margin-bottom:10px">
          <label>CSV- oder Excel-Datei</label>
          <input type="file" id="import-file" accept=".csv,.xlsx,.xls,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel">
        </div>
        <div class="field">
          <label>oder CSV-Text einfügen</label>
          <textarea id="import-text" style="min-height:160px;font-family:monospace" placeholder="Mustermann GmbH;Max Mustermann;Musterstr. 1;45357;Essen;0201123456;info@mustermann.de"></textarea>
        </div>
        <div class="field field-checkbox" style="margin-top:8px">
          <input type="checkbox" id="import-replace">
          <label for="import-replace">Bestehende Kunden vor dem Import löschen (vollständig ersetzen)</label>
        </div>
        <p class="hint" id="import-replace-warning" hidden>⚠️ Löscht unwiderruflich alle bisherigen Kunden. Bereits verknüpfte Projekte/Rechnungen bleiben erhalten, verweisen aber danach ggf. ins Leere.</p>
        <div id="import-preview" class="text-mute" style="margin-top:8px"></div>
        <div class="modal-actions">
          <span class="spacer"></span>
          <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
          <button type="button" class="btn btn-primary" id="btn-do-import">Importieren</button>
        </div>
      `,
    });
    body.querySelector('#btn-cancel').addEventListener('click', close);
    body.querySelector('#import-replace').addEventListener('change', (e) => {
      body.querySelector('#import-replace-warning').hidden = !e.target.checked;
    });
    body.querySelector('#import-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const isExcel = /\.xlsx?$/i.test(file.name);
      try {
        body.querySelector('#import-text').value = isExcel ? await excelFileToCsvText(file) : await readTextAutoEncoding(file);
      } catch (err) {
        toast(err.message, 'danger');
      }
    });
    body.querySelector('#btn-do-import').addEventListener('click', async () => {
      const text = body.querySelector('#import-text').value;
      const { rows, errors } = isLexofficeCsv(text) ? parseLexofficeCsv(text) : parseKundenCsv(text);
      if (rows.length === 0) {
        body.querySelector('#import-preview').textContent = 'Keine gültigen Zeilen gefunden.';
        return;
      }
      if (body.querySelector('#import-replace').checked) {
        if (!confirmDelete(`Wirklich ALLE ${kunden.length} bestehenden Kunden löschen und durch ${rows.length} neue ersetzen?`)) return;
        await clearStore('kunden');
      }
      for (const row of rows) await put('kunden', row);
      toast(`${rows.length} Kunde(n) importiert${errors.length ? `, ${errors.length} Zeile(n) übersprungen` : ''}`, 'success');
      close();
      render(container);
    });
  }

  function openForm(kunde) {
    const isEdit = !!kunde;
    const data = kunde || { id: uid(), firma: '', ansprechpartner: '', strasse: '', plz: '', ort: '', telefon: '', email: '', notizen: '', kundennummer: '' };
    const linkedProjekte = isEdit ? projekte.filter((p) => p.kundeId === data.id).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')) : [];
    const offenCount = linkedProjekte.filter((p) => !spaltenById[p.status]?.geschlossen).length;
    const linkedProjektIds = new Set(linkedProjekte.map((p) => p.id));
    const linkedAusgaben = isEdit ? ausgaben.filter((a) => a.kundeId === data.id || linkedProjektIds.has(a.projektId)) : [];
    const ausgabenSumme = linkedAusgaben.reduce((s, a) => s + (a.betragBrutto || 0), 0);
    const suggestedKundennummer = !isEdit
      ? nextDailyNummer('', { datum: settings.kundeNummerDatum, zaehler: settings.kundeNummerZaehler }).nummer
      : '';
    const { body, close } = openModal({
      title: isEdit ? 'Kunde bearbeiten' : 'Neuer Kunde',
      bodyHtml: `
        <form id="kunde-form">
          <div class="form-grid">
            <div class="field col-span-2"><label>Firma / Name *</label><input name="firma" required value="${escapeHtml(data.firma)}"></div>
            <div class="field"><label>Ansprechpartner</label><input name="ansprechpartner" value="${escapeHtml(data.ansprechpartner || '')}"></div>
            <div class="field"><label>Kundennummer</label><input name="kundennummer" value="${escapeHtml(data.kundennummer || suggestedKundennummer)}"></div>
            <div class="field"><label>Telefon</label><input name="telefon" value="${escapeHtml(data.telefon || '')}"></div>
            <div class="field"><label>E-Mail</label><input type="email" name="email" value="${escapeHtml(data.email || '')}"></div>
            <div class="field"><label>Straße & Hausnr.</label><input name="strasse" value="${escapeHtml(data.strasse || '')}"></div>
            <div class="field"><label>PLZ</label><input name="plz" value="${escapeHtml(data.plz || '')}"></div>
            <div class="field"><label>Ort</label><input name="ort" value="${escapeHtml(data.ort || '')}"></div>
            <div class="field col-span-2"><button type="button" class="btn btn-sm" id="btn-kunde-navi">🧭 Navigation zur Adresse</button></div>
            <div class="field col-span-2"><label>Notizen</label><textarea name="notizen">${escapeHtml(data.notizen || '')}</textarea></div>
          </div>
          ${isEdit ? `
            <div class="divider"></div>
            <div class="flex-row" style="justify-content:space-between;margin-bottom:8px">
              <h2 style="font-size:14px;margin:0">Aufträge &amp; Projekte (${linkedProjekte.length}, davon ${offenCount} offen)</h2>
              <button type="button" class="btn btn-sm" id="btn-akte">📁 Kundenakte öffnen</button>
            </div>
            ${linkedProjekte.length ? `<ul class="cal-event-list">${linkedProjekte.slice(0, 5).map((p) => `
              <li>
                <div>
                  <strong>${escapeHtml(p.titel)}</strong>
                  <div class="text-mute">${formatDate(p.start)}${p.ende ? ' – ' + formatDate(p.ende) : ''}</div>
                </div>
                <span class="badge badge-accent">${escapeHtml(spaltenById[p.status]?.titel || p.status || '')}</span>
              </li>
            `).join('')}</ul>${linkedProjekte.length > 5 ? `<p class="text-mute">... und ${linkedProjekte.length - 5} weitere – in der Kundenakte einsehbar.</p>` : ''}` : '<p class="text-mute">Noch keine Aufträge/Projekte für diesen Kunden.</p>'}
            ${linkedAusgaben.length ? `<p class="hint">💶 ${linkedAusgaben.length} Ausgabe(n) diesem Kunden zugeordnet · ${formatCurrency(ausgabenSumme)} – Details in der Kundenakte.</p>` : ''}
            <p class="hint">Alle Aufträge, Wartungen, Projekte, Ausgaben und Dokumente dieses Kunden findest du gesammelt in der Kundenakte.</p>
            <div class="divider"></div>
            <div id="dok-host"></div>
          ` : ''}
          ${isEdit && data.email ? `
            <div class="divider"></div>
            <div class="flex-row" style="justify-content:space-between;margin-bottom:8px">
              <h2 style="font-size:14px;margin:0">E-Mail-Verlauf (Gmail)</h2>
              <button type="button" class="btn btn-sm" id="btn-load-emails">E-Mails laden</button>
            </div>
            <div id="email-history"><p class="text-mute">Noch nicht geladen.</p></div>
          ` : ''}
          <div class="modal-actions">
            ${isEdit ? '<button type="button" class="btn btn-danger" id="btn-delete">Löschen</button>' : ''}
            ${isEdit && data.telefon ? '<button type="button" class="btn" id="btn-whatsapp">📱 Per WhatsApp senden</button>' : ''}
            <span class="spacer"></span>
            <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Speichern</button>
          </div>
        </form>
      `,
    });

    body.querySelector('#btn-cancel').addEventListener('click', close);
    attachAddressSearch(body.querySelector('input[name="strasse"]'), (r) => {
      const form = body.querySelector('#kunde-form');
      form.strasse.value = r.strasse || form.strasse.value;
      if (r.plz) form.plz.value = r.plz;
      if (r.ort) form.ort.value = r.ort;
    });
    body.querySelector('#btn-kunde-navi').addEventListener('click', () => {
      const form = body.querySelector('#kunde-form');
      const adresse = [form.strasse.value, form.plz.value, form.ort.value].filter((s) => s.trim()).join(', ');
      if (!adresse) { toast('Bitte zuerst eine Adresse eintragen', 'danger'); return; }
      window.open(navigationUrl(adresse), '_blank', 'noopener');
    });
    if (isEdit) {
      body.querySelector('#btn-akte').addEventListener('click', () => openKundenakte(data));
      renderDokumenteSection(body.querySelector('#dok-host'), 'kunde', data.id, {
        kategorien: KUNDE_DOKUMENT_KATEGORIEN, title: 'Dokumente (Rechnungen, Angebote, Verträge, ...)',
      });
      body.querySelector('#btn-delete').addEventListener('click', async () => {
        if (!confirmDelete(`Kunde "${data.firma}" wirklich löschen?`)) return;
        await remove('kunden', data.id);
        toast('Kunde gelöscht');
        close();
        render(container);
      });
      const whatsappBtn = body.querySelector('#btn-whatsapp');
      if (whatsappBtn) {
        whatsappBtn.addEventListener('click', () => {
          openWhatsApp(data.telefon, `Hallo${data.ansprechpartner ? ' ' + data.ansprechpartner : ''}, hier ist neuverdrahtet.`);
        });
      }
      const loadEmailsBtn = body.querySelector('#btn-load-emails');
      if (loadEmailsBtn) {
        loadEmailsBtn.addEventListener('click', async () => {
          const host = body.querySelector('#email-history');
          loadEmailsBtn.disabled = true;
          loadEmailsBtn.textContent = 'Lädt ...';
          host.innerHTML = '<p class="text-mute">Lädt ...</p>';
          try {
            const emails = await google.searchEmailsForAddress(data.email);
            host.innerHTML = emails.length === 0
              ? '<p class="text-mute">Keine E-Mails gefunden.</p>'
              : `<ul class="cal-event-list">${emails.map((m) => `
                  <li>
                    <div>
                      <strong>${escapeHtml(m.subject)}</strong>
                      <div class="text-mute">${escapeHtml(m.from)} · ${escapeHtml(m.date)}</div>
                      <div class="text-mute">${escapeHtml(m.snippet)}</div>
                    </div>
                    <a class="btn btn-sm" href="https://mail.google.com/mail/u/0/#all/${m.threadId}" target="_blank" rel="noopener">Öffnen</a>
                  </li>
                `).join('')}</ul>`;
          } catch (err) {
            host.innerHTML = `<p class="text-mute">Fehler: ${escapeHtml(err.message)}</p>`;
          }
          loadEmailsBtn.disabled = false;
          loadEmailsBtn.textContent = 'E-Mails laden';
        });
      }
    }

    body.querySelector('#kunde-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      for (const [k, v] of fd.entries()) updated[k] = v.trim ? v.trim() : v;
      if (!updated.firma) return;
      if (!isEdit) {
        const currentSettings = await getSettings();
        const { nummer: autoNummer, datum: nDatum, zaehler: nZaehler } = nextDailyNummer(
          '', { datum: currentSettings.kundeNummerDatum, zaehler: currentSettings.kundeNummerZaehler }
        );
        if (!updated.kundennummer) updated.kundennummer = autoNummer;
        await setSettings({ kundeNummerDatum: nDatum, kundeNummerZaehler: nZaehler });
      }
      await put('kunden', updated);
      toast(isEdit ? 'Kunde aktualisiert' : 'Kunde angelegt', 'success');
      close();
      render(container);
    });
  }

  function openKundenakte(kunde) {
    const kProjekte = projekte
      .filter((p) => p.kundeId === kunde.id)
      .sort((a, b) => (b.start || b.createdAt || '').localeCompare(a.start || a.createdAt || ''));
    const projektIds = new Set(kProjekte.map((p) => p.id));
    const projekteById2 = Object.fromEntries(kProjekte.map((p) => [p.id, p]));
    const dokAnzahl = dokumente.filter((d) => d.bezugTyp === 'projekt' && projektIds.has(d.bezugId)).length;
    const offen = kProjekte.filter((p) => !spaltenById[p.status]?.geschlossen).length;
    const kAusgaben = ausgaben
      .filter((a) => a.kundeId === kunde.id || projektIds.has(a.projektId))
      .sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));
    const kAusgabenSumme = kAusgaben.reduce((s, a) => s + (a.betragBrutto || 0), 0);

    const gruppen = [
      ...BEREICHE.map((b) => ({ id: b.id, titel: b.titel, items: kProjekte.filter((p) => p.bereich === b.id) })),
      { id: '__sonstige__', titel: 'Ohne Bereich', items: kProjekte.filter((p) => !BEREICHE.some((b) => b.id === p.bereich)) },
    ].filter((g) => g.items.length > 0);

    function projektMeta(p) {
      const dokCount = dokumente.filter((d) => d.bezugTyp === 'projekt' && d.bezugId === p.id).length;
      return `
        <summary>
          <span class="color-dot" style="background:${escapeHtml(p.farbe || 'var(--border)')}"></span>
          <strong>${escapeHtml(p.titel)}</strong>
          <span class="text-mute">${escapeHtml(kategorienById[p.kategorieId]?.titel || '')}</span>
          <span class="text-mute">${formatDate(p.start)}${p.ende ? ' – ' + formatDate(p.ende) : ''}</span>
          <span class="badge badge-accent">${escapeHtml(spaltenById[p.status]?.titel || p.status || '')}</span>
          <span class="text-mute">📎 ${dokCount}</span>
        </summary>
        <div class="akte-projekt-body">
          ${p.notizen ? `<p class="text-mute">${escapeHtml(p.notizen)}</p>` : ''}
          <div class="akte-dok-host" data-projekt-id="${p.id}"></div>
        </div>
      `;
    }

    const { body } = openModal({
      title: `Kundenakte – ${kunde.firma}`,
      wide: true,
      bodyHtml: `
        <p class="text-mute" style="margin-top:-6px">${kProjekte.length} Aufträge/Projekte insgesamt, davon ${offen} offen · ${dokAnzahl} Dokumente · ${kAusgaben.length} Ausgaben</p>
        <div class="akte-bereich">
          <h2 style="font-size:14px;margin:14px 0 8px">Ausgaben / Belege${kAusgaben.length ? ` (${kAusgaben.length}, ${formatCurrency(kAusgabenSumme)})` : ''}</h2>
          ${kAusgaben.length === 0 ? '<p class="text-mute">Noch keine Ausgaben diesem Kunden oder seinen Projekten zugeordnet.</p>' : `
            <table class="data-table">
              <thead><tr><th>Datum</th><th>Kategorie</th><th>Beschreibung</th><th>Projekt</th><th class="text-right">Betrag</th><th></th></tr></thead>
              <tbody>
                ${kAusgaben.map((a) => `
                  <tr>
                    <td>${formatDate(a.datum)}</td>
                    <td><span class="badge">${escapeHtml(a.kategorie)}</span></td>
                    <td>${escapeHtml(a.beschreibung || a.lieferant || '')}</td>
                    <td>${escapeHtml(projekteById2[a.projektId]?.titel || '')}</td>
                    <td class="text-right">${formatCurrency(a.betragBrutto)}</td>
                    <td>${a.beleg ? `<a href="#" class="btn btn-sm akte-ausgabe-beleg" data-id="${a.id}">📎</a>` : ''}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `}
        </div>
        ${gruppen.length === 0 ? '<p class="text-mute">Noch keine Aufträge, Wartungen oder Projekte für diesen Kunden.</p>' : gruppen.map((g) => `
          <div class="akte-bereich">
            <h2 style="font-size:14px;margin:14px 0 8px">${escapeHtml(g.titel)} (${g.items.length})</h2>
            <div class="akte-projekte-list">
              ${g.items.map((p) => `<details class="akte-projekt" data-id="${p.id}">${projektMeta(p)}</details>`).join('')}
            </div>
          </div>
        `).join('')}
        <div class="modal-actions"><span class="spacer"></span></div>
      `,
    });

    body.querySelectorAll('.akte-ausgabe-beleg').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const a = kAusgaben.find((x) => x.id === link.dataset.id);
        if (!a?.beleg) return;
        const url = URL.createObjectURL(a.beleg);
        window.open(url, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      });
    });
    body.querySelectorAll('details.akte-projekt').forEach((det) => {
      let loaded = false;
      det.addEventListener('toggle', () => {
        if (!det.open || loaded) return;
        loaded = true;
        const p = kProjekte.find((x) => x.id === det.dataset.id);
        const host = det.querySelector('.akte-dok-host');
        renderDokumenteSection(host, 'projekt', p.id, {
          title: 'Dokumente',
          berichtContext: { settings, kunde, projekt: p.titel },
        });
      });
    });
  }

  renderTable();
}
