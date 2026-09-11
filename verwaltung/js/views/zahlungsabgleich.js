import { getAll, put, getSettings } from '../db.js';
import { escapeHtml, formatCurrency, formatDate, toast } from '../utils.js';
import { holeQontoTransaktionen } from '../qonto.js';
import * as journal from '../journal.js';

/**
 * Gleicht eingehende Qonto-Kontobewegungen mit offenen Rechnungen ab.
 * Bucht NIE automatisch - jeder Treffer muss hier bestätigt werden, bevor
 * eine Rechnung als bezahlt markiert wird (siehe cloudflare-worker-qonto-sync/README.md).
 * Der Worker liefert nur die rohen Transaktionen; der Abgleich selbst läuft
 * hier im Browser, damit das Markieren als "bezahlt" über die normale,
 * bereits mit Firestore-Security-Rules abgesicherte App-Anmeldung läuft.
 */
export async function render(container) {
  let [settings, rechnungen, kunden, abgleiche] = await Promise.all([
    getSettings(), getAll('rechnungen'), getAll('kunden'), getAll('zahlungsabgleich'),
  ]);
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));
  const rechnungenById = Object.fromEntries(rechnungen.map((r) => [r.id, r]));
  const offenNichtStorniert = (r) => (r.status === 'offen' || r.status === 'teilbezahlt');
  // Betrag, den der Kunde bei Ausnutzung des angebotenen Skontos tatsächlich
  // überweist - eine Zahlung, die exakt auf diesen (kleineren) Betrag statt
  // auf den vollen Rechnungsbetrag lautet, ist ebenfalls ein gültiger Treffer.
  const betragBeiSkonto = (r) => (r.skontoProzent > 0 ? r.brutto - Math.round(r.brutto * r.skontoProzent) / 100 : null);

  function renderList() {
    const offen = abgleiche.filter((a) => a.status === 'offen').sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));
    const erledigt = abgleiche.filter((a) => a.status !== 'offen').sort((a, b) => (b.erledigtAm || '').localeCompare(a.erledigtAm || '')).slice(0, 20);

    const offeneRechnungenOptions = (kandidatenIds) => rechnungen
      .filter(offenNichtStorniert)
      .sort((a, b) => (kandidatenIds.includes(b.id) ? 1 : 0) - (kandidatenIds.includes(a.id) ? 1 : 0))
      .map((r) => {
        const skontoBetrag = betragBeiSkonto(r);
        const betragText = skontoBetrag != null ? `${formatCurrency(r.brutto)} (bei Skonto: ${formatCurrency(skontoBetrag)})` : formatCurrency(r.brutto);
        return `<option value="${r.id}" ${kandidatenIds.includes(r.id) ? 'selected' : ''}>${escapeHtml(r.nummer)} · ${escapeHtml(kundenById[r.kundeId]?.firma || '– kein Kunde –')} · ${betragText}</option>`;
      })
      .join('');

    container.querySelector('#zag-liste').innerHTML = offen.length === 0
      ? '<p class="empty-state">Keine offenen Zahlungsvorschläge. Klick auf "Jetzt synchronisieren", um neue Kontobewegungen abzurufen.</p>'
      : offen.map((a) => `
        <div class="card" style="margin-bottom:10px;padding:12px" data-id="${a.id}">
          <div class="flex-row" style="justify-content:space-between;align-items:flex-start">
            <div>
              <strong>${formatCurrency(a.betrag)}</strong> am ${formatDate(a.datum)}<br>
              <span class="text-mute">${escapeHtml(a.gegenpart || '– kein Absendername –')}${a.referenz ? ' · ' + escapeHtml(a.referenz) : ''}</span>
            </div>
          </div>
          <div class="form-grid" style="margin-top:8px">
            <div class="field col-span-2">
              <label>Passende Rechnung</label>
              <select class="zag-rechnung-select">
                <option value="">– keine passende Rechnung auswählen –</option>
                ${offeneRechnungenOptions(a.kandidatenRechnungIds || [])}
              </select>
              ${(a.kandidatenRechnungIds || []).length === 0 ? '<p class="hint">Kein Betrag stimmt exakt mit einer offenen Rechnung überein - bitte manuell prüfen/auswählen.</p>' : ''}
            </div>
          </div>
          <div class="modal-actions" style="border:none;padding-top:8px">
            <span class="spacer"></span>
            <button type="button" class="btn zag-ablehnen" data-id="${a.id}">Ignorieren</button>
            <button type="button" class="btn btn-primary zag-bestaetigen" data-id="${a.id}">Als bezahlt bestätigen</button>
          </div>
        </div>
      `).join('');

    container.querySelector('#zag-verlauf').innerHTML = erledigt.length === 0 ? '' : `
      <div class="divider"></div>
      <h2 style="font-size:14px;margin:0 0 8px">Zuletzt erledigt</h2>
      <ul class="cal-event-list">
        ${erledigt.map((a) => `<li><span>${formatDate(a.datum)} · ${escapeHtml(a.gegenpart || '')} · ${formatCurrency(a.betrag)}</span><span class="text-mute">${a.status === 'bestaetigt' ? `→ ${escapeHtml(rechnungenById[a.rechnungId]?.nummer || 'Rechnung gelöscht')}` : 'ignoriert'}</span></li>`).join('')}
      </ul>
    `;

    container.querySelectorAll('.zag-bestaetigen').forEach((btn) => btn.addEventListener('click', async () => {
      const card = btn.closest('.card');
      const id = card.dataset.id;
      const rechnungId = card.querySelector('.zag-rechnung-select').value;
      if (!rechnungId) { toast('Bitte zuerst eine Rechnung auswählen.', 'danger'); return; }
      const rechnung = rechnungenById[rechnungId];
      const abgleich = abgleiche.find((a) => a.id === id);
      btn.disabled = true;
      try {
        // Entspricht der eingegangene Betrag genau dem Skonto-reduzierten
        // Betrag (statt dem vollen Rechnungsbetrag), hat der Kunde das
        // angebotene Skonto offensichtlich genutzt - dann auch so verbuchen
        // (siehe journal.js erzeugeBuchungenFuerRechnung).
        const skontoBetrag = betragBeiSkonto(rechnung);
        const skontoGenutzt = skontoBetrag != null && Math.round(skontoBetrag * 100) === Math.round(Number(abgleich.betrag) * 100);
        const aktualisiert = { ...rechnung, status: 'bezahlt', bezahltAm: (abgleich.datum || '').slice(0, 10) || rechnung.bezahltAm, skontoGenutzt };
        await put('rechnungen', aktualisiert);
        await journal.syncBuchungFuerRechnung(aktualisiert, settings);
        rechnungenById[rechnungId] = aktualisiert;
        const rIndex = rechnungen.findIndex((r) => r.id === rechnungId);
        if (rIndex !== -1) rechnungen[rIndex] = aktualisiert;
        await put('zahlungsabgleich', { ...abgleich, status: 'bestaetigt', rechnungId, erledigtAm: new Date().toISOString() });
        abgleiche = abgleiche.map((a) => (a.id === id ? { ...a, status: 'bestaetigt', rechnungId, erledigtAm: new Date().toISOString() } : a));
        toast(`Rechnung ${rechnung.nummer} als bezahlt markiert.`, 'success');
        renderList();
      } catch (err) {
        toast(err.message, 'danger');
        btn.disabled = false;
      }
    }));

    container.querySelectorAll('.zag-ablehnen').forEach((btn) => btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const abgleich = abgleiche.find((a) => a.id === id);
      btn.disabled = true;
      try {
        await put('zahlungsabgleich', { ...abgleich, status: 'ignoriert', erledigtAm: new Date().toISOString() });
        abgleiche = abgleiche.map((a) => (a.id === id ? { ...a, status: 'ignoriert', erledigtAm: new Date().toISOString() } : a));
        renderList();
      } catch (err) {
        toast(err.message, 'danger');
        btn.disabled = false;
      }
    }));
  }

  container.innerHTML = `
    <div class="view-header">
      <h1>Zahlungsabgleich</h1>
      <div class="actions">
        <button class="btn btn-primary" id="btn-zag-sync">🔄 Jetzt synchronisieren</button>
      </div>
    </div>
    <p class="hint">Gleicht eingehende Kontobewegungen von Qonto mit offenen Rechnungen ab. Es wird NICHTS automatisch gebucht - jeder Vorschlag muss hier bestätigt werden.</p>
    <div id="zag-liste"></div>
    <div id="zag-verlauf"></div>
  `;

  if (!settings.qontoWorkerUrl) {
    container.querySelector('#zag-liste').innerHTML = `<p class="empty-state">Qonto-Zahlungsabgleich ist noch nicht eingerichtet. Trag die Worker-Zugangsdaten unter <a href="#/einstellungen">Einstellungen → Qonto-Zahlungsabgleich</a> ein.</p>`;
  } else {
    renderList();
  }

  container.querySelector('#btn-zag-sync').addEventListener('click', async () => {
    const btn = container.querySelector('#btn-zag-sync');
    btn.disabled = true;
    btn.textContent = 'Synchronisiere ...';
    try {
      const transaktionen = await holeQontoTransaktionen({ tage: 30 });
      const bekannteIds = new Set(abgleiche.map((a) => a.id));
      let neu = 0;
      for (const t of transaktionen) {
        if (!t.transactionId || bekannteIds.has(t.transactionId)) continue;
        const kandidatenRechnungIds = rechnungen
          .filter(offenNichtStorniert)
          .filter((r) => {
            const voll = Math.round(Number(r.brutto) * 100) === Math.round(Number(t.betrag) * 100);
            const skontoBetrag = betragBeiSkonto(r);
            const mitSkonto = skontoBetrag != null && Math.round(skontoBetrag * 100) === Math.round(Number(t.betrag) * 100);
            return voll || mitSkonto;
          })
          .map((r) => r.id);
        const abgleichDoc = {
          id: t.transactionId, betrag: t.betrag, datum: t.datum, gegenpart: t.gegenpart, referenz: t.referenz,
          kandidatenRechnungIds, status: 'offen', erstelltAm: new Date().toISOString(),
        };
        await put('zahlungsabgleich', abgleichDoc);
        abgleiche.push(abgleichDoc);
        neu++;
      }
      toast(neu > 0 ? `${neu} neue Kontobewegung(en) gefunden.` : 'Keine neuen Kontobewegungen seit dem letzten Abgleich.', 'success');
      renderList();
    } catch (err) {
      toast(err.message, 'danger');
    }
    btn.disabled = false;
    btn.textContent = '🔄 Jetzt synchronisieren';
  });
}
