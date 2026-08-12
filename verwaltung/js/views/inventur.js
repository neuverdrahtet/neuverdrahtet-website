import { getAll, get, put, remove } from '../db.js';
import { uid, escapeHtml, toast, formatDate, formatDateTime, todayISO } from '../utils.js';
import { getSession } from '../auth.js';
import { confirmDelete } from '../ui.js';

// Formale Inventur: Stichtag-Zählung des gesamten Lagerbestands (anders als
// die einzelnen Zu-/Abgangs-Buchungen im Katalog, siehe #299/#315). Eine
// Inventur ist ein Snapshot aller bestandTracking-Artikel zum Startzeitpunkt
// (sollBestand); beim Abschließen wird pro Artikel mit abweichendem
// Ist-Bestand eine Korrektur-Lagerbewegung gebucht und katalog.bestand
// angepasst - danach ist die Inventur unveränderlich (kein Löschen/Bearbeiten
// mehr, wie ein Audit-Log).

export async function render(container, route) {
  const inventurId = (route || '').trim();
  if (inventurId) return renderDetail(container, inventurId);
  return renderListe(container);
}

async function renderListe(container) {
  let liste = await getAll('inventuren');
  liste.sort((a, b) => (b.gestartetAm || '').localeCompare(a.gestartetAm || ''));

  container.innerHTML = `
    <div class="view-header">
      <h1>Inventur</h1>
      <div class="actions">
        <button class="btn btn-primary" id="btn-new">+ Neue Inventur starten</button>
      </div>
    </div>
    <p class="hint">Stichtag-Zählung des gesamten Lagerbestands - für einzelne Zu-/Abgänge nutzt ihr weiterhin die +/− Buchungen direkt im Katalog.</p>
    <div id="table-host"></div>
  `;
  const tableHost = container.querySelector('#table-host');

  function renderTable() {
    if (liste.length === 0) {
      tableHost.innerHTML = '<div class="empty-state">Noch keine Inventur durchgeführt.</div>';
      return;
    }
    tableHost.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Gestartet am</th><th>Status</th><th>Positionen</th><th>Abweichungen</th><th>Abgeschlossen von</th></tr></thead>
        <tbody>
          ${liste.map((inv) => {
            const anzahlAbweichungen = (inv.positionen || []).filter((p) => p.istBestand !== null && p.istBestand !== undefined && Number(p.istBestand) !== Number(p.sollBestand)).length;
            return `
            <tr data-id="${inv.id}">
              <td>${formatDateTime(inv.gestartetAm)}</td>
              <td><span class="badge ${inv.status === 'abgeschlossen' ? 'badge-success' : 'badge-warn'}">${inv.status === 'abgeschlossen' ? 'Abgeschlossen' : 'Läuft'}</span></td>
              <td>${(inv.positionen || []).length}</td>
              <td>${inv.status === 'abgeschlossen' ? anzahlAbweichungen : '<span class="text-mute">–</span>'}</td>
              <td>${escapeHtml(inv.abgeschlossenVon || '')}</td>
            </tr>
          `;
          }).join('')}
        </tbody>
      </table>
    `;
    tableHost.querySelectorAll('tbody tr').forEach((row) => {
      row.addEventListener('click', () => { window.location.hash = `#/inventur/${row.dataset.id}`; });
    });
  }

  container.querySelector('#btn-new').addEventListener('click', async () => {
    const artikel = (await getAll('katalog')).filter((k) => k.typ === 'artikel' && k.bestandTracking);
    if (artikel.length === 0) {
      toast('Keine Artikel mit aktivierter Bestandsführung gefunden - zuerst im Katalog "Lagerbestand verfolgen" für die relevanten Artikel einschalten.', 'error');
      return;
    }
    const session = getSession() || {};
    const neueId = uid();
    const inventur = {
      id: neueId,
      status: 'offen',
      gestartetAm: new Date().toISOString(),
      gestartetVon: session.name || session.role || '',
      abgeschlossenAm: '',
      abgeschlossenVon: '',
      positionen: artikel
        .sort((a, b) => (a.bezeichnung || '').localeCompare(b.bezeichnung || ''))
        .map((k) => ({ katalogId: k.id, bezeichnung: k.bezeichnung || '', einheit: k.einheit || '', sollBestand: Number(k.bestand ?? 0), istBestand: null })),
    };
    await put('inventuren', inventur);
    window.location.hash = `#/inventur/${neueId}`;
  });

  renderTable();
}

