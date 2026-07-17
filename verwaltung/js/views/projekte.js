import { getAll, put, remove, getSettings, BEREICHE, GEWERKE } from '../db.js';
import { uid, escapeHtml, formatDate, formatCurrency, toast } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import { openStatusManager } from '../statusManager.js';
import { renderFotoSection } from '../fotos.js';
import { renderDokumenteSection } from '../dokumente.js';
import { renderNachkalkulation } from '../nachkalkulation.js';
import { renderTeamchat } from '../teamchat.js';
import { createBulkSelect } from '../bulkselect.js';

const ALLE_OFFEN = '__offen__';
const ALLE = '__alle__';

export async function render(container) {
  let [projekte, kunden, mitarbeiter, spalten, angebote, rechnungen, kategorien, settings, ausgaben, zeiterfassung] = await Promise.all([
    getAll('projekte'), getAll('kunden'), getAll('mitarbeiter'), getAll('kanbanSpalten'),
    getAll('angebote'), getAll('rechnungen'), getAll('kategorien'), getSettings(),
    getAll('ausgaben'), getAll('zeiterfassung'),
  ]);
  spalten.sort((a, b) => a.reihenfolge - b.reihenfolge);
  kategorien.sort((a, b) => a.reihenfolge - b.reihenfolge);
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));
  const spaltenById = Object.fromEntries(spalten.map((s) => [s.id, s]));
  const kategorienById = Object.fromEntries(kategorien.map((k) => [k.id, k]));
  projekte.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  let folder = ALLE_OFFEN;
  let filtered = projekte;
  const bulk = createBulkSelect('projekte', { label: 'Projekte' });

  container.innerHTML = `
    <div class="view-header">
      <h1>Projekte</h1>
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
            ${BEREICHE.map((b) => `<option value="${b.id}">${escapeHtml(b.titel)}</option>`).join('')}
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
      onChange: () => render(container),
    });
  });

  function renderProjektAusgaben(host, projektId) {
    const liste = ausgaben.filter((a) => a.projektId === projektId).sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));
    const summe = liste.reduce((s, a) => s + (a.betragBrutto || 0), 0);
    host.innerHTML = `
      <div class="flex-row" style="justify-content:space-between;margin-bottom:8px">
        <h2 style="font-size:14px;margin:0">Ausgaben / Belege${liste.length ? ` · ${formatCurrency(summe)}` : ''}</h2>
        <a class="text-mute" href="#/ausgaben" style="font-size:12.5px">+ Ausgabe erfassen →</a>
      </div>
      ${liste.length === 0 ? '<p class="text-mute">Noch keine Ausgaben diesem Projekt zugeordnet.</p>' : `
        <table class="data-table">
          <thead><tr><th>Datum</th><th>Kategorie</th><th>Beschreibung</th><th class="text-right">Betrag</th><th></th></tr></thead>
          <tbody>
            ${liste.map((a) => `
              <tr>
                <td>${formatDate(a.datum)}</td>
                <td><span class="badge">${escapeHtml(a.kategorie)}</span></td>
                <td>${escapeHtml(a.beschreibung || a.lieferant || '')}</td>
                <td class="text-right">${formatCurrency(a.betragBrutto)}</td>
                <td>${a.beleg ? `<a href="#" class="btn btn-sm ausgabe-beleg-link" data-id="${a.id}">📎</a>` : ''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    `;
    host.querySelectorAll('.ausgabe-beleg-link').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const a = liste.find((x) => x.id === link.dataset.id);
        if (!a?.beleg) return;
        const url = URL.createObjectURL(a.beleg);
        window.open(url, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      });
    });
  }

  function openForm(p) {
    const isEdit = !!p;
    const data = p || {
      id: uid(), titel: '', kundeId: '', status: spalten[0]?.id || '', beschreibung: '',
      start: '', ende: '', mitarbeiterIds: [], bereich: 'auftrag', kategorieId: '', gewerk: '', farbe: '', createdAt: new Date().toISOString(),
    };
    const linkedAngebote = isEdit ? angebote.filter((a) => a.projektId === data.id) : [];
    const linkedRechnungen = isEdit ? rechnungen.filter((r) => r.projektId === data.id) : [];
    const kategorienForBereich = (bereich) => kategorien.filter((k) => k.bereich === bereich);

    const { body, close } = openModal({
      title: isEdit ? 'Projekt bearbeiten' : 'Neues Projekt',
      wide: true,
      bodyHtml: `
        <form id="proj-form">
          <div class="form-grid">
            <div class="field col-span-2"><label>Titel *</label><input name="titel" required value="${escapeHtml(data.titel)}"></div>
            <div class="field"><label>Kunde</label>
              <select name="kundeId"><option value="">– kein Kunde –</option>${kunden.map((k) => `<option value="${k.id}" ${k.id === data.kundeId ? 'selected' : ''}>${escapeHtml(k.firma)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Status</label>
              <select name="status">${spalten.map((s) => `<option value="${s.id}" ${s.id === data.status ? 'selected' : ''}>${escapeHtml(s.titel)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Bereich</label>
              <select name="bereich" id="f-bereich">${BEREICHE.map((b) => `<option value="${b.id}" ${b.id === data.bereich ? 'selected' : ''}>${escapeHtml(b.titel)}</option>`).join('')}</select>
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
            <h2 style="font-size:14px;margin:0 0 8px">Verknüpfte Angebote</h2>
            ${linkedAngebote.length ? `<ul class="cal-event-list">${linkedAngebote.map((a) => `<li><span>${escapeHtml(a.nummer)}</span><span>${formatCurrency(a.brutto)}</span></li>`).join('')}</ul>` : '<p class="text-mute">Keine Angebote verknüpft.</p>'}
            <h2 style="font-size:14px;margin:12px 0 8px">Verknüpfte Rechnungen</h2>
            ${linkedRechnungen.length ? `<ul class="cal-event-list">${linkedRechnungen.map((r) => `<li><span>${escapeHtml(r.nummer)}</span><span>${formatCurrency(r.brutto)}</span></li>`).join('')}</ul>` : '<p class="text-mute">Keine Rechnungen verknüpft.</p>'}
            <div class="divider"></div>
            <div id="nk-host"></div>
            <div class="divider"></div>
            <div id="ausgaben-host"></div>
            <div class="divider"></div>
            <div id="tc-host"></div>
            <div class="divider"></div>
            <div id="foto-host"></div>
            <div class="divider"></div>
            <div id="dok-host"></div>
          ` : ''}
          <div class="modal-actions">
            ${isEdit ? '<button type="button" class="btn btn-danger" id="btn-delete">Löschen</button>' : ''}
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
    if (isEdit) {
      body.querySelector('#btn-delete').addEventListener('click', async () => {
        if (!confirmDelete(`Projekt "${data.titel}" wirklich löschen?`)) return;
        await remove('projekte', data.id);
        toast('Projekt gelöscht');
        close();
        render(container);
      });
      renderNachkalkulation(body.querySelector('#nk-host'), {
        projekt: data, ausgaben, zeiterfassung, rechnungen, mitarbeiter, settings,
      });
      renderProjektAusgaben(body.querySelector('#ausgaben-host'), data.id);
      renderTeamchat(body.querySelector('#tc-host'), data.id, mitarbeiter);
      renderFotoSection(body.querySelector('#foto-host'), data.id);
      renderDokumenteSection(body.querySelector('#dok-host'), 'projekt', data.id, {
        title: 'Dokumente (Berichte, Stundenzettel, ...)',
        berichtContext: { settings, kunde: kundenById[data.kundeId] || null, projekt: data.titel },
      });
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
      render(container);
    });
  }

  applyFilter();
}
