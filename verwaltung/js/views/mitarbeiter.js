import { getAll, put, remove, ZUGRIFFSROLLEN, TERMIN_TYPEN } from '../db.js';
import { uid, escapeHtml, formatDate, toast } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import { renderDokumenteSection } from '../dokumente.js';
import { createBulkSelect } from '../bulkselect.js';

const STATUS_TYPEN = ['krank', 'urlaub', 'schulung', 'baustelle'];

function currentStatusFor(termine, mitarbeiterId) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const active = termine.find((t) => {
    if (!t.mitarbeiterIds?.includes(mitarbeiterId) || !STATUS_TYPEN.includes(t.typ)) return false;
    const start = (t.start || '').slice(0, 10);
    const ende = (t.ende || '').slice(0, 10) || start;
    return start <= todayStr && todayStr <= ende;
  });
  return active ? TERMIN_TYPEN.find((tt) => tt.id === active.typ) : null;
}

const FARBEN = ['#f0a020', '#2b7fd6', '#1f8a4c', '#c0392b', '#8e44ad', '#16a085', '#d35400', '#2c3e50'];
const VERTRAGSARTEN = ['Vollzeit', 'Teilzeit', 'Minijob', 'Werkstudent', 'Auszubildender', 'Praktikant'];
const MA_DOKUMENT_KATEGORIEN = [
  { id: 'vertrag', titel: 'Vertrag' },
  { id: 'sonstiges', titel: 'Sonstiges' },
];

function currentYearCount(termine, mitarbeiterId, typ) {
  const year = new Date().getFullYear();
  return termine.filter((t) =>
    t.typ === typ &&
    t.mitarbeiterIds?.includes(mitarbeiterId) &&
    Number((t.start || '').slice(0, 4)) === year
  ).length;
}

