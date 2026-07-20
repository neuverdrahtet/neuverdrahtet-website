import { el, escapeHtml, debounce } from './utils.js';
import { searchAddress } from './geocode.js';

/**
 * Hängt eine Adress-Autovervollständigung an ein Text-Input: bei Eingabe
 * (ab 3 Zeichen, debounced) werden Vorschläge über die freie Nominatim-Suche
 * geladen und als Dropdown darunter angezeigt. Klick auf einen Vorschlag ruft
 * onSelect({ label, strasse, plz, ort, lat, lng }) auf.
 */
export function attachAddressSearch(inputEl, onSelect) {
  const parent = inputEl.parentElement;
  if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
  const dropdown = el('<div class="address-search-dropdown" hidden></div>');
  parent.appendChild(dropdown);

  const runSearch = debounce(async () => {
    const q = inputEl.value.trim();
    if (q.length < 3) { dropdown.hidden = true; return; }
    let results = [];
    try {
      results = await searchAddress(q);
    } catch {
      dropdown.hidden = true;
      return;
    }
    if (!results.length) { dropdown.hidden = true; return; }
    dropdown.innerHTML = results.map((r, i) => `<div class="address-search-item" data-i="${i}">${escapeHtml(r.label)}</div>`).join('');
    dropdown.hidden = false;
    dropdown.querySelectorAll('.address-search-item').forEach((item) => {
      // mousedown statt click, damit der Vorschlag ausgewählt wird, bevor
      // der "blur"-Handler des Inputs das Dropdown schon wieder versteckt.
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        onSelect(results[Number(item.dataset.i)]);
        dropdown.hidden = true;
      });
    });
  }, 500);

  inputEl.addEventListener('input', runSearch);
  inputEl.addEventListener('blur', () => { setTimeout(() => { dropdown.hidden = true; }, 150); });
}

export function openModal({ title, bodyHtml, wide = false, onClose } = {}) {
  const backdrop = el(`<div class="modal-backdrop"></div>`);
  const modal = el(`<div class="modal ${wide ? 'modal-wide' : ''}">
    <div class="modal-header">
      <h2>${title}</h2>
      <button type="button" class="modal-close" aria-label="Schließen">&times;</button>
    </div>
    <div class="modal-body"></div>
  </div>`);
  modal.querySelector('.modal-body').innerHTML = bodyHtml;
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  function close() {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose();
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  modal.querySelector('.modal-close').addEventListener('click', close);

  return { backdrop, modal, body: modal.querySelector('.modal-body'), close };
}

export function confirmDelete(msg = 'Wirklich löschen?') {
  return window.confirm(msg);
}

export function optionList(items, { value = 'id', label = 'name', selected = '', placeholder = '' } = {}) {
  const labelFn = typeof label === 'function' ? label : (item) => escapeHtml(item[label] ?? '');
  let html = placeholder !== null ? `<option value="">${placeholder}</option>` : '';
  for (const item of items) {
    const v = item[value];
    const sel = String(v) === String(selected) ? 'selected' : '';
    html += `<option value="${v}" ${sel}>${labelFn(item)}</option>`;
  }
  return html;
}
