import { getAll, put, remove, getSettings } from '../db.js';
import { uid, escapeHtml, formatCurrency, toast } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import { createPositionsEditor } from '../positions.js';
import { createBulkSelect } from '../bulkselect.js';

const ABSCHNITT_LABEL = {
  kopfdaten: 'Kopfdaten (Steckbrief/Messwerte)',
  janein: 'Ja/Nein-Fragen',
  checkliste: 'Checkliste',
  tabelle: 'Tabelle (mit Berechnung)',
  raeume: 'Räume/Zeilen anpassen',
  tagesprotokoll: 'Bautagebuch (Tageseinträge)',
  unterschriften: 'Unterschriften anpassen',
};

function configFieldsFor(a) {
  if (a.typ === 'kopfdaten') {
    return `
      <div class="field"><label>Überschrift</label><input type="text" class="absch-input" data-field="titel" value="${escapeHtml(a.titel || '')}"></div>
      <div class="field"><label>Felder (ein Label pro Zeile)</label><textarea class="absch-input" data-field="felder" rows="4">${escapeHtml((a.felder || []).map((f) => f.label).join('\n'))}</textarea></div>
    `;
  }
  if (a.typ === 'janein') {
    return `
      <div class="field"><label>Überschrift</label><input type="text" class="absch-input" data-field="titel" value="${escapeHtml(a.titel || '')}"></div>
      <div class="field"><label>Fragen (eine pro Zeile)</label><textarea class="absch-input" data-field="fragen" rows="4">${escapeHtml((a.fragen || []).join('\n'))}</textarea></div>
    `;
  }
  if (a.typ === 'checkliste') {
    return `
      <div class="field"><label>Überschrift</label><input type="text" class="absch-input" data-field="titel" value="${escapeHtml(a.titel || '')}"></div>
      <div class="field"><label>Punkte (einer pro Zeile)</label><textarea class="absch-input" data-field="punkte" rows="4">${escapeHtml((a.punkte || []).join('\n'))}</textarea></div>
    `;
  }
  if (a.typ === 'tabelle') {
    return `
      <div class="field"><label>Überschrift</label><input type="text" class="absch-input" data-field="titel" value="${escapeHtml(a.titel || '')}"></div>
      <div class="field"><label>Spalten (kommagetrennt)</label><input type="text" class="absch-input" data-field="spalten" value="${escapeHtml((a.spalten || []).join(', '))}"></div>
      <div class="field"><label>Ergebnis-Spalte (optional). Wenn gesetzt: erste Spalte = Bezeichnung (Text), weitere Spalten = Zahlenwerte, Ergebnis = deren Produkt (z.B. RPZ). Wenn leer: alle Spalten frei als Text.</label><input type="text" class="absch-input" data-field="ergebnisSpalte" value="${escapeHtml(a.ergebnisSpalte || '')}"></div>
    `;
  }
  if (a.typ === 'raeume') {
    return `
      <div class="field"><label>Überschrift (überschreibt Standard-Label)</label><input type="text" class="absch-input" data-field="titel" value="${escapeHtml(a.titel || '')}"></div>
      <label class="field-checkbox"><input type="checkbox" class="absch-check" data-field="mitMassen" ${a.mitMassen ? 'checked' : ''}> Mit Länge/Breite/m²-Feldern</label>
      <label class="field-checkbox"><input type="checkbox" class="absch-check" data-field="mitFotoProZeile" ${a.mitFotoProZeile ? 'checked' : ''}> Mit Foto je Zeile</label>
      <label class="field-checkbox"><input type="checkbox" class="absch-check" data-field="mitMarkierung" ${a.mitMarkierung ? 'checked' : ''}> Markierung auf dem Foto möglich (z.B. für Mängel)</label>
    `;
  }
  if (a.typ === 'tagesprotokoll') {
    return `
      <div class="field"><label>Überschrift (überschreibt Standard-Label)</label><input type="text" class="absch-input" data-field="titel" value="${escapeHtml(a.titel || '')}"></div>
      <p class="hint">Pro Tag ein Eintrag mit Datum, Wetter, Personenzahl vor Ort und Vorkommnissen - erscheint als eigene Tabelle im PDF.</p>
    `;
  }
  if (a.typ === 'unterschriften') {
    return `
      <div class="field"><label>Unterschrift-Beschriftungen (eine pro Zeile, ersetzt Standard "Kunde"/"Mitarbeiter")</label><textarea class="absch-input" data-field="labels" rows="2">${escapeHtml((a.labels || []).join('\n'))}</textarea></div>
    `;
  }
  return '';
}

const ABSCHNITT_DEFAULTS = {
  kopfdaten: (typ) => ({ typ, titel: 'Kopfdaten', felder: [] }),
  janein: (typ) => ({ typ, titel: 'Fragen', fragen: [] }),
  checkliste: (typ) => ({ typ, titel: 'Checkliste', punkte: [] }),
  tabelle: (typ) => ({ typ, titel: 'Tabelle', spalten: [], ergebnisSpalte: '' }),
  raeume: (typ) => ({ typ, titel: '', mitMassen: false, mitFotoProZeile: false, mitMarkierung: false }),
  tagesprotokoll: (typ) => ({ typ, titel: '' }),
  unterschriften: (typ) => ({ typ, labels: [] }),
};

