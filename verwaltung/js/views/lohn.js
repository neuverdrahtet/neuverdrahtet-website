import { getAll, put, remove } from '../db.js';
import { uid, escapeHtml, formatCurrency, toast } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import { getSettings } from '../db.js';
import { STEUERKLASSEN, berechneLohnabrechnung } from '../lohnrechner.js';
import { buildLohnzettelPdfBlob } from '../lohnpdf.js';

function monatLabel(monat) {
  const [jahr, mon] = (monat || '').split('-');
  if (!jahr || !mon) return monat || '';
  const name = new Intl.DateTimeFormat('de-DE', { month: 'long' }).format(new Date(Number(jahr), Number(mon) - 1, 1));
  return `${name} ${jahr}`;
}

function vorschlagBrutto(m) {
  if (m.gehaltMonatlich) return Number(m.gehaltMonatlich) || 0;
  if (m.stundenlohn && m.wochenstunden) return Math.round(Number(m.stundenlohn) * Number(m.wochenstunden) * 4.33 * 100) / 100;
  return 0;
}

export async function render(container) {
  let [abrechnungen, mitarbeiter] = await Promise.all([getAll('lohnabrechnungen'), getAll('mitarbeiter')]);
  const settings = await getSettings();
  const mitarbeiterById = Object.fromEntries(mitarbeiter.map((m) => [m.id, m]));
  abrechnungen.sort((a, b) => (b.monat || '').localeCompare(a.monat || ''));

  container.innerHTML = `
    <div class="view-header">
      <h1>Lohn &amp; Gehalt</h1>
      <div class="actions"><button class="btn btn-primary" id="btn-new">+ Neue Abrechnung</button></div>
    </div>
    <div class="card" style="background:var(--warn-bg);border-color:var(--warn)">
      <p class="hint" style="color:var(--warn);margin:0">
        ⚠️ Dieser Netto-Rechner liefert eine <strong>unverbindliche Näherung</strong> (grob gerundete Steuerzonen und SV-Sätze),
        keine zertifizierte Lohnsoftware. Vor Auszahlung, Lohnsteuer-Anmeldung oder SV-/DEÜV-Meldungen bitte immer von
        einem Steuerberater oder Lohnbüro prüfen lassen.
      </p>
    </div>
    <div id="table-host"></div>
  `;
  const tableHost = container.querySelector('#table-host');

  function renderTable() {
    if (abrechnungen.length === 0) {
      tableHost.innerHTML = `<div class="empty-state">Noch keine Lohnabrechnungen erstellt.</div>`;
      return;
    }
    tableHost.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Mitarbeiter</th><th>Monat</th><th class="text-right">Brutto</th><th class="text-right">Netto</th></tr></thead>
        <tbody>
          ${abrechnungen.map((a) => `
            <tr data-id="${a.id}">
              <td>${escapeHtml(mitarbeiterById[a.mitarbeiterId]?.name || '(gelöscht)')}</td>
              <td>${escapeHtml(monatLabel(a.monat))}</td>
              <td class="text-right">${formatCurrency(a.ergebnis?.brutto)}</td>
              <td class="text-right">${formatCurrency(a.ergebnis?.netto)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    tableHost.querySelectorAll('tbody tr').forEach((row) => {
      row.addEventListener('click', () => openForm(abrechnungen.find((a) => a.id === row.dataset.id)));
    });
  }

  container.querySelector('#btn-new').addEventListener('click', () => openForm());

  function openForm(a) {
    const isEdit = !!a;
    const now = new Date();
    const data = a || {
      id: uid(), mitarbeiterId: mitarbeiter[0]?.id || '', monat: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
      bruttoMonat: mitarbeiter[0] ? vorschlagBrutto(mitarbeiter[0]) : 0, zulagen: 0, sonstigeAbzuege: 0,
      steuerklasse: 'I', kirchensteuerSatz: 0, kinderlos: false, notizen: '', createdAt: new Date().toISOString(),
    };

    const { body, close } = openModal({
      title: isEdit ? `Abrechnung ${monatLabel(data.monat)}` : 'Neue Lohnabrechnung',
      wide: true,
      bodyHtml: `
        <form id="lohn-form">
          <div class="form-grid">
            <div class="field"><label>Mitarbeiter *</label>
              <select name="mitarbeiterId" id="f-ma" required>${mitarbeiter.map((m) => `<option value="${m.id}" ${m.id === data.mitarbeiterId ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Monat</label><input type="month" name="monat" value="${data.monat}"></div>
            <div class="field"><label>Bruttogehalt (€)</label><input type="number" step="0.01" min="0" name="bruttoMonat" id="f-brutto" value="${data.bruttoMonat}"></div>
            <div class="field"><label>Zulagen/Zuschläge (€)</label><input type="number" step="0.01" min="0" name="zulagen" value="${data.zulagen || 0}"></div>
            <div class="field"><label>Steuerklasse</label>
              <select name="steuerklasse">${STEUERKLASSEN.map((k) => `<option value="${k}" ${k === data.steuerklasse ? 'selected' : ''}>${k}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Kirchensteuer</label>
              <select name="kirchensteuerSatz">
                <option value="0" ${!data.kirchensteuerSatz ? 'selected' : ''}>keine</option>
                <option value="0.08" ${data.kirchensteuerSatz === 0.08 ? 'selected' : ''}>8% (BY, BW)</option>
                <option value="0.09" ${data.kirchensteuerSatz === 0.09 ? 'selected' : ''}>9% (übrige Bundesländer)</option>
              </select>
            </div>
            <div class="field field-checkbox"><input type="checkbox" name="kinderlos" id="kl" ${data.kinderlos ? 'checked' : ''}><label for="kl">Kinderlos (PV-Zuschlag)</label></div>
            <div class="field"><label>Sonstige Abzüge (€)</label><input type="number" step="0.01" min="0" name="sonstigeAbzuege" value="${data.sonstigeAbzuege || 0}"></div>
            <div class="field col-span-2"><label>Notizen</label><textarea name="notizen">${escapeHtml(data.notizen || '')}</textarea></div>
          </div>
          <div class="divider"></div>
          <div id="ergebnis-host"></div>
          <div class="modal-actions">
            ${isEdit ? '<button type="button" class="btn btn-danger" id="btn-delete">Löschen</button>' : ''}
            ${isEdit ? '<button type="button" class="btn" id="btn-lohnzettel">Lohnzettel PDF</button>' : ''}
            <span class="spacer"></span>
            <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Speichern &amp; berechnen</button>
          </div>
        </form>
      `,
    });

    function currentInputs() {
      const fd = new FormData(body.querySelector('#lohn-form'));
      return {
        bruttoMonat: Number(fd.get('bruttoMonat')) || 0,
        zulagen: Number(fd.get('zulagen')) || 0,
        sonstigeAbzuege: Number(fd.get('sonstigeAbzuege')) || 0,
        steuerklasse: fd.get('steuerklasse') || 'I',
        kirchensteuerSatz: Number(fd.get('kirchensteuerSatz')) || 0,
        kinderlos: fd.get('kinderlos') === 'on',
      };
    }
    function renderErgebnis() {
      const ergebnis = berechneLohnabrechnung(currentInputs());
      body.querySelector('#ergebnis-host').innerHTML = `
        <div class="totals-box">
          <div class="row"><span>Lohnsteuer</span><span>${formatCurrency(ergebnis.lohnsteuer)}</span></div>
          <div class="row"><span>Solidaritätszuschlag</span><span>${formatCurrency(ergebnis.soli)}</span></div>
          <div class="row"><span>Kirchensteuer</span><span>${formatCurrency(ergebnis.kirchensteuer)}</span></div>
          <div class="row"><span>Rentenversicherung</span><span>${formatCurrency(ergebnis.sv.rv)}</span></div>
          <div class="row"><span>Arbeitslosenversicherung</span><span>${formatCurrency(ergebnis.sv.av)}</span></div>
          <div class="row"><span>Krankenversicherung</span><span>${formatCurrency(ergebnis.sv.kv)}</span></div>
          <div class="row"><span>Pflegeversicherung</span><span>${formatCurrency(ergebnis.sv.pv)}</span></div>
          <div class="row grand"><span>Netto (geschätzt)</span><span>${formatCurrency(ergebnis.netto)}</span></div>
        </div>
      `;
      return ergebnis;
    }
    body.querySelector('#lohn-form').addEventListener('input', renderErgebnis);
    let letztesErgebnis = renderErgebnis();

    body.querySelector('#f-ma').addEventListener('change', (e) => {
      const m = mitarbeiterById[e.target.value] || mitarbeiter.find((x) => x.id === e.target.value);
      if (m && !isEdit) {
        body.querySelector('#f-brutto').value = vorschlagBrutto(m);
        letztesErgebnis = renderErgebnis();
      }
    });

    body.querySelector('#btn-cancel').addEventListener('click', close);
    if (isEdit) {
      body.querySelector('#btn-delete').addEventListener('click', async () => {
        if (!confirmDelete('Diese Lohnabrechnung wirklich löschen?')) return;
        await remove('lohnabrechnungen', data.id);
        toast('Lohnabrechnung gelöscht');
        close();
        render(container);
      });
      body.querySelector('#btn-lohnzettel').addEventListener('click', () => {
        const m = mitarbeiterById[data.mitarbeiterId];
        if (!m) { toast('Mitarbeiter nicht gefunden', 'danger'); return; }
        const inputs = currentInputs();
        const blob = buildLohnzettelPdfBlob({
          settings, mitarbeiter: m, monat: body.querySelector('input[name="monat"]').value,
          ergebnis: letztesErgebnis, steuerklasse: inputs.steuerklasse, kirchensteuerSatz: inputs.kirchensteuerSatz, kinderlos: inputs.kinderlos,
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Lohnzettel-${m.name.replace(/\s+/g, '_')}-${body.querySelector('input[name="monat"]').value}.pdf`;
        link.click();
        URL.revokeObjectURL(url);
      });
    }

    body.querySelector('#lohn-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const inputs = currentInputs();
      const updated = {
        ...data,
        mitarbeiterId: fd.get('mitarbeiterId') || '',
        monat: fd.get('monat') || data.monat,
        notizen: (fd.get('notizen') || '').toString().trim(),
        ...inputs,
        ergebnis: berechneLohnabrechnung(inputs),
      };
      if (!updated.mitarbeiterId) { toast('Bitte einen Mitarbeiter wählen', 'danger'); return; }
      await put('lohnabrechnungen', updated);
      toast(isEdit ? 'Lohnabrechnung aktualisiert' : 'Lohnabrechnung angelegt', 'success');
      close();
      render(container);
    });
  }

  renderTable();
}
