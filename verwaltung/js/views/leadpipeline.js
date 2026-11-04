import { getAll, put, remove } from '../db.js';
import { uid, escapeHtml, toast, farbeAusText } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import { openStatusManager } from '../statusManager.js';
import { render as renderProjekteKanban } from './kanban.js';

const KUNDEN_FARBEN = ['#6b7280', '#2b7fd6', '#1f8a4c', '#f0a020', '#8e44ad', '#c0392b', '#14b8a6', '#e91e8c'];

// Analog zu GRUENDE_ABLEHNUNG/GRUENDE_ANNAHME in views/angebote.js - bewusst
// eine feste Liste statt einer konfigurierbaren Einstellung, passend zum dort
// bereits etablierten Muster für "Grund auswählen"-Felder.
const VERLUSTGRUENDE = [
  { id: 'preis', titel: 'Preis zu hoch' },
  { id: 'konkurrenz', titel: 'Anderer Anbieter gewählt' },
  { id: 'verschoben', titel: 'Projekt verschoben / auf Eis gelegt' },
  { id: 'entfaellt', titel: 'Projekt entfällt' },
  { id: 'keine_rueckmeldung', titel: 'Keine Rückmeldung vom Kunden' },
  { id: 'sonstiges', titel: 'Sonstiges' },
];
function verlustgrundTitel(id) {
  return VERLUSTGRUENDE.find((g) => g.id === id)?.titel || '';
}

function kuerzeText(text, maxLaenge) {
  const einzeilig = (text || '').replace(/\s+/g, ' ').trim();
  return einzeilig.length > maxLaenge ? einzeilig.slice(0, maxLaenge - 1) + '…' : einzeilig;
}

