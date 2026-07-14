import { getAll, put, remove, getSettings } from '../db.js';
import { uid, escapeHtml, formatCurrency, toast } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import { createPositionsEditor } from '../positions.js';

export async function render(container) {
  let [vorlagen, katalog, settings] = await Promise.all([getAll('vorlagen'), getAll('katalog'), getSettings()]);
  vorlagen.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  container.innerHTML = `
    <div class="view-header">
      <h1>Vorlagen</h1>
      <div class="actions"><button class="btn btn-primary" id="btn-new">+ Neue Vorlage</button></div>
    </div>
    <p class="hint">Positions-Vorlagen bündeln Positionen für Angebote/Rechnungen. Dokumentations-Vorlagen sind Text-Bausteine für Berichte (z.B. Abnahmeprotokoll), die du bei einem Projekt-Dokument einfügen kannst.</p>
    <div id="table-host"></div>
  `;
  const tableHost = container.querySelector('#table-host');

  function renderTable() {
    if (vorlagen.length === 0) {
      tableHost.innerHTML = `<div class="empty-state">Noch keine Vorlagen angelegt.</div>`;
      return;
    }
    tableHost.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Typ</th><th>Name</th><th>Positionen</th><th class="text-right">Summe (netto)</th></tr></thead>
        <tbody>
          ${vorlagen.map((v) => {
            const isDok = v.typ === 'dokumentation';
            const summe = (v.positionen || []).reduce((s, p) => s + (Number(p.menge) || 0) * (Number(p.einzelpreis) || 0), 0);
            return `
            <tr data-id="${v.id}">
              <td><span class="badge ${isDok ? 'badge-success' : 'badge-accent'}">${isDok ? 'Dokumentation' : 'Positionen'}</span></td>
              <td>${escapeHtml(v.name)}</td>
              <td>${isDok ? '–' : (v.positionen || []).length}</td>
              <td class="text-right">${isDok ? '–' : formatCurrency(summe)}</td>
            </tr>
          `; }).join('')}
        </tbody>
      </table>
    `;
    tableHost.querySelectorAll('tbody tr').forEach((row) => {
      row.addEventListener('click', () => openForm(vorlagen.find((v) => v.id === row.dataset.id)));
    });
  }

  container.querySelector('#btn-new').addEventListener('click', () => openForm());

  function openForm(v) {
    const isEdit = !!v;
    const data = v || { id: uid(), typ: 'positionen', name: '', positionen: [], textVorlage: '' };

    function bodyFor(typ) {
      if (typ === 'dokumentation') {
        return `
          <div class="divider"></div>
          <div class="field">
            <label>Text-Vorlage</label>
            <textarea name="textVorlage" style="min-height:220px" placeholder="Platzhalter: {{firma}}, {{kunde}}, {{projekt}}, {{datum}}">${escapeHtml(data.textVorlage || '')}</textarea>
          </div>
          <p class="hint">Diese Vorlage steht bei Projekt-Dokumenten unter "Bericht aus Vorlage erstellen" zur Auswahl.</p>
        `;
      }
      return `<div class="divider"></div><div id="pos-host"></div>`;
    }

    const { body, close } = openModal({
      title: isEdit ? 'Vorlage bearbeiten' : 'Neue Vorlage',
      wide: true,
      bodyHtml: `
        <form id="vorlage-form">
          <div class="form-grid">
            <div class="field"><label>Name *</label><input name="name" required value="${escapeHtml(data.name)}"></div>
            <div class="field"><label>Typ</label>
              <select name="typ" id="f-typ">
                <option value="positionen" ${data.typ !== 'dokumentation' ? 'selected' : ''}>Positionen (Angebot/Rechnung)</option>
                <option value="dokumentation" ${data.typ === 'dokumentation' ? 'selected' : ''}>Dokumentation (Bericht)</option>
              </select>
            </div>
          </div>
          <div id="typ-body">${bodyFor(data.typ)}</div>
          <div class="modal-actions">
            ${isEdit ? '<button type="button" class="btn btn-danger" id="btn-delete">Löschen</button>' : ''}
            <span class="spacer"></span>
            <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Speichern</button>
          </div>
        </form>
      `,
    });

    let editor = data.typ !== 'dokumentation' ? createPositionsEditor({
      host: body.querySelector('#pos-host'),
      katalog,
      positionen: data.positionen,
      defaultSteuersatz: settings.standardSteuersatz,
    }) : null;

    body.querySelector('#f-typ').addEventListener('change', (e) => {
      body.querySelector('#typ-body').innerHTML = bodyFor(e.target.value);
      if (e.target.value === 'dokumentation') {
        editor = null;
      } else {
        editor = createPositionsEditor({
          host: body.querySelector('#pos-host'),
          katalog,
          positionen: data.positionen,
          defaultSteuersatz: settings.standardSteuersatz,
        });
      }
    });

    body.querySelector('#btn-cancel').addEventListener('click', close);
    if (isEdit) {
      body.querySelector('#btn-delete').addEventListener('click', async () => {
        if (!confirmDelete(`Vorlage "${data.name}" wirklich löschen?`)) return;
        await remove('vorlagen', data.id);
        toast('Vorlage gelöscht');
        close();
        render(container);
      });
    }
    body.querySelector('#vorlage-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const typ = fd.get('typ') || 'positionen';
      const updated = {
        ...data,
        name: (fd.get('name') || '').toString().trim(),
        typ,
        positionen: typ === 'dokumentation' ? [] : editor.getPositionen(),
        textVorlage: typ === 'dokumentation' ? (fd.get('textVorlage') || '').toString() : '',
      };
      if (!updated.name) return;
      await put('vorlagen', updated);
      toast(isEdit ? 'Vorlage aktualisiert' : 'Vorlage angelegt', 'success');
      close();
      render(container);
    });
  }

  renderTable();
}
