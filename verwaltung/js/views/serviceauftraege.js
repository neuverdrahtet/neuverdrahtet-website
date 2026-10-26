import { getAll, put, getSettings, SERVICEAUFTRAG_STATUS } from '../db.js';
import { uid, escapeHtml, toast, formatDate, formatCurrency, todayISO } from '../utils.js';
import { openModal } from '../ui.js';
import { renderDokumenteSection, SERVICEAUFTRAG_DOKUMENT_KATEGORIEN } from '../dokumente.js';

// Service-Auftragsverwaltung (Phase 1 der Service-/Techniker-/
// Personalverwaltung, siehe Architektur-/Sicherheitsbericht Phase 0) -
// externe Herstellerwartungsaufträge (z.B. Stiebel-Eltron-Wärmepumpenservice).
// Bewusst eine EIGENE Collection statt "projekte" (die bestehenden
// "service"/"wartung"-Ansichten sind nur bereichsgefilterte Projekt-Ansichten
// ohne externe Auftragsnummer, Hersteller/Anlagentyp oder Dublettenprüfung).
//
// Diese Ansicht ist bewusst nur für admin/büro (siehe ROUTE_ROLLEN/
// firestore.rules match /serviceauftraege/{docId}) - die mobile
// Techniker-Oberfläche mit eigener, engerer Rechtevergabe folgt in Phase 4.

const STATUS_LABEL = Object.fromEntries(SERVICEAUFTRAG_STATUS.map((s) => [s.id, s.titel]));
const STATUS_BADGE = {
  offen: 'badge-warn', zugewiesen: 'badge-accent', in_bearbeitung: 'badge-accent',
  abgeschlossen: 'badge-success', abgebrochen: 'badge-danger',
};

// Exportiert für Tests (siehe verwaltung/tests/serviceauftraege.test.mjs) -
// reine Funktionen, keine DOM-/Firestore-Abhängigkeit.
export function normalisiereAuftragsnummer(nummer) {
  return (nummer || '').toString().trim().toLowerCase();
}

// Dublettenprüfung: findet einen ANDEREN Serviceauftrag mit derselben
// externen Auftragsnummer (Herstellerportale/E-Mails können dieselbe
// Auftragsnummer versehentlich zweimal liefern, z.B. bei einer erneuten
// Zusendung). Bewusst kein hartes Verbot (der Hersteller KANN eine Nummer
// legitim erneut verwenden, z.B. bei einer stornierten und neu
// ausgestellten Beauftragung) - die Oberfläche warnt und lässt die
// Entscheidung bei admin/büro.
export function findeDublette(auftraege, externeAuftragsnummer, eigeneId) {
  const norm = normalisiereAuftragsnummer(externeAuftragsnummer);
  if (!norm) return null;
  return auftraege.find((a) => a.id !== eigeneId && normalisiereAuftragsnummer(a.externeAuftragsnummer) === norm) || null;
}

export function istUeberfaellig(auftrag, heute = todayISO()) {
  if (!auftrag.auftragsfrist) return false;
  if (auftrag.status === 'abgeschlossen' || auftrag.status === 'abgebrochen') return false;
  return auftrag.auftragsfrist < heute;
}