// Maßnahme "Solo-Betrieb-Vereinfachung" (November 2026): Lead-Pipeline
// (Kunden-Status, diese Funktion) und Kanban (Projekt-Status, kanban.js)
// sind bewusst unterschiedliche Datenmodelle (kunden/kundenStatus vs.
// projekte/kanbanSpalten) und bleiben technisch getrennt - zusammengelegt
// wurde hier nur die NAVIGATION (ein Menüpunkt mit zwei Reitern statt
// zwei getrennten Menüpunkten, siehe render() unten), nicht die Daten.
async function renderLeads(container) {
  let [kunden, spalten] = await Promise.all([getAll('kunden'), getAll('kundenStatus')]);
  spalten.sort((a, b) => a.reihenfolge - b.reihenfolge);

  container.innerHTML = `
    <div class="view-header">
      <h1>Lead-Pipeline</h1>
      <div class="actions">
        <button class="btn" id="btn-status-manage">⚙️ Status verwalten</button>
        <button class="btn btn-primary" id="btn-new-card">+ Neuer Lead</button>
      </div>
    </div>
    <p class="hint">Kunden-Status entlang der Vertriebsphase - per Ziehen oder über die Auswahl in der Karte verschieben. Vollständige Kundendaten (Adresse, Kundenakte, Dokumente) bearbeitest du in der <a href="#/kunden">Kunden-Ansicht</a>.</p>
    <div class="kanban-board" id="board"></div>
  `;
  const board = container.querySelector('#board');

  function istVerlustStatusId(statusId) {
    return !!spalten.find((s) => s.id === statusId)?.istVerlustStatus;
  }

  // Zentrale Stelle für jeden Statuswechsel (Drag&Drop, card-move-Select,
  // Bearbeiten-Formular) - fängt den Wechsel IN einen Verlust-Status ab und
  // fragt erst den Grund ab, bevor der neue Status tatsächlich gespeichert
  // wird. onCancel kann z.B. ein <select> wieder auf den alten Wert zurücksetzen.
  function wechsleStatus(kunde, neuerStatus, { onCancel } = {}) {
    if (neuerStatus === kunde.status) return;
    if (istVerlustStatusId(neuerStatus) && !istVerlustStatusId(kunde.status)) {
      openVerlustgrundModal(kunde, neuerStatus, onCancel);
      return;
    }
    kunde.status = neuerStatus;
    put('kunden', kunde).then(renderBoard);
  }

  function openVerlustgrundModal(kunde, neuerStatus, onCancel) {
    const { body, close } = openModal({
      title: `Verlustgrund – ${escapeHtml(kunde.firma)}`,
      bodyHtml: `
        <div class="field"><label>Warum wurde dieser Lead verloren?</label>
          <select id="vg-grund">${VERLUSTGRUENDE.map((g) => `<option value="${g.id}">${escapeHtml(g.titel)}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Notiz (optional)</label><input type="text" id="vg-text" placeholder="Details"></div>
        <div class="modal-actions">
          <span class="spacer"></span>
          <button type="button" class="btn" id="vg-cancel">Abbrechen</button>
          <button type="button" class="btn btn-primary" id="vg-save">Als verloren speichern</button>
        </div>
      `,
    });
    body.querySelector('#vg-cancel').addEventListener('click', () => {
      close();
      if (onCancel) onCancel();
      renderBoard();
    });
    body.querySelector('#vg-save').addEventListener('click', async () => {
      kunde.status = neuerStatus;
      kunde.verlustgrund = body.querySelector('#vg-grund').value;
      kunde.verlustgrundText = body.querySelector('#vg-text').value.toString().trim();
      await put('kunden', kunde);
      close();
      renderBoard();
    });
  }

  function renderBoard() {
    board.innerHTML = spalten.map((s) => {
      const cards = kunden.filter((k) => (k.status || 'kunde') === s.id);
      return `
        <div class="kanban-col" data-col="${s.id}" style="--col-color:${escapeHtml(s.farbe || 'var(--border)')}">
          <div class="kanban-col-header">
            <span class="col-title"><span class="col-dot"></span>${escapeHtml(s.titel)}</span>
            <span class="count">${cards.length}</span>
          </div>
          <div class="kanban-cards" data-col-body="${s.id}">
            ${cards.map((k) => `
              <div class="kanban-card" draggable="true" data-id="${k.id}" style="border-left-color:${escapeHtml(k.farbe || 'var(--accent)')}">
                <div class="title">${escapeHtml(k.firma)}</div>
                ${k.ansprechpartner ? `<div class="meta">${escapeHtml(k.ansprechpartner)}</div>` : ''}
                ${k.telefon ? `<div class="meta">${escapeHtml(k.telefon)}</div>` : ''}
                ${k.notizen ? `<div class="meta text-mute" style="white-space:pre-wrap">${escapeHtml(kuerzeText(k.notizen, 140))}</div>` : ''}
                ${istVerlustStatusId(k.status) && k.verlustgrund ? `<div class="meta"><span class="badge badge-danger">Verloren: ${escapeHtml(verlustgrundTitel(k.verlustgrund))}</span></div>` : ''}
                <select class="card-move" data-id="${k.id}" title="Status wechseln (auch per Ziehen möglich)">
                  ${spalten.map((s2) => `<option value="${s2.id}" ${s2.id === (k.status || 'kunde') ? 'selected' : ''}>${escapeHtml(s2.titel)}</option>`).join('')}
                </select>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');

    board.querySelectorAll('.kanban-card').forEach((card) => {
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', card.dataset.id);
        setTimeout(() => card.classList.add('dragging'), 0);
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      card.addEventListener('click', (e) => {
        if (e.target.closest('.card-move')) return;
        openCardForm(kunden.find((k) => k.id === card.dataset.id));
      });
    });

    board.querySelectorAll('.card-move').forEach((select) => {
      select.addEventListener('click', (e) => e.stopPropagation());
      select.addEventListener('change', (e) => {
        e.stopPropagation();
        const kunde = kunden.find((k) => k.id === select.dataset.id);
        if (!kunde) return;
        const vorherigerStatus = kunde.status;
        wechsleStatus(kunde, select.value, { onCancel: () => { select.value = vorherigerStatus; } });
      });
    });

    board.querySelectorAll('.kanban-col').forEach((col) => {
      col.addEventListener('dragover', (e) => {
        e.preventDefault();
        col.classList.add('drag-over');
      });
      col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
      col.addEventListener('drop', (e) => {
        e.preventDefault();
        col.classList.remove('drag-over');
        const id = e.dataTransfer.getData('text/plain');
        const kunde = kunden.find((k) => k.id === id);
        const newStatus = col.dataset.col;
        if (!kunde || !newStatus) return;
        wechsleStatus(kunde, newStatus);
      });
    });
  }

  container.querySelector('#btn-new-card').addEventListener('click', () => openCardForm());
  // Übergabe aus dem Postfach ("🎯 Anfrage anlegen" an einer E-Mail, siehe
  // postfach.js) - einmaliger Prefill-Schlüssel, gleiches Muster wie
  // nv-anlage-prefill zwischen ausgaben.js und buchhaltung.js.
  try {
    const prefillRaw = sessionStorage.getItem('nv-lead-prefill');
    if (prefillRaw) {
      sessionStorage.removeItem('nv-lead-prefill');
      openCardForm(null, JSON.parse(prefillRaw));
    }
  } catch { /* sessionStorage evtl. nicht verfügbar */ }
  container.querySelector('#btn-status-manage').addEventListener('click', () => {
    openStatusManager({
      title: 'Kunden-Status verwalten',
      store: 'kundenStatus',
      items: spalten,
      zeigeVerlustFlag: true,
      canDelete: (it) => !kunden.some((k) => (k.status || 'kunde') === it.id),
      onChange: () => renderLeads(container),
    });
  });

  function openCardForm(k, prefill) {
    const isEdit = !!k;
    const neueId = uid();
    const data = k || {
      id: neueId, firma: prefill?.firma || '', ansprechpartner: prefill?.ansprechpartner || '', telefon: prefill?.telefon || '',
      email: prefill?.email || '', notizen: prefill?.notizen || '', status: spalten[0]?.id || '', farbe: farbeAusText(neueId, KUNDEN_FARBEN), createdAt: new Date().toISOString(),
    };
    const { body, close } = openModal({
      title: isEdit ? 'Lead bearbeiten' : 'Neuer Lead',
      bodyHtml: `
        <form id="lead-form">
          <div class="form-grid">
            <div class="field col-span-2"><label>Firma / Name *</label><input name="firma" required value="${escapeHtml(data.firma)}"></div>
            <div class="field"><label>Ansprechpartner</label><input name="ansprechpartner" value="${escapeHtml(data.ansprechpartner || '')}"></div>
            <div class="field"><label>Status</label>
              <select name="status">${spalten.map((s) => `<option value="${s.id}" ${s.id === (data.status || 'kunde') ? 'selected' : ''}>${escapeHtml(s.titel)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Telefon</label><input name="telefon" value="${escapeHtml(data.telefon || '')}"></div>
            <div class="field"><label>E-Mail</label><input type="email" name="email" value="${escapeHtml(data.email || '')}"></div>
            <div class="col-span-2" id="verlust-grund-section" ${istVerlustStatusId(data.status) ? '' : 'hidden'}>
              <div class="field">
                <label>Verlustgrund</label>
                <select name="verlustgrund">${VERLUSTGRUENDE.map((g) => `<option value="${g.id}" ${g.id === data.verlustgrund ? 'selected' : ''}>${escapeHtml(g.titel)}</option>`).join('')}</select>
                <input type="text" name="verlustgrundText" value="${escapeHtml(data.verlustgrundText || '')}" placeholder="Notiz (optional)" style="margin-top:6px">
              </div>
            </div>
            <div class="field col-span-2"><label>Notizen / Anliegen</label><textarea name="notizen" rows="4">${escapeHtml(data.notizen || '')}</textarea></div>
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
    body.querySelector('#btn-cancel').addEventListener('click', close);
    body.querySelector('select[name="status"]').addEventListener('change', (e) => {
      body.querySelector('#verlust-grund-section').hidden = !istVerlustStatusId(e.target.value);
    });
    if (isEdit) {
      body.querySelector('#btn-delete').addEventListener('click', async () => {
        if (!confirmDelete(`Kunde "${data.firma}" in den Papierkorb verschieben?`)) return;
        await remove('kunden', data.id);
        toast('Kunde in den Papierkorb verschoben');
        close();
        renderLeads(container);
      });
    }
    body.querySelector('#lead-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      for (const key of ['firma', 'ansprechpartner', 'status', 'telefon', 'email', 'notizen']) {
        updated[key] = (fd.get(key) || '').toString().trim();
      }
      if (istVerlustStatusId(updated.status)) {
        updated.verlustgrund = (fd.get('verlustgrund') || '').toString().trim();
        updated.verlustgrundText = (fd.get('verlustgrundText') || '').toString().trim();
      } else {
        updated.verlustgrund = '';
        updated.verlustgrundText = '';
      }
      if (!updated.firma) return;
      await put('kunden', updated);
      toast(isEdit ? 'Kunde aktualisiert' : 'Lead angelegt', 'success');
      close();
      renderLeads(container);
    });
  }

  renderBoard();
}

export async function render(container) {
  container.innerHTML = `
    <div class="tabs" id="lp-tabs">
      <button type="button" class="tab-item active" data-tab="leads">🧲 Leads</button>
      <button type="button" class="tab-item" data-tab="projekte">🗂️ Projekte</button>
    </div>
    <div id="lp-tab-leads"></div>
    <div id="lp-tab-projekte" hidden></div>
  `;
  const tabs = container.querySelector('#lp-tabs');
  const leadsHost = container.querySelector('#lp-tab-leads');
  const projekteHost = container.querySelector('#lp-tab-projekte');
  await renderLeads(leadsHost);
  let projekteGeladen = false;
  tabs.querySelectorAll('.tab-item').forEach((btn) => {
    btn.addEventListener('click', async () => {
      tabs.querySelectorAll('.tab-item').forEach((b) => b.classList.toggle('active', b === btn));
      const aktivTab = btn.dataset.tab;
      leadsHost.hidden = aktivTab !== 'leads';
      projekteHost.hidden = aktivTab !== 'projekte';
      if (aktivTab === 'projekte' && !projekteGeladen) {
        projekteGeladen = true;
        await renderProjekteKanban(projekteHost);
      }
    });
  });
}
