import { getAll, put, remove, getSettings, TAETIGKEITEN } from '../db.js';
import { uid, escapeHtml, formatDate, getCurrentMitarbeiterId, setCurrentMitarbeiterId, toast, compressImage } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import { createBulkSelect } from '../bulkselect.js';
import { mountSignaturePad } from '../signature.js';
import { FIREBASE_ENABLED, uploadBlobToStorage, deleteBlobFromStorage } from '../blobstore.js';

const ARBEITSORTE = [
  { id: 'buero', titel: 'Büro' },
  { id: 'homeoffice', titel: 'HomeOffice' },
  { id: 'aussendienst', titel: 'Außendienst/Kunde vor Ort' },
];
const BESONDERHEITEN = [
  { id: 'keine', titel: 'Keine' },
  { id: 'krankheit', titel: 'Krankheit/Urlaub/Feiertag' },
  { id: 'verspaetung', titel: 'Verspätung/früher Feierabend' },
  { id: 'dienstreise', titel: 'Dienstreise' },
  { id: 'technik', titel: 'Tech. Probleme' },
];
const MEDIEN_LIMITS = {
  image: { max: 10, maxSize: 10 * 1024 * 1024, label: 'Bilder' },
  video: { max: 1, maxSize: 100 * 1024 * 1024, label: 'Video' },
  pdf: { max: 3, maxSize: 25 * 1024 * 1024, label: 'PDF' },
};

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
    reader.readAsDataURL(blob);
  });
}

/** Lädt Medien/Unterschrift eines Tagesberichts nach Firebase Storage hoch (nur im Firebase-Modus). */
async function persistTagesberichtBlobs(entry) {
  if (!FIREBASE_ENABLED) return entry;
  const medien = [];
  for (const it of entry.medien || []) {
    if (it.dataUrl && it.dataUrl.startsWith('data:')) {
      const blob = await (await fetch(it.dataUrl)).blob();
      const meta = await uploadBlobToStorage(`zeiterfassung/${entry.id}/medien/${uid()}`, blob);
      medien.push({ ...it, dataUrl: meta.url, path: meta.path });
    } else {
      medien.push(it);
    }
  }
  let unterschriftMitarbeiter = entry.unterschriftMitarbeiter || null;
  let unterschriftPath = entry.unterschriftPath || null;
  if (unterschriftMitarbeiter && unterschriftMitarbeiter.startsWith('data:')) {
    const blob = await (await fetch(unterschriftMitarbeiter)).blob();
    const meta = await uploadBlobToStorage(`zeiterfassung/${entry.id}/unterschrift`, blob);
    unterschriftMitarbeiter = meta.url;
    unterschriftPath = meta.path;
  }
  return { ...entry, medien, unterschriftMitarbeiter, unterschriftPath };
}

function addDaysISO(iso, days) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Drag&Drop-Upload für Fotos/Videos/PDFs mit Mengen-/Größenlimits je Typ. */
function mountMedienDropzone(host, existing = []) {
  let items = existing.slice();

  function kindOf(file) {
    if (file.type.startsWith('image/')) return 'image';
    if (file.type.startsWith('video/')) return 'video';
    if (file.type === 'application/pdf') return 'pdf';
    return null;
  }

  async function handleFiles(files) {
    for (const file of files) {
      const kind = kindOf(file);
      if (!kind) { toast(`Dateityp nicht unterstützt: ${file.name}`, 'danger'); continue; }
      const limit = MEDIEN_LIMITS[kind];
      const count = items.filter((it) => it.type === kind).length;
      if (count >= limit.max) { toast(`Maximal ${limit.max}× ${limit.label} erlaubt.`, 'danger'); continue; }
      if (file.size > limit.maxSize) { toast(`${file.name} ist zu groß (max. ${Math.round(limit.maxSize / 1024 / 1024)} MB).`, 'danger'); continue; }
      try {
        const dataUrl = kind === 'image'
          ? await blobToDataUrl(await compressImage(file, { maxWidth: 1200, quality: 0.78 }))
          : await blobToDataUrl(file);
        items.push({ type: kind, dataUrl, name: file.name });
      } catch (err) {
        toast(err.message || 'Datei konnte nicht geladen werden.', 'danger');
      }
    }
    render();
  }

  function render() {
    host.innerHTML = `
      <div class="file-dropzone" tabindex="0">
        <div class="dz-icon">⬆️</div>
        <div>Drag &amp; Drop oder Datei hochladen</div>
        <div class="dz-hint">Bilder: 10×10 MB · Video: 1×100 MB · PDF: 3×25 MB</div>
        <div style="margin-top:10px">
          <button type="button" class="btn btn-sm dz-camera">📷 Foto aufnehmen</button>
        </div>
        <input type="file" class="dz-input" accept="image/*,video/*,application/pdf" multiple>
        <input type="file" class="dz-camera-input" accept="image/*" capture="environment" hidden>
      </div>
      <div class="dz-preview-grid">
        ${items.map((it, i) => `
          <div class="dz-preview-item" data-i="${i}">
            ${it.type === 'image' ? `<img src="${it.dataUrl}" alt="${escapeHtml(it.name || '')}">`
              : it.type === 'video' ? `<video src="${it.dataUrl}" muted></video>`
              : `<div class="dz-file-icon">📄</div>`}
            <button type="button" class="dz-remove" title="Entfernen">✕</button>
          </div>
        `).join('')}
      </div>
    `;
    const zone = host.querySelector('.file-dropzone');
    const input = host.querySelector('.dz-input');
    const camInput = host.querySelector('.dz-camera-input');
    zone.addEventListener('click', (e) => { if (e.target.closest('.dz-camera')) return; input.click(); });
    host.querySelector('.dz-camera').addEventListener('click', (e) => { e.stopPropagation(); camInput.click(); });
    ['dragover', 'dragenter'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('dragover'); }));
    zone.addEventListener('drop', (e) => handleFiles(Array.from(e.dataTransfer?.files || [])));
    input.addEventListener('change', (e) => { handleFiles(Array.from(e.target.files || [])); e.target.value = ''; });
    camInput.addEventListener('change', (e) => { handleFiles(Array.from(e.target.files || [])); e.target.value = ''; });
    host.querySelectorAll('.dz-remove').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const i = Number(btn.closest('.dz-preview-item').dataset.i);
        items.splice(i, 1);
        render();
      });
    });
  }
  render();
  return { getMedien: () => items };
}

