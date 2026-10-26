import { getAll, put } from '../db.js';
import { uid, escapeHtml, toast, formatDate, formatCurrency } from '../utils.js';
import { openModal } from '../ui.js';
import { getSession } from '../auth.js';
import { REISEKOSTEN_STATUS, findeGueltigenSatz, berechneVerpflegungspauschale, berechneKilometergeld } from '../reisekosten.js';

// Service-/Techniker-/Personalverwaltung Phase 9 - Reisekosten und
// Verpflegungspauschalen. WICHTIG - reine Simulation/Orientierungshilfe
// (siehe Kopfkommentar in verwaltung/js/reisekosten.js): KEINE automatische
// Auszahlung, KEINE Lohnabrechnung. "Genehmigen" markiert hier ausschließlich
// den Prüfstatus dieser Abrechnung - es löst keinerlei Zahlung, Buchung oder
// Export in ein Lohnprogramm aus.
//
// admin/büro sehen und prüfen ALLE Abrechnungen + pflegen die Satztabelle;
// mitarbeiter sehen/bearbeiten hier nur die EIGENEN (siehe firestore.rules) -
// Techniker nutzen dafür ihre eigene mobile Ansicht (verwaltung/techniker/).

const STATUS_LABEL = Object.fromEntries(REISEKOSTEN_STATUS.map((s) => [s.id, s.titel]));
const STATUS_BADGE = { entwurf: '', eingereicht: 'badge-warn', genehmigt: 'badge-success', abgelehnt: 'badge-danger' };

