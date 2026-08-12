import { getAll, get, put, remove } from '../db.js';
import { uid, escapeHtml, toast, formatDateTime } from '../utils.js';
import { getSession } from '../auth.js';
import { openModal, confirmDelete } from '../ui.js';

// Freier Formular-Generator: für alles, was NICHT in den strukturierten
// Berichte-Baukasten (vorlagen.js, PDF-Bericht an einem Projekt) passt -
// z.B. Sicherheitschecklisten, interne Abfragen, Freigabe-Formulare. Baut
// ein Admin/Büro hier ein Formular aus freien Feldern zusammen, kann jeder
// (auch mitarbeiter) es beliebig oft ausfüllen; jede Ausfüllung wird als
// eigener Eintrag gespeichert (kein PDF, keine Projekt-Bindung - reine
// Liste zum Nachschauen/Auswerten).

const FELD_TYP_LABEL = {
  text: 'Text (einzeilig)',
  mehrzeilig: 'Text (mehrzeilig)',
  zahl: 'Zahl',
  datum: 'Datum',
  checkbox: 'Ja/Nein',
  auswahl: 'Auswahl (Dropdown)',
};

export async function render(container, route) {
  const formularId = (route || '').trim();
  if (formularId) return renderDetail(container, formularId);
  return renderListe(container);
}

/**
 * Öffnet den Formular-Editor (Name/Beschreibung/Aktiv + Felder-Baukasten).
 * `vorhanden` ist das bestehende Formular-Objekt beim Bearbeiten, sonst
 * undefined für ein neues Formular. `onSaved`/`onDeleted` werden nach dem
 * jeweiligen Vorgang aufgerufen, damit Liste/Detail-Ansicht sich neu
 * aufbauen können - der Editor selbst kennt seinen Aufrufkontext nicht.
 */
function openFormularEditor(vorhanden, { onSaved, onDeleted } = {}) {
  const data = vorhanden || { id: uid(), name: '', beschreibung: '', aktiv: true, felder: [] };
  let feldState = (data.felder || []).map((f) => ({ ...f }));

  const { body, close } = openModal({
    title: vorhanden ? 'Formular bearbeiten' : 'Neues Formular',
    wide: true,
    bodyHtml: `
      <form id="formular-form">
        <div class="form-grid">
          <div class="field col-span-2"><label>Name *</label><input type="text" name="name" value="${escapeHtml(data.name)}" required></div>
          <div class="field col-span-2"><label>Beschreibung</label><textarea name="beschreibung" rows="2">${escapeHtml(data.beschreibung || '')}</textarea></div>
          <label class="field-checkbox col-span-2"><input type="checkbox" name="aktiv" ${data.aktiv !== false ? 'checked' : ''}> Aktiv (für alle sichtbar, sonst nur für Admin/Büro)</label>
        </div>
        <h3 style="margin-top:16px">Felder</h3>
        <div id="feld-list" style="margin-bottom:10px"></div>
        <div class="flex-row">
          <select id="feld-add-typ">
            ${Object.entries(FELD_TYP_LABEL).map(([typ, label]) => `<option value="${typ}">${label}</option>`).join('')}
          </select>
          <button type="button" class="btn btn-sm" id="feld-add-btn">+ Feld hinzufügen</button>
        </div>
        <div class="modal-actions">
          ${vorhanden ? `<button type="button" class="btn btn-danger" id="btn-del">Löschen</button>` : ''}
          <span class="spacer"></span>
          <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
          <button type="submit" class="btn btn-primary">Speichern</button>
        </div>
      </form>
    `,
  });

  function renderFeldList() {
    const listHost = body.querySelector('#feld-list');
    if (feldState.length === 0) {
      listHost.innerHTML = '<p class="hint">Noch keine Felder. Unten einen Feld-Typ wählen und hinzufügen.</p>';
      return;
    }
    listHost.innerHTML = feldState.map((f, i) => `
      <div class="card" style="padding:10px; margin-bottom:8px" data-i="${i}">
        <div class="flex-row" style="align-items:flex-start">
          <div style="flex:1">
            <div class="form-grid">
              <div class="field"><label>Beschriftung</label><input type="text" class="feld-input" data-field="label" value="${escapeHtml(f.label || '')}"></div>
              <div class="field"><label>Typ</label><span class="text-mute">${FELD_TYP_LABEL[f.typ] || f.typ}</span></div>
              ${f.typ === 'auswahl' ? `<div class="field col-span-2"><label>Optionen (eine pro Zeile)</label><textarea class="feld-input" data-field="optionen" rows="3">${escapeHtml((f.optionen || []).join('\n'))}</textarea></div>` : ''}
            </div>
            <label class="field-checkbox"><input type="checkbox" class="feld-check" data-field="pflicht" ${f.pflicht ? 'checked' : ''}> Pflichtfeld</label>
          </div>
          <button type="button" class="btn btn-sm btn-danger feld-del">Entfernen</button>
        </div>
      </div>
    `).join('');
    listHost.querySelectorAll('.card').forEach((card) => {
      const i = Number(card.dataset.i);
      card.querySelectorAll('.feld-input').forEach((inp) => {
        inp.addEventListener('input', (e) => {
          const field = e.target.dataset.field;
          feldState[i][field] = field === 'optionen' ? e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) : e.target.value;
        });
      });
      card.querySelectorAll('.feld-check').forEach((cb) => {
        cb.addEventListener('change', (e) => { feldState[i][e.target.dataset.field] = e.target.checked; });
      });
      card.querySelector('.feld-del').addEventListener('click', () => { feldState.splice(i, 1); renderFeldList(); });
    });
  }

  body.querySelector('#feld-add-btn').addEventListener('click', () => {
    const typ = body.querySelector('#feld-add-typ').value;
    feldState.push({ id: uid(), typ, label: '', pflicht: false, optionen: typ === 'auswahl' ? [] : undefined });
    renderFeldList();
  });

  if (vorhanden) {
    body.querySelector('#btn-del').addEventListener('click', async () => {
      if (!confirmDelete(`Formular "${data.name}" wirklich löschen? Alle zugehörigen Einträge werden ebenfalls gelöscht.`)) return;
      const zugehoerige = (await getAll('formularEintraege')).filter((e) => e.formularId === data.id);
      for (const e of zugehoerige) await remove('formularEintraege', e.id);
      await remove('formulare', data.id);
      toast('Formular gelöscht');
      close();
      if (onDeleted) onDeleted();
    });
  }

  body.querySelector('#btn-cancel').addEventListener('click', close);
  body.querySelector('#formular-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const name = (fd.get('name') || '').toString().trim();
    if (!name) return;
    if (feldState.some((f) => !f.label || !f.label.trim())) {
      toast('Jedes Feld braucht eine Beschriftung', 'error');
      return;
    }
    const updated = {
      ...data,
      name,
      beschreibung: (fd.get('beschreibung') || '').toString().trim(),
      aktiv: fd.get('aktiv') === 'on',
      felder: feldState,
    };
    await put('formulare', updated);
    toast('Formular gespeichert', 'success');
    close();
    if (onSaved) onSaved(updated);
  });

  renderFeldList();
}