const DOW = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const TIMER_KEY = 'nv-running-timer';

function startOfWeek(d) {
  const date = new Date(d);
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  date.setHours(0, 0, 0, 0);
  return date;
}
function toDateOnly(iso) {
  return (iso || '').slice(0, 10);
}
function mapsUrl(ort) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ort)}`;
}

function loadRunningTimer() {
  try { return JSON.parse(localStorage.getItem(TIMER_KEY) || 'null'); } catch { return null; }
}
function saveRunningTimer(t) {
  if (t) localStorage.setItem(TIMER_KEY, JSON.stringify(t));
  else localStorage.removeItem(TIMER_KEY);
}
function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}:${String(m).padStart(2, '0')} Std.`;
}
function nowHHMM() {
  return new Date().toTimeString().slice(0, 5);
}
function addMinutesHHMM(hhmm, minutes) {
  const [h, m] = (hhmm || '00:00').split(':').map(Number);
  const total = (h * 60 + m + minutes + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
function minutesBetweenHHMM(start, end) {
  const [sh, sm] = (start || '00:00').split(':').map(Number);
  const [eh, em] = (end || '00:00').split(':').map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff < 0) diff += 1440;
  return diff;
}

export async function render(container) {
  let [eintraege, projekte, mitarbeiter, settings, termine, kunden] = await Promise.all([
    getAll('zeiterfassung'), getAll('projekte'), getAll('mitarbeiter'), getSettings(), getAll('termine'), getAll('kunden'),
  ]);
  const projekteById = Object.fromEntries(projekte.map((p) => [p.id, p]));
  const mitarbeiterById = Object.fromEntries(mitarbeiter.map((m) => [m.id, m]));
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));
  eintraege.sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));
  let filtered = eintraege;
  const bulk = createBulkSelect('zeiterfassung', { label: 'Einträge' });
  let tickInterval = null;
  let mode = 'einsaetze';

  container.innerHTML = `
    <div class="view-header">
      <h1>Zeiterfassung</h1>
      <div class="actions">
        <button class="btn" id="btn-new-tagesbericht">+ Tagesbericht</button>
        <button class="btn btn-primary" id="btn-new">+ Eintrag erfassen</button>
      </div>
    </div>
    <div class="tabs" id="mode-tabs">
      <button type="button" class="tab-item" data-mode="einsaetze">📱 Einsätze</button>
      <button type="button" class="tab-item" data-mode="liste">📋 Liste</button>
    </div>
    <div id="einsaetze-view"></div>
    <div id="liste-view" hidden>
      <div class="card" id="timer-card"></div>
      <div class="search-bar">
        <select id="filter-projekt"><option value="">Alle Projekte</option>${projekte.map((p) => `<option value="${p.id}">${escapeHtml(p.titel)}</option>`).join('')}</select>
        <select id="filter-mitarbeiter"><option value="">Alle Mitarbeiter</option>${mitarbeiter.map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('')}</select>
      </div>
      <div id="table-host"></div>
    </div>
  `;

  function setMode(m) {
    mode = m;
    container.querySelectorAll('#mode-tabs .tab-item').forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
    container.querySelector('#einsaetze-view').hidden = m !== 'einsaetze';
    container.querySelector('#liste-view').hidden = m !== 'liste';
    if (m === 'einsaetze') renderEinsaetze();
    if (m === 'liste') renderTable();
  }
  container.querySelectorAll('#mode-tabs .tab-item').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  // --- Mobile "Einsätze" view ---
  const einsaetzeHost = container.querySelector('#einsaetze-view');
  let selectedDay = toDateOnly(new Date().toISOString());

  function renderEinsaetze() {
    let currentMa = getCurrentMitarbeiterId();
    if (!currentMa && mitarbeiter.length) currentMa = mitarbeiter[0].id;
    const weekStart = startOfWeek(new Date(selectedDay + 'T00:00:00'));
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return toDateOnly(d.toISOString());
    });
    const todayStr = toDateOnly(new Date().toISOString());
    const running = loadRunningTimer();

    const einsaetze = termine
      .filter((t) => currentMa && t.mitarbeiterIds?.includes(currentMa))
      .filter((t) => {
        const start = toDateOnly(t.start);
        const ende = toDateOnly(t.ende) || start;
        return selectedDay >= start && selectedDay <= ende;
      })
      .sort((a, b) => (a.start || '').localeCompare(b.start || ''));

    einsaetzeHost.innerHTML = `
      <div class="search-bar">
        <label class="text-mute" style="display:flex;align-items:center;gap:6px;font-size:12.5px">
          Ich bin:
          <select id="es-ich-bin">
            <option value="">– auswählen –</option>
            ${mitarbeiter.map((m) => `<option value="${m.id}" ${m.id === currentMa ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="es-daystrip">
        ${days.map((d, i) => `
          <button type="button" class="es-day ${d === selectedDay ? 'active' : ''} ${d === todayStr ? 'is-today' : ''}" data-date="${d}">
            <span class="es-dow">${DOW[i]}</span><span class="es-num">${Number(d.slice(8, 10))}</span>
          </button>
        `).join('')}
      </div>
      <div class="es-list">
        ${einsaetze.length === 0 ? '<p class="text-mute" style="padding:20px 0">Keine Einsätze an diesem Tag.</p>' : einsaetze.map((t) => {
          const projekt = projekteById[t.projektId];
          const kunde = kundenById[t.kundeId] || kundenById[projekt?.kundeId];
          const isRunningHere = running && running.terminId === t.id;
          return `
            <div class="es-card" data-id="${t.id}">
              <div class="es-card-head">
                <strong>${escapeHtml(projekt?.titel || t.titel)}</strong>
                <span class="text-mute">${(t.start || '').slice(11, 16)}</span>
              </div>
              ${kunde ? `<div class="text-mute" style="font-size:12.5px">${escapeHtml(kunde.firma)}</div>` : ''}
              ${t.ort ? `<div class="text-mute" style="font-size:12.5px">📍 ${escapeHtml(t.ort)}</div>` : ''}
              <textarea class="es-notiz" data-id="${t.id}" placeholder="Notiz hinzufügen ...">${escapeHtml(t.notizen || '')}</textarea>
              <div class="es-progress-row">
                <span class="text-mute" style="font-size:12px">Fortschritt</span>
                <input type="range" min="0" max="100" step="5" class="es-fortschritt" data-id="${t.id}" value="${t.fortschritt || 0}">
                <span class="es-fortschritt-val">${t.fortschritt || 0}%</span>
              </div>
              <div class="es-actions">
                ${t.ort ? `<a class="btn btn-sm" href="${mapsUrl(t.ort)}" target="_blank" rel="noopener">📍 Standort</a>` : ''}
                ${kunde?.telefon ? `<a class="btn btn-sm" href="tel:${escapeHtml(kunde.telefon)}">📞 Anruf</a>` : ''}
                ${t.projektId ? `<button type="button" class="btn btn-sm ${isRunningHere ? 'btn-danger' : 'btn-primary'} es-timer-btn" data-id="${t.id}" data-projekt="${t.projektId}">${isRunningHere ? '⏹️ Stopp' : '▶️ Start'}</button>` : ''}
                ${t.projektId ? `<button type="button" class="btn btn-sm es-manual-btn" data-id="${t.id}" data-projekt="${t.projektId}">✏️ Manuell</button>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    einsaetzeHost.querySelector('#es-ich-bin').addEventListener('change', (e) => {
      setCurrentMitarbeiterId(e.target.value);
      renderEinsaetze();
    });
    einsaetzeHost.querySelectorAll('.es-day').forEach((btn) => {
      btn.addEventListener('click', () => { selectedDay = btn.dataset.date; renderEinsaetze(); });
    });
    einsaetzeHost.querySelectorAll('.es-notiz').forEach((ta) => {
      ta.addEventListener('blur', async () => {
        const t = termine.find((x) => x.id === ta.dataset.id);
        if (!t) return;
        t.notizen = ta.value;
        await put('termine', t);
      });
    });
    einsaetzeHost.querySelectorAll('.es-fortschritt').forEach((range) => {
      range.addEventListener('input', () => {
        range.parentElement.querySelector('.es-fortschritt-val').textContent = `${range.value}%`;
      });
      range.addEventListener('change', async () => {
        const t = termine.find((x) => x.id === range.dataset.id);
        if (!t) return;
        t.fortschritt = Number(range.value);
        await put('termine', t);
      });
    });
    einsaetzeHost.querySelectorAll('.es-timer-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const runningNow = loadRunningTimer();
        if (runningNow && runningNow.terminId === btn.dataset.id) {
          const minutes = Math.max(1, Math.round((Date.now() - new Date(runningNow.startedAt).getTime()) / 60000));
          saveRunningTimer(null);
          const neu = {
            id: uid(), projektId: runningNow.projektId, mitarbeiterId: currentMa,
            datum: runningNow.startedAt.slice(0, 10), dauerMinuten: minutes, beschreibung: '', abgerechnet: false,
            startzeit: runningNow.startedAt.slice(11, 16), endzeit: new Date().toISOString().slice(11, 16),
            taetigkeit: 'baustelle',
          };
          await put('zeiterfassung', neu);
          eintraege.unshift(neu);
          toast(`Zeit gespeichert: ${minutes} Min.`, 'success');
        } else {
          saveRunningTimer({ projektId: btn.dataset.projekt, mitarbeiterId: currentMa, startedAt: new Date().toISOString(), terminId: btn.dataset.id });
        }
        renderEinsaetze();
      });
    });
    einsaetzeHost.querySelectorAll('.es-manual-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        openForm({
          id: uid(), projektId: btn.dataset.projekt, mitarbeiterId: currentMa, datum: selectedDay,
          dauerMinuten: 60, beschreibung: '', abgerechnet: false,
          startzeit: nowHHMM(), endzeit: addMinutesHHMM(nowHHMM(), 60), taetigkeit: 'baustelle',
        }, { isNewFromTimer: true });
      });
    });
  }

  // --- Timer widget ---
  const timerCard = container.querySelector('#timer-card');
  function renderTimer() {
    const running = loadRunningTimer();
    if (!running) {
      timerCard.innerHTML = `
        <h2>Zeit stoppen</h2>
        <div class="form-grid">
          <div class="field"><label>Projekt *</label>
            <select id="timer-projekt"><option value="">– wählen –</option>${projekte.map((p) => `<option value="${p.id}">${escapeHtml(p.titel)}</option>`).join('')}</select>
          </div>
          <div class="field"><label>Mitarbeiter</label>
            <select id="timer-mitarbeiter"><option value="">–</option>${mitarbeiter.map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('')}</select>
          </div>
          <div class="field"><label>Tätigkeit</label>
            <select id="timer-taetigkeit">${TAETIGKEITEN.map((t) => `<option value="${t.id}">${escapeHtml(t.titel)}</option>`).join('')}</select>
          </div>
        </div>
        <button class="btn btn-primary" id="btn-start" style="margin-top:10px;font-size:16px;padding:14px 22px">▶️ Zeit starten</button>
      `;
      timerCard.querySelector('#btn-start').addEventListener('click', () => {
        const projektId = timerCard.querySelector('#timer-projekt').value;
        if (!projektId) { toast('Bitte ein Projekt wählen', 'danger'); return; }
        const mitarbeiterId = timerCard.querySelector('#timer-mitarbeiter').value;
        const taetigkeit = timerCard.querySelector('#timer-taetigkeit').value;
        saveRunningTimer({ projektId, mitarbeiterId, taetigkeit, startedAt: new Date().toISOString() });
        renderTimer();
      });
    } else {
      const projekt = projekteById[running.projektId];
      timerCard.innerHTML = `
        <h2>⏱️ Zeit läuft: ${escapeHtml(projekt?.titel || '')}</h2>
        <div class="kpi-value" id="timer-display" style="font-size:32px;margin:10px 0">00:00:00</div>
        <button class="btn btn-danger" id="btn-stop" style="font-size:16px;padding:14px 22px">⏹️ Stoppen &amp; speichern</button>
      `;
      const display = timerCard.querySelector('#timer-display');
      function tick() {
        const secs = Math.floor((Date.now() - new Date(running.startedAt).getTime()) / 1000);
        const h = String(Math.floor(secs / 3600)).padStart(2, '0');
        const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
        const s = String(secs % 60).padStart(2, '0');
        display.textContent = `${h}:${m}:${s}`;
      }
      tick();
      tickInterval = setInterval(tick, 1000);
      timerCard.querySelector('#btn-stop').addEventListener('click', async () => {
        clearInterval(tickInterval);
        const minutes = Math.max(1, Math.round((Date.now() - new Date(running.startedAt).getTime()) / 60000));
        saveRunningTimer(null);
        openForm({
          id: uid(), projektId: running.projektId, mitarbeiterId: running.mitarbeiterId,
          datum: running.startedAt.slice(0, 10), dauerMinuten: minutes, beschreibung: '', abgerechnet: false,
          startzeit: running.startedAt.slice(11, 16), endzeit: new Date().toISOString().slice(11, 16),
          taetigkeit: running.taetigkeit || 'baustelle',
        }, { isNewFromTimer: true });
      });
    }
  }

  const tableHost = container.querySelector('#table-host');
  function applyFilter() {
    const projektId = container.querySelector('#filter-projekt').value;
    const mitarbeiterId = container.querySelector('#filter-mitarbeiter').value;
    filtered = eintraege.filter((e) => (!projektId || e.projektId === projektId) && (!mitarbeiterId || e.mitarbeiterId === mitarbeiterId));
    renderTable();
  }
  container.querySelector('#filter-projekt').addEventListener('change', applyFilter);
  container.querySelector('#filter-mitarbeiter').addEventListener('change', applyFilter);

  function renderTable() {
    if (filtered.length === 0) {
      tableHost.innerHTML = `<div class="empty-state">Noch keine Zeiten erfasst.</div>`;
      return;
    }
    const totalMinutes = filtered.reduce((s, e) => s + (e.dauerMinuten || 0), 0);
    tableHost.innerHTML = `
      <p class="hint">Gesamt: ${formatDuration(totalMinutes)}</p>
      ${bulk.barHtml()}
      <table class="data-table">
        <thead><tr>${bulk.headerCell()}<th>Datum</th><th>Uhrzeit</th><th>Projekt</th><th>Mitarbeiter</th><th>Tätigkeit</th><th>Dauer</th><th>Beschreibung</th><th>Status</th></tr></thead>
        <tbody>
          ${filtered.map((e) => `
            <tr data-id="${e.id}">
              ${bulk.rowCell(e.id)}
              <td>${formatDate(e.datum)}</td>
              <td>${e.startzeit && e.endzeit ? `${e.startzeit}–${e.endzeit}` : '–'}</td>
              <td>${escapeHtml(projekteById[e.projektId]?.titel || '')}</td>
              <td>${escapeHtml(mitarbeiterById[e.mitarbeiterId]?.name || '')}</td>
              <td>${e.istTagesbericht ? '<span class="badge badge-accent">📝 Tagesbericht</span>' : escapeHtml(TAETIGKEITEN.find((t) => t.id === e.taetigkeit)?.titel || '')}</td>
              <td>${formatDuration(e.dauerMinuten || 0)}</td>
              <td>${escapeHtml(e.beschreibung || '')}</td>
              <td><span class="badge ${e.abgerechnet ? 'badge-success' : 'badge'}">${e.abgerechnet ? 'abgerechnet' : 'offen'}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    tableHost.querySelectorAll('tbody tr').forEach((row) => {
      row.addEventListener('click', () => {
        const entry = eintraege.find((e) => e.id === row.dataset.id);
        if (entry?.istTagesbericht) openTagesberichtForm(entry);
        else openForm(entry);
      });
    });
    bulk.wire(tableHost, {
      onChange: renderTable,
      onDeleted: (ids) => {
        eintraege = eintraege.filter((e) => !ids.includes(e.id));
        filtered = filtered.filter((e) => !ids.includes(e.id));
        renderTable();
      },
    });
  }

  container.querySelector('#btn-new').addEventListener('click', () => openForm());
  container.querySelector('#btn-new-tagesbericht').addEventListener('click', () => openTagesberichtForm());

  function openTagesberichtForm(entry) {
    const isEdit = !!entry;
    const currentMa = getCurrentMitarbeiterId();
    const data = entry || {
      id: uid(), projektId: '', mitarbeiterId: currentMa || '',
      verfassungsdatum: toDateOnly(new Date().toISOString()),
      notizen: '', arbeitsbeginn: '08:00', arbeitsende: '17:00', pause: 1,
      taetigkeitsbeschreibung: '', arbeitsort: 'aussendienst', besonderheit: 'keine',
      medien: [], unterschriftMitarbeiter: null,
    };

    function calcArbeitszeit(beginn, ende, pause) {
      const minuten = minutesBetweenHHMM(beginn, ende) - (Number(pause) || 0) * 60;
      return Math.max(0, Math.round((minuten / 60) * 100) / 100);
    }

    const { body, close } = openModal({
      title: isEdit ? 'Tagesbericht bearbeiten' : 'Neuer Tagesbericht',
      wide: true,
      bodyHtml: `
        <form id="tb-form">
          <div class="form-grid">
            <div class="field"><label>Mitarbeiter</label>
              <select name="mitarbeiterId">
                <option value="">–</option>
                ${mitarbeiter.map((m) => `<option value="${m.id}" ${m.id === data.mitarbeiterId ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}
              </select>
            </div>
            <div class="field"><label>Projekt (optional)</label>
              <select name="projektId">
                <option value="">–</option>
                ${projekte.map((p) => `<option value="${p.id}" ${p.id === data.projektId ? 'selected' : ''}>${escapeHtml(p.titel)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="field"><label>Notizen (Mehrzeiligen Text eingeben, ggf. in Bulletpoints)</label><textarea name="notizen" style="min-height:90px">${escapeHtml(data.notizen || '')}</textarea></div>
          <div class="form-grid">
            <div class="field"><label>Arbeitsbeginn (Uhrzeit)</label><input type="time" name="arbeitsbeginn" id="tb-beginn" value="${data.arbeitsbeginn}"></div>
            <div class="field"><label>Arbeitsende (Uhrzeit)</label><input type="time" name="arbeitsende" id="tb-ende" value="${data.arbeitsende}"></div>
            <div class="field"><label>Pause (in h)</label><input type="number" step="0.25" min="0" name="pause" id="tb-pause" value="${data.pause}"></div>
            <div class="field"><label>Arbeitszeit ges. (in h)</label><input type="number" step="0.01" min="0" name="arbeitszeitGesamt" id="tb-gesamt" value="${data.arbeitszeitGesamt ?? calcArbeitszeit(data.arbeitsbeginn, data.arbeitsende, data.pause)}"></div>
          </div>
          <div class="field"><label>Tätigkeitsbeschreibung (Projekte/Aufgaben)</label><textarea name="taetigkeitsbeschreibung" style="min-height:90px">${escapeHtml(data.taetigkeitsbeschreibung || '')}</textarea></div>
          <div class="field"><label>Arbeitsort</label>
            <div class="toggle-group" id="tb-arbeitsort">
              ${ARBEITSORTE.map((o) => `<button type="button" data-val="${o.id}" class="${o.id === data.arbeitsort ? 'active' : ''}">${escapeHtml(o.titel)}</button>`).join('')}
            </div>
            <input type="hidden" name="arbeitsort" id="tb-arbeitsort-val" value="${data.arbeitsort}">
          </div>
          <div class="field"><label>Besonderheiten</label>
            <div class="pill-radio-group">
              ${BESONDERHEITEN.map((b) => `
                <label>
                  <input type="radio" name="besonderheit" value="${b.id}" ${b.id === (data.besonderheit || 'keine') ? 'checked' : ''}>
                  <span>${escapeHtml(b.titel)}</span>
                </label>
              `).join('')}
            </div>
          </div>
          <div class="field"><label>Verfassungsdatum</label><input type="date" name="verfassungsdatum" value="${data.verfassungsdatum}"></div>
          <div class="field"><label>Medienupload (Foto/Video)</label><div id="tb-medien-host"></div></div>
          <div id="tb-sig-host"></div>
          <div class="modal-actions">
            ${isEdit ? '<button type="button" class="btn btn-danger" id="btn-delete">Löschen</button>' : ''}
            <span class="spacer"></span>
            ${isEdit ? '<button type="button" class="btn" id="btn-duplizieren">Duplizieren</button>' : ''}
            <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary" id="btn-submit">Speichern</button>
            <button type="submit" class="btn btn-primary" id="btn-submit-next">+ Arbeitstag</button>
          </div>
        </form>
      `,
    });

    const beginnInput = body.querySelector('#tb-beginn');
    const endeInput = body.querySelector('#tb-ende');
    const pauseInput = body.querySelector('#tb-pause');
    const gesamtInput = body.querySelector('#tb-gesamt');
    function recalcGesamt() {
      gesamtInput.value = calcArbeitszeit(beginnInput.value, endeInput.value, pauseInput.value);
    }
    [beginnInput, endeInput, pauseInput].forEach((el) => el.addEventListener('change', recalcGesamt));

    const arbeitsortGroup = body.querySelector('#tb-arbeitsort');
    const arbeitsortVal = body.querySelector('#tb-arbeitsort-val');
    arbeitsortGroup.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        arbeitsortGroup.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        arbeitsortVal.value = btn.dataset.val;
      });
    });

    const medienEditor = mountMedienDropzone(body.querySelector('#tb-medien-host'), data.medien || []);
    const sig = mountSignaturePad(body.querySelector('#tb-sig-host'), { label: 'Unterschrift Mitarbeiter' });
    if (data.unterschriftMitarbeiter) {
      const img = new Image();
      img.onload = () => {
        const canvas = body.querySelector('#tb-sig-host canvas');
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      };
      img.src = data.unterschriftMitarbeiter;
    }

    body.querySelector('#btn-cancel').addEventListener('click', close);
    if (isEdit) {
      body.querySelector('#btn-delete').addEventListener('click', async () => {
        if (!confirmDelete('Tagesbericht wirklich löschen?')) return;
        await remove('zeiterfassung', data.id);
        for (const it of data.medien || []) { if (it.path) await deleteBlobFromStorage(it.path); }
        if (data.unterschriftPath) await deleteBlobFromStorage(data.unterschriftPath);
        toast('Tagesbericht gelöscht');
        close();
        render(container);
      });
      body.querySelector('#btn-duplizieren').addEventListener('click', async () => {
        const kopie = await persistTagesberichtBlobs({ ...collect(), id: uid() });
        await put('zeiterfassung', kopie);
        eintraege.unshift(kopie);
        toast('Tagesbericht dupliziert', 'success');
        close();
        openTagesberichtForm(kopie);
      });
    }

    function collect() {
      const fd = new FormData(body.querySelector('#tb-form'));
      const beginn = (fd.get('arbeitsbeginn') || '').toString();
      const ende = (fd.get('arbeitsende') || '').toString();
      return {
        ...data,
        mitarbeiterId: fd.get('mitarbeiterId') || '',
        projektId: fd.get('projektId') || '',
        notizen: (fd.get('notizen') || '').toString().trim(),
        arbeitsbeginn: beginn,
        arbeitsende: ende,
        pause: Number(fd.get('pause')) || 0,
        arbeitszeitGesamt: Number(fd.get('arbeitszeitGesamt')) || 0,
        taetigkeitsbeschreibung: (fd.get('taetigkeitsbeschreibung') || '').toString().trim(),
        arbeitsort: fd.get('arbeitsort') || 'aussendienst',
        besonderheit: fd.get('besonderheit') || 'keine',
        verfassungsdatum: fd.get('verfassungsdatum') || data.verfassungsdatum,
        medien: medienEditor.getMedien(),
        unterschriftMitarbeiter: sig.getDataUrl() || data.unterschriftMitarbeiter || null,
        // Kompatibilität mit der bestehenden Listenansicht:
        datum: fd.get('verfassungsdatum') || data.verfassungsdatum,
        startzeit: beginn,
        endzeit: ende,
        dauerMinuten: Math.round((Number(fd.get('arbeitszeitGesamt')) || 0) * 60),
        beschreibung: (fd.get('taetigkeitsbeschreibung') || '').toString().trim(),
        taetigkeit: data.taetigkeit || 'baustelle',
        abgerechnet: data.abgerechnet || false,
        istTagesbericht: true,
      };
    }

    body.querySelector('#tb-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitter = e.submitter;
      let updated = collect();
      if (!updated.mitarbeiterId) { toast('Bitte einen Mitarbeiter wählen', 'danger'); return; }
      updated = await persistTagesberichtBlobs(updated);
      await put('zeiterfassung', updated);
      if (!isEdit) eintraege.unshift(updated);
      else {
        const idx = eintraege.findIndex((x) => x.id === updated.id);
        if (idx >= 0) eintraege[idx] = updated;
      }
      toast('Tagesbericht gespeichert', 'success');
      close();
      if (submitter?.id === 'btn-submit-next') {
        openTagesberichtForm({
          ...updated,
          id: uid(),
          verfassungsdatum: addDaysISO(updated.verfassungsdatum, 1),
          datum: addDaysISO(updated.verfassungsdatum, 1),
          medien: [],
          unterschriftMitarbeiter: null,
        });
      } else {
        renderTable();
      }
    });
  }

  function openForm(entry, { isNewFromTimer = false } = {}) {
    const isEdit = !!entry && !isNewFromTimer;
    const data = entry || {
      id: uid(), projektId: '', mitarbeiterId: '', datum: new Date().toISOString().slice(0, 10),
      dauerMinuten: 60, beschreibung: '', abgerechnet: false,
      startzeit: nowHHMM(), endzeit: addMinutesHHMM(nowHHMM(), 60), taetigkeit: 'baustelle',
    };
    const { body, close } = openModal({
      title: isNewFromTimer ? 'Zeit speichern' : (isEdit ? 'Eintrag bearbeiten' : 'Neuer Eintrag'),
      bodyHtml: `
        <form id="ze-form">
          <div class="form-grid">
            <div class="field"><label>Projekt *</label>
              <select name="projektId" required>${projekte.map((p) => `<option value="${p.id}" ${p.id === data.projektId ? 'selected' : ''}>${escapeHtml(p.titel)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Mitarbeiter</label>
              <select name="mitarbeiterId"><option value="">–</option>${mitarbeiter.map((m) => `<option value="${m.id}" ${m.id === data.mitarbeiterId ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Datum</label><input type="date" name="datum" value="${data.datum}"></div>
            <div class="field"><label>Startzeit</label><input type="time" name="startzeit" id="ze-startzeit" value="${data.startzeit || ''}"></div>
            <div class="field"><label>Endzeit</label><input type="time" name="endzeit" id="ze-endzeit" value="${data.endzeit || ''}"></div>
            <div class="field"><label>Dauer (Minuten)</label><input type="number" min="1" name="dauerMinuten" id="ze-dauer" value="${data.dauerMinuten}"></div>
            <div class="field"><label>Tätigkeit</label>
              <select name="taetigkeit">${TAETIGKEITEN.map((t) => `<option value="${t.id}" ${t.id === (data.taetigkeit || 'baustelle') ? 'selected' : ''}>${escapeHtml(t.titel)}</option>`).join('')}</select>
            </div>
            <div class="field col-span-2"><label>Beschreibung</label><textarea name="beschreibung">${escapeHtml(data.beschreibung || '')}</textarea></div>
            <div class="field field-checkbox col-span-2"><input type="checkbox" name="abgerechnet" id="ze-abgerechnet" ${data.abgerechnet ? 'checked' : ''}><label for="ze-abgerechnet">Bereits abgerechnet</label></div>
          </div>
          <div class="modal-actions">
            ${isEdit ? '<button type="button" class="btn btn-danger" id="btn-delete">Löschen</button>' : ''}
            <span class="spacer"></span>
            <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Speichern</button>
          </div>
        </form>
      `,
    });
    const startzeitInput = body.querySelector('#ze-startzeit');
    const endzeitInput = body.querySelector('#ze-endzeit');
    const dauerInput = body.querySelector('#ze-dauer');
    function recalcDauer() {
      if (!startzeitInput.value || !endzeitInput.value) return;
      dauerInput.value = minutesBetweenHHMM(startzeitInput.value, endzeitInput.value) || 1;
    }
    startzeitInput.addEventListener('change', recalcDauer);
    endzeitInput.addEventListener('change', recalcDauer);
    body.querySelector('#btn-cancel').addEventListener('click', close);
    if (isEdit) {
      body.querySelector('#btn-delete').addEventListener('click', async () => {
        if (!confirmDelete('Eintrag wirklich löschen?')) return;
        await remove('zeiterfassung', data.id);
        toast('Eintrag gelöscht');
        close();
        render(container);
      });
    }
    body.querySelector('#ze-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      updated.projektId = fd.get('projektId') || '';
      updated.mitarbeiterId = fd.get('mitarbeiterId') || '';
      updated.datum = fd.get('datum') || data.datum;
      updated.startzeit = (fd.get('startzeit') || '').toString();
      updated.endzeit = (fd.get('endzeit') || '').toString();
      updated.dauerMinuten = Number(fd.get('dauerMinuten')) || 0;
      updated.taetigkeit = fd.get('taetigkeit') || 'baustelle';
      updated.beschreibung = (fd.get('beschreibung') || '').toString().trim();
      updated.abgerechnet = fd.get('abgerechnet') === 'on';
      if (!updated.projektId) { toast('Bitte ein Projekt wählen', 'danger'); return; }
      await put('zeiterfassung', updated);
      toast('Zeit gespeichert', 'success');
      close();
      render(container);
    });
  }

  renderTimer();
  renderTable();
  setMode('einsaetze');

  return () => { if (tickInterval) clearInterval(tickInterval); };
}
