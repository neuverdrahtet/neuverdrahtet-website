import { getAll, put, remove, getSettings, BEREICHE, GEWERKE } from '../db.js';
import { uid, escapeHtml, formatDate, formatCurrency, toast, navigationUrl, getCurrentMitarbeiterId } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import { openStatusManager } from '../statusManager.js';
import { renderFotoSection } from '../fotos.js';
import { renderDokumenteSection } from '../dokumente.js';
import { renderTeamchat } from '../teamchat.js';
import { createBulkSelect } from '../bulkselect.js';
import * as lexoffice from '../lexoffice.js';

const ALLE_OFFEN = '__offen__';
const ALLE = '__alle__';

export async function render(container, opts = {}) {
  const bereichScope = opts.bereichScope || null;
  const scopedBereiche = bereichScope ? BEREICHE.filter((b) => bereichScope.includes(b.id)) : BEREICHE;

  let [projekte, kunden, mitarbeiter, spalten, kategorien, settings, zeiterfassung, verwendungen, katalog, dokumente] = await Promise.all([
    getAll('projekte'), getAll('kunden'), getAll('mitarbeiter'), getAll('kanbanSpalten'),
    getAll('kategorien'), getSettings(),
    getAll('zeiterfassung'), getAll('verwendungen'), getAll('katalog'), getAll('dokumente'),
  ]);
  spalten.sort((a, b) => a.reihenfolge - b.reihenfolge);
  kategorien.sort((a, b) => a.reihenfolge - b.reihenfolge);
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));
  const spaltenById = Object.fromEntries(spalten.map((s) => [s.id, s]));
  const kategorienById = Object.fromEntries(kategorien.map((k) => [k.id, k]));
  projekte.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  if (bereichScope) projekte = projekte.filter((p) => bereichScope.includes(p.bereich));

  let folder = ALLE_OFFEN;
  let filtered = projekte;
  const bulk = createBulkSelect('projekte', { label: 'Projekte' });

  container.innerHTML = `
    <div class="view-header">
      <h1>${escapeHtml(opts.titel || 'Projekte')}</h1>
      <div class="actions">
        <button class="btn" id="btn-status-manage">⚙️ Status verwalten</button>
        <button class="btn btn-primary" id="btn-new">+ Neues Projekt</button>
      </div>
    </div>
    <div class="projekte-layout">
      <div class="projekte-folders" id="folders"></div>
      <div class="projekte-main">
        <div class="search-bar">
          <input type="search" id="search" placeholder="Suche nach Titel oder Kunde ...">
          <select id="bereich-filter">
            <option value="">Alle Bereiche</option>
            ${scopedBereiche.map((b) => `<option value="${b.id}">${escapeHtml(b.titel)}</option>`).join('')}
          </select>
          <select id="gewerk-filter">
            <option value="">Alle Gewerke</option>
            ${GEWERKE.map((g) => `<option value="${g.id}">${escapeHtml(g.titel)}</option>`).join('')}
          </select>
        </div>
        <div id="table-host"></div>
      </div>
    </div>
  `;
  const foldersHost = container.querySelector('#folders');
  const tableHost = container.querySelector('#table-host');

  function folderCount(id) {
    if (id === ALLE) return projekte.length;
    if (id === ALLE_OFFEN) return projekte.filter((p) => !spaltenById[p.status]?.geschlossen).length;
    return projekte.filter((p) => p.status === id).length;
  }

  function renderFolders() {
    const items = [
      { id: ALLE_OFFEN, titel: 'Alle offenen' },
      { id: ALLE, titel: 'Alle Projekte' },
      ...spalten.map((s) => ({ id: s.id, titel: s.titel, farbe: s.farbe })),
    ];
    foldersHost.innerHTML = items.map((it) => `
      <button type="button" class="folder-item ${folder === it.id ? 'active' : ''}" data-folder="${it.id}">
        <span>${it.farbe ? `<span class="color-dot" style="background:${escapeHtml(it.farbe)};margin-right:6px"></span>` : ''}${escapeHtml(it.titel)}</span><span class="count">${folderCount(it.id)}</span>
      </button>
    `).join('');
    foldersHost.querySelectorAll('.folder-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        folder = btn.dataset.folder;
        applyFilter();
      });
    });
  }

  function applyFilter() {
    renderFolders();
    const q = container.querySelector('#search').value.trim().toLowerCase();
    const bereichFilter = container.querySelector('#bereich-filter').value;
    const gewerkFilter = container.querySelector('#gewerk-filter').value;
    filtered = projekte.filter((p) => {
      if (folder === ALLE_OFFEN && spaltenById[p.status]?.geschlossen) return false;
      if (folder !== ALLE && folder !== ALLE_OFFEN && p.status !== folder) return false;
      if (bereichFilter && p.bereich !== bereichFilter) return false;
      if (gewerkFilter && p.gewerk !== gewerkFilter) return false;
      if (!q) return true;
      const kunde = kundenById[p.kundeId];
      return [p.titel, kunde?.firma].filter(Boolean).join(' ').toLowerCase().includes(q);
    });
    renderTable();
  }

  function renderTable() {
    if (filtered.length === 0) {
      tableHost.innerHTML = `<div class="empty-state">Keine Projekte gefunden.</div>`;
      return;
    }
    tableHost.innerHTML = `
      ${bulk.barHtml()}
      <table class="data-table">
        <thead><tr>${bulk.headerCell()}<th></th><th>Titel</th><th>Kunde</th><th>Gewerk</th><th>Bereich</th><th>Status</th><th>Start</th><th>Ende</th></tr></thead>
        <tbody>
          ${filtered.map((p) => `
            <tr data-id="${p.id}">
              ${bulk.rowCell(p.id)}
              <td><span class="color-dot" style="background:${escapeHtml(p.farbe || 'var(--border)')}"></span></td>
              <td>${escapeHtml(p.titel)}</td>
              <td>${escapeHtml(kundenById[p.kundeId]?.firma || '')}</td>
              <td>${p.gewerk ? `<span class="badge" style="background:${escapeHtml(GEWERKE.find((g) => g.id === p.gewerk)?.farbe || 'var(--border)')}22;color:${escapeHtml(GEWERKE.find((g) => g.id === p.gewerk)?.farbe || 'var(--text)')}">${escapeHtml(GEWERKE.find((g) => g.id === p.gewerk)?.titel || '')}</span>` : ''}</td>
              <td>${escapeHtml(kategorienById[p.kategorieId]?.titel || BEREICHE.find((b) => b.id === p.bereich)?.titel || '')}</td>
              <td><span class="badge badge-accent">${escapeHtml(spaltenById[p.status]?.titel || p.status || '')}</span></td>
              <td>${formatDate(p.start)}</td>
              <td>${formatDate(p.ende)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    tableHost.querySelectorAll('tbody tr').forEach((row) => {
      row.addEventListener('click', () => openForm(projekte.find((p) => p.id === row.dataset.id)));
    });
    bulk.wire(tableHost, {
      onChange: renderTable,
      onDeleted: (ids) => {
        projekte = projekte.filter((p) => !ids.includes(p.id));
        filtered = filtered.filter((p) => !ids.includes(p.id));
        renderFolders();
        renderTable();
      },
    });
  }

  container.querySelector('#search').addEventListener('input', applyFilter);
  container.querySelector('#bereich-filter').addEventListener('change', applyFilter);
  container.querySelector('#gewerk-filter').addEventListener('change', applyFilter);
  container.querySelector('#btn-new').addEventListener('click', () => openForm());
  container.querySelector('#btn-status-manage').addEventListener('click', () => {
    openStatusManager({
      title: 'Projekt-Status verwalten',
      store: 'kanbanSpalten',
      items: spalten,
      canDelete: (it) => !projekte.some((p) => p.status === it.id),
      onChange: () => render(container, opts),
    });
  });

  function renderVerwendungen(host, projektId) {
    const liste = verwendungen.filter((v) => v.projektId === projektId).sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));
    const katalogById = Object.fromEntries(katalog.map((k) => [k.id, k]));
    host.innerHTML = `
      <div class="flex-row" style="justify-content:space-between;margin-bottom:8px">
        <h2 style="font-size:14px;margin:0">Verwendetes Material / Leistungen</h2>
      </div>
      <div class="flex-row" style="gap:6px;margin-bottom:10px">
        <select id="verwendung-katalog" style="flex:2">
          <option value="">– Artikel wählen –</option>
          ${katalog.map((k) => `<option value="${k.id}">${escapeHtml(k.bezeichnung)}${k.einheit ? ` (${escapeHtml(k.einheit)})` : ''}</option>`).join('')}
        </select>
        <input type="number" id="verwendung-menge" placeholder="Menge" min="0" step="0.01" style="flex:1">
        <button type="button" class="btn btn-sm" id="btn-verwendung-add">+ hinzufügen</button>
      </div>
      ${liste.length === 0 ? '<p class="text-mute">Noch kein Material/Leistungen erfasst.</p>' : `
        <table class="data-table">
          <thead><tr><th>Datum</th><th>Bezeichnung</th><th class="text-right">Menge</th><th></th></tr></thead>
          <tbody>
            ${liste.map((v) => {
              const k = katalogById[v.katalogId];
              return `
                <tr data-id="${v.id}">
                  <td>${formatDate(v.datum)}</td>
                  <td>${escapeHtml(k?.bezeichnung || '– gelöschter Artikel –')}</td>
                  <td class="text-right">${v.menge}${k?.einheit ? ` ${escapeHtml(k.einheit)}` : ''}</td>
                  <td><a href="#" class="btn btn-sm verwendung-del" data-id="${v.id}">🗑️</a></td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `}
    `;
    host.querySelector('#btn-verwendung-add').addEventListener('click', async () => {
      const katalogId = host.querySelector('#verwendung-katalog').value;
      const menge = parseFloat(host.querySelector('#verwendung-menge').value);
      if (!katalogId || !menge || menge <= 0) { toast('Bitte Artikel und Menge angeben', 'danger'); return; }
      const entry = {
        id: uid(), projektId, katalogId, menge, datum: new Date().toISOString().slice(0, 10),
        mitarbeiterId: getCurrentMitarbeiterId() || '',
      };
      await put('verwendungen', entry);
      verwendungen.push(entry);
      toast('Verwendung erfasst', 'success');
      renderVerwendungen(host, projektId);
    });
    host.querySelectorAll('.verwendung-del').forEach((link) => {
      link.addEventListener('click', async (e) => {
        e.preventDefault();
        const id = link.dataset.id;
        await remove('verwendungen', id);
        verwendungen = verwendungen.filter((v) => v.id !== id);
        renderVerwendungen(host, projektId);
      });
    });
  }

  function pickLexofficeContact(contacts, firma) {
    return new Promise((resolve) => {
      const { body, close } = openModal({
        title: `lexoffice-Kontakt für "${firma}" wählen`,
        bodyHtml: `
          <p class="hint">Es gibt mehrere passende Kontakte in lexoffice. Bitte den richtigen wählen.</p>
          <div class="cal-event-list">
            ${contacts.map((c) => `
              <button type="button" class="btn" style="display:block;width:100%;text-align:left;margin-bottom:6px" data-id="${escapeHtml(c.id)}">
                ${escapeHtml(c.company?.name || [c.person?.firstName, c.person?.lastName].filter(Boolean).join(' ') || c.id)}
              </button>
            `).join('')}
          </div>
          <div class="modal-actions"><span class="spacer"></span><button type="button" class="btn" id="btn-cancel">Abbrechen</button></div>
        `,
      });
      body.querySelectorAll('button[data-id]').forEach((btn) => {
        btn.addEventListener('click', () => { close(); resolve(btn.dataset.id); });
      });
      body.querySelector('#btn-cancel').addEventListener('click', () => { close(); resolve(null); });
    });
  }

  async function uebertrageAnLexoffice(projekt) {
    if (!(await lexoffice.isConfigured())) {
      toast('Bitte zuerst in den Einstellungen den lexoffice-API-Key hinterlegen.', 'danger');
      return;
    }
    const kunde = kundenById[projekt.kundeId];
    if (!kunde) { toast('Diesem Projekt ist kein Kunde zugewiesen.', 'danger'); return; }

    const offeneZeiten = zeiterfassung.filter((z) => z.projektId === projekt.id && !z.lexofficeExportiert);
    const offeneVerwendungen = verwendungen.filter((v) => v.projektId === projekt.id && !v.lexofficeExportiert);
    const gesamtStunden = offeneZeiten.reduce((s, z) => s + (z.dauerMinuten || 0), 0) / 60;

    if (!offeneZeiten.length && !offeneVerwendungen.length) {
      toast('Keine offenen Zeiterfassungs- oder Verwendungs-Einträge für dieses Projekt.', 'danger');
      return;
    }
    if (gesamtStunden > 0 && !settings.lexofficeArbeitsstundeArtikelId) {
      toast('Bitte zuerst in den Einstellungen einen lexoffice-Artikel für "Arbeitsstunde" auswählen.', 'danger');
      return;
    }

    const lineItems = [];
    if (gesamtStunden > 0) {
      lineItems.push({ type: 'material', id: settings.lexofficeArbeitsstundeArtikelId, quantity: Math.round(gesamtStunden * 100) / 100, unitName: 'Stunde' });
    }
    const fehlendeArtikel = [];
    const katalogById = Object.fromEntries(katalog.map((k) => [k.id, k]));
    for (const v of offeneVerwendungen) {
      const k = katalogById[v.katalogId];
      if (!k?.lexofficeArtikelId) { fehlendeArtikel.push(k?.bezeichnung || v.katalogId); continue; }
      lineItems.push({ type: 'material', id: k.lexofficeArtikelId, quantity: v.menge, unitName: k.einheit || undefined });
    }
    if (fehlendeArtikel.length) {
      toast(`Folgende Artikel sind noch nicht mit lexoffice verknüpft: ${fehlendeArtikel.join(', ')}. Bitte im Katalog abgleichen.`, 'danger');
      return;
    }

    const berichte = dokumente.filter((d) => d.bezugTyp === 'projekt' && d.bezugId === projekt.id && d.kategorie === 'bericht')
      .sort((a, b) => (b.erstelltAm || '').localeCompare(a.erstelltAm || ''));
    if (berichte[0]) {
      lineItems.push({ type: 'text', name: 'Protokoll/Bericht', description: `Siehe Dokumentation "${berichte[0].name}" vom ${formatDate(berichte[0].erstelltAm)} in der Projekt-Akte.` });
    }

    let contactId = kunde.lexofficeContactId;
    if (!contactId) {
      let contacts;
      try {
        contacts = await lexoffice.searchContacts(kunde.firma);
      } catch (err) {
        toast(err.message, 'danger');
        return;
      }
      if (contacts.length === 1) {
        contactId = contacts[0].id;
      } else if (contacts.length === 0) {
        toast(`Kein lexoffice-Kontakt für "${kunde.firma}" gefunden. Bitte in lexoffice anlegen.`, 'danger');
        return;
      } else {
        contactId = await pickLexofficeContact(contacts, kunde.firma);
        if (!contactId) return;
      }
      const updatedKunde = { ...kunde, lexofficeContactId: contactId };
      await put('kunden', updatedKunde);
      kundenById[kunde.id] = updatedKunde;
    }

    try {
      const result = await lexoffice.createInvoiceDraft({ contactId, lineItems, remark: `Auftrag: ${projekt.titel}` });
      for (const z of offeneZeiten) {
        const updatedZ = { ...z, lexofficeExportiert: true };
        await put('zeiterfassung', updatedZ);
        Object.assign(z, updatedZ);
      }
      for (const v of offeneVerwendungen) {
        const updatedV = { ...v, lexofficeExportiert: true };
        await put('verwendungen', updatedV);
        Object.assign(v, updatedV);
      }
      toast('Rechnungsentwurf in lexoffice erstellt.', 'success');
      if (result?.id) window.open(`https://app.lexoffice.io/rechnungen/edit/${result.id}`, '_blank', 'noopener');
    } catch (err) {
      toast(err.message, 'danger');
    }
  }

  function openForm(p) {
    const isEdit = !!p;
    const data = p || {
      id: uid(), titel: '', kundeId: '', status: spalten[0]?.id || '', beschreibung: '',
      start: '', ende: '', mitarbeiterIds: [], bereich: bereichScope?.[0] || 'auftrag', kategorieId: '', gewerk: '', farbe: '', createdAt: new Date().toISOString(),
    };
    const kategorienForBereich = (bereich) => kategorien.filter((k) => k.bereich === bereich);

    const { body, close } = openModal({
      title: isEdit ? 'Projekt bearbeiten' : 'Neues Projekt',
      wide: true,
      bodyHtml: `
        <form id="proj-form">
          <div class="form-grid">
            <div class="field col-span-2"><label>Titel *</label><input name="titel" required value="${escapeHtml(data.titel)}"></div>
            <div class="field"><label>Kunde</label>
              <div class="flex-row" style="gap:6px">
                <select name="kundeId" style="flex:1"><option value="">– kein Kunde –</option>${kunden.map((k) => `<option value="${k.id}" ${k.id === data.kundeId ? 'selected' : ''}>${escapeHtml(k.firma)}</option>`).join('')}</select>
                <button type="button" class="btn btn-sm" id="btn-proj-navi" title="Zur Kundenadresse navigieren">🧭</button>
              </div>
            </div>
            <div class="field"><label>Status</label>
              <select name="status">${spalten.map((s) => `<option value="${s.id}" ${s.id === data.status ? 'selected' : ''}>${escapeHtml(s.titel)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Bereich</label>
              <select name="bereich" id="f-bereich">${scopedBereiche.map((b) => `<option value="${b.id}" ${b.id === data.bereich ? 'selected' : ''}>${escapeHtml(b.titel)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Kategorie</label>
              <select name="kategorieId" id="f-kategorie">${kategorienForBereich(data.bereich).map((k) => `<option value="${k.id}" ${k.id === data.kategorieId ? 'selected' : ''}>${escapeHtml(k.titel)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Gewerk</label>
              <select name="gewerk"><option value="">– kein Gewerk –</option>${GEWERKE.map((g) => `<option value="${g.id}" ${g.id === data.gewerk ? 'selected' : ''}>${escapeHtml(g.titel)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Start</label><input type="date" name="start" value="${data.start || ''}"></div>
            <div class="field"><label>Ende</label><input type="date" name="ende" value="${data.ende || ''}"></div>
            <div class="field"><label>Farbe</label><input type="color" name="farbe" value="${escapeHtml(data.farbe || '#2b7fd6')}"></div>
            <div class="field col-span-2"><label>Beschreibung</label><textarea name="beschreibung">${escapeHtml(data.beschreibung || '')}</textarea></div>
            <div class="field col-span-2"><label>Zugewiesene Mitarbeiter</label>
              <div class="tag-list">
                ${mitarbeiter.map((m) => `
                  <label class="field-checkbox" style="border:1px solid var(--border);border-radius:8px;padding:5px 10px;">
                    <input type="checkbox" name="mitarbeiterIds" value="${m.id}" ${data.mitarbeiterIds?.includes(m.id) ? 'checked' : ''}> ${escapeHtml(m.name)}
                  </label>
                `).join('') || '<span class="text-mute">Keine Mitarbeiter angelegt.</span>'}
              </div>
            </div>
          </div>
          ${isEdit ? `
            <div class="divider"></div>
            <div id="verwendung-host"></div>
            <div class="divider"></div>
            <div id="tc-host"></div>
            <div class="divider"></div>
            <div id="foto-host"></div>
            <div class="divider"></div>
            <div id="dok-host"></div>
          ` : ''}
          <div class="modal-actions">
            ${isEdit ? '<button type="button" class="btn btn-danger" id="btn-delete">Löschen</button>' : ''}
            ${isEdit ? '<button type="button" class="btn" id="btn-lexoffice-transfer">🧾 An lexoffice übertragen</button>' : ''}
            <span class="spacer"></span>
            <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Speichern</button>
          </div>
        </form>
      `,
    });
    body.querySelector('#f-bereich').addEventListener('change', (e) => {
      const sel = body.querySelector('#f-kategorie');
      sel.innerHTML = kategorienForBereich(e.target.value).map((k) => `<option value="${k.id}">${escapeHtml(k.titel)}</option>`).join('');
    });
    body.querySelector('#btn-cancel').addEventListener('click', close);
    body.querySelector('#btn-proj-navi').addEventListener('click', () => {
      const kunde = kundenById[body.querySelector('select[name="kundeId"]').value];
      const adresse = kunde ? [kunde.strasse, kunde.plz, kunde.ort].filter((s) => s && s.trim()).join(', ') : '';
      if (!adresse) { toast('Kein Kunde mit Adresse ausgewählt', 'danger'); return; }
      window.open(navigationUrl(adresse), '_blank', 'noopener');
    });
    if (isEdit) {
      body.querySelector('#btn-delete').addEventListener('click', async () => {
        if (!confirmDelete(`Projekt "${data.titel}" wirklich löschen?`)) return;
        await remove('projekte', data.id);
        toast('Projekt gelöscht');
        close();
        render(container, opts);
      });
      renderVerwendungen(body.querySelector('#verwendung-host'), data.id);
      renderTeamchat(body.querySelector('#tc-host'), data.id, mitarbeiter);
      renderFotoSection(body.querySelector('#foto-host'), data.id);
      renderDokumenteSection(body.querySelector('#dok-host'), 'projekt', data.id, {
        title: 'Dokumente (Berichte, Stundenzettel, ...)',
        berichtContext: { settings, kunde: kundenById[data.kundeId] || null, projekt: data.titel },
      });
      body.querySelector('#btn-lexoffice-transfer').addEventListener('click', () => uebertrageAnLexoffice(data));
    }
    body.querySelector('#proj-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      updated.mitarbeiterIds = fd.getAll('mitarbeiterIds');
      for (const key of ['titel', 'kundeId', 'status', 'start', 'ende', 'beschreibung', 'bereich', 'kategorieId', 'gewerk', 'farbe']) {
        updated[key] = (fd.get(key) || '').toString().trim();
      }
      if (!updated.titel) return;
      await put('projekte', updated);
      toast(isEdit ? 'Projekt aktualisiert' : 'Projekt angelegt', 'success');
      close();
      render(container, opts);
    });
  }

  applyFilter();
}
