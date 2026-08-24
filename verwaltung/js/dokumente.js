import { getAll, put, remove, GEWERKE } from './db.js';
import { uid, escapeHtml, formatDate, formatDateTime, todayISO, toast, compressImage, openDokumentMitVorbelegung, getCurrentMitarbeiterId, katalogOptionsHtml } from './utils.js';
import { openModal, confirmDelete, mountProgressBar } from './ui.js';
import { buildBerichtPdfBlob } from './docpdf.js';
import { openEmailComposer } from './emailsend.js';
import { sendDocumentViaWhatsApp } from './whatsapp.js';
import { mountSignaturePad } from './signature.js';
import { FIREBASE_ENABLED, uploadBlobToStorage, deleteBlobFromStorage } from './blobstore.js';
import { mountVoiceRecorder } from './voicenote.js';

function nowHHMM() {
  return new Date().toTimeString().slice(0, 5);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Foto konnte nicht gelesen werden.'));
    reader.readAsDataURL(blob);
  });
}

/** Repeatable Raum/Zeile-Editor für Berichte (z.B. je Raum eine Zustandsnotiz). */
function mountRaeumeEditor(host, { mitMassen = false, mitFotoProZeile = false, mitMarkierung = false } = {}) {
  let rows = [];
  function updateM2(row, i) {
    if (!mitMassen) return;
    const m2El = host.querySelector(`.rz-m2[data-i="${i}"]`);
    const laenge = Number(row.laenge) || 0;
    const breite = Number(row.breite) || 0;
    if (m2El) m2El.textContent = laenge && breite ? (laenge * breite).toFixed(2) + ' m²' : '';
  }
  function render() {
    host.innerHTML = `
      <div class="rz-list">
        ${rows.map((r, i) => `
          <div class="flex-row flex-wrap rz-row" data-i="${i}" style="align-items:center;margin-bottom:6px;gap:6px">
            <input type="text" class="rz-raum" placeholder="Raum/Bereich" value="${escapeHtml(r.raum || '')}" style="flex:1">
            ${mitMassen ? `
              <input type="number" step="0.01" min="0" class="rz-laenge" placeholder="Länge (m)" value="${escapeHtml(r.laenge || '')}" style="width:90px">
              <input type="number" step="0.01" min="0" class="rz-breite" placeholder="Breite (m)" value="${escapeHtml(r.breite || '')}" style="width:90px">
              <span class="text-mute rz-m2" data-i="${i}" style="width:70px">${(Number(r.laenge) && Number(r.breite)) ? (Number(r.laenge) * Number(r.breite)).toFixed(2) + ' m²' : ''}</span>
            ` : ''}
            <input type="text" class="rz-beschreibung" placeholder="Beschreibung/Zustand" value="${escapeHtml(r.beschreibung || '')}" style="flex:2">
            <button type="button" class="btn btn-sm btn-ghost rz-del" title="Entfernen">✕</button>
            ${mitFotoProZeile ? `<div class="col-span-2" style="width:100%" data-foto-i="${i}"></div>` : ''}
          </div>
        `).join('') || '<p class="text-mute" style="font-size:12px">Noch keine Räume/Zeilen.</p>'}
      </div>
      <button type="button" class="btn btn-sm rz-add" style="margin-top:4px">+ Raum/Zeile hinzufügen</button>
    `;
    host.querySelectorAll('.rz-row').forEach((row) => {
      const i = Number(row.dataset.i);
      row.querySelector('.rz-raum').addEventListener('input', (e) => { rows[i].raum = e.target.value; });
      row.querySelector('.rz-beschreibung').addEventListener('input', (e) => { rows[i].beschreibung = e.target.value; });
      row.querySelector('.rz-laenge')?.addEventListener('input', (e) => { rows[i].laenge = e.target.value; updateM2(rows[i], i); });
      row.querySelector('.rz-breite')?.addEventListener('input', (e) => { rows[i].breite = e.target.value; updateM2(rows[i], i); });
      row.querySelector('.rz-del').addEventListener('click', () => { rows.splice(i, 1); render(); });
    });
    if (mitFotoProZeile) {
      host.querySelectorAll('[data-foto-i]').forEach((el) => {
        const i = Number(el.dataset.fotoI);
        const editor = mountFotoEditor(el, { mitMarkierung });
        rows[i]._fotoEditor = editor;
      });
    }
    host.querySelector('.rz-add').addEventListener('click', () => { rows.push({ raum: '', beschreibung: '' }); render(); });
  }
  render();
  return {
    getRaeume: () => rows
      .filter((r) => r.raum || r.beschreibung || r.laenge || r.breite)
      .map((r) => ({ raum: r.raum, beschreibung: r.beschreibung, laenge: r.laenge, breite: r.breite, fotos: r._fotoEditor ? r._fotoEditor.getFotos() : [] })),
  };
}

/**
 * Öffnet ein Foto zur Markierung von Mängeln: Klick/Tap auf das Bild setzt
 * einen roten Kreis an der Stelle. Die Markierungen werden fest ins Bild
 * eingebrannt (wie bei der Unterschrift ein flaches PNG) - kein separates
 * Ebenen-Modell nötig, das würde für den Zweck (auf einen Blick zeigen, wo
 * der Mangel sitzt) unnötig kompliziert.
 */