async function renderListe(container) {
  const session = getSession() || {};
  const istAdminOderBuero = session.role === 'admin' || session.role === 'buero';
  let [formulare, eintraege] = await Promise.all([getAll('formulare'), getAll('formularEintraege')]);
  formulare.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  if (!istAdminOderBuero) formulare = formulare.filter((f) => f.aktiv !== false);

  container.innerHTML = `
    <div class="view-header">
      <h1>Formulare</h1>
      ${istAdminOderBuero ? `<div class="actions"><button class="btn btn-primary" id="btn-new">+ Neues Formular</button></div>` : ''}
    </div>
    <div id="table-host"></div>
  `;

  function anzahlEintraege(formularId) {
    return eintraege.filter((e) => e.formularId === formularId).length;
  }

  function renderTable() {
    const host = container.querySelector('#table-host');
    if (formulare.length === 0) {
      host.innerHTML = '<div class="empty-state">Noch keine Formulare angelegt.</div>';
      return;
    }
    host.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Name</th><th>Felder</th><th>Einträge</th>${istAdminOderBuero ? '<th>Status</th>' : ''}<th></th></tr></thead>
        <tbody>
          ${formulare.map((f) => `
            <tr data-id="${f.id}">
              <td>${escapeHtml(f.name || '')}${f.beschreibung ? `<div class="text-mute" style="font-size:12px">${escapeHtml(f.beschreibung)}</div>` : ''}</td>
              <td>${(f.felder || []).length}</td>
              <td>${anzahlEintraege(f.id)}</td>
              ${istAdminOderBuero ? `<td><span class="badge ${f.aktiv === false ? '' : 'badge-success'}">${f.aktiv === false ? 'Inaktiv' : 'Aktiv'}</span></td>` : ''}
              <td></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    host.querySelectorAll('tr[data-id]').forEach((row) => {
      row.addEventListener('click', () => { window.location.hash = `#/formulare/${row.dataset.id}`; });
    });
  }

  if (istAdminOderBuero) {
    container.querySelector('#btn-new').addEventListener('click', () => {
      openFormularEditor(undefined, {
        onSaved: (updated) => { formulare.push(updated); renderTable(); },
      });
    });
  }

  renderTable();
}

