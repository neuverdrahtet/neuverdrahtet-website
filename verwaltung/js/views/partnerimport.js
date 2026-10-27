import { PARTNER_QUELLEN } from '../db.js';
import { uid, escapeHtml, toast, formatDate, compressImage } from '../utils.js';
import { analysierePartnerImportScreenshot, uebernehmePartnerImportZeilen, verwirfPartnerImportZeilen } from '../ai.js';

// KI-Wartungsdisposition MVP Phase 1 ("Entwicklungsfreigabe MVP Phase 1") -
// Screenshot-basierter Import von Partner-Wartungsaufträgen (z.B. WR-Gruppe-
// Plantafel aus dem Salesforce-Partnerportal). Admin-only wie JARVIS
// insgesamt (siehe ROUTE_ROLLEN.partnerimport/firestore.rules
// match /jarvisPartnerImportEntwuerfe/{docId}).
//
// WICHTIG - reine Entwurfsverarbeitung:
// - Screenshots werden NIE auf einen Server hochgeladen/gespeichert - sie
//   werden nur für den einzelnen Analyse-Aufruf an den JARVIS-Worker
//   gesendet und dort NICHT persistiert (siehe worker.js Kopfkommentar zum
//   Abschnitt "KI-Wartungsdisposition").
// - Nichts wird automatisch übernommen: jede Zeile landet zunächst nur im
//   Entwurf, eine echte Serviceauftrag-Anlage/-Aktualisierung passiert
//   ausschließlich nach expliziter Auswahl + Klick auf "Übernehmen".
// - KEIN automatischer Kundenkontakt, KEINE Terminbuchung, KEIN Salesforce-
//   Schreibzugriff - diese Seite endet mit einem ganz normalen, offenen
//   Serviceauftrag, den die bestehende Serviceauftragsverwaltung/
//   SmartDispatch unverändert weiterverarbeitet.

const PARTNER_TITEL = Object.fromEntries(PARTNER_QUELLEN.map((p) => [p.id, p.titel]));
const MAX_UPLOAD_MB = 15;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

function dateiZuDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
    reader.readAsDataURL(file);
  });
}

function zeilenStatusBadge(zeile) {
  if (zeile.uebernahmeStatus === 'uebernommen') return '<span class="badge badge-success">übernommen</span>';
  if (zeile.uebernahmeStatus === 'verworfen') return '<span class="badge">verworfen</span>';
  if ((zeile.widersprueche || []).length > 0) return '<span class="badge badge-danger">widersprüchlich</span>';
  if ((zeile.fehlendeFelder || []).length > 0) return '<span class="badge badge-warn">unvollständig</span>';
  return '<span class="badge badge-success">vollständig</span>';
}