export async function render(container) {
  let [auftraege, kunden, anlagen, mitarbeiter, settings] = await Promise.all([
    getAll('serviceauftraege'), getAll('kunden'), getAll('anlagen'), getAll('mitarbeiter'), getSettings(),
  ]);
  auftraege.sort((a, b) => (b.erstelltAm || '').localeCompare(a.erstelltAm || ''));
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));
  const anlagenById = Object.fromEntries(anlagen.map((a) => [a.id, a]));
  const techniker = mitarbeiter.filter((m) => m.zugriffsrolle === 'techniker');
  const technikerById = Object.fromEntries(mitarbeiter.map((m) => [m.id, m]));

  container.innerHTML = `
    <div class="view-header">
      <h1>Serviceaufträge</h1>
      <div class="actions">
        <button class="btn btn-primary" id="btn-new">+ Serviceauftrag</button>
      </div>
    </div>
    <p class="hint">Externe Herstellerwartungsaufträge (z.B. Wärmepumpen-Service). Die mobile Techniker-Ansicht folgt in einer späteren Phase - hier wird zugewiesen, geplant und der Status gepflegt.</p>
    <div class="kpi-grid">
      <div class="kpi-card kpi-warn"><div class="kpi-value">${auftraege.filter((a) => a.status === 'offen').length}</div><div class="kpi-label">Offen (nicht zugewiesen)</div></div>
      <div class="kpi-card"><div class="kpi-value">${auftraege.filter((a) => a.status === 'zugewiesen' || a.status === 'in_bearbeitung').length}</div><div class="kpi-label">Zugewiesen / in Bearbeitung</div></div>
      <div class="kpi-card kpi-danger"><div class="kpi-value">${auftraege.filter((a) => istUeberfaellig(a)).length}</div><div class="kpi-label">Frist überschritten</div></div>
      <div class="kpi-card kpi-success"><div class="kpi-value">${auftraege.filter((a) => a.status === 'abgeschlossen').length}</div><div class="kpi-label">Abgeschlossen</div></div>
    </div>
    <div id="liste-host"></div>
  `;

  function renderListe() {
    const host = container.querySelector('#liste-host');
    if (auftraege.length === 0) { host.innerHTML = '<div class="empty-state">Noch keine Serviceaufträge erfasst.</div>'; return; }
    host.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Auftragsnummer</th><th>Kunde / Auftraggeber</th><th>Anlage</th><th>Techniker</th><th>Frist</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${auftraege.map((a) => `
            <tr data-id="${a.id}">
              <td>${escapeHtml(a.externeAuftragsnummer || '–')}</td>
              <td>${escapeHtml(kundenById[a.kundeId]?.firma || a.kundenname || '–')}${a.auftraggeber ? `<div class="text-mute" style="font-size:12px">${escapeHtml(a.auftraggeber)}</div>` : ''}</td>
              <td>${escapeHtml(anlagenById[a.anlagenId]?.bezeichnung || a.herstellerUndAnlagentyp || '–')}</td>
              <td>${(a.technikerIds || []).map((id) => escapeHtml(technikerById[id]?.name || '?')).join(', ') || '–'}</td>
              <td>${a.auftragsfrist ? formatDate(a.auftragsfrist) : '–'}${istUeberfaellig(a) ? ' <span class="badge badge-danger">überfällig</span>' : ''}</td>
              <td><span class="badge ${STATUS_BADGE[a.status] || ''}">${STATUS_LABEL[a.status] || a.status}</span></td>
              <td><button type="button" class="btn btn-sm btn-edit" data-id="${a.id}">Bearbeiten</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    host.querySelectorAll('.btn-edit').forEach((btn) => {
      btn.addEventListener('click', () => openForm(auftraege.find((a) => a.id === btn.dataset.id)));
    });
  }

  function kundenOptionen(ausgewaehlt) {
    return `<option value="">– kein Kunde zugeordnet –</option>` + kunden.map((k) => `<option value="${k.id}" ${k.id === ausgewaehlt ? 'selected' : ''}>${escapeHtml(k.firma || k.ansprechpartner || '(ohne Name)')}</option>`).join('');
  }
  function anlagenOptionen(kundeId, ausgewaehlt) {
    const gefiltert = kundeId ? anlagen.filter((a) => a.kundeId === kundeId) : [];
    return `<option value="">– keine Anlage zugeordnet –</option>` + gefiltert.map((a) => `<option value="${a.id}" ${a.id === ausgewaehlt ? 'selected' : ''}>${escapeHtml(a.bezeichnung)}</option>`).join('');
  }
  function technikerCheckboxen(ausgewaehlt) {
    if (techniker.length === 0) return '<p class="hint">Noch keine Mitarbeiter mit Zugriffsrolle "Techniker" angelegt.</p>';
    return techniker.map((t) => `
      <label class="field-checkbox" style="border:1px solid var(--border);border-radius:8px;padding:5px 10px;">
        <input type="checkbox" name="technikerIds" value="${t.id}" ${(ausgewaehlt || []).includes(t.id) ? 'checked' : ''}> ${escapeHtml(t.name)}
      </label>
    `).join('');
  }

  function openForm(auftrag) {
    const isEdit = !!auftrag;
    const data = auftrag || {
      id: uid(), externeAuftragsnummer: '', auftraggeber: '', kundeId: '', kundenname: '', telefonnummer: '', einsatzadresse: '',
      anlagenId: '', herstellerUndAnlagentyp: '', anlagenmodell: '', seriennummer: '', wartungsart: '',
      auftragsfrist: '', geplanteWartungsdauer: '', geplanterNettoumsatz: '', hinweise: '',
      technikerIds: [], status: 'offen', technikerNotizen: '',
    };
    const { body, close } = openModal({
      title: isEdit ? `Serviceauftrag ${data.externeAuftragsnummer || ''}` : 'Neuer Serviceauftrag',
      wide: true,
      bodyHtml: `
        <form id="sa-form">
          <div class="form-grid">
            <div class="field"><label>Externe Auftragsnummer *</label><input name="externeAuftragsnummer" required value="${escapeHtml(data.externeAuftragsnummer)}"></div>
            <div class="field"><label>Auftraggeber / Hersteller</label><input name="auftraggeber" value="${escapeHtml(data.auftraggeber || '')}" placeholder="z.B. Stiebel Eltron"></div>

            <div class="field"><label>Kunde (falls bereits in Werkora)</label>
              <select name="kundeId">${kundenOptionen(data.kundeId)}</select>
            </div>
            <div class="field"><label>Anlage (falls bereits in Werkora)</label>
              <select name="anlagenId">${anlagenOptionen(data.kundeId, data.anlagenId)}</select>
            </div>

            <div class="field"><label>Kundenname (frei, z.B. aus Herstellerportal)</label><input name="kundenname" value="${escapeHtml(data.kundenname || '')}"></div>
            <div class="field"><label>Telefonnummer</label><input name="telefonnummer" value="${escapeHtml(data.telefonnummer || '')}"></div>
            <div class="field col-span-2"><label>Einsatzadresse</label><input name="einsatzadresse" value="${escapeHtml(data.einsatzadresse || '')}"></div>

            <div class="field"><label>Hersteller &amp; Anlagentyp</label><input name="herstellerUndAnlagentyp" value="${escapeHtml(data.herstellerUndAnlagentyp || '')}" placeholder="z.B. Stiebel Eltron WPL 25"></div>
            <div class="field"><label>Anlagenmodell</label><input name="anlagenmodell" value="${escapeHtml(data.anlagenmodell || '')}"></div>
            <div class="field"><label>Seriennummer</label><input name="seriennummer" value="${escapeHtml(data.seriennummer || '')}"></div>
            <div class="field"><label>Wartungsart</label><input name="wartungsart" value="${escapeHtml(data.wartungsart || '')}" placeholder="z.B. Jahreswartung, Störung"></div>

            <div class="field"><label>Auftragsfrist</label><input type="date" name="auftragsfrist" value="${escapeHtml(data.auftragsfrist || '')}"></div>
            <div class="field"><label>Geplante Wartungsdauer (Std.)</label><input type="number" step="0.5" min="0" name="geplanteWartungsdauer" value="${escapeHtml(String(data.geplanteWartungsdauer ?? ''))}"></div>
            <div class="field"><label>Geplanter Nettoumsatz (EUR)</label><input type="number" step="0.01" min="0" name="geplanterNettoumsatz" value="${escapeHtml(String(data.geplanterNettoumsatz ?? ''))}"></div>
            <div class="field"><label>Status</label>
              <select name="status">${SERVICEAUFTRAG_STATUS.map((s) => `<option value="${s.id}" ${s.id === data.status ? 'selected' : ''}>${s.titel}</option>`).join('')}</select>
            </div>

            <div class="field col-span-2"><label>Techniker-Zuweisung</label>${technikerCheckboxen(data.technikerIds)}</div>
            <div class="field col-span-2"><label>Hinweise</label><textarea name="hinweise">${escapeHtml(data.hinweise || '')}</textarea></div>
            ${isEdit && data.technikerNotizen ? `<div class="field col-span-2"><label>Notizen des Technikers (nur lesend)</label><p class="hint">${escapeHtml(data.technikerNotizen)}</p></div>` : ''}
          </div>
          ${isEdit ? `
            <h3 style="margin-top:24px">Wartungsdokumentation</h3>
            <p class="hint">Wartungsprotokoll (Checkliste, Ja/Nein-Abschnitte, Unterschrift) aus Vorlage erzeugen, Fotos und Stundenzettel anhängen. Die mobile Techniker-Erfassung folgt in einer späteren Phase - bis dahin pflegt das Büro diesen Bereich.</p>
            <div id="dok-host"></div>
          ` : ''}
          <div class="modal-actions">
            <span class="spacer"></span>
            <button type="button" class="btn" id="sa-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">${isEdit ? 'Speichern' : 'Anlegen'}</button>
          </div>
        </form>
      `,
    });
    body.querySelector('#sa-cancel').addEventListener('click', close);
    body.querySelector('select[name="kundeId"]').addEventListener('change', (e) => {
      const sel = body.querySelector('select[name="anlagenId"]');
      sel.innerHTML = anlagenOptionen(e.target.value, '');
    });
    if (isEdit) {
      const technikerNamen = (data.technikerIds || []).map((id) => technikerById[id]?.name).filter(Boolean).join(', ');
      renderDokumenteSection(body.querySelector('#dok-host'), 'serviceauftrag', data.id, {
        kategorien: SERVICEAUFTRAG_DOKUMENT_KATEGORIEN, title: 'Dokumente',
        berichtContext: {
          settings, kunde: kundenById[data.kundeId] || null,
          projekt: data.externeAuftragsnummer || '', mitarbeiter: technikerNamen,
        },
      });
    }
    body.querySelector('#sa-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const externeAuftragsnummer = (fd.get('externeAuftragsnummer') || '').toString().trim();
      if (!externeAuftragsnummer) { toast('Externe Auftragsnummer ist Pflicht', 'error'); return; }

      const dublette = findeDublette(auftraege, externeAuftragsnummer, data.id);
      if (dublette && !confirm(`Es existiert bereits ein Serviceauftrag mit der Auftragsnummer "${externeAuftragsnummer}" (Status: ${STATUS_LABEL[dublette.status] || dublette.status}). Trotzdem speichern?`)) {
        return;
      }

      const updated = {
        ...data,
        externeAuftragsnummer,
        auftraggeber: (fd.get('auftraggeber') || '').toString().trim(),
        kundeId: (fd.get('kundeId') || '').toString(),
        anlagenId: (fd.get('anlagenId') || '').toString(),
        kundenname: (fd.get('kundenname') || '').toString().trim(),
        telefonnummer: (fd.get('telefonnummer') || '').toString().trim(),
        einsatzadresse: (fd.get('einsatzadresse') || '').toString().trim(),
        herstellerUndAnlagentyp: (fd.get('herstellerUndAnlagentyp') || '').toString().trim(),
        anlagenmodell: (fd.get('anlagenmodell') || '').toString().trim(),
        seriennummer: (fd.get('seriennummer') || '').toString().trim(),
        wartungsart: (fd.get('wartungsart') || '').toString().trim(),
        auftragsfrist: (fd.get('auftragsfrist') || '').toString(),
        geplanteWartungsdauer: fd.get('geplanteWartungsdauer') ? Number(fd.get('geplanteWartungsdauer')) : '',
        geplanterNettoumsatz: fd.get('geplanterNettoumsatz') ? Number(fd.get('geplanterNettoumsatz')) : '',
        status: (fd.get('status') || 'offen').toString(),
        technikerIds: fd.getAll('technikerIds').map((v) => v.toString()),
        hinweise: (fd.get('hinweise') || '').toString().trim(),
        erstelltAm: data.erstelltAm || new Date().toISOString(),
        aktualisiertAm: new Date().toISOString(),
      };
      await put('serviceauftraege', updated);
      const idx = auftraege.findIndex((a) => a.id === updated.id);
      if (idx === -1) auftraege.unshift(updated); else auftraege[idx] = updated;
      toast(isEdit ? 'Serviceauftrag gespeichert' : 'Serviceauftrag angelegt', 'success');
      close();
      renderListe();
    });
  }

  container.querySelector('#btn-new').addEventListener('click', () => openForm());
  renderListe();
}
