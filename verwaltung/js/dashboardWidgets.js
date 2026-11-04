import { setSetting } from './db.js';
import { escapeHtml } from './utils.js';
import { openModal } from './ui.js';

// Gemeinsamer Baustein für anpassbare Startseiten (Dashboard, Tagesübersicht):
// jede Seite definiert ihre eigene Liste von Widgets (id + Label), die
// Sichtbarkeit wird pro Seite unter einem eigenen Settings-Schlüssel als
// { widgetId: false } gespeichert (fehlender Eintrag = sichtbar, also
// rückwärtskompatibel ohne Migration - bestehende Nutzer sehen nach dem
// Update unverändert alles).
export function istWidgetSichtbar(config, widgetId) {
  return !config || config[widgetId] !== false;
}

export function oeffneWidgetAuswahl({ titel = 'Ansicht anpassen', settingsKey, widgets, config, onSave }) {
  const { body, close } = openModal({
    title: titel,
    bodyHtml: `
      <p class="hint">Wähle, welche Bereiche du hier sehen möchtest. Die Auswahl gilt für alle, die sich mit diesem Konto anmelden.</p>
      <div style="display:flex;flex-direction:column;gap:10px;margin:14px 0">
        ${widgets.map((w) => `
          <label class="flex-row" style="gap:8px;cursor:pointer">
            <input type="checkbox" class="wa-check" data-id="${w.id}" ${istWidgetSichtbar(config, w.id) ? 'checked' : ''}>
            ${escapeHtml(w.label)}
          </label>
        `).join('')}
      </div>
      <div class="modal-actions">
        <span class="spacer"></span>
        <button type="button" class="btn" id="wa-cancel">Abbrechen</button>
        <button type="button" class="btn btn-primary" id="wa-save">Speichern</button>
      </div>
    `,
  });
  body.querySelector('#wa-cancel').addEventListener('click', close);
  body.querySelector('#wa-save').addEventListener('click', async () => {
    const neueConfig = {};
    body.querySelectorAll('.wa-check').forEach((cb) => { neueConfig[cb.dataset.id] = cb.checked; });
    await setSetting(settingsKey, neueConfig);
    close();
    onSave();
  });
}
