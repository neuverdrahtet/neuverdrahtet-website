import { el } from './utils.js';

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
  let html = placeholder !== null ? `<option value="">${placeholder}</option>` : '';
  for (const item of items) {
    const v = item[value];
    const sel = String(v) === String(selected) ? 'selected' : '';
    html += `<option value="${v}" ${sel}>${label(item)}</option>`;
  }
  return html;
}
