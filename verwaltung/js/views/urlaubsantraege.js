import { getAll, put } from '../db.js';
import { uid, escapeHtml, toast, formatDate, getCurrentMitarbeiterId, setCurrentMitarbeiterId } from '../utils.js';
import { getSession } from '../auth.js';
import { openModal } from '../ui.js';

// Urlaub/Krankmeldung als Antrags-/Genehmigungsworkflow - ergänzt den
// bestehenden Anwesenheits-/Status-Verlauf (#116) und die Termin-Typen
// "urlaub"/"krank" (bisher nur manuell in der Plantafel anlegbar) um einen
// echten Beantragen->Genehmigen-Ablauf. Genehmigen legt automatisch einen
// passenden Termin an (erscheint dann auch in der Plantafel), Ablehnen legt
// nichts an.

const TYP_LABEL = { urlaub: 'Urlaub', krankmeldung: 'Krankmeldung' };
const STATUS_LABEL = { offen: 'Offen', genehmigt: 'Genehmigt', abgelehnt: 'Abgelehnt' };
const STATUS_BADGE = { offen: 'badge-warn', genehmigt: 'badge-success', abgelehnt: 'badge-danger' };

export async function render(container) {
  let [antraege, mitarbeiter] = await Promise.all([getAll('urlaubsantraege'), getAll('mitarbeiter')]);
  antraege.sort((a, b) => (b.erstelltAm || '').localeCompare(a.erstelltAm || ''));
  const mitarbeiterById = Object.fromEntries(mitarbeiter.map((m) => [m.id, m]));
  const session = getSession() || {};
  const istAdminOderBuero = session.role === 'admin' || session.role === 'buero';

  container.innerHTML = `
    <div class="view-header">
      <h1>Urlaub &amp; Krankmeldung</h1>
      <div class="actions">
        <button class="btn btn-primary" id="btn-new">+ Antrag stellen</button>
      </div>
    </div>
    ${session.mitarbeiterId ? `
      <h2 style="margin-top:20px">Meine Anträge</h2>
      <div id="meine-host"></div>
    ` : ''}
    ${istAdminOderBuero ? `
      <h2 style="margin-top:28px">Alle Anträge</h2>
      <p class="hint">Genehmigen legt automatisch einen passenden Termin an (Plantafel), Ablehnen legt nichts an.</p>
      <div class="kpi-grid">
        <button type="button" class="kpi-card kpi-clickable kpi-warn" style="text-align:left" id="kpi-ua-offen">
          <div class="kpi-value">${antraege.filter((a) => a.status === 'offen').length}</div>
          <div class="kpi-label">Offen · wartet auf Entscheidung</div>
        </button>
        <button type="button" class="kpi-card kpi-clickable kpi-success" style="text-align:left" id="kpi-ua-genehmigt">
          <div class="kpi-value">${antraege.filter((a) => a.status === 'genehmigt').length}</div>
          <div class="kpi-label">Genehmigt</div>
        </button>
        <button type="button" class="kpi-card kpi-clickable kpi-danger" style="text-align:left" id="kpi-ua-abgelehnt">
          <div class="kpi-value">${antraege.filter((a) => a.status === 'abgelehnt').length}</div>
          <div class="kpi-label">Abgelehnt</div>
        </button>
        <button type="button" class="kpi-card kpi-clickable" style="text-align:left" id="kpi-ua-alle">
          <div class="kpi-value">${antraege.length}</div>
          <div class="kpi-label">Gesamt</div>
        </button>
      </div>
      <div id="alle-host"></div>
    ` : ''}
  `;

  function terminBadge(a) {
    return `<span class="badge ${STATUS_BADGE[a.status]}">${STATUS_LABEL[a.status]}</span>`;
  }

  // KPI-Kacheln filtern "Alle Anträge" darunter (gleiches Klick-Muster wie
  // in Serviceaufträge: kpi-clickable/kpi-active, erneuter Klick auf die
  // aktive Kachel hebt den Filter wieder auf).
  let statusFilter = null;
  function markActiveKpi() {
    container.querySelectorAll('.kpi-card').forEach((el) => el.classList.remove('kpi-active'));
    const aktiveId = statusFilter ? `kpi-ua-${statusFilter}` : 'kpi-ua-alle';
    container.querySelector(`#${aktiveId}`)?.classList.add('kpi-active');
  }

  function renderMeine() {
    const host = container.querySelector('#meine-host');
    if (!host) return;
    const meine = antraege.filter((a) => a.mitarbeiterId === session.mitarbeiterId);
    if (meine.length === 0) { host.innerHTML = '<div class="empty-state">Noch keine eigenen Anträge.</div>'; return; }
    host.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Typ</th><th>Zeitraum</th><th>Status</th><th>Kommentar</th></tr></thead>
        <tbody>
          ${meine.map((a) => `
            <tr>
              <td>${TYP_LABEL[a.typ]}</td>
              <td>${formatDate(a.von)} – ${formatDate(a.bis)}</td>
              <td>${terminBadge(a)}${a.status === 'abgelehnt' && a.ablehnungsgrund ? `<div class="text-mute" style="font-size:12px">${escapeHtml(a.ablehnungsgrund)}</div>` : ''}</td>
              <td>${escapeHtml(a.kommentar || '')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  function renderAlle() {
    const host = container.querySelector('#alle-host');
    if (!host) return;
    const sichtbar = statusFilter ? antraege.filter((a) => a.status === statusFilter) : antraege;
    const filterHinweis = statusFilter
      ? `<p class="hint">Gefiltert: ${escapeHtml(STATUS_LABEL[statusFilter])} (${sichtbar.length} von ${antraege.length}). <button type="button" class="btn btn-sm" id="btn-ua-filter-reset">Filter zurücksetzen</button></p>`
      : '';
    if (antraege.length === 0) { host.innerHTML = '<div class="empty-state">Noch keine Anträge.</div>'; return; }
    if (sichtbar.length === 0) {
      host.innerHTML = `${filterHinweis}<div class="empty-state">Keine Anträge für diesen Filter.</div>`;
      host.querySelector('#btn-ua-filter-reset')?.addEventListener('click', () => { statusFilter = null; markActiveKpi(); renderAlle(); });
      return;
    }
    host.innerHTML = `
      ${filterHinweis}
      <table class="data-table">
        <thead><tr><th>Mitarbeiter</th><th>Typ</th><th>Zeitraum</th><th>Kommentar</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${sichtbar.map((a) => `
            <tr data-id="${a.id}">
              <td>${escapeHtml(mitarbeiterById[a.mitarbeiterId]?.name || 'Unbekannt')}</td>
              <td>${TYP_LABEL[a.typ]}</td>
              <td>${formatDate(a.von)} – ${formatDate(a.bis)}</td>
              <td>${escapeHtml(a.kommentar || '')}</td>
              <td>${terminBadge(a)}${a.status === 'abgelehnt' && a.ablehnungsgrund ? `<div class="text-mute" style="font-size:12px">${escapeHtml(a.ablehnungsgrund)}</div>` : ''}</td>
              <td>
                ${a.status === 'offen' ? `
                  <button type="button" class="btn btn-sm btn-primary btn-genehmigen" data-id="${a.id}">Genehmigen</button>
                  <button type="button" class="btn btn-sm btn-ablehnen" data-id="${a.id}">Ablehnen</button>
                ` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    host.querySelector('#btn-ua-filter-reset')?.addEventListener('click', () => { statusFilter = null; markActiveKpi(); renderAlle(); });
    host.querySelectorAll('.btn-genehmigen').forEach((btn) => {
      btn.addEventListener('click', () => genehmigen(btn.dataset.id));
    });
    host.querySelectorAll('.btn-ablehnen').forEach((btn) => {
      btn.addEventListener('click', () => ablehnen(btn.dataset.id));
    });
  }

  async function genehmigen(id) {
    const antrag = antraege.find((a) => a.id === id);
    if (!antrag) return;
    const mitarbeiterName = mitarbeiterById[antrag.mitarbeiterId]?.name || 'Unbekannt';
    const terminId = uid();
    await put('termine', {
      id: terminId,
      titel: `${TYP_LABEL[antrag.typ]}: ${mitarbeiterName}`,
      typ: antrag.typ === 'urlaub' ? 'urlaub' : 'krank',
      start: `${antrag.von}T00:00`,
      // Bug gefunden 28.10.2026: "ende" stand bisher als reines Datum ohne
      // Uhrzeit ("YYYY-MM-DD"), während terminUeberlappt()/findeTerminKonflikte()
      // (serviceauftraege.js) start/ende konsequent als "YYYY-MM-DDTHH:MM"
      // per String-Vergleich behandeln. Ein reines Datum ist als String immer
      // "kleiner" als jeder Zeitstempel desselben Tages, wodurch ein Konflikt
      // am LETZTEN Urlaubs-/Krankheitstag nie erkannt wurde (z.B. Serviceauftrag
      // am letzten Urlaubstag ab 09:00 Uhr für denselben Techniker).
      ende: `${antrag.bis}T23:59`,
      mitarbeiterIds: [antrag.mitarbeiterId],
      beschreibung: antrag.kommentar || '',
    });
    const updated = { ...antrag, status: 'genehmigt', bearbeitetVon: session.name || session.role || '', bearbeitetAm: new Date().toISOString(), terminId };
    await put('urlaubsantraege', updated);
    Object.assign(antrag, updated);
    toast('Antrag genehmigt, Termin angelegt', 'success');
    renderMeine();
    renderAlle();
  }

  async function ablehnen(id) {
    const antrag = antraege.find((a) => a.id === id);
    if (!antrag) return;
    const grund = prompt('Grund für die Ablehnung (optional):') || '';
    const updated = { ...antrag, status: 'abgelehnt', bearbeitetVon: session.name || session.role || '', bearbeitetAm: new Date().toISOString(), ablehnungsgrund: grund };
    await put('urlaubsantraege', updated);
    Object.assign(antrag, updated);
    toast('Antrag abgelehnt');
    renderMeine();
    renderAlle();
  }

  container.querySelector('#btn-new').addEventListener('click', () => openForm());

  function openForm() {
    const darfAuswaehlen = istAdminOderBuero || !session.mitarbeiterId;
    let vorausgewaehlt = session.mitarbeiterId || getCurrentMitarbeiterId() || (mitarbeiter[0] && mitarbeiter[0].id) || '';
    const { body, close } = openModal({
      title: 'Antrag stellen',
      bodyHtml: `
        <form id="ua-form">
          <div class="form-grid">
            ${darfAuswaehlen ? `
              <div class="field col-span-2"><label>Mitarbeiter *</label>
                <select name="mitarbeiterId" required>
                  ${mitarbeiter.map((m) => `<option value="${m.id}" ${m.id === vorausgewaehlt ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}
                </select>
              </div>
            ` : `<input type="hidden" name="mitarbeiterId" value="${vorausgewaehlt}">`}
            <div class="field col-span-2"><label>Art *</label>
              <select name="typ" required>
                <option value="urlaub">Urlaub</option>
                <option value="krankmeldung">Krankmeldung</option>
              </select>
            </div>
            <div class="field"><label>Von *</label><input type="date" name="von" required></div>
            <div class="field"><label>Bis *</label><input type="date" name="bis" required></div>
            <div class="field col-span-2"><label>Kommentar</label><textarea name="kommentar"></textarea></div>
          </div>
          <div class="modal-actions">
            <span class="spacer"></span>
            <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Antrag stellen</button>
          </div>
        </form>
      `,
    });
    body.querySelector('#btn-cancel').addEventListener('click', close);
    body.querySelector('#ua-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const mitarbeiterId = (fd.get('mitarbeiterId') || '').toString();
      const von = (fd.get('von') || '').toString();
      const bis = (fd.get('bis') || '').toString();
      if (!mitarbeiterId || !von || !bis) return;
      if (bis < von) { toast('"Bis" darf nicht vor "Von" liegen', 'error'); return; }
      if (darfAuswaehlen && !session.mitarbeiterId) setCurrentMitarbeiterId(mitarbeiterId);
      const antrag = {
        id: uid(),
        mitarbeiterId,
        typ: (fd.get('typ') || 'urlaub').toString(),
        von, bis,
        kommentar: (fd.get('kommentar') || '').toString().trim(),
        status: 'offen',
        erstelltAm: new Date().toISOString(),
        bearbeitetVon: '', bearbeitetAm: '', ablehnungsgrund: '', terminId: '',
      };
      await put('urlaubsantraege', antrag);
      antraege.unshift(antrag);
      toast('Antrag gestellt', 'success');
      close();
      renderMeine();
      renderAlle();
    });
  }

  [['kpi-ua-offen', 'offen'], ['kpi-ua-genehmigt', 'genehmigt'], ['kpi-ua-abgelehnt', 'abgelehnt'], ['kpi-ua-alle', null]].forEach(([id, wert]) => {
    container.querySelector(`#${id}`)?.addEventListener('click', () => {
      statusFilter = statusFilter === wert ? null : wert;
      markActiveKpi();
      renderAlle();
    });
  });
  markActiveKpi();
  renderMeine();
  renderAlle();
}