function renderZeile(zeile) {
  const adresse = [zeile.strasse, [zeile.plz, zeile.stadt].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '<span class="text-mute">–</span>';
  const widersprueche = (zeile.widersprueche || []).map((w) => `<li><strong>${escapeHtml(w.feld)}</strong>: ${w.werte.map((v) => escapeHtml(v)).join(' vs. ')}</li>`).join('');
  const kannBearbeitetWerden = zeile.uebernahmeStatus === 'offen';
  return `
    <tr data-zeilen-id="${escapeHtml(zeile.zeilenId)}">
      <td>${kannBearbeitetWerden ? `<input type="checkbox" class="pi-zeile-checkbox" data-zeilen-id="${escapeHtml(zeile.zeilenId)}">` : ''}</td>
      <td>${escapeHtml(zeile.auftragsnummer || '–')}</td>
      <td>${escapeHtml(zeile.partnerStatus || '–')}</td>
      <td>${zeile.faelligkeitsdatum ? formatDate(zeile.faelligkeitsdatum) : '<span class="text-mute">–</span>'}</td>
      <td>${escapeHtml(zeile.wartungsdauerText || '–')}</td>
      <td>${adresse}</td>
      <td>${escapeHtml(zeile.telefonnummer || '–')}</td>
      <td>${escapeHtml(zeile.serviceempfaenger || '–')}</td>
      <td>${escapeHtml(zeile.sachbearbeiter || '–')}</td>
      <td>${zeilenStatusBadge(zeile)}</td>
      <td>
        ${(zeile.fehlendeFelder || []).length > 0 ? `<div class="hint" style="margin:0">Fehlend: ${zeile.fehlendeFelder.map((f) => escapeHtml(f)).join(', ')}</div>` : ''}
        ${widersprueche ? `<div class="hint" style="margin:0;color:var(--danger,#c0392b)">Widersprüche:<ul style="margin:2px 0 0 16px">${widersprueche}</ul></div>` : ''}
        ${(zeile.unsicherheitshinweise || []).filter((h) => h && !h.startsWith('Keine besonderen')).map((h) => `<div class="hint" style="margin:0">⚠️ ${escapeHtml(h)}</div>`).join('')}
        ${zeile.uebernommenAlsServiceauftragId ? `<div class="hint" style="margin:0">→ Serviceauftrag angelegt/aktualisiert</div>` : ''}
        ${(zeile.uebersprungeneAbweichungen || []).length > 0 ? `<div class="hint" style="margin:0;color:var(--danger,#c0392b)">${zeile.uebersprungeneAbweichungen.length} Abweichung(en) NICHT übernommen - bitte im Serviceauftrag manuell prüfen.</div>` : ''}
      </td>
    </tr>
  `;
}

export async function render(container) {
  let batch = null;
  let batchId = uid();
  let partnerId = PARTNER_QUELLEN[0]?.id || '';
  let screenshotIndex = 0;

  container.innerHTML = `
    <div class="view-header">
      <h1>Partner-Import (Screenshot)</h1>
      <div class="actions">
        <button class="btn btn-sm" id="pi-neu-btn">↺ Neuer Import starten</button>
      </div>
    </div>
    <div class="card card-hinweis" style="margin-bottom:10px">
      <p class="mb-0">⚠️ <strong>KI-Wartungsdisposition, MVP Phase 1 - reine Entwurfsverarbeitung.</strong> Screenshots werden NICHT gespeichert, nur die daraus erkannten Textdaten. Es wird NICHTS automatisch übernommen, kein Kunde kontaktiert, kein Termin gebucht, keine Daten an Salesforce zurückgemeldet. Jede Zeile unten muss explizit ausgewählt und per "Übernehmen" bestätigt werden, bevor ein echter Serviceauftrag entsteht. Ein erneuter Import überschreibt NIE ein bereits befülltes Feld eines bestehenden Auftrags - Abweichungen werden nur gemeldet.</p>
    </div>
    <div class="form-grid" style="margin-bottom:10px">
      <div class="field"><label>Partner</label>
        <select id="pi-partner">${PARTNER_QUELLEN.map((p) => `<option value="${p.id}">${escapeHtml(p.titel)}</option>`).join('')}</select>
      </div>
    </div>
    <div class="file-dropzone" id="pi-dropzone" tabindex="0">
      <div class="dz-icon">📷</div>
      <div>Screenshot(s) der Plantafel-Übersicht auswählen</div>
      <div class="dz-hint">JPEG/PNG/WebP · max. ${MAX_UPLOAD_MB} MB je Datei · mehrere Screenshots nacheinander möglich (z.B. Übersicht + aufgeklappte Details)</div>
      <button type="button" class="btn btn-sm" id="pi-datei-btn" style="margin-top:8px">📁 Datei(en) wählen</button>
      <input type="file" id="pi-datei-input" accept="image/png,image/jpeg,image/webp" multiple hidden>
    </div>
    <p id="pi-upload-status" class="hint"></p>
    <div id="pi-ergebnis"></div>
  `;

  const partnerSelect = container.querySelector('#pi-partner');
  partnerSelect.addEventListener('change', () => { partnerId = partnerSelect.value; });
  partnerId = partnerSelect.value;

  function renderErgebnis() {
    const host = container.querySelector('#pi-ergebnis');
    if (!batch || batch.zeilen.length === 0) { host.innerHTML = ''; return; }
    const offeneZeilenIds = batch.zeilen.filter((z) => z.uebernahmeStatus === 'offen').map((z) => z.zeilenId);
    host.innerHTML = `
      <p class="hint">Partner: ${escapeHtml(PARTNER_TITEL[batch.partnerId] || batch.partnerId)} · ${batch.screenshotAnzahl} Screenshot(s) ausgewertet${batch.uebersprungeneZeilenOhneAuftragsnummer ? ` · ${batch.uebersprungeneZeilenOhneAuftragsnummer} Zeile(n) ohne lesbare Auftragsnummer übersprungen` : ''}${batch.bildLesbar === false ? ' · ⚠️ letzter Screenshot war nicht auswertbar' : ''}</p>
      <div class="flex-row" style="gap:8px;margin-bottom:8px">
        <button type="button" class="btn btn-sm" id="pi-alle-waehlen-btn" ${offeneZeilenIds.length === 0 ? 'disabled' : ''}>Alle offenen auswählen</button>
        <button type="button" class="btn btn-primary btn-sm" id="pi-uebernehmen-btn" ${offeneZeilenIds.length === 0 ? 'disabled' : ''}>✓ Ausgewählte übernehmen</button>
        <button type="button" class="btn btn-sm btn-danger" id="pi-verwerfen-btn" ${offeneZeilenIds.length === 0 ? 'disabled' : ''}>✕ Ausgewählte verwerfen</button>
      </div>
      <table class="data-table">
        <thead><tr>
          <th></th><th>Auftragsnummer</th><th>Partner-Status</th><th>Fälligkeit</th><th>Wartungsdauer</th><th>Adresse</th><th>Telefon</th><th>Serviceempfänger</th><th>Sachbearbeiter</th><th>Status</th><th>Hinweise</th>
        </tr></thead>
        <tbody>${batch.zeilen.map(renderZeile).join('')}</tbody>
      </table>
    `;
    host.querySelector('#pi-alle-waehlen-btn')?.addEventListener('click', () => {
      host.querySelectorAll('.pi-zeile-checkbox').forEach((cb) => { cb.checked = true; });
    });
    host.querySelector('#pi-uebernehmen-btn')?.addEventListener('click', async () => {
      const ausgewaehlt = [...host.querySelectorAll('.pi-zeile-checkbox:checked')].map((cb) => cb.dataset.zeilenId);
      if (ausgewaehlt.length === 0) { toast('Bitte mindestens eine Zeile auswählen.', 'error'); return; }
      try {
        const ergebnis = await uebernehmePartnerImportZeilen({ batchId, erwarteteVersion: batch.version, zeilenIds: ausgewaehlt });
        toast(`${ergebnis.neu} neue(r) Serviceauftrag/-aufträge angelegt, ${ergebnis.aktualisiert} aktualisiert${ergebnis.abweichungen.length ? `, ${ergebnis.abweichungen.length} mit nicht übernommenen Abweichungen (bitte manuell prüfen)` : ''}.`, 'success');
        // Lokal den neuen Stand übernehmen (der Server hat dieselbe Logik
        // bereits angewendet und in jarvisPartnerImportEntwuerfe gespeichert) -
        // ein erneuter Analyse-/Übernahme-Aufruf liest ohnehin wieder den
        // echten Firestore-Stand, hier reicht die direkte Markierung.
        batch = { ...batch, version: batch.version + 1, zeilen: batch.zeilen.map((z) => ausgewaehlt.includes(z.zeilenId) ? { ...z, uebernahmeStatus: 'uebernommen' } : z) };
        renderErgebnis();
      } catch (err) {
        toast(err.message || 'Übernahme fehlgeschlagen.', 'danger');
      }
    });
    host.querySelector('#pi-verwerfen-btn')?.addEventListener('click', async () => {
      const ausgewaehlt = [...host.querySelectorAll('.pi-zeile-checkbox:checked')].map((cb) => cb.dataset.zeilenId);
      if (ausgewaehlt.length === 0) { toast('Bitte mindestens eine Zeile auswählen.', 'error'); return; }
      if (!confirm(`${ausgewaehlt.length} Zeile(n) verwerfen? Es wird kein Serviceauftrag angelegt.`)) return;
      try {
        await verwirfPartnerImportZeilen({ batchId, erwarteteVersion: batch.version, zeilenIds: ausgewaehlt });
        batch = { ...batch, version: batch.version + 1, zeilen: batch.zeilen.map((z) => ausgewaehlt.includes(z.zeilenId) ? { ...z, uebernahmeStatus: 'verworfen' } : z) };
        toast('Verworfen.', 'success');
        renderErgebnis();
      } catch (err) {
        toast(err.message || 'Verwerfen fehlgeschlagen.', 'danger');
      }
    });
  }

  async function verarbeiteDatei(file) {
    if (!file.type.startsWith('image/')) { toast(`Dateityp nicht unterstützt: ${file.type || file.name}`, 'danger'); return; }
    if (file.size > MAX_UPLOAD_BYTES) { toast(`Datei ist zu groß (max. ${MAX_UPLOAD_MB} MB): ${file.name}`, 'danger'); return; }
    const statusEl = container.querySelector('#pi-upload-status');
    statusEl.textContent = `Analysiere ${file.name} …`;
    try {
      const bildDataUrl = await dateiZuDataUrl(await compressImage(file, { maxWidth: 2000, quality: 0.85 }));
      batch = await analysierePartnerImportScreenshot({ batchId, partnerId, bildDataUrl, screenshotIndex });
      screenshotIndex++;
      statusEl.textContent = `${file.name} ausgewertet.`;
      renderErgebnis();
    } catch (err) {
      statusEl.textContent = '';
      toast(err.message || `Screenshot konnte nicht analysiert werden: ${file.name}`, 'danger');
    }
  }

  const datInput = container.querySelector('#pi-datei-input');
  container.querySelector('#pi-datei-btn').addEventListener('click', () => datInput.click());
  datInput.addEventListener('change', async (e) => {
    const dateien = [...(e.target.files || [])];
    e.target.value = '';
    // Bewusst NACHEINANDER statt parallel verarbeitet (kein Promise.all):
    // mehrere Screenshots derselben Aufträge müssen in einer festen
    // Reihenfolge in denselben Batch zusammengeführt werden, siehe
    // worker.js mergePartnerImportZeile - eine parallele Verarbeitung
    // könnte sich sonst gegenseitig überschreiben (die serverseitige
    // Zusammenführung liest den Batch vor jedem Schreiben neu ein).
    for (const file of dateien) {
      await verarbeiteDatei(file);
    }
  });

  container.querySelector('#pi-neu-btn').addEventListener('click', () => {
    if (batch && batch.zeilen.some((z) => z.uebernahmeStatus === 'offen') && !confirm('Es gibt noch nicht übernommene/verworfene Zeilen. Wirklich einen neuen Import starten?')) return;
    batch = null;
    batchId = uid();
    screenshotIndex = 0;
    container.querySelector('#pi-upload-status').textContent = '';
    renderErgebnis();
    toast('Neuer Import gestartet.', 'success');
  });
}
