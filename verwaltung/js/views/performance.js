import { getAll, put } from '../db.js';
import { uid, escapeHtml, toast, formatCurrency } from '../utils.js';
import { openModal } from '../ui.js';
import { getSession } from '../auth.js';
import { PERFORMANCE_KENNZAHLEN, berechneKennzahlen, berechneBonusSimulation } from '../performance.js';

// Service-/Techniker-/Personalverwaltung Phase 8 - Performance- und
// Bonus-Simulation. WICHTIG - reine Simulation (siehe Kopfkommentar in
// verwaltung/js/performance.js): "Der Referenzwert ist noch nicht
// festgelegt" laut Spezifikation - es gibt KEINEN von dieser Entwicklung
// erfundenen Schwellenwert. Kennzahlen werden immer aus echten Daten
// berechnet; ein simulierter Bonus erscheint NUR, wenn admin selbst einen
// Referenzwert hinterlegt hat. Keine automatische Auszahlung, keine
// Lohnwirkung - vor Umsetzung ist eine Freigabe durch Geschäftsführung/
// Lohnbüro erforderlich.
//
// Bewusst admin/büro-only (siehe ROUTE_ROLLEN.performance/firestore.rules
// match /bonusreferenzwerte/{docId}), analog zur bestehenden
// "Lohnvorbereitung" in mitarbeiter.js - keine Selbstauskunft für
// mitarbeiter/techniker innerhalb der Hauptanwendung, und damit auch keine
// neue dokumentgebundene Leseregel/Scoping-Falle nötig (siehe Kommentar in
// views/reisekosten.js).

