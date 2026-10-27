import { getAll, put, remove, BENEFIT_TYPEN } from '../db.js';
import { uid, escapeHtml, toast, formatDate, formatCurrency } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import { getSession } from '../auth.js';
import { berechneGesamtkosten } from '../mitarbeiterkosten.js';

// Service-/Techniker-/Personalverwaltung Phase 10-13: Mitarbeiter-Benefits,
// versionierte steuerliche Benefit-Regeln (reine Referenz, siehe unten),
// Benefits-Verwaltung und Gesamtkosten pro Mitarbeiter.
//
// Bewusst admin/büro-only (siehe ROUTE_ROLLEN.benefits/firestore.rules
// match /mitarbeiterBenefits/{docId} + /benefitSteuerregeln/{docId}) - genau
// wie die bestehende "Lohnvorbereitung" und die Performance-/Bonus-
// Simulation keine Selbstauskunft für mitarbeiter/techniker innerhalb der
// Hauptanwendung (vermeidet zugleich die dokumentgebundene
// Leseregel-Scoping-Falle, siehe Kommentar in views/reisekosten.js).
//
// WICHTIG: Die Steuerregeln-Tabelle ist reine ADMIN-GEPFLEGTE REFERENZ zum
// Nachschlagen neben jedem Benefit (z.B. "Sachbezugsfreigrenze 50€/Monat,
// §8 Abs. 2 Satz 11 EStG") - sie fließt NICHT automatisch in die
// Gesamtkosten-Berechnung ein (siehe Kopfkommentar in
// verwaltung/js/mitarbeiterkosten.js: keine erfundenen/pauschalierten
// steuer- oder sozialversicherungsrechtlichen Berechnungen). Es gibt dafür
// absichtlich KEINEN Seed-Datensatz, anders als die Reisekostensätze - die
// steuerliche Behandlung variiert zu stark nach Gestaltung (z.B.
// Gehaltsumwandlung vs. zusätzlich zum Lohn), um einen einzelnen
// "Standardwert" ohne Fehlinterpretationsrisiko vorzubelegen.