export async function render(container) {
  let [mitarbeiter, termine] = await Promise.all([getAll('mitarbeiter'), getAll('termine')]);
  mitarbeiter.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const bulk = createBulkSelect('mitarbeiter', { label: 'Mitarbeiter' });

  container.innerHTML = `
    <div class="view-header">
      <h1>Mitarbeiter</h1>
      <div class="actions"><button class="btn btn-primary" id="btn-new">+ Neuer Mitarbeiter</button></div>
    </div>
    <div id="table-host"></div>
  `;
  const tableHost = container.querySelector('#table-host');

  function renderTable() {
    if (mitarbeiter.length === 0) {
      tableHost.innerHTML = `<div class="empty-state">Noch keine Mitarbeiter angelegt.</div>`;
      return;
    }
    tableHost.innerHTML = `
      ${bulk.barHtml()}
      <table class="data-table">
        <thead><tr>${bulk.headerCell()}<th></th><th>Name</th><th>Rolle</th><th>Vertrag</th><th>Status heute</th><th>Urlaub (Jahr)</th><th>Telefon</th><th>E-Mail</th></tr></thead>
        <tbody>
          ${mitarbeiter.map((m) => {
            const genommen = currentYearCount(termine, m.id, 'urlaub');
            const anspruch = Number(m.urlaubsanspruchTage) || 0;
            const status = currentStatusFor(termine, m.id);
            return `
            <tr data-id="${m.id}">
              ${bulk.rowCell(m.id)}
              <td><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${m.farbe || '#f0a020'}"></span></td>
              <td>${escapeHtml(m.name)}</td>
              <td>${escapeHtml(m.rolle || '')}</td>
              <td>${escapeHtml(m.vertragsart || '')}</td>
              <td>${status ? `<span class="badge" style="background:${escapeHtml(status.farbe)}22;color:${escapeHtml(status.farbe)}">${escapeHtml(status.titel)}</span>` : '<span class="badge badge-success">Verfügbar</span>'}</td>
              <td>${anspruch ? `${genommen} / ${anspruch} Tage` : (genommen ? `${genommen} Tage` : '')}</td>
              <td>${escapeHtml(m.telefon || '')}</td>
              <td>${escapeHtml(m.email || '')}</td>
            </tr>
          `; }).join('')}
        </tbody>
      </table>
    `;
    tableHost.querySelectorAll('tbody tr').forEach((row) => {
      row.addEventListener('click', () => openForm(mitarbeiter.find((m) => m.id === row.dataset.id)));
    });
    bulk.wire(tableHost, {
      onChange: renderTable,
      onDeleted: (ids) => {
        mitarbeiter = mitarbeiter.filter((m) => !ids.includes(m.id));
        renderTable();
      },
    });
  }

  container.querySelector('#btn-new').addEventListener('click', () => openForm());

  function openForm(m) {
    const isEdit = !!m;
    const data = m || {
      id: uid(), name: '', rolle: '', telefon: '', email: '', farbe: FARBEN[mitarbeiter.length % FARBEN.length],
      personalnummer: '', geburtsdatum: '', strasse: '', plz: '', ort: '',
      eintrittsdatum: '', austrittsdatum: '', vertragsart: 'Vollzeit', wochenstunden: 40,
      stundenlohn: '', gehaltMonatlich: '', urlaubsanspruchTage: 30,
      iban: '', steuerId: '', sozialversicherungsnummer: '', krankenkasse: '',
      notfallkontaktName: '', notfallkontaktTelefon: '', notizen: '',
      zugangscode: '', zugriffsrolle: 'mitarbeiter',
    };
    const urlaubGenommen = isEdit ? currentYearCount(termine, data.id, 'urlaub') : 0;
    const krankTage = isEdit ? currentYearCount(termine, data.id, 'krank') : 0;
    const schulungTage = isEdit ? currentYearCount(termine, data.id, 'schulung') : 0;
    const urlaubRest = (Number(data.urlaubsanspruchTage) || 0) - urlaubGenommen;
    const aktuellerStatus = isEdit ? currentStatusFor(termine, data.id) : null;
    const statusVerlauf = isEdit
      ? termine.filter((t) => t.mitarbeiterIds?.includes(data.id) && STATUS_TYPEN.includes(t.typ))
          .sort((a, b) => (b.start || '').localeCompare(a.start || '')).slice(0, 8)
      : [];

    const { body, close } = openModal({
      title: isEdit ? 'Mitarbeiter bearbeiten' : 'Neuer Mitarbeiter',
      wide: true,
      bodyHtml: `
        <form id="ma-form">
          <h2 style="font-size:14px;margin:0 0 8px">Stammdaten</h2>
          <div class="form-grid">
            <div class="field"><label>Name *</label><input name="name" required value="${escapeHtml(data.name)}"></div>
            <div class="field"><label>Personalnummer</label><input name="personalnummer" value="${escapeHtml(data.personalnummer || '')}"></div>
            <div class="field"><label>Rolle</label><input name="rolle" placeholder="z.B. Elektriker" value="${escapeHtml(data.rolle || '')}"></div>
            <div class="field"><label>Geburtsdatum</label><input type="date" name="geburtsdatum" value="${data.geburtsdatum || ''}"></div>
            <div class="field"><label>Telefon</label><input name="telefon" value="${escapeHtml(data.telefon || '')}"></div>
            <div class="field"><label>E-Mail</label><input type="email" name="email" value="${escapeHtml(data.email || '')}"></div>
            <div class="field"><label>Straße & Hausnr.</label><input name="strasse" value="${escapeHtml(data.strasse || '')}"></div>
            <div class="field"><label>PLZ</label><input name="plz" value="${escapeHtml(data.plz || '')}"></div>
            <div class="field"><label>Ort</label><input name="ort" value="${escapeHtml(data.ort || '')}"></div>
            <div class="field"><label>Kalenderfarbe</label>
              <select name="farbe">
                ${FARBEN.map((f) => `<option value="${f}" ${f === data.farbe ? 'selected' : ''}>${f}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="divider"></div>
          <h2 style="font-size:14px;margin:0 0 8px">Vertrag & Gehalt</h2>
          <div class="form-grid">
            <div class="field"><label>Vertragsart</label>
              <select name="vertragsart">${VERTRAGSARTEN.map((v) => `<option value="${v}" ${v === data.vertragsart ? 'selected' : ''}>${v}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Wochenstunden</label><input type="number" step="0.5" min="0" name="wochenstunden" value="${data.wochenstunden ?? ''}"></div>
            <div class="field"><label>Eintrittsdatum</label><input type="date" name="eintrittsdatum" value="${data.eintrittsdatum || ''}"></div>
            <div class="field"><label>Austrittsdatum</label><input type="date" name="austrittsdatum" value="${data.austrittsdatum || ''}"></div>
            <div class="field"><label>Stundenlohn (€, brutto)</label><input type="number" step="0.01" min="0" name="stundenlohn" value="${data.stundenlohn ?? ''}"></div>
            <div class="field"><label>Gehalt monatlich (€, brutto)</label><input type="number" step="0.01" min="0" name="gehaltMonatlich" value="${data.gehaltMonatlich ?? ''}"></div>
            <div class="field"><label>IBAN</label><input name="iban" value="${escapeHtml(data.iban || '')}"></div>
            <div class="field"><label>Steuer-ID</label><input name="steuerId" value="${escapeHtml(data.steuerId || '')}"></div>
            <div class="field"><label>Sozialversicherungsnr.</label><input name="sozialversicherungsnummer" value="${escapeHtml(data.sozialversicherungsnummer || '')}"></div>
            <div class="field"><label>Krankenkasse</label><input name="krankenkasse" value="${escapeHtml(data.krankenkasse || '')}"></div>
          </div>

          <div class="divider"></div>
          <h2 style="font-size:14px;margin:0 0 8px">Urlaub & Krankheit</h2>
          <div class="form-grid">
            <div class="field"><label>Urlaubsanspruch (Tage/Jahr)</label><input type="number" min="0" name="urlaubsanspruchTage" value="${data.urlaubsanspruchTage ?? ''}"></div>
            ${isEdit ? `
              <div class="field"><label>Urlaub genommen (${new Date().getFullYear()})</label><input disabled value="${urlaubGenommen} Tage · Rest: ${urlaubRest}"></div>
              <div class="field"><label>Krankheitstage (${new Date().getFullYear()})</label><input disabled value="${krankTage} Tage"></div>
              <div class="field"><label>Schulungstage (${new Date().getFullYear()})</label><input disabled value="${schulungTage} Tage"></div>
            ` : '<p class="text-mute col-span-2">Urlaub/Krank/Schulung werden nach dem Anlegen aus der Plantafel berechnet.</p>'}
          </div>
          <p class="hint">Trage Urlaub, Krankheit, Schulungen und Baustellen-Einsätze über Kalender oder Plantafel ein – sie werden hier automatisch gezählt.</p>
          ${isEdit ? `
            <div class="flex-row" style="margin:8px 0"><strong>Status heute:</strong>
              ${aktuellerStatus ? `<span class="badge" style="background:${escapeHtml(aktuellerStatus.farbe)}22;color:${escapeHtml(aktuellerStatus.farbe)}">${escapeHtml(aktuellerStatus.titel)}</span>` : '<span class="badge badge-success">Verfügbar</span>'}
            </div>
            <h2 style="font-size:13px;margin:10px 0 6px">Letzte Einträge</h2>
            ${statusVerlauf.length ? `<ul class="cal-event-list">${statusVerlauf.map((t) => {
              const info = TERMIN_TYPEN.find((tt) => tt.id === t.typ);
              return `<li>
                <div>
                  <strong>${escapeHtml(info?.titel || t.typ)}</strong>
                  <div class="text-mute">${formatDate(t.start)}${t.ende && t.ende !== t.start ? ' – ' + formatDate(t.ende) : ''}${t.titel ? ' · ' + escapeHtml(t.titel) : ''}</div>
                </div>
                <span class="color-dot" style="background:${escapeHtml(info?.farbe || 'var(--border)')}"></span>
              </li>`;
            }).join('')}</ul>` : '<p class="text-mute">Noch keine Einträge (Urlaub/Krank/Schulung/Baustelle).</p>'}
          ` : ''}

          <div class="divider"></div>
          <h2 style="font-size:14px;margin:0 0 8px">Zugang zur Verwaltung</h2>
          <div class="form-grid">
            <div class="field"><label>Eigener Zugangscode (optional)</label><input name="zugangscode" placeholder="leer = kein eigener Login" value="${escapeHtml(data.zugangscode || '')}"></div>
            <div class="field"><label>Zugriffsrolle</label>
              <select name="zugriffsrolle">${ZUGRIFFSROLLEN.map((r) => `<option value="${r.id}" ${r.id === (data.zugriffsrolle || 'mitarbeiter') ? 'selected' : ''}>${escapeHtml(r.titel)}</option>`).join('')}</select>
            </div>
            <p class="hint col-span-2">${escapeHtml(ZUGRIFFSROLLEN.find((r) => r.id === (data.zugriffsrolle || 'mitarbeiter'))?.beschreibung || '')} Wichtig: Diese App läuft rein lokal im Browser – der Code ist eine einfache Bedienungssperre, kein vollwertiger Server-Login.</p>
          </div>

          <div class="divider"></div>
          <h2 style="font-size:14px;margin:0 0 8px">Notfallkontakt</h2>
          <div class="form-grid">
            <div class="field"><label>Name</label><input name="notfallkontaktName" value="${escapeHtml(data.notfallkontaktName || '')}"></div>
            <div class="field"><label>Telefon</label><input name="notfallkontaktTelefon" value="${escapeHtml(data.notfallkontaktTelefon || '')}"></div>
          </div>

          <div class="divider"></div>
          <div class="form-grid">
            <div class="field col-span-2"><label>Notizen</label><textarea name="notizen">${escapeHtml(data.notizen || '')}</textarea></div>
          </div>

          ${isEdit ? `<div class="divider"></div><div id="dok-host"></div>` : ''}

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
    if (isEdit) {
      body.querySelector('#btn-delete').addEventListener('click', async () => {
        if (!confirmDelete(`Mitarbeiter "${data.name}" wirklich löschen?`)) return;
        await remove('mitarbeiter', data.id);
        toast('Mitarbeiter gelöscht');
        close();
        render(container);
      });
      renderDokumenteSection(body.querySelector('#dok-host'), 'mitarbeiter', data.id, {
        kategorien: MA_DOKUMENT_KATEGORIEN, title: 'Dokumente (Vertrag, Ausweis, ...)',
      });
    }
    body.querySelector('#ma-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      for (const [k, v] of fd.entries()) updated[k] = v.trim ? v.trim() : v;
      if (!updated.name) return;
      await put('mitarbeiter', updated);
      toast(isEdit ? 'Mitarbeiter aktualisiert' : 'Mitarbeiter angelegt', 'success');
      close();
      render(container);
    });
  }

  renderTable();
}
