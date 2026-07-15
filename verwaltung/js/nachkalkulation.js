import { put, KALK_KATEGORIEN } from './db.js';
import { escapeHtml, formatCurrency, toast } from './utils.js';

function istWerte(projekt, ausgaben, zeiterfassung, mitarbeiterById, settings) {
  const werte = { material: 0, lohn: 0, fremdleistung: 0, geraete: 0, sonstige: 0 };
  for (const a of ausgaben) {
    if (a.projektId !== projekt.id || !a.kalkKategorie) continue;
    werte[a.kalkKategorie] = (werte[a.kalkKategorie] || 0) + (Number(a.betragNetto) || 0);
  }
  for (const z of zeiterfassung) {
    if (z.projektId !== projekt.id) continue;
    const satz = Number(mitarbeiterById[z.mitarbeiterId]?.stundenlohn) || Number(settings.stundensatz) || 0;
    werte.lohn += ((Number(z.dauerMinuten) || 0) / 60) * satz;
  }
  return werte;
}

/**
 * Renders the Soll/Ist Nachkalkulation for a Projekt: cost bars per category
 * plus Rohgewinn/Marge, computed from Ausgaben (kalkKategorie) and Zeiterfassung.
 */
export function renderNachkalkulation(host, { projekt, ausgaben, zeiterfassung, rechnungen, mitarbeiter, settings, onSaved }) {
  const mitarbeiterById = Object.fromEntries(mitarbeiter.map((m) => [m.id, m]));
  const plan = projekt.kalkulation || {};
  let editing = false;

  function render() {
    const ist = istWerte(projekt, ausgaben, zeiterfassung, mitarbeiterById, settings);
    const erloes = rechnungen.filter((r) => r.projektId === projekt.id).reduce((s, r) => s + (Number(r.netto) || 0), 0);
    const summeIst = Object.values(ist).reduce((s, v) => s + v, 0);
    const rohgewinn = erloes - summeIst;
    const marge = erloes > 0 ? (rohgewinn / erloes) * 100 : null;

    host.innerHTML = `
      <div class="flex-row" style="justify-content:space-between;margin-bottom:10px;flex-wrap:wrap">
        <h2 style="font-size:14px;margin:0">Nachkalkulation</h2>
        <button type="button" class="btn btn-sm" id="nk-btn-edit">${editing ? 'Fertig' : '✎ Plan bearbeiten'}</button>
      </div>
      <div class="nk-bars">
        ${KALK_KATEGORIEN.map((k) => {
          const istV = ist[k.id] || 0;
          const planV = Number(plan[k.id]) || 0;
          const pct = planV > 0 ? Math.min(100, (istV / planV) * 100) : (istV > 0 ? 100 : 0);
          const over = planV > 0 && istV > planV;
          return `
            <div class="nk-row">
              <div class="nk-label">${escapeHtml(k.titel)}</div>
              <div class="nk-track"><div class="nk-fill ${over ? 'over' : ''}" style="width:${pct}%;background:${k.farbe}"></div></div>
              ${editing
                ? `<input type="number" step="0.01" min="0" class="nk-plan-input" data-kat="${k.id}" value="${planV}">`
                : `<div class="nk-value">${formatCurrency(istV)} / ${formatCurrency(planV)}</div>`}
            </div>
          `;
        }).join('')}
      </div>
      <div class="nk-summary">
        <div><span class="text-mute">Erlös (netto, aus Rechnungen)</span><strong>${formatCurrency(erloes)}</strong></div>
        <div><span class="text-mute">Kosten gesamt (Ist)</span><strong>${formatCurrency(summeIst)}</strong></div>
        <div class="${rohgewinn >= 0 ? 'nk-pos' : 'nk-neg'}"><span class="text-mute">Rohgewinn</span><strong>${formatCurrency(rohgewinn)}</strong></div>
        <div class="${rohgewinn >= 0 ? 'nk-pos' : 'nk-neg'}"><span class="text-mute">Marge</span><strong>${marge === null ? '–' : marge.toFixed(1) + '%'}</strong></div>
      </div>
      ${editing ? '<button type="button" class="btn btn-primary btn-sm" id="nk-btn-save" style="margin-top:10px">Plan speichern</button>' : ''}
      <p class="hint">Lohn wird automatisch aus der Zeiterfassung berechnet (Std. × Stundenlohn/-satz). Material, Fremdleistungen, Geräte und Sonstige stammen aus Ausgaben, die diesem Projekt zugeordnet sind.</p>
    `;

    host.querySelector('#nk-btn-edit').addEventListener('click', () => {
      editing = !editing;
      render();
    });
    const saveBtn = host.querySelector('#nk-btn-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const newPlan = { ...plan };
        host.querySelectorAll('.nk-plan-input').forEach((inp) => {
          newPlan[inp.dataset.kat] = Number(inp.value) || 0;
        });
        projekt.kalkulation = newPlan;
        await put('projekte', projekt);
        Object.assign(plan, newPlan);
        editing = false;
        toast('Kalkulation gespeichert', 'success');
        render();
        if (onSaved) onSaved();
      });
    }
  }

  render();
}