function openMarkierungModal(dataUrl, onDone) {
  const img = new Image();
  img.onload = () => {
    const marker = [];
    const { body, close } = openModal({
      title: 'Mangel auf dem Foto markieren',
      bodyHtml: `
        <p class="hint">Auf die Stelle im Foto tippen/klicken, um eine Markierung zu setzen.</p>
        <div style="display:flex;justify-content:center">
          <canvas id="mk-canvas" style="max-width:100%;border-radius:8px;touch-action:none;cursor:crosshair"></canvas>
        </div>
        <div class="modal-actions" style="border:none;padding-top:10px">
          <button type="button" class="btn btn-sm" id="mk-clear">Markierungen entfernen</button>
          <span class="spacer"></span>
          <button type="button" class="btn" id="mk-cancel">Abbrechen</button>
          <button type="button" class="btn btn-primary" id="mk-save">Übernehmen</button>
        </div>
      `,
    });
    const canvas = body.querySelector('#mk-canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    const radius = Math.max(10, Math.round(img.naturalWidth * 0.02));
    function draw() {
      ctx.drawImage(img, 0, 0);
      for (const m of marker) {
        ctx.beginPath();
        ctx.arc(m.x, m.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = radius * 0.35;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(m.x, m.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = '#e53935';
        ctx.lineWidth = radius * 0.22;
        ctx.stroke();
      }
    }
    draw();
    canvas.addEventListener('pointerdown', (e) => {
      const rect = canvas.getBoundingClientRect();
      marker.push({
        x: (e.clientX - rect.left) * (canvas.width / rect.width),
        y: (e.clientY - rect.top) * (canvas.height / rect.height),
      });
      draw();
    });
    body.querySelector('#mk-clear').addEventListener('click', () => { marker.length = 0; draw(); });
    body.querySelector('#mk-cancel').addEventListener('click', close);
    body.querySelector('#mk-save').addEventListener('click', () => {
      onDone(canvas.toDataURL('image/jpeg', 0.85));
      close();
    });
  };
  img.src = dataUrl;
}

/** Foto-Aufnahme/-Upload für Berichte; komprimiert und embedded als DataURL. */
function mountFotoEditor(host, { mitMarkierung = false } = {}) {
  let fotos = [];
  function render() {
    host.innerHTML = `
      <div class="foto-grid tag-list" style="margin-bottom:6px">
        ${fotos.map((f, i) => `
          <div class="foto-thumb" data-i="${i}">
            <img src="${f}" alt="Foto">
            ${mitMarkierung ? '<button type="button" class="btn btn-sm foto-markieren" title="Mangel auf dem Foto markieren">🎯</button>' : ''}
            <button type="button" class="btn btn-sm btn-danger foto-del" title="Entfernen">✕</button>
          </div>
        `).join('')}
      </div>
      <label class="btn btn-sm" style="cursor:pointer">
        📷 Foto(s) hinzufügen
        <input type="file" accept="image/*" multiple hidden class="foto-input">
      </label>
    `;
    host.querySelectorAll('.foto-del').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.closest('.foto-thumb').dataset.i);
        fotos.splice(i, 1);
        render();
      });
    });
    host.querySelectorAll('.foto-markieren').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.closest('.foto-thumb').dataset.i);
        openMarkierungModal(fotos[i], (markiertesDataUrl) => {
          fotos[i] = markiertesDataUrl;
          render();
        });
      });
    });
    host.querySelector('.foto-input').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      for (const file of files) {
        try {
          const compressed = await compressImage(file, { maxWidth: 1000, quality: 0.75 });
          fotos.push(await blobToDataUrl(compressed));
        } catch (err) {
          toast(err.message, 'danger');
        }
      }
      e.target.value = '';
      render();
    });
  }
  render();
  return { getFotos: () => fotos };
}

/** Zweispaltiges Label/Eingabefeld-Raster (z.B. Geräte-Steckbrief, Messwerte). */
function mountKopfdatenEditor(host, { titel, felder }) {
  host.innerHTML = `
    ${titel ? `<p style="font-weight:600;margin:0 0 6px">${escapeHtml(titel)}</p>` : ''}
    <div class="form-grid">
      ${felder.map((f, i) => `
        <div class="field"><label>${escapeHtml(f.label)}</label>
          <input type="${f.typ === 'zahl' ? 'number' : f.typ === 'datum' ? 'date' : 'text'}" class="kd-input" data-i="${i}" ${f.typ === 'zahl' ? 'step="any"' : ''}>
        </div>
      `).join('')}
    </div>
  `;
  return {
    getBlock: () => ({
      titel,
      felder: felder
        .map((f, i) => ({ label: f.label, wert: host.querySelector(`.kd-input[data-i="${i}"]`).value.trim() }))
        .filter((f) => f.wert),
    }),
  };
}

/** Liste von Ja/Nein-Fragen mit Ampel-Toggle (Standard: Nein). */
function mountJaNeinEditor(host, { titel, fragen }) {
  host.innerHTML = `
    ${titel ? `<p style="font-weight:600;margin:0 0 6px">${escapeHtml(titel)}</p>` : ''}
    <div class="rz-list">
      ${fragen.map((f, i) => `
        <div class="flex-row" style="align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px" data-i="${i}">
          <span style="flex:1">${escapeHtml(f)}</span>
          <div class="toggle-group jn-toggle" data-i="${i}">
            <button type="button" data-val="ja">Ja</button>
            <button type="button" data-val="nein" class="active">Nein</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
  const state = fragen.map(() => 'nein');
  host.querySelectorAll('.jn-toggle').forEach((grp) => {
    const i = Number(grp.dataset.i);
    grp.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        state[i] = btn.dataset.val;
        grp.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });
  });
  return { getBlock: () => ({ titel, antworten: fragen.map((frage, i) => ({ frage, antwort: state[i] })) }) };
}

/** Liste abhakbarer Punkte (Sichtprüfung, Ergebnis, ...). */
function mountChecklisteEditor(host, { titel, punkte }) {
  host.innerHTML = `
    ${titel ? `<p style="font-weight:600;margin:0 0 6px">${escapeHtml(titel)}</p>` : ''}
    <div class="tag-list">
      ${punkte.map((p, i) => `
        <label class="field-checkbox" style="border:1px solid var(--border);border-radius:8px;padding:5px 10px;">
          <input type="checkbox" class="cl-check" data-i="${i}"> ${escapeHtml(p)}
        </label>
      `).join('')}
    </div>
  `;
  return {
    getBlock: () => ({
      titel,
      punkte: punkte.map((punkt, i) => ({ punkt, checked: host.querySelector(`.cl-check[data-i="${i}"]`).checked })),
    }),
  };
}

