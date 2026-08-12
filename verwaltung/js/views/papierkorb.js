import { getAllDeleted, restoreDeleted, hardRemove } from '../db.js';
import { escapeHtml, formatDateTime, toast } from '../utils.js';
import { confirmDelete } from '../ui.js';

// Reihenfolge bestimmt auch die Anzeigereihenfolge. "title" liefert eine
// möglichst sprechende Bezeichnung je Store, damit man im Papierkorb sofort
// erkennt, was man da vor sich hat, ohne die Datensätze einzeln zu öffnen.
const LABELS = {
  kunden: { label: 'Kunden', icon: '👥', title: (k) => k.firma || '(ohne Namen)' },
  projekte: { label: 'Projekte', icon: '📁', title: (p) => p.titel || '(ohne Titel)' },
  aufgaben: { label: 'Aufgaben', icon: '✅', title: (a) => a.titel || '(ohne Titel)' },
  mitarbeiter: { label: 'Mitarbeiter', icon: '🧑‍🔧', title: (m) => m.name || '(ohne Namen)' },
  subunternehmer: { label: 'Subunternehmer', icon: '🤝', title: (s) => s.firma || '(ohne Namen)' },
  geraete: { label: 'Geräte', icon: '🛠️', title: (g) => g.name || '(ohne Namen)' },
  flotten: { label: 'Fahrzeuge', icon: '🚐', title: (f) => f.bezeichnung || '(ohne Bezeichnung)' },
  katalog: { label: 'Artikel & Leistungen', icon: '🧾', title: (k) => k.bezeichnung || '(ohne Bezeichnung)' },
  angebote: { label: 'Angebote', icon: '📄', title: (a) => a.nummer || '(ohne Nummer)' },
  rechnungen: { label: 'Rechnungen', icon: '💶', title: (r) => r.nummer || '(ohne Nummer)' },
  mahnungen: { label: 'Mahnungen', icon: '⚠️', title: (m) => m.nummer || m.art || '(ohne Nummer)' },
  ausgaben: { label: 'Ausgaben', icon: '💸', title: (a) => a.beschreibung || '(ohne Beschreibung)' },
  zeiterfassung: { label: 'Zeiterfassung', icon: '⏱️', title: (z) => formatDateTime(z.datum) || z.datum || '(ohne Datum)' },
  vorlagen: { label: 'Vorlagen', icon: '📑', title: (v) => v.name || v.titel || '(ohne Titel)' },
};

export async function render(container) {
  container.innerHTML = `
    <div class="view-header">
      <h1>🗑️ Papierkorb</h1>
    </div>
    <p class="text-mute">Gelöschte Einträge bleiben hier 30 Tage lang wiederherstellbar und werden danach automatisch endgültig entfernt.</p>
    <div id="pk-list"></div>
  `;
  const host = container.querySelector('#pk-list');

  async function reload() {
    const eintraege = await getAllDeleted();
    if (eintraege.length === 0) {
      host.innerHTML = '<div class="empty-state">Der Papierkorb ist leer.</div>';
      return;
    }
    eintraege.sort((a, b) => (b._geloeschtAm || '').localeCompare(a._geloeschtAm || ''));
    host.innerHTML = `
      <table class="table">
        <thead><tr><th>Typ</th><th>Bezeichnung</th><th>Gelöscht am</th><th></th></tr></thead>
        <tbody>
          ${eintraege.map((e) => {
            const meta = LABELS[e.storeName] || { label: e.storeName, icon: '📦', title: () => e.id };
            return `
              <tr>
                <td>${meta.icon} ${escapeHtml(meta.label)}</td>
                <td ${e.loeschGrundLabel || e.loeschGrundText ? `title="${escapeHtml([e.loeschGrundLabel, e.loeschGrundText].filter(Boolean).join(' – '))}"` : ''}>${escapeHtml(meta.title(e))}</td>
                <td>${formatDateTime(e._geloeschtAm)}</td>
                <td class="text-right">
                  <button type="button" class="btn btn-sm" data-restore data-store="${escapeHtml(e.storeName)}" data-id="${escapeHtml(e.id)}">↩️ Wiederherstellen</button>
                  <button type="button" class="btn btn-sm btn-danger" data-purge data-store="${escapeHtml(e.storeName)}" data-id="${escapeHtml(e.id)}">🗑 Endgültig löschen</button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
    host.querySelectorAll('[data-restore]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await restoreDeleted(btn.dataset.store, btn.dataset.id);
        toast('Wiederhergestellt', 'success');
        reload();
      });
    });
    host.querySelectorAll('[data-purge]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirmDelete('Endgültig löschen? Das kann nicht rückgängig gemacht werden.')) return;
        await hardRemove(btn.dataset.store, btn.dataset.id);
        toast('Endgültig gelöscht', 'success');
        reload();
      });
    });
  }

  await reload();
}