async function renderDetail(container, inventurId) {
  const inventur = await get('inventuren', inventurId);
  if (!inventur) {
    container.innerHTML = '<div class="empty-state">Inventur wurde nicht gefunden. <a href="#/inventur">Zurück zur Übersicht</a></div>';
    return;
  }
  const istAbgeschlossen = inventur.status === 'abgeschlossen';

  container.innerHTML = `
    <div class="view-header">
      <h1>Inventur vom ${formatDate(inventur.gestartetAm)}</h1>
      <div class="actions">
        <a href="#/inventur" class="btn btn-ghost">← Zur Übersicht</a>
        ${!istAbgeschlossen ? `
          <button class="btn" id="btn-abbrechen">Abbrechen</button>
          <button class="btn btn-primary" id="btn-abschliessen">Inventur abschließen</button>
        ` : ''}
      </div>
    </div>
    ${!istAbgeschlossen ? '<p class="hint">Trag bei jedem Artikel den tatsächlich gezählten Bestand ein. Leer gelassene Artikel werden beim Abschließen nicht verändert (gelten als "nicht gezählt").</p>' : `<p class="hint">Abgeschlossen am ${formatDateTime(inventur.abgeschlossenAm)} von ${escapeHtml(inventur.abgeschlossenVon || '')}. Abgeschlossene Inventuren sind unveränderlich.</p>`}
    <table class="data-table">
      <thead><tr><th>Artikel</th><th>Soll-Bestand</th><th>Ist-Bestand</th><th>Abweichung</th></tr></thead>
      <tbody id="inv-tbody">
        ${inventur.positionen.map((p, i) => `
          <tr data-index="${i}">
            <td>${escapeHtml(p.bezeichnung)}</td>
            <td>${p.sollBestand} ${escapeHtml(p.einheit)}</td>
            <td>${istAbgeschlossen
              ? `${p.istBestand === null || p.istBestand === undefined ? '<span class="text-mute">nicht gezählt</span>' : `${p.istBestand} ${escapeHtml(p.einheit)}`}`
              : `<input type="number" step="0.01" class="inv-ist-input" data-index="${i}" value="${p.istBestand ?? ''}" placeholder="noch nicht gezählt" style="width:100px">`}</td>
            <td class="inv-diff" data-index="${i}"></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  function differenzText(p) {
    if (p.istBestand === null || p.istBestand === undefined || p.istBestand === '') return '<span class="text-mute">–</span>';
    const diff = Number(p.istBestand) - Number(p.sollBestand);
    if (diff === 0) return '<span class="text-mute">0</span>';
    return `<span style="color:var(${diff > 0 ? '--success' : '--danger'})">${diff > 0 ? '+' : ''}${diff}</span>`;
  }
  function updateDiffCells() {
    inventur.positionen.forEach((p, i) => {
      const cell = container.querySelector(`.inv-diff[data-index="${i}"]`);
      if (cell) cell.innerHTML = differenzText(p);
    });
  }
  updateDiffCells();

  if (!istAbgeschlossen) {
    container.querySelectorAll('.inv-ist-input').forEach((input) => {
      input.addEventListener('input', () => {
        const i = Number(input.dataset.index);
        inventur.positionen[i].istBestand = input.value === '' ? null : Number(input.value);
        updateDiffCells();
      });
    });

    container.querySelector('#btn-abbrechen').addEventListener('click', async () => {
      if (!confirmDelete('Diese Inventur wirklich abbrechen? Es wird nichts am Lagerbestand verändert.')) return;
      await remove('inventuren', inventur.id);
      toast('Inventur abgebrochen');
      window.location.hash = '#/inventur';
    });

    container.querySelector('#btn-abschliessen').addEventListener('click', async () => {
      const abweichungen = inventur.positionen.filter((p) => p.istBestand !== null && p.istBestand !== undefined && Number(p.istBestand) !== Number(p.sollBestand));
      if (abweichungen.length > 0 && !confirm(`${abweichungen.length} Artikel weichen vom Soll-Bestand ab. Bestand jetzt korrigieren und Inventur abschließen?`)) return;
      const session = getSession() || {};
      for (const p of abweichungen) {
        const artikel = await get('katalog', p.katalogId);
        if (!artikel) continue;
        const delta = Number(p.istBestand) - Number(p.sollBestand);
        await put('katalog', { ...artikel, bestand: Number(p.istBestand) });
        await put('lagerbewegungen', { id: uid(), katalogId: p.katalogId, delta, grund: `Inventur-Korrektur (Inventur vom ${formatDate(inventur.gestartetAm)})`, datum: new Date().toISOString() });
      }
      await put('inventuren', { ...inventur, status: 'abgeschlossen', abgeschlossenAm: new Date().toISOString(), abgeschlossenVon: session.name || session.role || '' });
      toast('Inventur abgeschlossen', 'success');
      render(container, inventur.id);
    });
  }
}