/** Frei konfigurierte Tabelle mit wiederholbaren Zeilen und optionaler Produkt-Berechnung (z.B. RPZ = B*A*E). */
function mountTabelleEditor(host, { titel, spalten, ergebnisSpalte }) {
  let rows = [{}];
  function produkt(row) {
    if (!ergebnisSpalte) return '';
    const zahlen = spalten.slice(1).map((s) => Number(row[s]) || 0);
    return zahlen.length ? zahlen.reduce((a, b) => a * b, 1) : '';
  }
  function render() {
    host.innerHTML = `
      ${titel ? `<p style="font-weight:600;margin:0 0 6px">${escapeHtml(titel)}</p>` : ''}
      <div style="overflow-x:auto">
        <table class="data-table">
          <thead><tr>${spalten.map((s) => `<th>${escapeHtml(s)}</th>`).join('')}${ergebnisSpalte ? `<th>${escapeHtml(ergebnisSpalte)}</th>` : ''}<th></th></tr></thead>
          <tbody>
            ${rows.map((r, ri) => `
              <tr data-ri="${ri}">
                ${spalten.map((s, si) => { const numerisch = ergebnisSpalte && si > 0; return `<td><input type="${numerisch ? 'number' : 'text'}" ${numerisch ? 'step="any"' : ''} class="tb-cell" data-ri="${ri}" data-s="${escapeHtml(s)}" value="${escapeHtml(r[s] ?? '')}" style="width:${si === 0 || !ergebnisSpalte ? '140px' : '70px'}"></td>`; }).join('')}
                ${ergebnisSpalte ? `<td class="tb-ergebnis" data-ri="${ri}">${produkt(r)}</td>` : ''}
                <td><button type="button" class="btn btn-sm btn-ghost tb-del" data-ri="${ri}">✕</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <button type="button" class="btn btn-sm tb-add" style="margin-top:6px">+ Zeile hinzufügen</button>
    `;
    host.querySelectorAll('.tb-cell').forEach((input) => {
      input.addEventListener('input', (e) => {
        const ri = Number(e.target.dataset.ri);
        rows[ri][e.target.dataset.s] = e.target.value;
        const erg = host.querySelector(`.tb-ergebnis[data-ri="${ri}"]`);
        if (erg) erg.textContent = produkt(rows[ri]);
      });
    });
    host.querySelectorAll('.tb-del').forEach((btn) => {
      btn.addEventListener('click', () => { rows.splice(Number(btn.dataset.ri), 1); render(); });
    });
    host.querySelector('.tb-add').addEventListener('click', () => { rows.push({}); render(); });
  }
  render();
  return {
    getBlock: () => ({
      titel, spalten, ergebnisSpalte,
      rows: rows.filter((r) => spalten.some((s) => r[s])),
    }),
  };
}

/**
 * Laufendes Bautagebuch: pro Tag ein Eintrag mit Datum/Wetter/Personenzahl/
 * Vorkommnissen - eigener Abschnittstyp statt Wiederverwendung von
 * mountTabelleEditor, da die Spalten fest (nicht frei benennbar) und die
 * Eingabetypen unterschiedlich sind (Datum-Picker, Zahl, Freitext).
 */
function mountTagesprotokollEditor(host, { titel } = {}) {
  let rows = [{ datum: todayISO(), wetter: '', personen: '', vorkommnisse: '' }];
  function render() {
    host.innerHTML = `
      ${titel ? `<p style="font-weight:600;margin:0 0 6px">${escapeHtml(titel)}</p>` : ''}
      <div class="rz-list">
        ${rows.map((r, i) => `
          <div class="flex-row flex-wrap rz-row" data-i="${i}" style="align-items:center;margin-bottom:6px;gap:6px">
            <input type="date" class="tp-datum" value="${escapeHtml(r.datum || '')}" style="width:150px">
            <input type="text" class="tp-wetter" placeholder="Wetter" value="${escapeHtml(r.wetter || '')}" style="width:140px">
            <input type="number" min="0" class="tp-personen" placeholder="Personen vor Ort" value="${escapeHtml(r.personen || '')}" style="width:150px">
            <input type="text" class="tp-vorkommnisse" placeholder="Besonderheiten/Vorkommnisse" value="${escapeHtml(r.vorkommnisse || '')}" style="flex:1;min-width:200px">
            <button type="button" class="btn btn-sm btn-ghost tp-del" title="Entfernen">✕</button>
          </div>
        `).join('') || '<p class="text-mute" style="font-size:12px">Noch keine Tageseinträge.</p>'}
      </div>
      <button type="button" class="btn btn-sm tp-add" style="margin-top:4px">+ Tageseintrag hinzufügen</button>
    `;
    host.querySelectorAll('.rz-row').forEach((row) => {
      const i = Number(row.dataset.i);
      row.querySelector('.tp-datum').addEventListener('input', (e) => { rows[i].datum = e.target.value; });
      row.querySelector('.tp-wetter').addEventListener('input', (e) => { rows[i].wetter = e.target.value; });
      row.querySelector('.tp-personen').addEventListener('input', (e) => { rows[i].personen = e.target.value; });
      row.querySelector('.tp-vorkommnisse').addEventListener('input', (e) => { rows[i].vorkommnisse = e.target.value; });
      row.querySelector('.tp-del').addEventListener('click', () => { rows.splice(i, 1); render(); });
    });
    host.querySelector('.tp-add').addEventListener('click', () => { rows.push({ datum: todayISO(), wetter: '', personen: '', vorkommnisse: '' }); render(); });
  }
  render();
  return {
    getEintraege: () => rows.filter((r) => r.wetter || r.personen || r.vorkommnisse),
  };
}

/**
 * Multi-select checklist (mit Suche) über Katalog-Einträge; ausgewählte Bezeichnungen
 * werden als Aufzählung an den Bericht-Text übergeben. Bleibt danach frei editierbar.
 */
function mountKatalogPicker(host, { items, label, placeholder, onInsert }) {
  host.innerHTML = `
    <div class="field col-span-2">
      <label>${escapeHtml(label)}</label>
      <input type="text" class="qp-search" placeholder="${escapeHtml(placeholder || 'Suchen ...')}" style="margin-bottom:6px">
      <div class="qp-list tag-list"></div>
      <button type="button" class="btn btn-sm qp-insert" style="margin-top:6px;align-self:flex-start">+ Ausgewählte in Text einfügen</button>
    </div>
  `;
  const listHost = host.querySelector('.qp-list');
  function renderList(filter) {
    const q = (filter || '').trim().toLowerCase();
    const filtered = items.filter((it) => !q || (it.bezeichnung || '').toLowerCase().includes(q));
    listHost.innerHTML = filtered.length === 0
      ? '<p class="text-mute" style="font-size:12px">Keine Treffer.</p>'
      : filtered.slice(0, 60).map((it) => `
          <label class="field-checkbox" style="border:1px solid var(--border);border-radius:8px;padding:5px 10px;">
            <input type="checkbox" class="qp-check" value="${escapeHtml(it.id)}"> ${escapeHtml(it.bezeichnung)}
          </label>
        `).join('');
  }
  renderList('');
  host.querySelector('.qp-search').addEventListener('input', (e) => renderList(e.target.value));
  host.querySelector('.qp-insert').addEventListener('click', () => {
    const checked = Array.from(host.querySelectorAll('.qp-check:checked')).map((c) => c.value);
    if (checked.length === 0) return;
    const lines = checked.map((id) => items.find((it) => it.id === id)?.bezeichnung).filter(Boolean).map((b) => `- ${b}`);
    onInsert(lines.join('\n'));
    host.querySelectorAll('.qp-check:checked').forEach((c) => { c.checked = false; });
  });
}

export const DOKUMENT_KATEGORIEN = [
  { id: 'bericht', titel: 'Bericht' },
  { id: 'stundenzettel', titel: 'Stundenzettel' },
  { id: 'bild', titel: 'Bild' },
  { id: 'vertrag', titel: 'Vertrag' },
  { id: 'rechnung', titel: 'Rechnung' },
  { id: 'angebot', titel: 'Angebot' },
  { id: 'sonstiges', titel: 'Sonstiges' },
];

export const KUNDE_DOKUMENT_KATEGORIEN = DOKUMENT_KATEGORIEN.filter((k) => ['rechnung', 'angebot', 'vertrag', 'bericht', 'sonstiges'].includes(k.id));

function katLabel(id) {
  return DOKUMENT_KATEGORIEN.find((k) => k.id === id)?.titel || 'Sonstiges';
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function iconFor(mime) {
  if ((mime || '').startsWith('image/')) return '🖼️';
  if (mime === 'application/pdf') return '📄';
  return '📎';
}

export async function saveDokument({ bezugTyp, bezugId, kategorie, name, mime, blob }) {
  const doc = {
    id: uid(), bezugTyp, bezugId, kategorie: kategorie || 'sonstiges',
    name, mime: mime || blob.type || 'application/octet-stream',
    groesse: blob.size || 0, erstelltAm: new Date().toISOString(),
  };
  if (FIREBASE_ENABLED) {
    const meta = await uploadBlobToStorage(`dokumente/${bezugTyp}/${bezugId}/${doc.id}`, blob);
    Object.assign(doc, meta);
  } else {
    doc.blob = blob;
  }
  await put('dokumente', doc);
  return doc;
}

/**
 * Renders an upload + list UI for arbitrary files (reports, timesheets, photos, contracts)
 * attached to a Projekt/Kunde/Mitarbeiter. Mirrors fotos.js but for any file type.
 */
export function renderDokumenteSection(host, bezugTyp, bezugId, { kategorien = DOKUMENT_KATEGORIEN, title = 'Dokumente', berichtContext = null, onProjektDatenGeaendert = null } = {}) {
  const zeigeBerichtsVorlage = berichtContext && kategorien.some((k) => k.id === 'bericht');

  async function openBerichtVorlage() {
    const [vorlagenAlle, katalog] = await Promise.all([getAll('vorlagen'), getAll('katalog')]);
    const vorlagen = vorlagenAlle.filter((v) => v.typ === 'dokumentation');
    if (vorlagen.length === 0) {
      toast('Noch keine Dokumentations-Vorlage angelegt (siehe Menü Vorlagen).', 'danger');
      return;
    }
    const settings = berichtContext.settings || {};
    const kunde = berichtContext.kunde || null;
    const projekt = berichtContext.projekt || '';
    const mitarbeiterName = berichtContext.mitarbeiter || '';
    const arbeitenItems = katalog.filter((k) => k.typ === 'leistung');
    const materialItems = katalog.filter((k) => k.typ === 'artikel');
    const zeitPresets = ['0.25', '0.5', '0.75', '1', '1.5', '2', '2.5', '3', '4', '5', '6', '7', '8'];

    const { body, close } = openModal({
      title: 'Bericht aus Vorlage erstellen',
      wide: true,
      bodyHtml: `
        <div class="form-grid">
          <div class="field col-span-2"><label>Vorlage</label>
            <select id="ber-vorlage">${vorlagen.map((v) => `<option value="${v.id}">${escapeHtml(v.name)}</option>`).join('')}</select>
          </div>
          <div class="field col-span-2"><label>Titel</label><input id="ber-titel" type="text"></div>
          <div class="field"><label>Datum</label><input id="ber-datum" type="date" value="${todayISO()}"></div>
          <div class="field"><label>Uhrzeit</label><input id="ber-uhrzeit" type="time" value="${nowHHMM()}"></div>
          <div class="field"><label>Arbeitszeit (Std.)</label><input id="ber-arbeitszeit" type="number" step="0.25" min="0" list="ber-zeit-presets" placeholder="frei wählbar oder eingeben"></div>
          <div class="field"><label>Fahrtzeit (Std.)</label><input id="ber-fahrtzeit" type="number" step="0.25" min="0" list="ber-zeit-presets" placeholder="frei wählbar oder eingeben"></div>
          <datalist id="ber-zeit-presets">${zeitPresets.map((z) => `<option value="${z}"></option>`).join('')}</datalist>
          <div class="field col-span-2"><button type="button" class="btn btn-sm" id="btn-zeit-insert" style="align-self:flex-start">+ Arbeits-/Fahrtzeit in Text einfügen</button></div>
        </div>
        <div class="divider"></div>
        <div class="form-grid">
          <div id="ber-arbeiten-picker"></div>
          <div id="ber-material-picker"></div>
        </div>
        <div id="ber-abschnitte-host"></div>
        <div class="field"><label>Text (bearbeitbar)</label><textarea id="ber-text" style="min-height:260px"></textarea></div>
        <div id="ber-checkliste-host"></div>
        <div class="divider"></div>
        <div class="field col-span-2"><label id="ber-raeume-label">Räume / Zeilen (optional, erscheinen als Tabelle im PDF)</label></div>
        <div id="ber-raeume-host"></div>
        <div class="divider"></div>
        <div class="field col-span-2"><label>Fotos (optional)</label></div>
        <div id="ber-fotos-host"></div>
        <div class="divider"></div>
        <div class="form-grid" id="ber-sig-host"></div>
        <div class="modal-actions">
          <span class="spacer"></span>
          <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
          ${kunde?.telefon ? '<button type="button" class="btn" id="btn-send-whatsapp">📱 Per WhatsApp senden</button>' : ''}
          <button type="button" class="btn" id="btn-zu-angebot" hidden>📐 Als Positionen ins Angebot übernehmen</button>
          <button type="button" class="btn" id="btn-send-email">✉️ Per E-Mail senden</button>
          <button type="button" class="btn btn-primary" id="btn-save-pdf">Als PDF speichern</button>
        </div>
        <div id="ber-save-progress-host"></div>
      `,
    });
    const vorlageSelect = body.querySelector('#ber-vorlage');
    const titelInput = body.querySelector('#ber-titel');
    const datumInput = body.querySelector('#ber-datum');
    const uhrzeitInput = body.querySelector('#ber-uhrzeit');
    const textArea = body.querySelector('#ber-text');

    function appendToText(str) {
      if (!str) return;
      textArea.value = (textArea.value ? textArea.value.replace(/\s+$/, '') + '\n' : '') + str + '\n';
    }
    body.querySelector('#btn-zeit-insert').addEventListener('click', () => {
      const az = body.querySelector('#ber-arbeitszeit').value;
      const fz = body.querySelector('#ber-fahrtzeit').value;
      const lines = [];
      if (az) lines.push(`Arbeitszeit: ${az} Std.`);
      if (fz) lines.push(`Fahrtzeit: ${fz} Std.`);
      appendToText(lines.join('\n'));
    });
    mountKatalogPicker(body.querySelector('#ber-arbeiten-picker'), {
      items: arbeitenItems, label: 'Ausgeführte Arbeiten – Auswahl (zusätzlich frei im Text ergänzbar)',
      placeholder: 'Leistung suchen ...', onInsert: appendToText,
    });
    mountKatalogPicker(body.querySelector('#ber-material-picker'), {
      items: materialItems, label: 'Material – Auswahl (zusätzlich frei im Text ergänzbar)',
      placeholder: 'Material suchen ...', onInsert: appendToText,
    });
    const raeumeHost = body.querySelector('#ber-raeume-host');
    const raeumeLabel = body.querySelector('#ber-raeume-label');
    let raeumeEditor = mountRaeumeEditor(raeumeHost);
    const fotoEditor = mountFotoEditor(body.querySelector('#ber-fotos-host'));
    const sigHost = body.querySelector('#ber-sig-host');
    let sigPads = [];
    function mountSigPads(labels) {
      sigHost.innerHTML = '';
      sigPads = labels.map((label) => {
        const div = document.createElement('div');
        sigHost.appendChild(div);
        return { label, pad: mountSignaturePad(div, { label }) };
      });
    }
    mountSigPads(['Unterschrift Kunde', 'Unterschrift Mitarbeiter']);

    const abschnitteHost = body.querySelector('#ber-abschnitte-host');
    const checklisteHost = body.querySelector('#ber-checkliste-host');
    let kopfdatenEditoren = [];
    let jaNeinEditoren = [];
    let checklisteEditoren = [];
    let tabellenEditoren = [];
    let tagesprotokollEditoren = [];

    function abschnittBox(host) {
      const div = document.createElement('div');
      div.style.marginBottom = '14px';
      host.appendChild(div);
      return div;
    }

    function renderAbschnitte(v) {
      abschnitteHost.innerHTML = '';
      checklisteHost.innerHTML = '';
      kopfdatenEditoren = [];
      jaNeinEditoren = [];
      checklisteEditoren = [];
      tabellenEditoren = [];
      tagesprotokollEditoren = [];
      const abschnitte = v?.abschnitte || [];
      let raeumeOptions = {};
      let sigLabels = ['Unterschrift Kunde', 'Unterschrift Mitarbeiter'];
      abschnitte.forEach((a) => {
        if (a.typ === 'kopfdaten') kopfdatenEditoren.push(mountKopfdatenEditor(abschnittBox(abschnitteHost), a));
        else if (a.typ === 'janein') jaNeinEditoren.push(mountJaNeinEditor(abschnittBox(abschnitteHost), a));
        else if (a.typ === 'tabelle') tabellenEditoren.push(mountTabelleEditor(abschnittBox(abschnitteHost), a));
        else if (a.typ === 'checkliste') checklisteEditoren.push(mountChecklisteEditor(abschnittBox(checklisteHost), a));
        else if (a.typ === 'tagesprotokoll') tagesprotokollEditoren.push(mountTagesprotokollEditor(abschnittBox(abschnitteHost), a));
        else if (a.typ === 'raeume') {
          raeumeOptions = { mitMassen: !!a.mitMassen, mitFotoProZeile: !!a.mitFotoProZeile, mitMarkierung: !!a.mitMarkierung };
          if (a.titel) raeumeLabel.textContent = a.titel;
        } else if (a.typ === 'unterschriften' && Array.isArray(a.labels) && a.labels.length) {
          sigLabels = a.labels;
        }
      });
      const hatRaeumeAbschnitt = abschnitte.some((a) => a.typ === 'raeume');
      if (!hatRaeumeAbschnitt) raeumeLabel.textContent = 'Räume / Zeilen (optional, erscheinen als Tabelle im PDF)';
      raeumeEditor = mountRaeumeEditor(raeumeHost, raeumeOptions);
      mountSigPads(sigLabels);
      // "Ins Angebot übernehmen" ergibt nur bei echter Maß-Erfassung Sinn (z.B.
      // Aufmaßprotokoll, mitMassen:true) - bei reinen Foto-Sammlungen ohne Maße
      // (z.B. Mängel- oder Bautagebuch-Fotos) gäbe es keine sinnvollen Mengen/
      // Positionen daraus abzuleiten.
      body.querySelector('#btn-zu-angebot').hidden = !abschnitte.some((a) => a.typ === 'raeume' && a.mitMassen);
    }

    function substitute(text) {
      return (text || '')
        .replaceAll('{{firma}}', settings.firmenname || '')
        .replaceAll('{{kunde}}', kunde?.firma || '')
        .replaceAll('{{projekt}}', projekt)
        .replaceAll('{{mitarbeiter}}', mitarbeiterName)
        .replaceAll('{{datum}}', formatDate(datumInput.value))
        .replaceAll('{{uhrzeit}}', uhrzeitInput.value || '');
    }
    function fillText() {
      const v = vorlagen.find((x) => x.id === vorlageSelect.value);
      titelInput.value = v?.name || 'Bericht';
      textArea.value = v ? substitute(v.textVorlage || '') : '';
      renderAbschnitte(v);
    }
    vorlageSelect.addEventListener('change', fillText);
    fillText();
    body.querySelector('#btn-cancel').addEventListener('click', close);

    function currentDatumIso() {
      return new Date(`${datumInput.value || todayISO()}T${uhrzeitInput.value || '00:00'}:00`).toISOString();
    }
    function currentUntertitel() {
      return [
        kunde?.firma ? `Kunde: ${kunde.firma}` : '',
        projekt ? `Projekt: ${projekt}` : '',
        mitarbeiterName ? `Mitarbeiter: ${mitarbeiterName}` : '',
      ].filter(Boolean).join(' · ');
    }
    function currentFilename() {
      return `${(titelInput.value || 'Bericht').replace(/[^a-z0-9äöüß _-]/gi, '')}-${datumInput.value || todayISO()}.pdf`;
    }
    function buildPdf() {
      return buildBerichtPdfBlob({
        settings, titel: titelInput.value || 'Bericht',
        untertitel: currentUntertitel(), text: textArea.value, datum: currentDatumIso(),
        raeume: raeumeEditor.getRaeume(), fotos: fotoEditor.getFotos(),
        unterschriften: sigPads.map((s) => ({ label: s.label, dataUrl: s.pad.getDataUrl() })).filter((s) => s.dataUrl),
        kopfdaten: kopfdatenEditoren.map((e) => e.getBlock()).filter((b) => b.felder.length),
        jaNeinAntworten: jaNeinEditoren.map((e) => e.getBlock()),
        checklisteAntworten: checklisteEditoren.map((e) => e.getBlock()),
        tabellenAbschnitte: tabellenEditoren.map((e) => e.getBlock()).filter((b) => b.rows.length),
        tagesprotokoll: tagesprotokollEditoren.flatMap((e) => e.getEintraege()),
      });
    }

    body.querySelector('#btn-save-pdf').addEventListener('click', async () => {
      const saveBtn = body.querySelector('#btn-save-pdf');
      saveBtn.disabled = true;
      const progress = mountProgressBar(body.querySelector('#ber-save-progress-host'), { indeterminate: true, label: 'Bericht wird erstellt und gespeichert ...' });
      let blob;
      try {
        blob = await buildPdf();
      } catch (err) {
        toast(err.message, 'danger');
        progress.remove();
        saveBtn.disabled = false;
        return;
      }
      await saveDokument({
        bezugTyp, bezugId, kategorie: 'bericht',
        name: currentFilename(), mime: 'application/pdf', blob,
      });
      progress.remove();
      toast('Bericht gespeichert', 'success');
      close();
      load();
    });

    body.querySelector('#btn-zu-angebot').addEventListener('click', () => {
      const zeilen = raeumeEditor.getRaeume().filter((r) => (r.raum || '').trim() || (r.beschreibung || '').trim());
      if (zeilen.length === 0) {
        toast('Bitte zuerst mindestens eine Raum-/Aufmaß-Zeile erfassen.', 'danger');
        return;
      }
      const positionen = zeilen.map((r) => {
        const flaeche = Number(r.laenge) > 0 && Number(r.breite) > 0 ? Math.round(Number(r.laenge) * Number(r.breite) * 100) / 100 : 0;
        return {
          id: uid(),
          bezeichnung: [r.raum, r.beschreibung].filter((s) => (s || '').trim()).join(' – ') || 'Position aus Aufmaß',
          beschreibung: '',
          einheit: flaeche ? 'm²' : 'Stk.',
          menge: flaeche || 1,
          einzelpreis: 0,
          steuersatz: settings.standardSteuersatz ?? 19,
        };
      });
      close();
      openDokumentMitVorbelegung('angebote', {
        kundeId: kunde?.id || '',
        projektId: bezugTyp === 'projekt' ? bezugId : '',
        betreff: titelInput.value || 'Angebot aus Aufmaß',
        positionen,
      });
    });

    body.querySelector('#btn-send-email').addEventListener('click', () => {
      openEmailComposer({
        to: kunde?.email || '',
        subject: `${titelInput.value || 'Bericht'}${kunde?.firma ? ' – ' + kunde.firma : ''}`,
        bodyText: `Guten Tag${kunde?.ansprechpartner ? ' ' + kunde.ansprechpartner : ''},\n\nanbei erhalten Sie ${titelInput.value || 'den Bericht'}.\n\nMit freundlichen Grüßen\n${settings.firmenname || ''}`,
        filename: currentFilename(),
        buildPdfBlob: buildPdf,
      });
    });

    const whatsappBtn = body.querySelector('#btn-send-whatsapp');
    if (whatsappBtn) {
      whatsappBtn.addEventListener('click', async () => {
        let blob;
        try {
          blob = await buildPdf();
        } catch (err) {
          toast(err.message, 'danger');
          return;
        }
        sendDocumentViaWhatsApp({
          phone: kunde.telefon,
          text: `${titelInput.value || 'Bericht'}${kunde?.firma ? ' – ' + kunde.firma : ''}`,
          pdfBlob: blob,
          filename: currentFilename(),
        });
      });
    }
  }

  /**
   * Schnellerfassung per Sprachaufnahme: statt einer vollständigen Vorlage
   * mit vielen Feldern nur Titel + Arbeitszeit + frei diktierter/
   * eingegebener Text + Fotos - für kurze Vor-Ort-Notizen ("Sprachnotiz"),
   * die als PDF im Dokumente-Bereich landen. Nutzt dieselbe PDF-Erzeugung
   * wie "Bericht aus Vorlage" (buildBerichtPdfBlob) und denselben
   * Foto-Editor (mountFotoEditor), nur ohne Räume/Checklisten/Unterschriften
   * - die lassen sich bei Bedarf weiterhin über die volle Vorlage erfassen.
   */
  async function openSprachnotizModal() {
    const settings = berichtContext.settings || {};
    const kunde = berichtContext.kunde || null;
    const projekt = berichtContext.projekt || '';
    const zeitPresets = ['0.25', '0.5', '0.75', '1', '1.5', '2', '2.5', '3', '4', '5', '6', '7', '8'];
    // Verwendetes Material lässt sich nur bei Projekten strukturiert erfassen
    // (verwendungen-Einträge hängen an einer projektId) - bei Kunden-Doku
    // bleibt der Abschnitt aus, dort kann Material nur im Freitext erwähnt
    // werden.
    const mitMaterial = bezugTyp === 'projekt';
    const katalog = mitMaterial ? await getAll('katalog') : [];
    const materialListe = [];

    const { body, close } = openModal({
      title: 'Sprachnotiz',
      wide: true,
      bodyHtml: `
        <div class="field"><label>Titel</label><input id="sn-titel" type="text" value="Sprachnotiz ${formatDate(todayISO())}"></div>
        <div class="field" style="margin-top:8px"><label>Arbeitszeit (Std.)</label>
          <div class="flex-row" style="gap:8px">
            <input id="sn-arbeitszeit" type="number" step="0.25" min="0" list="sn-zeit-presets" style="max-width:120px" placeholder="frei wählbar">
            <datalist id="sn-zeit-presets">${zeitPresets.map((z) => `<option value="${z}"></option>`).join('')}</datalist>
            <button type="button" class="btn btn-sm" id="btn-sn-zeit-insert">+ In Text einfügen</button>
          </div>
        </div>
        <div class="field" style="margin-top:8px"><label>Text</label><div id="sn-recorder-host"></div></div>
        <p class="hint">Arbeitszeit und verwendetes Material lassen sich einfach mitdiktieren (z.B. "3,5 Stunden gearbeitet, 5 Steckdosen und 20 Meter Kabel verbaut") - für die Nachkalkulation zusätzlich oben/unten strukturiert erfassen.</p>
        ${mitMaterial ? `
          <div class="field" style="margin-top:8px"><label>Verwendetes Material (optional)</label></div>
          <div class="flex-row flex-wrap" style="gap:6px;margin-bottom:8px">
            <select id="sn-mat-gewerk" style="flex:1;min-width:140px">
              <option value="">Alle Gewerke</option>
              ${GEWERKE.map((g) => `<option value="${g.id}">${escapeHtml(g.titel)}</option>`).join('')}
            </select>
            <select id="sn-mat-katalog" style="flex:2;min-width:200px">
              <option value="">– Artikel wählen –</option>
              ${katalogOptionsHtml(katalog, (k) => `${escapeHtml(k.bezeichnung)}${k.einheit ? ` (${escapeHtml(k.einheit)})` : ''}`)}
            </select>
            <input type="number" id="sn-mat-menge" placeholder="Menge" min="0" step="0.01" style="flex:1;min-width:90px">
            <button type="button" class="btn btn-sm" id="btn-sn-mat-add">+ hinzufügen</button>
          </div>
          <div id="sn-mat-list" class="tag-list" style="margin-bottom:8px"></div>
        ` : ''}
        <div class="field" style="margin-top:8px"><label>Fotos (optional)</label></div>
        <div id="sn-fotos-host"></div>
        <div class="modal-actions">
          <span class="spacer"></span>
          <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
          <button type="button" class="btn btn-primary" id="btn-save">Als PDF speichern</button>
        </div>
        <div id="sn-save-progress-host"></div>
      `,
    });
    const recorder = mountVoiceRecorder(body.querySelector('#sn-recorder-host'));
    const fotoEditor = mountFotoEditor(body.querySelector('#sn-fotos-host'), {});
    body.querySelector('#btn-sn-zeit-insert').addEventListener('click', () => {
      const az = body.querySelector('#sn-arbeitszeit').value;
      if (!az) return;
      const textarea = body.querySelector('#vn-text');
      textarea.value = (textarea.value ? textarea.value.replace(/\s+$/, '') + '\n' : '') + `Arbeitszeit: ${az} Std.`;
    });

    if (mitMaterial) {
      const matListHost = body.querySelector('#sn-mat-list');
      function renderMatListe() {
        matListHost.innerHTML = materialListe.length === 0 ? '' : materialListe.map((m, i) => `
          <span class="badge" style="display:inline-flex;align-items:center;gap:6px">
            ${escapeHtml(m.bezeichnung)}: ${m.menge}${m.einheit ? ` ${escapeHtml(m.einheit)}` : ''}
            <button type="button" class="mat-del" data-i="${i}" style="background:none;border:none;color:inherit;cursor:pointer;font-weight:700">✕</button>
          </span>
        `).join('');
        matListHost.querySelectorAll('.mat-del').forEach((btn) => {
          btn.addEventListener('click', () => { materialListe.splice(Number(btn.dataset.i), 1); renderMatListe(); });
        });
      }
      body.querySelector('#sn-mat-gewerk').addEventListener('change', (e) => {
        const gefiltert = e.target.value ? katalog.filter((k) => k.gewerk === e.target.value) : katalog;
        body.querySelector('#sn-mat-katalog').innerHTML = `<option value="">– Artikel wählen –</option>${katalogOptionsHtml(gefiltert, (k) => `${escapeHtml(k.bezeichnung)}${k.einheit ? ` (${escapeHtml(k.einheit)})` : ''}`)}`;
      });
      body.querySelector('#btn-sn-mat-add').addEventListener('click', () => {
        const katalogId = body.querySelector('#sn-mat-katalog').value;
        const menge = parseFloat(body.querySelector('#sn-mat-menge').value);
        const k = katalog.find((x) => x.id === katalogId);
        if (!k || !menge || menge <= 0) { toast('Bitte Artikel und Menge angeben', 'danger'); return; }
        materialListe.push({ katalogId, menge, bezeichnung: k.bezeichnung, einheit: k.einheit || '' });
        renderMatListe();
        const textarea = body.querySelector('#vn-text');
        textarea.value = (textarea.value ? textarea.value.replace(/\s+$/, '') + '\n' : '') + `Material: ${menge}${k.einheit ? ` ${k.einheit}` : ''} ${k.bezeichnung}`;
        body.querySelector('#sn-mat-menge').value = '';
      });
    }

    body.querySelector('#btn-cancel').addEventListener('click', () => { recorder.stop(); close(); });
    body.querySelector('#btn-save').addEventListener('click', async () => {
      recorder.stop();
      const titel = body.querySelector('#sn-titel').value.trim() || 'Sprachnotiz';
      const text = recorder.getText();
      if (!text) { toast('Bitte zuerst Text aufnehmen oder eingeben.', 'danger'); return; }
      const saveBtn = body.querySelector('#btn-save');
      saveBtn.disabled = true;
      const progress = mountProgressBar(body.querySelector('#sn-save-progress-host'), { indeterminate: true, label: 'Sprachnotiz wird gespeichert ...' });
      const untertitel = [
        kunde?.firma ? `Kunde: ${kunde.firma}` : '',
        projekt ? `Projekt: ${projekt}` : '',
      ].filter(Boolean).join(' · ');
      let blob;
      try {
        blob = await buildBerichtPdfBlob({ settings, titel, untertitel, text, datum: new Date().toISOString(), fotos: fotoEditor.getFotos() });
      } catch (err) {
        toast(err.message, 'danger');
        progress.remove();
        saveBtn.disabled = false;
        return;
      }
      await saveDokument({
        bezugTyp, bezugId, kategorie: 'bericht',
        name: `${titel.replace(/\d{1,2}\.\d{1,2}\.\d{4}/, '').replace(/[^a-z0-9äöüß _-]/gi, '').trim() || 'Sprachnotiz'}-${todayISO()}.pdf`, mime: 'application/pdf', blob,
      });
      for (const m of materialListe) {
        await put('verwendungen', {
          id: uid(), projektId: bezugId, katalogId: m.katalogId, menge: m.menge,
          datum: todayISO(), mitarbeiterId: getCurrentMitarbeiterId() || '',
        });
      }
      // Arbeitszeit landet - wie das Material - zusätzlich zur Textzeile im
      // PDF als echter Zeiterfassungs-Eintrag, statt nur als Text stehen zu
      // bleiben (sonst wäre die Zeit für Nachkalkulation/Abrechnung verloren).
      const arbeitszeitStd = mitMaterial ? parseFloat(body.querySelector('#sn-arbeitszeit').value) : NaN;
      if (mitMaterial && arbeitszeitStd > 0) {
        await put('zeiterfassung', {
          id: uid(), projektId: bezugId, mitarbeiterId: getCurrentMitarbeiterId() || '',
          datum: todayISO(), dauerMinuten: Math.round(arbeitszeitStd * 60), beschreibung: titel,
          abgerechnet: false, startzeit: '', endzeit: '', taetigkeit: 'baustelle',
        });
      }
      if ((materialListe.length || arbeitszeitStd > 0) && onProjektDatenGeaendert) onProjektDatenGeaendert();
      progress.remove();
      toast('Sprachnotiz gespeichert', 'success');
      close();
      load();
    });
  }

  async function load() {
    const dokumente = (await getAll('dokumente'))
      .filter((d) => d.bezugTyp === bezugTyp && d.bezugId === bezugId)
      .sort((a, b) => (b.erstelltAm || '').localeCompare(a.erstelltAm || ''));

    host.innerHTML = `
      <div class="flex-row" style="justify-content:space-between;margin-bottom:8px;flex-wrap:wrap">
        <h2 style="font-size:14px;margin:0">${escapeHtml(title)}</h2>
        <div class="flex-row">
          ${zeigeBerichtsVorlage ? '<button type="button" class="btn btn-sm" id="btn-bericht-vorlage">📝 Bericht aus Vorlage</button>' : ''}
          ${zeigeBerichtsVorlage ? '<button type="button" class="btn btn-sm" id="btn-sprachnotiz">🎙️ Sprachnotiz</button>' : ''}
          <select id="dok-kategorie" class="btn-sm" style="border:1px solid var(--border);border-radius:8px;padding:5px 8px;">
            ${kategorien.map((k) => `<option value="${k.id}">${escapeHtml(k.titel)}</option>`).join('')}
          </select>
          <label class="btn btn-sm" style="cursor:pointer">
            + Datei hinzufügen
            <input type="file" id="dok-input" hidden multiple>
          </label>
        </div>
      </div>
      <div id="dok-progress-host"></div>
      <div class="dok-list" id="dok-list">
        ${dokumente.length === 0 ? '<p class="text-mute">Noch keine Dokumente.</p>' : dokumente.map((d) => `
          <div class="dok-row" data-id="${d.id}">
            <span class="dok-icon">${iconFor(d.mime)}</span>
            <div class="dok-info">
              <div class="dok-name">${escapeHtml(d.name)}</div>
              <div class="text-mute" style="font-size:11px">${escapeHtml(katLabel(d.kategorie))} · ${formatSize(d.groesse)} · ${formatDateTime(d.erstelltAm)}</div>
            </div>
            <a class="btn btn-sm dok-download" data-id="${d.id}" href="#">Öffnen</a>
            <button type="button" class="btn btn-sm btn-danger dok-del" data-id="${d.id}">✕</button>
          </div>
        `).join('')}
      </div>
    `;

    const berichtBtn = host.querySelector('#btn-bericht-vorlage');
    if (berichtBtn) berichtBtn.addEventListener('click', openBerichtVorlage);
    const sprachnotizBtn = host.querySelector('#btn-sprachnotiz');
    if (sprachnotizBtn) sprachnotizBtn.addEventListener('click', openSprachnotizModal);

    host.querySelectorAll('.dok-download').forEach((a) => {
      const doc = dokumente.find((d) => d.id === a.dataset.id);
      if (doc?.url) {
        a.href = doc.url;
        a.target = '_blank';
        a.rel = 'noopener';
      } else if (doc?.blob) {
        a.href = URL.createObjectURL(doc.blob);
        a.target = '_blank';
        a.rel = 'noopener';
        a.addEventListener('click', () => setTimeout(() => URL.revokeObjectURL(a.href), 4000));
      }
    });

    // Die ganze Zeile antippbar machen, nicht nur den kleinen "Öffnen"-Link -
    // auf dem Handy war der Link sonst leicht zu verfehlen.
    host.querySelectorAll('.dok-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.dok-del') || e.target.closest('.dok-download')) return;
        row.querySelector('.dok-download')?.click();
      });
    });

    host.querySelector('#dok-input').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;
      const kategorie = host.querySelector('#dok-kategorie').value;
      const label = host.querySelector('label.btn');
      const originalText = label.textContent;
      label.textContent = 'Lädt ...';
      const progress = mountProgressBar(host.querySelector('#dok-progress-host'), { label: `0 / ${files.length} Datei(en) hochgeladen` });
      let fertig = 0;
      for (const file of files) {
        try {
          await saveDokument({ bezugTyp, bezugId, kategorie, name: file.name, mime: file.type, blob: file });
        } catch (err) {
          toast(err.message, 'danger');
        }
        fertig += 1;
        progress.setProgress((fertig / files.length) * 100);
        progress.setLabel(`${fertig} / ${files.length} Datei(en) hochgeladen`);
      }
      progress.remove();
      label.textContent = originalText;
      load();
    });

    host.querySelectorAll('.dok-del').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirmDelete('Dokument wirklich löschen?')) return;
        const doc = dokumente.find((d) => d.id === btn.dataset.id);
        await remove('dokumente', btn.dataset.id);
        if (doc?.path) await deleteBlobFromStorage(doc.path);
        load();
      });
    });
  }

  load();
  return { reload: load };
}