export async function render(container) {
  const session = getSession() || {};
  const istBuero = session.role === 'admin' || session.role === 'buero';
  let [abrechnungen, mitarbeiter, saetze] = await Promise.all([
    getAll('reisekostenabrechnungen'), getAll('mitarbeiter'), getAll('reisekostensaetze'),
  ]);
  if (!istBuero) abrechnungen = abrechnungen.filter((a) => a.mitarbeiterId === session.mitarbeiterId);
  abrechnungen.sort((a, b) => (b.von || '').localeCompare(a.von || ''));
  const mitarbeiterById = Object.fromEntries(mitarbeiter.map((m) => [m.id, m]));
  saetze.sort((a, b) => (b.gueltigAb || '').localeCompare(a.gueltigAb || ''));

  container.innerHTML = `
    <div class="view-header">
      <h1>Reisekosten &amp; Verpflegungspauschalen</h1>
      <div class="actions">
        <button class="btn btn-primary" id="btn-new">+ Reisekostenabrechnung</button>
        ${istBuero ? '<button class="btn btn-sm" id="btn-saetze">Sätze verwalten</button>' : ''}
      </div>
    </div>
    <p class="hint">⚠️ Reine Orientierungshilfe auf Basis der gesetzlichen Verpflegungspauschalen (§9 Abs. 4a EStG) und der üblichen Kilometerpauschale. KEINE automatische Auszahlung, KEINE Lohnabrechnung - eine Genehmigung hier löst keinerlei Zahlung aus. Vor Verwendung in einer echten Gehaltsabrechnung ist eine rechtliche Prüfung durch Lohnbüro/Steuerberater erforderlich.</p>
    <div id="saetze-host"></div>
    <div id="liste-host"></div>
  `;

  function renderSaetze() {
    const host = container.querySelector('#saetze-host');
    if (!host) return;
    host.innerHTML = `
      <h3 style="margin-top:8px">Gültige Sätze</h3>
      <table class="data-table" style="max-width:640px">
        <thead><tr><th>Gültig ab</th><th>Gültig bis</th><th>Voller Tag</th><th>An-/Abreisetag</th><th>Kilometerpauschale</th></tr></thead>
        <tbody>${saetze.map((s) => `
          <tr>
            <td>${formatDate(s.gueltigAb)}</td><td>${s.gueltigBis ? formatDate(s.gueltigBis) : 'bis auf Weiteres'}</td>
            <td>${formatCurrency(s.verpflegungGanztag)}</td><td>${formatCurrency(s.verpflegungAnUndAbreise)}</td>
            <td>${(s.kilometerpauschale || 0).toFixed(2)} €/km</td>
          </tr>
        `).join('')}</tbody>
      </table>
    `;
  }

  function renderListe() {
    const host = container.querySelector('#liste-host');
    if (abrechnungen.length === 0) { host.innerHTML = '<div class="empty-state">Noch keine Reisekostenabrechnungen erfasst.</div>'; return; }
    host.innerHTML = `
      <table class="data-table">
        <thead><tr>${istBuero ? '<th>Mitarbeiter</th>' : ''}<th>Anlass</th><th>Zeitraum</th><th>Betrag</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${abrechnungen.map((a) => {
            const berechnung = berechneVerpflegungspauschale(a.von, a.bis, saetze);
            const km = berechneKilometergeld(a.kilometer, a.von, saetze);
            return `
            <tr data-id="${a.id}">
              ${istBuero ? `<td>${escapeHtml(mitarbeiterById[a.mitarbeiterId]?.name || a.mitarbeiterId || '–')}</td>` : ''}
              <td>${escapeHtml(a.anlass || '–')}</td>
              <td>${formatDate((a.von || '').slice(0, 10))}${(a.bis || '').slice(0, 10) !== (a.von || '').slice(0, 10) ? ` – ${formatDate((a.bis || '').slice(0, 10))}` : ''}</td>
              <td>${formatCurrency(berechnung.gesamtBetrag + km)}${berechnung.fehlendeSaetze.length ? ' <span class="badge badge-danger">kein Satz hinterlegt</span>' : ''}</td>
              <td><span class="badge ${STATUS_BADGE[a.status] || ''}">${STATUS_LABEL[a.status] || a.status}</span></td>
              <td>
                <button type="button" class="btn btn-sm btn-edit" data-id="${a.id}">Ansehen</button>
                ${istBuero && a.status === 'eingereicht' ? `
                  <button type="button" class="btn btn-sm btn-genehmigen" data-id="${a.id}">Genehmigen</button>
                  <button type="button" class="btn btn-sm btn-danger btn-ablehnen" data-id="${a.id}">Ablehnen</button>
                ` : ''}
              </td>
            </tr>
          `;
          }).join('')}
        </tbody>
      </table>
    `;
    host.querySelectorAll('.btn-edit').forEach((btn) => btn.addEventListener('click', () => openForm(abrechnungen.find((a) => a.id === btn.dataset.id))));
    host.querySelectorAll('.btn-genehmigen').forEach((btn) => btn.addEventListener('click', () => entscheiden(btn.dataset.id, 'genehmigt')));
    host.querySelectorAll('.btn-ablehnen').forEach((btn) => btn.addEventListener('click', () => entscheiden(btn.dataset.id, 'abgelehnt')));
  }

  async function entscheiden(id, status) {
    const a = abrechnungen.find((x) => x.id === id);
    if (!a) return;
    const grund = status === 'abgelehnt' ? (prompt('Grund für die Ablehnung (optional):') || '') : '';
    const updated = { ...a, status, geprueftVon: session.name || session.mitarbeiterId || session.role || '', geprueftAm: new Date().toISOString(), ablehnungsgrund: grund };
    await put('reisekostenabrechnungen', updated);
    Object.assign(a, updated);
    toast(status === 'genehmigt' ? 'Genehmigt (nur Prüfstatus - keine Auszahlung ausgelöst)' : 'Abgelehnt', status === 'genehmigt' ? 'success' : 'info');
    renderListe();
  }

  function openForm(vorhanden) {
    const isEdit = !!vorhanden;
    const darfBearbeiten = !isEdit || istBuero || (vorhanden.mitarbeiterId === session.mitarbeiterId && ['entwurf', 'eingereicht'].includes(vorhanden.status));
    const data = vorhanden || {
      id: uid(), mitarbeiterId: istBuero ? '' : session.mitarbeiterId, anlass: '', von: '', bis: '',
      kilometer: '', uebernachtungskostenBrutto: '', status: 'entwurf',
    };

    function vorschau(von, bis, kilometer) {
      const v = berechneVerpflegungspauschale(von, bis, saetze);
      const km = berechneKilometergeld(kilometer, von, saetze);
      return { v, km };
    }

    const { body, close } = openModal({
      title: isEdit ? `Reisekostenabrechnung – ${escapeHtml(data.anlass || '')}` : 'Neue Reisekostenabrechnung',
      bodyHtml: `
        <form id="rk-form">
          <div class="form-grid">
            ${istBuero ? `<div class="field col-span-2"><label>Mitarbeiter *</label>
              <select name="mitarbeiterId" required ${isEdit ? 'disabled' : ''}>
                <option value="">– auswählen –</option>
                ${mitarbeiter.map((m) => `<option value="${m.id}" ${m.id === data.mitarbeiterId ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}
              </select>
            </div>` : ''}
            <div class="field col-span-2"><label>Anlass *</label><input name="anlass" required value="${escapeHtml(data.anlass || '')}" placeholder="z.B. Kundentermin Wärmepumpenservice"></div>
            <div class="field"><label>Von *</label><input type="datetime-local" name="von" required value="${escapeHtml(data.von || '')}" ${darfBearbeiten ? '' : 'disabled'}></div>
            <div class="field"><label>Bis *</label><input type="datetime-local" name="bis" required value="${escapeHtml(data.bis || '')}" ${darfBearbeiten ? '' : 'disabled'}></div>
            <div class="field"><label>Gefahrene Kilometer (eigener Pkw, optional)</label><input type="number" step="1" min="0" name="kilometer" value="${escapeHtml(String(data.kilometer ?? ''))}" ${darfBearbeiten ? '' : 'disabled'}></div>
            <div class="field"><label>Übernachtungskosten brutto (optional, Beleg erforderlich)</label><input type="number" step="0.01" min="0" name="uebernachtungskostenBrutto" value="${escapeHtml(String(data.uebernachtungskostenBrutto ?? ''))}" ${darfBearbeiten ? '' : 'disabled'}></div>
          </div>
          <div id="rk-vorschau" class="card" style="margin-top:12px"></div>
          ${isEdit && data.ablehnungsgrund ? `<p class="hint">Ablehnungsgrund: ${escapeHtml(data.ablehnungsgrund)}</p>` : ''}
          <div class="modal-actions">
            <span class="spacer"></span>
            <button type="button" class="btn" id="rk-cancel">Schließen</button>
            ${darfBearbeiten ? `<button type="submit" class="btn btn-primary">${isEdit ? 'Speichern' : 'Als Entwurf anlegen'}</button>` : ''}
          </div>
        </form>
      `,
    });

    function aktualisiereVorschau() {
      const fd = new FormData(body.querySelector('#rk-form'));
      const { v, km } = vorschau(fd.get('von'), fd.get('bis'), fd.get('kilometer'));
      body.querySelector('#rk-vorschau').innerHTML = `
        <strong>Berechnete Verpflegungspauschale: ${formatCurrency(v.gesamtBetrag)}</strong>
        ${v.tage.length ? `<ul style="margin:6px 0 0 18px;font-size:12.5px">${v.tage.map((t) => `<li>${formatDate(t.datum)}: ${t.typ === 'voller_tag' ? 'voller Abwesenheitstag' : t.typ === 'an_abreisetag' ? 'An-/Abreisetag' : t.typ === 'eintaegig_ueber_8h' ? 'eintägig, über 8 Std.' : 'eintägig, bis 8 Std. (kein Anspruch)'} - ${formatCurrency(t.betrag)}</li>`).join('')}</ul>` : ''}
        ${v.fehlendeSaetze.length ? `<p class="hint">⚠️ Kein gültiger Satz für: ${v.fehlendeSaetze.map((d) => formatDate(d)).join(', ')} - bitte Satz in den Einstellungen anlegen.</p>` : ''}
        ${km > 0 ? `<p style="margin-top:4px">zzgl. Kilometergeld: ${formatCurrency(km)}</p>` : ''}
        <p style="margin-top:6px"><strong>Gesamt: ${formatCurrency(v.gesamtBetrag + km)}</strong></p>
      `;
    }
    body.querySelectorAll('input[name="von"], input[name="bis"], input[name="kilometer"]').forEach((inp) => inp.addEventListener('input', aktualisiereVorschau));
    aktualisiereVorschau();

    body.querySelector('#rk-cancel').addEventListener('click', close);
    if (darfBearbeiten) {
      body.querySelector('#rk-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const mitarbeiterId = istBuero ? (fd.get('mitarbeiterId') || '').toString() : session.mitarbeiterId;
        if (!mitarbeiterId) { toast('Bitte einen Mitarbeiter auswählen', 'error'); return; }
        const updated = {
          ...data, mitarbeiterId,
          anlass: (fd.get('anlass') || '').toString().trim(),
          von: (fd.get('von') || '').toString(), bis: (fd.get('bis') || '').toString(),
          kilometer: fd.get('kilometer') ? Number(fd.get('kilometer')) : '',
          uebernachtungskostenBrutto: fd.get('uebernachtungskostenBrutto') ? Number(fd.get('uebernachtungskostenBrutto')) : '',
          status: data.status || 'entwurf',
          erstelltAm: data.erstelltAm || new Date().toISOString(),
        };
        await put('reisekostenabrechnungen', updated);
        const idx = abrechnungen.findIndex((a) => a.id === updated.id);
        if (idx === -1) abrechnungen.unshift(updated); else abrechnungen[idx] = updated;
        toast(isEdit ? 'Gespeichert' : 'Als Entwurf angelegt', 'success');
        close();
        renderListe();
      });
    }
  }

  if (istBuero) {
    renderSaetze();
    container.querySelector('#btn-saetze').addEventListener('click', () => openSatzForm());
  }
  container.querySelector('#btn-new').addEventListener('click', () => openForm());
  renderListe();

  function openSatzForm() {
    const { body, close } = openModal({
      title: 'Neuen Reisekosten-Satz anlegen',
      bodyHtml: `
        <form id="satz-form">
          <p class="hint">Ein neuer Satz gilt ab dem gewählten Datum "bis auf Weiteres". Der zuvor gültige Satz wird automatisch zum Vortag begrenzt - frühere Reisen bleiben unverändert mit dem alten Satz berechnet.</p>
          <div class="form-grid">
            <div class="field col-span-2"><label>Gültig ab *</label><input type="date" name="gueltigAb" required></div>
            <div class="field"><label>Verpflegung voller Tag (EUR) *</label><input type="number" step="0.01" min="0" name="verpflegungGanztag" required value="28"></div>
            <div class="field"><label>Verpflegung An-/Abreisetag (EUR) *</label><input type="number" step="0.01" min="0" name="verpflegungAnUndAbreise" required value="14"></div>
            <div class="field"><label>Kilometerpauschale (EUR/km) *</label><input type="number" step="0.01" min="0" name="kilometerpauschale" required value="0.30"></div>
            <div class="field col-span-2"><label>Quelle/Begründung *</label><textarea name="quelle" required placeholder="z.B. §9 Abs. 4a EStG, BMF-Schreiben vom ..."></textarea></div>
          </div>
          <div class="modal-actions">
            <span class="spacer"></span>
            <button type="button" class="btn" id="satz-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Anlegen</button>
          </div>
        </form>
      `,
    });
    body.querySelector('#satz-cancel').addEventListener('click', close);
    body.querySelector('#satz-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const gueltigAb = (fd.get('gueltigAb') || '').toString();
      if (!gueltigAb) return;
      const vorherigeGueltige = findeGueltigenSatz(saetze, gueltigAb);
      if (vorherigeGueltige && vorherigeGueltige.gueltigAb < gueltigAb) {
        const vortag = new Date(new Date(`${gueltigAb}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
        const begrenzt = { ...vorherigeGueltige, gueltigBis: vortag };
        await put('reisekostensaetze', begrenzt);
        Object.assign(vorherigeGueltige, begrenzt);
      }
      const neu = {
        id: uid(), gueltigAb, gueltigBis: '',
        verpflegungGanztag: Number(fd.get('verpflegungGanztag')), verpflegungAnUndAbreise: Number(fd.get('verpflegungAnUndAbreise')),
        kilometerpauschale: Number(fd.get('kilometerpauschale')), quelle: (fd.get('quelle') || '').toString().trim(),
      };
      await put('reisekostensaetze', neu);
      saetze.unshift(neu);
      saetze.sort((a, b) => (b.gueltigAb || '').localeCompare(a.gueltigAb || ''));
      toast('Neuer Satz angelegt', 'success');
      close();
      renderSaetze();
      renderListe();
    });
  }
}