async function renderDetail(container, formularId) {
  const formular = await get('formulare', formularId);
  if (!formular) {
    container.innerHTML = '<div class="empty-state">Formular wurde nicht gefunden. <a href="#/formulare">Zurück zur Übersicht</a></div>';
    return;
  }
  const session = getSession() || {};
  const istAdminOderBuero = session.role === 'admin' || session.role === 'buero';
  let eintraege = (await getAll('formularEintraege')).filter((e) => e.formularId === formularId);
  eintraege.sort((a, b) => (b.erstelltAm || '').localeCompare(a.erstelltAm || ''));
  const felder = formular.felder || [];

  container.innerHTML = `
    <div class="view-header">
      <div>
        <a href="#/formulare" class="text-mute">&larr; Formulare</a>
        <h1>${escapeHtml(formular.name || '')}</h1>
        ${formular.beschreibung ? `<p class="hint">${escapeHtml(formular.beschreibung)}</p>` : ''}
      </div>
      <div class="actions">
        ${istAdminOderBuero ? `<button class="btn" id="btn-bearbeiten">Bearbeiten</button>` : ''}
        <button class="btn btn-primary" id="btn-ausfuellen">+ Ausfüllen</button>
      </div>
    </div>
    <div id="eintraege-host"></div>
  `;

  function renderWert(feld, wert) {
    if (wert === undefined || wert === null || wert === '') return '–';
    if (feld.typ === 'checkbox') return wert ? 'Ja' : 'Nein';
    return escapeHtml(String(wert));
  }

  function renderEintraege() {
    const host = container.querySelector('#eintraege-host');
    if (felder.length === 0) {
      host.innerHTML = '<div class="empty-state">Dieses Formular hat noch keine Felder. Im Formular-Editor Felder hinzufügen.</div>';
      return;
    }
    if (eintraege.length === 0) {
      host.innerHTML = '<div class="empty-state">Noch keine Einträge. Auf "+ Ausfüllen" klicken, um den ersten Eintrag zu erfassen.</div>';
      return;
    }
    host.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Erfasst am</th><th>Von</th>
            ${felder.map((f) => `<th>${escapeHtml(f.label)}</th>`).join('')}
            ${istAdminOderBuero ? '<th></th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${eintraege.map((e) => `
            <tr data-id="${e.id}">
              <td>${formatDateTime(e.erstelltAm)}</td>
              <td>${escapeHtml(e.erstelltVon || '')}</td>
              ${felder.map((f) => `<td>${renderWert(f, (e.werte || {})[f.id])}</td>`).join('')}
              ${istAdminOderBuero ? `<td><button type="button" class="btn btn-sm btn-danger btn-del-eintrag" data-id="${e.id}">Löschen</button></td>` : ''}
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    host.querySelectorAll('.btn-del-eintrag').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirmDelete('Eintrag wirklich löschen?')) return;
        await remove('formularEintraege', btn.dataset.id);
        eintraege = eintraege.filter((e) => e.id !== btn.dataset.id);
        renderEintraege();
      });
    });
  }

  function feldInputHtml(f) {
    const req = f.pflicht ? 'required' : '';
    if (f.typ === 'mehrzeilig') return `<textarea name="${f.id}" ${req}></textarea>`;
    if (f.typ === 'zahl') return `<input type="number" step="any" name="${f.id}" ${req}>`;
    if (f.typ === 'datum') return `<input type="date" name="${f.id}" ${req}>`;
    if (f.typ === 'checkbox') return `<label class="field-checkbox"><input type="checkbox" name="${f.id}"> Ja</label>`;
    if (f.typ === 'auswahl') {
      return `<select name="${f.id}" ${req}>
        <option value="">– auswählen –</option>
        ${(f.optionen || []).map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('')}
      </select>`;
    }
    return `<input type="text" name="${f.id}" ${req}>`;
  }

  if (istAdminOderBuero) {
    container.querySelector('#btn-bearbeiten').addEventListener('click', () => {
      openFormularEditor(formular, {
        onSaved: () => render(container, formularId),
        onDeleted: () => { window.location.hash = '#/formulare'; },
      });
    });
  }

  container.querySelector('#btn-ausfuellen').addEventListener('click', () => {
    if (felder.length === 0) {
      toast('Dieses Formular hat noch keine Felder', 'error');
      return;
    }
    const { body, close } = openModal({
      title: `${formular.name}: Ausfüllen`,
      bodyHtml: `
        <form id="ausfuell-form">
          <div class="form-grid">
            ${felder.map((f) => `
              <div class="field ${f.typ === 'mehrzeilig' || f.typ === 'checkbox' ? 'col-span-2' : ''}">
                ${f.typ !== 'checkbox' ? `<label>${escapeHtml(f.label)}${f.pflicht ? ' *' : ''}</label>` : ''}
                ${feldInputHtml(f)}
              </div>
            `).join('')}
          </div>
          <div class="modal-actions">
            <span class="spacer"></span>
            <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Speichern</button>
          </div>
        </form>
      `,
    });
    body.querySelector('#btn-cancel').addEventListener('click', close);
    body.querySelector('#ausfuell-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const werte = {};
      for (const f of felder) {
        if (f.typ === 'checkbox') {
          werte[f.id] = fd.get(f.id) === 'on';
        } else if (f.typ === 'zahl') {
          const raw = (fd.get(f.id) || '').toString();
          werte[f.id] = raw === '' ? '' : Number(raw);
        } else {
          werte[f.id] = (fd.get(f.id) || '').toString().trim();
        }
      }
      const eintrag = {
        id: uid(),
        formularId,
        werte,
        erstelltVon: session.name || session.role || '',
        erstelltAm: new Date().toISOString(),
      };
      await put('formularEintraege', eintrag);
      eintraege.unshift(eintrag);
      toast('Eintrag gespeichert', 'success');
      close();
      renderEintraege();
    });
  });

  renderEintraege();
}