const KENNZAHL_LABEL = Object.fromEntries(PERFORMANCE_KENNZAHLEN.map((k) => [k.id, k]));
const MONATSNAMEN = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export async function render(container) {
  const session = getSession() || {};
  const istAdmin = session.role === 'admin';
  const heute = new Date();
  let [serviceauftraege, zeiterfassung, mitarbeiter, referenzwerte] = await Promise.all([
    getAll('serviceauftraege'), getAll('zeiterfassung'), getAll('mitarbeiter'), getAll('bonusreferenzwerte'),
  ]);
  referenzwerte.sort((a, b) => (b.gueltigAb || '').localeCompare(a.gueltigAb || ''));
  // Kennzahlen gelten für Techniker UND Mitarbeiter, die Serviceaufträge
  // übernehmen können (technikerIds ist nicht auf die Rolle "techniker"
  // beschränkt - auch ein normaler Mitarbeiter kann dort eingetragen sein).
  const relevanteMitarbeiter = mitarbeiter.filter((m) => !m.austrittsdatum || m.austrittsdatum >= heute.toISOString().slice(0, 10));

  let monat = heute.getMonth() + 1;
  let jahr = heute.getFullYear();

  container.innerHTML = `
    <div class="view-header">
      <h1>Performance &amp; Bonus-Simulation</h1>
      <div class="actions">
        ${istAdmin ? '<button class="btn btn-sm" id="btn-referenzwerte">Referenzwerte verwalten</button>' : ''}
      </div>
    </div>
    <div class="card" style="background:#fff6e0;border-color:#f0d78c;margin-bottom:10px">
      <p class="mb-0">⚠️ <strong>Reine Simulation, keine Bewertung und keine Auszahlung.</strong> Die Kennzahlen stammen aus bereits vorhandenen Serviceauftrags- und Zeiterfassungsdaten. Ein simulierter Bonusbetrag erscheint nur, wenn ein Referenzwert unten hinterlegt wurde – ohne Referenzwert wird <strong>kein</strong> Schwellenwert angenommen. Referenzwerte sind eine interne Arbeitsgrundlage ohne rechtliche Bindung und ohne Auszahlungswirkung; eine Umsetzung in echte Vergütung erfordert eine Freigabe durch Geschäftsführung und ggf. Lohnbüro/Steuerberater.</p>
    </div>
    <div class="flex-row" style="gap:10px;margin-bottom:10px">
      <select id="pf-monat">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${i + 1 === monat ? 'selected' : ''}>${MONATSNAMEN[i]}</option>`).join('')}</select>
      <select id="pf-jahr">${[jahr, jahr - 1].map((j) => `<option value="${j}">${j}</option>`).join('')}</select>
    </div>
    <div id="referenzwerte-host"></div>
    <div id="kennzahlen-host"></div>
  `;

  function renderReferenzwerte() {
    const host = container.querySelector('#referenzwerte-host');
    if (!host) return;
    if (referenzwerte.length === 0) {
      host.innerHTML = '<p class="hint">Noch kein Referenzwert hinterlegt – unten werden nur die Kennzahlen angezeigt, keine Bonus-Simulation.</p>';
      return;
    }
    host.innerHTML = `
      <h3 style="margin-top:8px">Referenzwerte</h3>
      <table class="data-table" style="max-width:760px">
        <thead><tr><th>Kennzahl</th><th>Schwellenwert</th><th>Bonus</th><th>Gültig ab</th><th>Gültig bis</th><th>Begründung</th></tr></thead>
        <tbody>${referenzwerte.map((r) => `
          <tr>
            <td>${escapeHtml(KENNZAHL_LABEL[r.kennzahl]?.titel || r.kennzahl)}</td>
            <td>${r.schwellenwert}${escapeHtml(KENNZAHL_LABEL[r.kennzahl]?.einheit ? ` ${KENNZAHL_LABEL[r.kennzahl].einheit}` : '')}</td>
            <td>${formatCurrency(r.bonusBetrag)}</td>
            <td>${escapeHtml(r.gueltigAb || '')}</td>
            <td>${r.gueltigBis ? escapeHtml(r.gueltigBis) : 'bis auf Weiteres'}</td>
            <td>${escapeHtml(r.quelle || '')}</td>
          </tr>
        `).join('')}</tbody>
      </table>
    `;
  }

  function renderKennzahlen() {
    const host = container.querySelector('#kennzahlen-host');
    const monatStart = `${jahr}-${String(monat).padStart(2, '0')}-01`;
    const letzterTag = new Date(jahr, monat, 0).getDate();
    const monatEnde = `${jahr}-${String(monat).padStart(2, '0')}-${String(letzterTag).padStart(2, '0')}`;
    const stichtag = heute.toISOString().slice(0, 10) < monatEnde ? heute.toISOString().slice(0, 10) : monatEnde;

    const zeilen = relevanteMitarbeiter.map((m) => {
      const kennzahlen = berechneKennzahlen(m.id, monatStart, monatEnde, serviceauftraege, zeiterfassung);
      const simulation = berechneBonusSimulation(kennzahlen, referenzwerte, stichtag);
      return { m, kennzahlen, simulation };
    }).filter(({ kennzahlen }) => kennzahlen.abgeschlosseneAuftraege > 0 || kennzahlen.istStunden > 0 || kennzahlen.offenUeberfaellig > 0);

    if (zeilen.length === 0) { host.innerHTML = '<div class="empty-state">Keine Daten für diesen Zeitraum.</div>'; return; }

    host.innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>Mitarbeiter</th><th class="text-right">Abgeschlossene Aufträge</th>
          <th class="text-right">Pünktlichkeit</th><th class="text-right">Offen &amp; überfällig</th>
          <th class="text-right">Ist-Std.</th><th class="text-right">Bonus-Simulation</th>
        </tr></thead>
        <tbody>
          ${zeilen.map(({ m, kennzahlen, simulation }) => `
            <tr>
              <td>${escapeHtml(m.name)}</td>
              <td class="text-right">${kennzahlen.abgeschlosseneAuftraege}</td>
              <td class="text-right">${kennzahlen.puenktlichkeitQuote == null ? '–' : `${kennzahlen.puenktlichkeitQuote}%`}</td>
              <td class="text-right">${kennzahlen.offenUeberfaellig > 0 ? `<span class="badge badge-danger">${kennzahlen.offenUeberfaellig}</span>` : '0'}</td>
              <td class="text-right">${kennzahlen.istStunden}</td>
              <td class="text-right">
                ${simulation.bonusBetrag > 0 ? `<strong>${formatCurrency(simulation.bonusBetrag)}</strong>` : '<span class="text-mute">0 €</span>'}
                <div class="hint" style="margin:0">${escapeHtml(simulation.hinweis || '')}</div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  container.querySelector('#pf-monat').addEventListener('change', (e) => { monat = Number(e.target.value); renderKennzahlen(); });
  container.querySelector('#pf-jahr').addEventListener('change', (e) => { jahr = Number(e.target.value); renderKennzahlen(); });
  if (istAdmin) container.querySelector('#btn-referenzwerte').addEventListener('click', () => openReferenzwertForm());
  renderReferenzwerte();
  renderKennzahlen();

  function openReferenzwertForm() {
    const { body, close } = openModal({
      title: 'Neuen Bonus-Referenzwert anlegen',
      bodyHtml: `
        <form id="rw-form">
          <p class="hint">Ein neuer Referenzwert gilt ab dem gewählten Datum "bis auf Weiteres". Frühere Zeiträume bleiben unverändert ohne diesen Referenzwert bewertet (keine rückwirkende Änderung).</p>
          <div class="form-grid">
            <div class="field col-span-2"><label>Kennzahl *</label>
              <select name="kennzahl" required>
                ${PERFORMANCE_KENNZAHLEN.map((k) => `<option value="${k.id}">${escapeHtml(k.titel)} (${escapeHtml(k.einheit)})</option>`).join('')}
              </select>
            </div>
            <div class="field"><label>Schwellenwert *</label><input type="number" step="0.1" min="0" name="schwellenwert" required></div>
            <div class="field"><label>Bonus bei Erreichen (EUR) *</label><input type="number" step="0.01" min="0" name="bonusBetrag" required></div>
            <div class="field"><label>Gültig ab *</label><input type="date" name="gueltigAb" required></div>
            <div class="field col-span-2"><label>Begründung / beschlossen von *</label><textarea name="quelle" required placeholder="z.B. Geschäftsführungsentscheidung vom ..., Grundlage, Ansprechpartner"></textarea></div>
          </div>
          <div class="modal-actions">
            <span class="spacer"></span>
            <button type="button" class="btn" id="rw-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Anlegen</button>
          </div>
        </form>
      `,
    });
    body.querySelector('#rw-cancel').addEventListener('click', close);
    body.querySelector('#rw-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const gueltigAb = (fd.get('gueltigAb') || '').toString();
      if (!gueltigAb) return;
      // Ein vorheriger, noch offen gültiger Referenzwert für DIESELBE
      // Kennzahl wird zum Vortag begrenzt - analog zum Reisekostensatz-Muster
      // in views/reisekosten.js (verhindert zwei gleichzeitig offen gültige
      // Referenzwerte für dieselbe Kennzahl).
      const kennzahl = (fd.get('kennzahl') || '').toString();
      const vorheriger = referenzwerte.find((r) => r.kennzahl === kennzahl && !r.gueltigBis && r.gueltigAb < gueltigAb);
      if (vorheriger) {
        const vortag = new Date(new Date(`${gueltigAb}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
        const begrenzt = { ...vorheriger, gueltigBis: vortag };
        await put('bonusreferenzwerte', begrenzt);
        Object.assign(vorheriger, begrenzt);
      }
      const neu = {
        id: uid(), kennzahl, gueltigAb, gueltigBis: '',
        schwellenwert: Number(fd.get('schwellenwert')), bonusBetrag: Number(fd.get('bonusBetrag')),
        quelle: (fd.get('quelle') || '').toString().trim(),
      };
      await put('bonusreferenzwerte', neu);
      referenzwerte.unshift(neu);
      referenzwerte.sort((a, b) => (b.gueltigAb || '').localeCompare(a.gueltigAb || ''));
      toast('Referenzwert angelegt (reine Simulationsgrundlage, keine Auszahlung)', 'success');
      close();
      renderReferenzwerte();
      renderKennzahlen();
    });
  }
}
