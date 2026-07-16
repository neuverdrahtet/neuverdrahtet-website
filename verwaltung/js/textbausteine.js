import { escapeHtml } from './utils.js';

/**
 * Mounts a multi-select checklist of Textbausteine (closing-text snippets)
 * into `host`. Selected texts are joined and handed to onInsert() when the
 * "Einfügen" button is clicked — the caller decides where the text goes
 * (e.g. appended to a Notizen textarea).
 */
export function mountTextbausteinPicker(host, { textbausteine, kategorie, onInsert }) {
  const passende = textbausteine.filter((t) => t.kategorie === 'beide' || t.kategorie === kategorie);
  if (passende.length === 0) {
    host.innerHTML = '';
    return;
  }
  host.innerHTML = `
    <div class="field col-span-2">
      <label>Textbausteine (Schlusstexte) – Mehrfachauswahl möglich</label>
      <div class="tag-list">
        ${passende.map((t) => `
          <label class="field-checkbox" style="border:1px solid var(--border);border-radius:8px;padding:5px 10px;">
            <input type="checkbox" class="tb-check" value="${t.id}"> ${escapeHtml(t.titel)}
          </label>
        `).join('')}
      </div>
      <button type="button" class="btn btn-sm" id="btn-tb-insert" style="margin-top:6px;align-self:flex-start">+ Ausgewählte einfügen</button>
    </div>
  `;
  host.querySelector('#btn-tb-insert').addEventListener('click', () => {
    const checked = Array.from(host.querySelectorAll('.tb-check:checked')).map((c) => c.value);
    if (checked.length === 0) return;
    const texts = checked.map((id) => passende.find((t) => t.id === id)?.text).filter(Boolean);
    onInsert(texts.join('\n\n'));
    host.querySelectorAll('.tb-check:checked').forEach((c) => { c.checked = false; });
  });
}