/** Baukasten für strukturierte Bericht-Abschnitte (Kopfdaten/Ja-Nein/Checkliste/Tabelle/Räume/Unterschriften). */
function renderAbschnitteEditor(host, abschnitteState) {
  host.innerHTML = `
    <div id="absch-list" style="margin-bottom:10px"></div>
    <div class="flex-row">
      <select id="absch-add-typ">
        ${Object.entries(ABSCHNITT_LABEL).map(([typ, label]) => `<option value="${typ}">${escapeHtml(label)}</option>`).join('')}
      </select>
      <button type="button" class="btn btn-sm" id="btn-absch-add">+ Abschnitt hinzufügen</button>
    </div>
  `;
  function renderList() {
    const listHost = host.querySelector('#absch-list');
    listHost.innerHTML = abschnitteState.map((a, i) => `
      <div class="card" style="margin-bottom:8px;padding:10px" data-i="${i}">
        <div class="flex-row" style="justify-content:space-between;align-items:center;margin-bottom:6px">
          <strong>${escapeHtml(ABSCHNITT_LABEL[a.typ] || a.typ)}</strong>
          <button type="button" class="btn btn-sm btn-danger absch-del" data-i="${i}">✕</button>
        </div>
        ${configFieldsFor(a)}
      </div>
    `).join('') || '<p class="text-mute" style="font-size:12px">Noch keine zusätzlichen Abschnitte – der freie Text unten reicht bei einfachen Vorlagen völlig aus.</p>';
    listHost.querySelectorAll('.card[data-i]').forEach((card) => {
      const i = Number(card.dataset.i);
      card.querySelectorAll('.absch-input').forEach((input) => {
        input.addEventListener('input', (e) => {
          const field = e.target.dataset.field;
          if (field === 'spalten') {
            abschnitteState[i][field] = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
          } else if (['felder', 'fragen', 'punkte', 'labels'].includes(field)) {
            const lines = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean);
            abschnitteState[i][field] = field === 'felder' ? lines.map((l) => ({ label: l, typ: 'text' })) : lines;
          } else {
            abschnitteState[i][field] = e.target.value;
          }
        });
      });
      card.querySelectorAll('.absch-check').forEach((cb) => {
        cb.addEventListener('change', (e) => { abschnitteState[i][e.target.dataset.field] = e.target.checked; });
      });
      card.querySelector('.absch-del').addEventListener('click', () => { abschnitteState.splice(i, 1); renderList(); });
    });
  }
  renderList();
  host.querySelector('#btn-absch-add').addEventListener('click', () => {
    const typ = host.querySelector('#absch-add-typ').value;
    abschnitteState.push(ABSCHNITT_DEFAULTS[typ](typ));
    renderList();
  });
}

export async function render(container) {
  let [vorlagen, katalog, settings] = await Promise.all([getAll('vorlagen'), getAll('katalog'), getSettings()]);
  vorlagen.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const bulk = createBulkSelect('vorlagen', { label: 'Vorlagen' });

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
      ${bulk.barHtml()}
      <table class="data-table">
        <thead><tr>${bulk.headerCell()}<th>Typ</th><th>Name</th><th>Positionen</th><th class="text-right">Summe (netto)</th></tr></thead>
        <tbody>
          ${vorlagen.map((v) => {
            const isDok = v.typ === 'dokumentation';
            const summe = (v.positionen || []).reduce((s, p) => s + (Number(p.menge) || 0) * (Number(p.einzelpreis) || 0), 0);
            return `
            <tr data-id="${v.id}">
              ${bulk.rowCell(v.id)}
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
    bulk.wire(tableHost, {
      onChange: renderTable,
      onDeleted: (ids) => {
        vorlagen = vorlagen.filter((v) => !ids.includes(v.id));
        renderTable();
      },
    });
  }

  container.querySelector('#btn-new').addEventListener('click', () => openForm());

  function openForm(v) {
    const isEdit = !!v;
    const data = v || { id: uid(), typ: 'positionen', name: '', positionen: [], textVorlage: '', abschnitte: [] };
    let abschnitteState = (data.abschnitte || []).map((a) => ({ ...a }));

    function bodyFor(typ) {
      if (typ === 'dokumentation') {
        return `
          <div class="divider"></div>
          <h2 style="font-size:14px;margin:0 0 8px">Strukturierte Abschnitte (optional)</h2>
          <p class="hint">Zusätzlich zum freien Text: Kopfdaten-Steckbrief, Ja/Nein-Fragen, Checklisten, Berechnungstabellen (z.B. Risikomatrix), angepasste Räume/Zeilen oder Unterschrift-Beschriftungen – erscheinen beim Ausfüllen als eigene Formularfelder und werden strukturiert ins PDF übernommen.</p>
          <div id="absch-host"></div>
          <div class="divider"></div>
          <div class="field">
            <label>Text-Vorlage</label>
            <textarea name="textVorlage" style="min-height:220px" placeholder="Platzhalter: {{firma}}, {{kunde}}, {{projekt}}, {{datum}}">${escapeHtml(data.textVorlage || '')}</textarea>
          </div>
          <p class="hint">Diese Vorlage steht bei Projekt-/Mitarbeiter-Dokumenten unter "Bericht aus Vorlage erstellen" zur Auswahl.</p>
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
    if (data.typ === 'dokumentation') renderAbschnitteEditor(body.querySelector('#absch-host'), abschnitteState);

    body.querySelector('#f-typ').addEventListener('change', (e) => {
      body.querySelector('#typ-body').innerHTML = bodyFor(e.target.value);
      if (e.target.value === 'dokumentation') {
        editor = null;
        renderAbschnitteEditor(body.querySelector('#absch-host'), abschnitteState);
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
        if (!confirmDelete(`Vorlage "${data.name}" in den Papierkorb verschieben?`)) return;
        await remove('vorlagen', data.id);
        toast('Vorlage in den Papierkorb verschoben');
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
        abschnitte: typ === 'dokumentation' ? abschnitteState : [],
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
