import { getAll, put } from './db.js';
import { uid, escapeHtml, formatDateTime, getCurrentMitarbeiterId, setCurrentMitarbeiterId, toast } from './utils.js';

/**
 * Renders a simple message log for a Projekt (Teamkommunikation). Notes: this
 * app has no backend/sync — messages are stored locally in this browser's
 * IndexedDB only, so this is a shared log across office/field devices only
 * if they use the same browser profile, not a real-time cross-device chat.
 */
export function renderTeamchat(host, projektId, mitarbeiter) {
  async function load() {
    const nachrichten = (await getAll('nachrichten'))
      .filter((n) => n.projektId === projektId)
      .sort((a, b) => (a.erstelltAm || '').localeCompare(b.erstelltAm || ''));
    const mitarbeiterById = Object.fromEntries(mitarbeiter.map((m) => [m.id, m]));
    let currentMa = getCurrentMitarbeiterId();

    host.innerHTML = `
      <div class="flex-row" style="justify-content:space-between;margin-bottom:8px;flex-wrap:wrap">
        <h2 style="font-size:14px;margin:0">Teamkommunikation</h2>
        <label class="text-mute" style="display:flex;align-items:center;gap:6px;font-size:12px">
          Ich bin:
          <select id="tc-ich-bin">
            <option value="">– auswählen –</option>
            ${mitarbeiter.map((m) => `<option value="${m.id}" ${m.id === currentMa ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="tc-list">
        ${nachrichten.length === 0 ? '<p class="text-mute">Noch keine Nachrichten.</p>' : nachrichten.map((n) => `
          <div class="tc-msg">
            <div class="tc-msg-head"><strong>${escapeHtml(mitarbeiterById[n.mitarbeiterId]?.name || 'Unbekannt')}</strong><span class="text-mute">${formatDateTime(n.erstelltAm)}</span></div>
            <div class="tc-msg-text">${escapeHtml(n.text)}</div>
          </div>
        `).join('')}
      </div>
      <div class="tc-input-row">
        <textarea id="tc-input" placeholder="Nachricht schreiben ..." rows="2"></textarea>
        <button type="button" class="btn btn-primary" id="tc-send">Senden</button>
      </div>
      <p class="hint">Nachrichten werden lokal in diesem Browser gespeichert (kein Cloud-Sync) – für geräteübergreifenden Chat wäre ein Server nötig.</p>
    `;

    host.querySelector('#tc-ich-bin').addEventListener('change', (e) => {
      setCurrentMitarbeiterId(e.target.value);
    });

    host.querySelector('#tc-send').addEventListener('click', async () => {
      const text = host.querySelector('#tc-input').value.trim();
      if (!text) return;
      const authorId = getCurrentMitarbeiterId();
      if (!authorId) {
        toast('Bitte zuerst auswählen, wer du bist', 'danger');
        return;
      }
      await put('nachrichten', { id: uid(), projektId, mitarbeiterId: authorId, text, erstelltAm: new Date().toISOString() });
      load();
    });

    const list = host.querySelector('.tc-list');
    if (list) list.scrollTop = list.scrollHeight;
  }

  load();
}
