import { getAll, put, remove, getSettings, resolveMarkeSettings, BEREICHE, GEWERKE } from '../db.js';
import { uid, escapeHtml, formatDate, formatCurrency, toast, navigationUrl, getCurrentMitarbeiterId, openTerminMitVorbelegung, openDokumentMitVorbelegung, todayISO, katalogOptionsHtml } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import { openStatusManager } from '../statusManager.js';
import { renderFotoSection } from '../fotos.js';
import { renderDokumenteSection } from '../dokumente.js';
import { renderNachkalkulation } from '../nachkalkulation.js';
import { renderTeamchat } from '../teamchat.js';
import { createBulkSelect } from '../bulkselect.js';
import * as lexoffice from '../lexoffice.js';

const ALLE_OFFEN = '__offen__';
const ALLE = '__alle__';

export async function render(container, opts = {}) {
  const bereichScope = opts.bereichScope || null;
  const scopedBereiche = bereichScope ? BEREICHE.filter((b) => bereichScope.includes(b.id)) : BEREICHE;

  let [projekte, kunden, mitarbeiter, spalten, angebote, auftragsbestaetigungen, rechnungen, kategorien, settings, ausgaben, zeiterfassung, verwendungen, katalog, dokumente, marken, subunternehmer, termine, aufgaben] = await Promise.all([
    getAll('projekte'), getAll('kunden'), getAll('mitarbeiter'), getAll('kanbanSpalten'),
    getAll('angebote'), getAll('auftragsbestaetigungen'), getAll('rechnungen'), getAll('kategorien'), getSettings(),
    getAll('ausgaben'), getAll('zeiterfassung'), getAll('verwendungen'), getAll('katalog'), getAll('dokumente'), getAll('marken'), getAll('subunternehmer'),
    getAll('termine'), getAll('aufgaben'),
  ]);
  spalten.sort((a, b) => a.reihenfolge - b.reihenfolge);
  kategorien.sort((a, b) => a.reihenfolge - b.reihenfolge);
  marken.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  subunternehmer.sort((a, b) => (a.firma || '').localeCompare(b.firma || ''));
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));
  const spaltenById = Object.fromEntries(spalten.map((s) => [s.id, s]));
  const kategorienById = Object.fromEntries(kategorien.map((k) => [k.id, k]));
  const markenById = Object.fromEntries(marken.map((m) => [m.id, m]));
  projekte.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  if (bereichScope) projekte = projekte.filter((p) => bereichScope.includes(p.bereich));

  let folder = ALLE_OFFEN;
  let filtered = projekte;
  let verwendungGewerkFilter = '';
  const bulk = createBulkSelect('projekte', { label: 'Projekte' });

  container.innerHTML = `
    <div class="view-header">
      <h1>${escapeHtml(opts.titel || 'Projekte')}</h1>
      <div class="actions">
        <button class="btn" id="btn-duplikate">🧹 Duplikate zusammenführen</button>
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
        <thead><tr>${bulk.headerCell()}<th></th><th>Titel</th><th>Kunde</th>${marken.length > 0 ? '<th>Marke</th>' : ''}<th>Gewerk</th><th>Bereich</th><th>Status</th><th>Start</th><th>Ende</th></tr></thead>
        <tbody>
          ${filtered.map((p) => `
            <tr data-id="${p.id}">
              ${bulk.rowCell(p.id)}
              <td><span class="color-dot" style="background:${escapeHtml(p.farbe || 'var(--border)')}"></span></td>
              <td>${escapeHtml(p.titel)}</td>
              <td>${escapeHtml(kundenById[p.kundeId]?.firma || '')}</td>
              ${marken.length > 0 ? `<td>${p.markeId && markenById[p.markeId] ? `<span class="badge">🏷️ ${escapeHtml(markenById[p.markeId].name)}</span>` : `<span class="text-mute">Standard</span>`}</td>` : ''}
              <td>${p.gewerk ? `<span class="badge" style="background:${escapeHtml(GEWERKE.find((g) => g.id === p.gewerk)?.farbe || 'var(--border)')}22;color:${escapeHtml(GEWERKE.find((g) => g.id === p.gewerk)?.farbe || 'var(--text)')}">${escapeHtml(GEWERKE.find((g) => g.id === p.gewerk)?.titel || '')}</span>` : ''}</td>
              <td>${escapeHtml(kategorienById[p.kategorieId]?.titel || BEREICHE.find((b) => b.id === p.bereich)?.titel || '')}</td>
              <td><span class="badge badge-accent">${escapeHtml(spaltenById[p.status]?.titel || p.status || '')}</span></td>
              <td>${formatDate(p.start)}</td>
              <td>${formatDate(p.ende)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="tt-card-list">
        ${filtered.map((p) => {
          const kunde = kundenById[p.kundeId];
          const adresse = kunde ? [kunde.strasse, [kunde.plz, kunde.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '';
          return `
            <div class="tt-card" data-id="${p.id}">
              <div class="tt-card-top">
                <span class="tt-card-meta">${escapeHtml(kunde?.firma || 'ohne Kunde')}</span>
                <span class="badge badge-accent">${escapeHtml(spaltenById[p.status]?.titel || p.status || '')}</span>
              </div>
              <div class="tt-card-title-row">
                <span class="tt-card-icon">🔧</span>
                <span>${escapeHtml(p.titel)}</span>
              </div>
              ${adresse ? `<div class="tt-card-sub">${escapeHtml(adresse)}</div>` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;
    tableHost.querySelectorAll('tbody tr, .tt-card').forEach((row) => {
      row.addEventListener('click', () => renderProjektAkte(projekte.find((p) => p.id === row.dataset.id)));
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
  container.querySelector('#btn-duplikate').addEventListener('click', () => openProjektDuplikateModal());

  // Findet Projekte mit gleichem Titel beim gleichen Kunden - Projekte werden
  // zusammengeführt (verknüpfte Termine/Angebote/AB/Rechnungen/Ausgaben/
  // Aufgaben/Dokumente auf das behaltene Projekt umgehängt) statt nur
  // gelöscht, da sonst verwaiste Verweise zurückblieben.
  const PROJEKT_VERKNUEPFTE_COLLECTIONS = [
    { store: 'termine', liste: termine, feld: 'projektId' },
    { store: 'angebote', liste: angebote, feld: 'projektId' },
    { store: 'auftragsbestaetigungen', liste: auftragsbestaetigungen, feld: 'projektId' },
    { store: 'rechnungen', liste: rechnungen, feld: 'projektId' },
    { store: 'ausgaben', liste: ausgaben, feld: 'projektId' },
    { store: 'aufgaben', liste: aufgaben, feld: 'projektId' },
    { store: 'zeiterfassung', liste: zeiterfassung, feld: 'projektId' },
    { store: 'verwendungen', liste: verwendungen, feld: 'projektId' },
  ];

  function projektVerknuepfteAnzahl(projektId) {
    let n = PROJEKT_VERKNUEPFTE_COLLECTIONS.reduce((s, c) => s + c.liste.filter((r) => r[c.feld] === projektId).length, 0);
    n += dokumente.filter((d) => d.bezugTyp === 'projekt' && d.bezugId === projektId).length;
    return n;
  }

  function findProjektDuplikatGruppen() {
    const groups = new Map();
    for (const p of projekte) {
      const titel = (p.titel || '').trim().toLowerCase();
      if (!titel) continue;
      const key = `${titel}|${p.kundeId || ''}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    return [...groups.values()].filter((g) => g.length > 1);
  }

  async function fuehreProjekteZusammen(behaltenId, duplikatIds) {
    for (const c of PROJEKT_VERKNUEPFTE_COLLECTIONS) {
      for (const record of c.liste) {
        if (duplikatIds.includes(record[c.feld])) {
          await put(c.store, { ...record, [c.feld]: behaltenId });
        }
      }
    }
    for (const d of dokumente) {
      if (d.bezugTyp === 'projekt' && duplikatIds.includes(d.bezugId)) {
        await put('dokumente', { ...d, bezugId: behaltenId });
      }
    }
    for (const id of duplikatIds) {
      await remove('projekte', id);
    }
  }

  function openProjektDuplikateModal() {
    const gruppen = findProjektDuplikatGruppen();
    if (gruppen.length === 0) {
      toast('Keine Duplikate gefunden.', 'success');
      return;
    }
    const empfehlung = new Map(gruppen.map((g) => {
      const sortiert = [...g].sort((a, b) => projektVerknuepfteAnzahl(b.id) - projektVerknuepfteAnzahl(a.id));
      return [g, sortiert[0].id];
    }));
    const { body, close } = openModal({
      title: 'Projekt-Duplikate zusammenführen',
      wide: true,
      bodyHtml: `
        <p class="hint">${gruppen.length} Gruppe(n) mit gleichem Titel beim selben Kunden gefunden. Das ausgewählte Projekt je Gruppe bleibt bestehen, alle verknüpften Termine/Angebote/AB/Rechnungen/Ausgaben/Aufgaben/Zeiterfassung/Verwendungen/Dokumente der anderen werden dorthin übertragen, die Duplikate danach gelöscht. Gruppen abwählen, die keine echten Duplikate sind.</p>
        <label class="field-checkbox" style="display:flex;align-items:center;gap:8px;padding:4px 0;font-weight:600;border-bottom:1px solid var(--border);margin-bottom:8px;padding-bottom:8px">
          <input type="checkbox" id="pdup-select-all" checked>
          <span>Alle Gruppen auswählen / abwählen</span>
        </label>
        <div id="pdup-groups">
          ${gruppen.map((g, gi) => `
            <div class="card" style="margin-bottom:10px">
              <label class="field-checkbox" style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                <input type="checkbox" class="pdup-gruppe-aktiv" data-gi="${gi}" checked>
                <strong>${escapeHtml(g[0].titel)}</strong>
              </label>
              <div class="text-mute" style="font-size:12px;margin-bottom:6px">${escapeHtml(kundenById[g[0].kundeId]?.firma || 'ohne Kunde')} · ${g.length} gleiche Einträge</div>
              ${g.map((p) => `
                <label class="field-checkbox" style="display:flex;align-items:center;gap:8px;padding:4px 0 4px 26px">
                  <input type="radio" name="pdup-behalten-${gi}" class="pdup-behalten" data-gi="${gi}" value="${p.id}" ${p.id === empfehlung.get(g) ? 'checked' : ''}>
                  <span>${formatDate(p.createdAt) || '– kein Datum –'} <span class="text-mute">(${projektVerknuepfteAnzahl(p.id)} verknüpft, Status: ${escapeHtml(spaltenById[p.status]?.titel || p.status || '–')})</span></span>
                </label>
              `).join('')}
            </div>
          `).join('')}
        </div>
        <div class="modal-actions">
          <span class="spacer"></span>
          <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
          <button type="button" class="btn btn-primary" id="btn-pdup-merge">Zusammenführen</button>
        </div>
      `,
    });
    const pdupGruppenAktivCheckboxen = () => Array.from(body.querySelectorAll('.pdup-gruppe-aktiv'));
    const pdupSelectAll = body.querySelector('#pdup-select-all');
    const pdupMergeBtn = body.querySelector('#btn-pdup-merge');
    function updatePdupMergeButton() {
      const n = pdupGruppenAktivCheckboxen().filter((cb) => cb.checked).length;
      pdupMergeBtn.textContent = n > 0 ? `Zusammenführen (${n})` : 'Zusammenführen';
      pdupMergeBtn.disabled = n === 0;
    }
    function updatePdupSelectAllState() {
      const all = pdupGruppenAktivCheckboxen();
      pdupSelectAll.checked = all.length > 0 && all.every((cb) => cb.checked);
      pdupSelectAll.indeterminate = all.some((cb) => cb.checked) && !pdupSelectAll.checked;
    }
    pdupSelectAll.addEventListener('change', () => {
      pdupGruppenAktivCheckboxen().forEach((cb) => { cb.checked = pdupSelectAll.checked; });
      updatePdupMergeButton();
    });
    pdupGruppenAktivCheckboxen().forEach((cb) => {
      cb.addEventListener('change', () => { updatePdupSelectAllState(); updatePdupMergeButton(); });
    });
    updatePdupMergeButton();
    body.querySelector('#btn-cancel').addEventListener('click', close);
    pdupMergeBtn.addEventListener('click', async () => {
      const gruppenMitAuswahl = gruppen
        .map((g, gi) => {
          const aktiv = body.querySelector(`.pdup-gruppe-aktiv[data-gi="${gi}"]`)?.checked;
          const gewaehlt = body.querySelector(`.pdup-behalten[data-gi="${gi}"]:checked`)?.value;
          return { g, aktiv, behaltenId: gewaehlt };
        })
        .filter((x) => x.aktiv);
      if (gruppenMitAuswahl.length === 0) { toast('Keine Gruppe ausgewählt.', 'danger'); return; }
      if (gruppenMitAuswahl.some((x) => !x.behaltenId)) { toast('Bitte in jeder ausgewählten Gruppe ein Projekt zum Behalten auswählen.', 'danger'); return; }
      if (!confirmDelete(`${gruppenMitAuswahl.length} Gruppe(n) zusammenführen? Die jeweils nicht ausgewählten Projekte werden danach gelöscht.`)) return;
      let anzahlZusammengefuehrt = 0;
      for (const { g, behaltenId } of gruppenMitAuswahl) {
        const duplikatIds = g.map((p) => p.id).filter((id) => id !== behaltenId);
        if (duplikatIds.length === 0) continue;
        await fuehreProjekteZusammen(behaltenId, duplikatIds);
        anzahlZusammengefuehrt += duplikatIds.length;
      }
      toast(`${anzahlZusammengefuehrt} Duplikat(e) zusammengeführt`, 'success');
      close();
      render(container, opts);
    });
  }

  container.querySelector('#btn-status-manage').addEventListener('click', () => {
    openStatusManager({
      title: 'Projekt-Status verwalten',
      store: 'kanbanSpalten',
      items: spalten,
      canDelete: (it) => !projekte.some((p) => p.status === it.id),
      onChange: () => render(container, opts),
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
        if (a.beleg.url) { window.open(a.beleg.url, '_blank', 'noopener'); return; }
        const url = URL.createObjectURL(a.beleg);
        window.open(url, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      });
    });
  }

  function renderVerwendungen(host, projektId) {
    const liste = verwendungen.filter((v) => v.projektId === projektId).sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));
    const katalogById = Object.fromEntries(katalog.map((k) => [k.id, k]));
    host.innerHTML = `
      <div class="flex-row" style="justify-content:space-between;margin-bottom:8px">
        <h2 style="font-size:14px;margin:0">Verwendetes Material / Leistungen</h2>
      </div>
      <div class="flex-row flex-wrap" style="gap:6px;margin-bottom:10px">
        <select id="verwendung-gewerk" style="flex:1;min-width:140px" title="Gewerk zum Filtern wählen">
          <option value="">Alle Gewerke</option>
          ${GEWERKE.map((g) => `<option value="${g.id}" ${verwendungGewerkFilter === g.id ? 'selected' : ''}>${escapeHtml(g.titel)}</option>`).join('')}
        </select>
        <select id="verwendung-katalog" style="flex:2;min-width:180px">
          <option value="">– Artikel wählen –</option>
          ${katalogOptionsHtml(verwendungGewerkFilter ? katalog.filter((k) => k.gewerk === verwendungGewerkFilter) : katalog, (k) => `${escapeHtml(k.bezeichnung)}${k.einheit ? ` (${escapeHtml(k.einheit)})` : ''}`)}
        </select>
        <input type="number" id="verwendung-menge" placeholder="Menge" min="0" step="0.01" style="flex:1;min-width:90px">
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
    host.querySelector('#verwendung-gewerk').addEventListener('change', (e) => {
      verwendungGewerkFilter = e.target.value;
      const gefiltert = verwendungGewerkFilter ? katalog.filter((k) => k.gewerk === verwendungGewerkFilter) : katalog;
      host.querySelector('#verwendung-katalog').innerHTML = `<option value="">– Artikel wählen –</option>${katalogOptionsHtml(gefiltert, (k) => `${escapeHtml(k.bezeichnung)}${k.einheit ? ` (${escapeHtml(k.einheit)})` : ''}`)}`;
    });
    host.querySelector('#btn-verwendung-add').addEventListener('click', async (e) => {
      const katalogId = host.querySelector('#verwendung-katalog').value;
      const menge = parseFloat(host.querySelector('#verwendung-menge').value);
      if (!katalogId || !menge || menge <= 0) { toast('Bitte Artikel und Menge angeben', 'danger'); return; }
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Speichert ...';
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
      start: '', ende: '', mitarbeiterIds: [], subunternehmerIds: [], bereich: bereichScope?.[0] || 'auftrag', kategorieId: '', gewerk: '', farbe: '', markeId: '', createdAt: new Date().toISOString(),
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
            ${marken.length > 0 ? `
              <div class="field"><label>Marke</label>
                <select name="markeId">
                  <option value="">Standard (${escapeHtml(settings.firmenname)})</option>
                  ${marken.map((m) => `<option value="${m.id}" ${m.id === data.markeId ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}
                </select>
                <span class="hint mb-0">Bestimmt Name/Logo auf Angeboten, Rechnungen, Mahnungen und Berichten dieses Projekts.</span>
              </div>
            ` : ''}
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
              <div class="tag-list" id="mitarbeiter-checklist"></div>
              ${marken.length > 0 ? '<p class="hint mb-0">Mitarbeiter mit Marken-Freigabe für eine andere Marke werden hier ausgeblendet.</p>' : ''}
            </div>
            ${subunternehmer.length > 0 ? `
              <div class="field col-span-2"><label>Beauftragte Subunternehmer</label>
                <div class="tag-list">
                  ${subunternehmer.map((s) => `
                    <label class="field-checkbox" style="border:1px solid var(--border);border-radius:8px;padding:5px 10px;">
                      <input type="checkbox" name="subunternehmerIds" value="${s.id}" ${(data.subunternehmerIds || []).includes(s.id) ? 'checked' : ''}> ${escapeHtml(s.firma)}
                    </label>
                  `).join('')}
                </div>
              </div>
            ` : ''}
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
    body.querySelector('#f-bereich').addEventListener('change', (e) => {
      const sel = body.querySelector('#f-kategorie');
      sel.innerHTML = kategorienForBereich(e.target.value).map((k) => `<option value="${k.id}">${escapeHtml(k.titel)}</option>`).join('');
    });
    function renderMitarbeiterChecklist(markeId, checkedIds) {
      const host = body.querySelector('#mitarbeiter-checklist');
      const sichtbar = mitarbeiter.filter((m) => !m.markeIds?.length || m.markeIds.includes(markeId));
      host.innerHTML = sichtbar.map((m) => `
        <label class="field-checkbox" style="border:1px solid var(--border);border-radius:8px;padding:5px 10px;">
          <input type="checkbox" name="mitarbeiterIds" value="${m.id}" ${checkedIds.includes(m.id) ? 'checked' : ''}> ${escapeHtml(m.name)}
        </label>
      `).join('') || '<span class="text-mute">Keine Mitarbeiter verfügbar.</span>';
    }
    renderMitarbeiterChecklist(data.markeId || '', data.mitarbeiterIds || []);
    body.querySelector('select[name="markeId"]')?.addEventListener('change', (e) => {
      const checkedIds = Array.from(body.querySelectorAll('input[name="mitarbeiterIds"]:checked')).map((cb) => cb.value);
      renderMitarbeiterChecklist(e.target.value, checkedIds);
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
        if (!confirmDelete(`Projekt "${data.titel}" in den Papierkorb verschieben?`)) return;
        await remove('projekte', data.id);
        toast('Projekt in den Papierkorb verschoben');
        close();
        render(container, opts);
      });
    }
    body.querySelector('#proj-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      updated.mitarbeiterIds = fd.getAll('mitarbeiterIds');
      updated.subunternehmerIds = fd.getAll('subunternehmerIds');
      for (const key of ['titel', 'kundeId', 'status', 'start', 'ende', 'beschreibung', 'bereich', 'kategorieId', 'gewerk', 'farbe', 'markeId']) {
        updated[key] = (fd.get(key) || '').toString().trim();
      }
      if (!updated.titel) return;
      await put('projekte', updated);
      toast(isEdit ? 'Projekt aktualisiert' : 'Projekt angelegt', 'success');
      close();
      render(container, opts);
    });
  }

  // Ganzseitige Projekt-Akte (ToolTime-Vorbild, analog zur Kundenakte) -
  // kompletter Überblick statt der bisherigen, sehr langen Bearbeiten-Maske:
  // verknüpfte Angebote/Auftragsbestätigungen/Rechnungen, Nachkalkulation,
  // Ausgaben, Verwendungen, Teamchat, Fotos und Dokumente an einer Stelle.
  // Stammdaten bearbeiten läuft weiterhin über die schlankere openForm().
  function renderProjektAkte(p) {
    const linkedAngebote = angebote.filter((a) => a.projektId === p.id).sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));
    const linkedAB = auftragsbestaetigungen.filter((a) => a.projektId === p.id).sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));
    const linkedRechnungen = rechnungen.filter((r) => r.projektId === p.id).sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));
    const heute = todayISO();
    const hatUeberfaelligeRechnung = linkedRechnungen.some((r) => (r.status === 'offen' || r.status === 'teilbezahlt') && r.faelligAm && r.faelligAm < heute);
    const kunde = kundenById[p.kundeId];
    const mitarbeiterNamen = (p.mitarbeiterIds || []).map((id) => mitarbeiter.find((m) => m.id === id)?.name).filter(Boolean);
    const subunternehmerNamen = (p.subunternehmerIds || []).map((id) => subunternehmer.find((s) => s.id === id)?.firma).filter(Boolean);

    container.innerHTML = `
      <div class="fullpage-form">
        <div class="fullpage-form-header">
          <button type="button" class="btn-back" id="akte-back">← ${escapeHtml(p.titel)}</button>
          <div class="fullpage-form-actions">
            <button type="button" class="btn" id="akte-edit">✏️ Bearbeiten</button>
            <button type="button" class="btn" id="akte-neuer-termin">📅 + Termin</button>
            <button type="button" class="btn" id="akte-neues-angebot">📄 + Angebot</button>
            <button type="button" class="btn" id="akte-neue-rechnung">🧾 + Rechnung</button>
            <button type="button" class="btn" id="akte-neue-ab">✅ + Auftragsbestätigung</button>
            <button type="button" class="btn" id="akte-lexoffice-transfer">🧾 An lexoffice übertragen</button>
            ${hatUeberfaelligeRechnung ? '<button type="button" class="btn btn-danger" id="akte-zu-mahnungen">🔔 Mahnung</button>' : ''}
          </div>
        </div>
        <div class="tabs akte-mobile-tabs">
          <button type="button" class="tab-item active" data-akte-tab="details">Details</button>
          <button type="button" class="tab-item" data-akte-tab="dokumentation">Dokumentation</button>
        </div>
        <div class="akte-split" data-active-tab="details">
          <div class="akte-info-col">
            <div class="card">
              <div class="flex-row" style="align-items:center;gap:8px;margin-bottom:2px">
                <span class="color-dot" style="background:${escapeHtml(p.farbe || 'var(--border)')}"></span>
                <h2 style="margin:0">${escapeHtml(p.titel)}</h2>
              </div>
              <p class="text-mute" style="margin-top:2px">${escapeHtml(spaltenById[p.status]?.titel || p.status || '')}</p>
              <div class="akte-info-rows">
                ${kunde ? `<div class="akte-info-row"><span class="text-mute">Kunde</span><span>${escapeHtml(kunde.firma)}</span></div>` : ''}
                ${BEREICHE.find((b) => b.id === p.bereich) ? `<div class="akte-info-row"><span class="text-mute">Bereich</span><span>${escapeHtml(BEREICHE.find((b) => b.id === p.bereich).titel)}</span></div>` : ''}
                ${kategorienById[p.kategorieId] ? `<div class="akte-info-row"><span class="text-mute">Kategorie</span><span>${escapeHtml(kategorienById[p.kategorieId].titel)}</span></div>` : ''}
                ${p.gewerk ? `<div class="akte-info-row"><span class="text-mute">Gewerk</span><span>${escapeHtml(GEWERKE.find((g) => g.id === p.gewerk)?.titel || p.gewerk)}</span></div>` : ''}
                ${p.markeId && markenById[p.markeId] ? `<div class="akte-info-row"><span class="text-mute">Marke</span><span>🏷️ ${escapeHtml(markenById[p.markeId].name)}</span></div>` : ''}
                ${p.start ? `<div class="akte-info-row"><span class="text-mute">Start</span><span>${formatDate(p.start)}</span></div>` : ''}
                ${p.ende ? `<div class="akte-info-row"><span class="text-mute">Ende</span><span>${formatDate(p.ende)}</span></div>` : ''}
                ${mitarbeiterNamen.length ? `<div class="akte-info-row"><span class="text-mute">Mitarbeiter</span><span>${escapeHtml(mitarbeiterNamen.join(', '))}</span></div>` : ''}
                ${subunternehmerNamen.length ? `<div class="akte-info-row"><span class="text-mute">Subunternehmer</span><span>${escapeHtml(subunternehmerNamen.join(', '))}</span></div>` : ''}
              </div>
              ${p.beschreibung ? `<div class="divider"></div><p class="text-mute" style="white-space:pre-wrap">${escapeHtml(p.beschreibung)}</p>` : ''}
            </div>
          </div>
          <div class="akte-main-col">
            <div class="akte-bereich" data-tab="details">
              <h2 style="font-size:14px;margin:0 0 8px">Angebote (${linkedAngebote.length})</h2>
              ${linkedAngebote.length === 0 ? '<p class="text-mute">Keine Angebote verknüpft.</p>' : `
                <table class="data-table">
                  <thead><tr><th>Datum</th><th>Nr.</th><th>Betreff</th><th class="text-right">Betrag</th></tr></thead>
                  <tbody>${linkedAngebote.map((a) => `
                    <tr class="akte-row-link" data-href="#/angebote/${a.id}"><td>${formatDate(a.datum)}</td><td>${escapeHtml(a.nummer)}</td><td>${escapeHtml(a.betreff || '')}</td><td class="text-right">${formatCurrency(a.brutto)}</td></tr>
                  `).join('')}</tbody>
                </table>
              `}
            </div>
            ${linkedAB.length ? `
              <div class="akte-bereich" data-tab="details">
                <h2 style="font-size:14px;margin:0 0 8px">Auftragsbestätigungen (${linkedAB.length})</h2>
                <table class="data-table">
                  <thead><tr><th>Datum</th><th>Nr.</th><th>Betreff</th><th class="text-right">Betrag</th></tr></thead>
                  <tbody>${linkedAB.map((a) => `
                    <tr class="akte-row-link" data-href="#/auftragsbestaetigung/${a.id}"><td>${formatDate(a.datum)}</td><td>${escapeHtml(a.nummer)}</td><td>${escapeHtml(a.betreff || '')}</td><td class="text-right">${formatCurrency(a.brutto)}</td></tr>
                  `).join('')}</tbody>
                </table>
              </div>
            ` : ''}
            <div class="akte-bereich" data-tab="details">
              <h2 style="font-size:14px;margin:0 0 8px">Rechnungen (${linkedRechnungen.length})</h2>
              ${linkedRechnungen.length === 0 ? '<p class="text-mute">Keine Rechnungen verknüpft.</p>' : `
                <table class="data-table">
                  <thead><tr><th>Datum</th><th>Nr.</th><th>Betreff</th><th class="text-right">Betrag</th></tr></thead>
                  <tbody>${linkedRechnungen.map((r) => {
                    const ueberfaellig = (r.status === 'offen' || r.status === 'teilbezahlt') && r.faelligAm && r.faelligAm < heute;
                    return `<tr class="akte-row-link" data-href="#/rechnungen/${r.id}"><td>${formatDate(r.datum)}</td><td>${escapeHtml(r.nummer)}${ueberfaellig ? ' <span class="badge badge-danger">überfällig</span>' : ''}</td><td>${escapeHtml(r.betreff || '')}</td><td class="text-right">${formatCurrency(r.brutto)}</td></tr>`;
                  }).join('')}</tbody>
                </table>
              `}
            </div>
            <div class="akte-bereich" data-tab="details" id="nk-host"></div>
            <div class="akte-bereich" data-tab="details" id="ausgaben-host"></div>
            <div class="akte-bereich" data-tab="dokumentation" id="verwendung-host"></div>
            <div class="akte-bereich" data-tab="dokumentation" id="tc-host"></div>
            <div class="akte-bereich" data-tab="dokumentation" id="foto-host"></div>
            <div class="akte-bereich" data-tab="dokumentation" id="dok-host"></div>
          </div>
        </div>
      </div>
    `;

    const close = () => render(container, opts);
    container.querySelector('#akte-back').addEventListener('click', close);
    // Reiter-Umschalter "Details"/"Dokumentation" - nur auf dem Handy sichtbar
    // (siehe app.css @media 760px), auf dem Desktop bleiben beide Spalten wie
    // gehabt komplett sichtbar und die Reiter-Leiste ist ausgeblendet.
    const akteSplit = container.querySelector('.akte-split');
    container.querySelectorAll('.akte-mobile-tabs .tab-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.akte-mobile-tabs .tab-item').forEach((b) => b.classList.toggle('active', b === btn));
        akteSplit.dataset.activeTab = btn.dataset.akteTab;
      });
    });
    container.querySelector('#akte-edit').addEventListener('click', () => openForm(p));
    // Angebote/Auftragsbestätigungen/Rechnungen direkt aus der Projekt-Akte
    // anklickbar - öffnet das jeweilige Formular per Deep-Link, wie in der
    // Kundenakte.
    container.querySelectorAll('tr.akte-row-link[data-href]').forEach((row) => {
      row.addEventListener('click', () => { window.location.hash = row.dataset.href; });
    });
    container.querySelector('#akte-neuer-termin').addEventListener('click', () => {
      openTerminMitVorbelegung({
        titel: p.titel, kundeId: kunde?.id || '', projektId: p.id,
        ort: kunde ? [kunde.strasse, kunde.plz, kunde.ort].filter((s) => s && s.trim()).join(', ') : '',
      });
    });
    function dokumentPrefill() {
      return { kundeId: p.kundeId || '', projektId: p.id };
    }
    container.querySelector('#akte-neues-angebot').addEventListener('click', () => openDokumentMitVorbelegung('angebote', dokumentPrefill()));
    container.querySelector('#akte-neue-rechnung').addEventListener('click', () => openDokumentMitVorbelegung('rechnungen', dokumentPrefill()));
    container.querySelector('#akte-neue-ab').addEventListener('click', () => openDokumentMitVorbelegung('auftragsbestaetigung', dokumentPrefill()));
    container.querySelector('#akte-zu-mahnungen')?.addEventListener('click', () => { window.location.hash = '#/mahnungen'; });
    container.querySelector('#akte-lexoffice-transfer').addEventListener('click', () => uebertrageAnLexoffice(p));

    renderNachkalkulation(container.querySelector('#nk-host'), {
      projekt: p, ausgaben, zeiterfassung, rechnungen, mitarbeiter, settings,
    });
    renderProjektAusgaben(container.querySelector('#ausgaben-host'), p.id);
    renderVerwendungen(container.querySelector('#verwendung-host'), p.id);
    renderTeamchat(container.querySelector('#tc-host'), p.id, mitarbeiter);
    renderFotoSection(container.querySelector('#foto-host'), p.id);
    renderDokumenteSection(container.querySelector('#dok-host'), 'projekt', p.id, {
      title: 'Dokumente (Berichte, Stundenzettel, ...)',
      berichtContext: { settings: resolveMarkeSettings(settings, markenById[p.markeId]), kunde: kunde || null, projekt: p.titel },
      // Die Sprachnotiz kann direkt Verwendungen-/Zeiterfassungs-Einträge
      // anlegen (Material bzw. Arbeitszeit, die dabei mit erfasst wurden) -
      // danach die eigenen, bereits gerenderten Verwendungen- und
      // Nachkalkulations-Bereiche neu laden, sonst blieben sie bis zum
      // nächsten Öffnen der Akte veraltet.
      onProjektDatenGeaendert: async () => {
        [verwendungen, zeiterfassung] = await Promise.all([getAll('verwendungen'), getAll('zeiterfassung')]);
        renderVerwendungen(container.querySelector('#verwendung-host'), p.id);
        renderNachkalkulation(container.querySelector('#nk-host'), {
          projekt: p, ausgaben, zeiterfassung, rechnungen, mitarbeiter, settings,
        });
      },
    });
  }

  applyFilter();
}