const BENEFIT_TITEL = Object.fromEntries(BENEFIT_TYPEN.map((b) => [b.id, b.titel]));
const MONATSNAMEN = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export async function render(container) {
  const session = getSession() || {};
  const istAdmin = session.role === 'admin';
  const heute = new Date();
  let [benefits, mitarbeiter, steuerregeln, zeiterfassung, reisekostenabrechnungen, reisekostensaetze] = await Promise.all([
    getAll('mitarbeiterBenefits'), getAll('mitarbeiter'), getAll('benefitSteuerregeln'),
    getAll('zeiterfassung'), getAll('reisekostenabrechnungen'), getAll('reisekostensaetze'),
  ]);
  steuerregeln.sort((a, b) => (b.gueltigAb || '').localeCompare(a.gueltigAb || ''));
  const mitarbeiterById = Object.fromEntries(mitarbeiter.map((m) => [m.id, m]));
  const aktiveMitarbeiter = mitarbeiter.filter((m) => !m.austrittsdatum || m.austrittsdatum >= heute.toISOString().slice(0, 10));

  let monat = heute.getMonth() + 1;
  let jahr = heute.getFullYear();

  container.innerHTML = `
    <div class="view-header">
      <h1>Mitarbeiter-Benefits &amp; Gesamtkosten</h1>
      <div class="actions">
        <button class="btn btn-primary" id="btn-new-benefit">+ Benefit zuweisen</button>
        ${istAdmin ? '<button class="btn btn-sm" id="btn-steuerregeln">Steuerregeln verwalten</button>' : ''}
      </div>
    </div>
    <div class="card card-hinweis" style="margin-bottom:10px">
      <p class="mb-0">⚠️ <strong>Reine Orientierungshilfe, keine Lohnbuchhaltung.</strong> Die Gesamtkosten-Übersicht enthält Grundvergütung, tatsächliche Benefit-Arbeitgeberkosten und genehmigte Reisekosten – <strong>ohne</strong> gesetzliche Lohnnebenkosten (Arbeitgeberanteile Sozialversicherung), da sich deren Sätze jährlich ändern und hier nicht pauschaliert werden. Die Steuerregeln-Tabelle ist eine reine Nachschlagehilfe und fließt nicht automatisch in eine Berechnung ein. Vor Verwendung in einer echten Kalkulation oder Gehaltsabrechnung ist eine Prüfung durch Lohnbüro/Steuerberater erforderlich – keine automatische Auszahlung, keine rechtliche Bindung.</p>
    </div>
    <div id="steuerregeln-host"></div>
    <h3>Zugewiesene Benefits</h3>
    <div id="benefits-host"></div>
    <h3 style="margin-top:20px">Gesamtkosten pro Mitarbeiter</h3>
    <div class="flex-row" style="gap:10px;margin-bottom:10px">
      <select id="gk-monat">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${i + 1 === monat ? 'selected' : ''}>${MONATSNAMEN[i]}</option>`).join('')}</select>
      <select id="gk-jahr">${[jahr, jahr - 1].map((j) => `<option value="${j}">${j}</option>`).join('')}</select>
    </div>
    <div id="gesamtkosten-host"></div>
  `;

  function renderSteuerregeln() {
    const host = container.querySelector('#steuerregeln-host');
    if (!host) return;
    if (steuerregeln.length === 0) {
      host.innerHTML = '<p class="hint">Noch keine Steuerregel hinterlegt.</p>';
      return;
    }
    host.innerHTML = `
      <h3 style="margin-top:8px">Steuerregeln (Nachschlagehilfe, keine automatische Berechnung)</h3>
      <table class="data-table" style="max-width:900px">
        <thead><tr><th>Benefit-Art</th><th>Regel</th><th>Gültig ab</th><th>Gültig bis</th><th>Quelle</th></tr></thead>
        <tbody>${steuerregeln.map((r) => `
          <tr>
            <td>${escapeHtml(BENEFIT_TITEL[r.benefitTyp] || r.benefitTyp)}</td>
            <td>${escapeHtml(r.regelBeschreibung || '')}</td>
            <td>${formatDate(r.gueltigAb)}</td>
            <td>${r.gueltigBis ? formatDate(r.gueltigBis) : 'bis auf Weiteres'}</td>
            <td>${escapeHtml(r.quelle || '')}</td>
          </tr>
        `).join('')}</tbody>
      </table>
    `;
  }

  function renderBenefits() {
    const host = container.querySelector('#benefits-host');
    if (benefits.length === 0) { host.innerHTML = '<div class="empty-state">Noch keine Benefits zugewiesen.</div>'; return; }
    const sortiert = [...benefits].sort((a, b) => (mitarbeiterById[a.mitarbeiterId]?.name || '').localeCompare(mitarbeiterById[b.mitarbeiterId]?.name || ''));
    host.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Mitarbeiter</th><th>Benefit</th><th>Bezeichnung</th><th class="text-right">AG-Kosten/Monat</th><th>Zeitraum</th><th></th></tr></thead>
        <tbody>${sortiert.map((b) => `
          <tr data-id="${b.id}">
            <td>${escapeHtml(mitarbeiterById[b.mitarbeiterId]?.name || b.mitarbeiterId || '–')}</td>
            <td>${escapeHtml(BENEFIT_TITEL[b.benefitTyp] || b.benefitTyp)}</td>
            <td>${escapeHtml(b.bezeichnung || '')}</td>
            <td class="text-right">${formatCurrency(b.arbeitgeberKostenMonatlich)}</td>
            <td>${formatDate(b.beginnDatum)}${b.endeDatum ? ` – ${formatDate(b.endeDatum)}` : ' – laufend'}</td>
            <td>
              <button type="button" class="btn btn-sm btn-edit" data-id="${b.id}">Bearbeiten</button>
              <button type="button" class="btn btn-sm btn-danger btn-delete" data-id="${b.id}">Löschen</button>
            </td>
          </tr>
        `).join('')}</tbody>
      </table>
    `;
    host.querySelectorAll('.btn-edit').forEach((btn) => btn.addEventListener('click', () => openBenefitForm(benefits.find((b) => b.id === btn.dataset.id))));
    host.querySelectorAll('.btn-delete').forEach((btn) => btn.addEventListener('click', async () => {
      if (!confirmDelete('Diesen Benefit wirklich löschen?')) return;
      await remove('mitarbeiterBenefits', btn.dataset.id);
      benefits = benefits.filter((b) => b.id !== btn.dataset.id);
      toast('Gelöscht', 'success');
      renderBenefits();
      renderGesamtkosten();
    }));
  }

  function renderGesamtkosten() {
    const host = container.querySelector('#gesamtkosten-host');
    const monatStart = `${jahr}-${String(monat).padStart(2, '0')}-01`;
    const letzterTag = new Date(jahr, monat, 0).getDate();
    const monatEnde = `${jahr}-${String(monat).padStart(2, '0')}-${String(letzterTag).padStart(2, '0')}`;
    const zeilen = aktiveMitarbeiter
      .map((m) => ({ m, k: berechneGesamtkosten(m, monatStart, monatEnde, { zeiterfassung, benefits, reisekostenabrechnungen, reisekostensaetze }) }))
      .filter(({ k }) => k.gesamt > 0);
    if (zeilen.length === 0) { host.innerHTML = '<div class="empty-state">Keine Daten für diesen Zeitraum.</div>'; return; }
    host.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Mitarbeiter</th><th class="text-right">Grundvergütung</th><th class="text-right">Benefit-Kosten</th><th class="text-right">Reisekosten (genehmigt)</th><th class="text-right">Gesamt</th></tr></thead>
        <tbody>${zeilen.map(({ m, k }) => `
          <tr>
            <td>${escapeHtml(m.name)}</td>
            <td class="text-right">${formatCurrency(k.grundverguetung)}</td>
            <td class="text-right">${formatCurrency(k.benefitKosten)}</td>
            <td class="text-right">${formatCurrency(k.reisekosten)}</td>
            <td class="text-right"><strong>${formatCurrency(k.gesamt)}</strong></td>
          </tr>
        `).join('')}</tbody>
      </table>
      <p class="hint">Ohne gesetzliche Lohnnebenkosten (Arbeitgeberanteile Sozialversicherung) – siehe Hinweis oben.</p>
    `;
  }

  container.querySelector('#btn-new-benefit').addEventListener('click', () => openBenefitForm());
  container.querySelector('#gk-monat').addEventListener('change', (e) => { monat = Number(e.target.value); renderGesamtkosten(); });
  container.querySelector('#gk-jahr').addEventListener('change', (e) => { jahr = Number(e.target.value); renderGesamtkosten(); });
  if (istAdmin) container.querySelector('#btn-steuerregeln').addEventListener('click', () => openSteuerregelForm());
  renderSteuerregeln();
  renderBenefits();
  renderGesamtkosten();

  function openBenefitForm(vorhanden) {
    const isEdit = !!vorhanden;
    const data = vorhanden || { id: uid(), mitarbeiterId: '', benefitTyp: BENEFIT_TYPEN[0].id, bezeichnung: '', arbeitgeberKostenMonatlich: '', beginnDatum: '', endeDatum: '', notiz: '' };
    const { body, close } = openModal({
      title: isEdit ? 'Benefit bearbeiten' : 'Benefit zuweisen',
      bodyHtml: `
        <form id="benefit-form">
          <div class="form-grid">
            <div class="field col-span-2"><label>Mitarbeiter *</label>
              <select name="mitarbeiterId" required ${isEdit ? 'disabled' : ''}>
                <option value="">– auswählen –</option>
                ${mitarbeiter.map((m) => `<option value="${m.id}" ${m.id === data.mitarbeiterId ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}
              </select>
            </div>
            <div class="field col-span-2"><label>Benefit-Art *</label>
              <select name="benefitTyp" required>
                ${BENEFIT_TYPEN.map((b) => `<option value="${b.id}" ${b.id === data.benefitTyp ? 'selected' : ''}>${escapeHtml(b.titel)}</option>`).join('')}
              </select>
            </div>
            <div class="field col-span-2"><label>Bezeichnung</label><input name="bezeichnung" value="${escapeHtml(data.bezeichnung || '')}" placeholder="z.B. Trek FX 3, Leasingrate"></div>
            <div class="field"><label>Arbeitgeberkosten/Monat (EUR) *</label><input type="number" step="0.01" min="0" name="arbeitgeberKostenMonatlich" required value="${escapeHtml(String(data.arbeitgeberKostenMonatlich ?? ''))}"></div>
            <div class="field"><label>Beginn *</label><input type="date" name="beginnDatum" required value="${escapeHtml(data.beginnDatum || '')}"></div>
            <div class="field col-span-2"><label>Ende (leer = laufend)</label><input type="date" name="endeDatum" value="${escapeHtml(data.endeDatum || '')}"></div>
            <div class="field col-span-2"><label>Notiz</label><textarea name="notiz">${escapeHtml(data.notiz || '')}</textarea></div>
          </div>
          <div class="modal-actions">
            <span class="spacer"></span>
            <button type="button" class="btn" id="benefit-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">${isEdit ? 'Speichern' : 'Zuweisen'}</button>
          </div>
        </form>
      `,
    });
    body.querySelector('#benefit-cancel').addEventListener('click', close);
    body.querySelector('#benefit-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const mitarbeiterId = isEdit ? data.mitarbeiterId : (fd.get('mitarbeiterId') || '').toString();
      if (!mitarbeiterId) { toast('Bitte einen Mitarbeiter auswählen', 'error'); return; }
      const updated = {
        ...data, mitarbeiterId,
        benefitTyp: (fd.get('benefitTyp') || '').toString(),
        bezeichnung: (fd.get('bezeichnung') || '').toString().trim(),
        arbeitgeberKostenMonatlich: Number(fd.get('arbeitgeberKostenMonatlich')) || 0,
        beginnDatum: (fd.get('beginnDatum') || '').toString(),
        endeDatum: (fd.get('endeDatum') || '').toString(),
        notiz: (fd.get('notiz') || '').toString().trim(),
      };
      await put('mitarbeiterBenefits', updated);
      const idx = benefits.findIndex((b) => b.id === updated.id);
      if (idx === -1) benefits.unshift(updated); else benefits[idx] = updated;
      toast(isEdit ? 'Gespeichert' : 'Benefit zugewiesen', 'success');
      close();
      renderBenefits();
      renderGesamtkosten();
    });
  }

  function openSteuerregelForm() {
    const { body, close } = openModal({
      title: 'Neue Steuerregel anlegen',
      bodyHtml: `
        <form id="sr-form">
          <p class="hint">Reine Nachschlagehilfe neben der jeweiligen Benefit-Art - KEINE automatische Berechnung. Die Begründung/Quelle ist Pflicht (z.B. Gesetzesparagraph, BMF-Schreiben) - niemals eine erfundene Regel eintragen.</p>
          <div class="form-grid">
            <div class="field col-span-2"><label>Benefit-Art *</label>
              <select name="benefitTyp" required>
                ${BENEFIT_TYPEN.map((b) => `<option value="${b.id}">${escapeHtml(b.titel)}</option>`).join('')}
              </select>
            </div>
            <div class="field col-span-2"><label>Regel (kurz) *</label><input name="regelBeschreibung" required placeholder="z.B. Sachbezugsfreigrenze 50 EUR/Monat"></div>
            <div class="field"><label>Gültig ab *</label><input type="date" name="gueltigAb" required></div>
            <div class="field"><label>Gültig bis (leer = bis auf Weiteres)</label><input type="date" name="gueltigBis"></div>
            <div class="field col-span-2"><label>Quelle/Begründung *</label><textarea name="quelle" required placeholder="z.B. §8 Abs. 2 Satz 11 EStG"></textarea></div>
          </div>
          <div class="modal-actions">
            <span class="spacer"></span>
            <button type="button" class="btn" id="sr-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Anlegen</button>
          </div>
        </form>
      `,
    });
    body.querySelector('#sr-cancel').addEventListener('click', close);
    body.querySelector('#sr-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const neu = {
        id: uid(), benefitTyp: (fd.get('benefitTyp') || '').toString(),
        regelBeschreibung: (fd.get('regelBeschreibung') || '').toString().trim(),
        gueltigAb: (fd.get('gueltigAb') || '').toString(), gueltigBis: (fd.get('gueltigBis') || '').toString(),
        quelle: (fd.get('quelle') || '').toString().trim(),
      };
      if (!neu.gueltigAb) return;
      await put('benefitSteuerregeln', neu);
      steuerregeln.unshift(neu);
      steuerregeln.sort((a, b) => (b.gueltigAb || '').localeCompare(a.gueltigAb || ''));
      toast('Steuerregel angelegt', 'success');
      close();
      renderSteuerregeln();
    });
  }
}
