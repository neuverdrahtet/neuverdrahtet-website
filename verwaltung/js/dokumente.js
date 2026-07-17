import { getAll, put, remove } from './db.js';
import { uid, escapeHtml, formatDate, formatDateTime, todayISO, toast } from './utils.js';
import { openModal, confirmDelete } from './ui.js';
import { buildBerichtPdfBlob } from './docpdf.js';
import { openEmailComposer } from './emailsend.js';
import { sendDocumentViaWhatsApp } from './whatsapp.js';

function nowHHMM() {
  return new Date().toTimeString().slice(0, 5);
}

export const DOKUMENT_KATEGORIEN = [
  { id: 'bericht', titel: 'Bericht' },
  { id: 'stundenzettel', titel: 'Stundenzettel' },
  { id: 'bild', titel: 'Bild' },
  { id: 'vertrag', titel: 'Vertrag' },
  { id: 'sonstiges', titel: 'Sonstiges' },
];

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
    blob, groesse: blob.size || 0, erstelltAm: new Date().toISOString(),
  };
  await put('dokumente', doc);
  return doc;
}

/**
 * Renders an upload + list UI for arbitrary files (reports, timesheets, photos, contracts)
 * attached to a Projekt/Kunde/Mitarbeiter. Mirrors fotos.js but for any file type.
 */
export function renderDokumenteSection(host, bezugTyp, bezugId, { kategorien = DOKUMENT_KATEGORIEN, title = 'Dokumente', berichtContext = null } = {}) {
  const zeigeBerichtsVorlage = berichtContext && kategorien.some((k) => k.id === 'bericht');

  async function openBerichtVorlage() {
    const vorlagen = (await getAll('vorlagen')).filter((v) => v.typ === 'dokumentation');
    if (vorlagen.length === 0) {
      toast('Noch keine Dokumentations-Vorlage angelegt (siehe Menü Vorlagen).', 'danger');
      return;
    }
    const settings = berichtContext.settings || {};
    const kunde = berichtContext.kunde || null;
    const projekt = berichtContext.projekt || '';

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
        </div>
        <div class="divider"></div>
        <div class="field"><label>Text (bearbeitbar)</label><textarea id="ber-text" style="min-height:260px"></textarea></div>
        <div class="modal-actions">
          <span class="spacer"></span>
          <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
          ${kunde?.telefon ? '<button type="button" class="btn" id="btn-send-whatsapp">📱 Per WhatsApp senden</button>' : ''}
          <button type="button" class="btn" id="btn-send-email">✉️ Per E-Mail senden</button>
          <button type="button" class="btn btn-primary" id="btn-save-pdf">Als PDF speichern</button>
        </div>
      `,
    });
    const vorlageSelect = body.querySelector('#ber-vorlage');
    const titelInput = body.querySelector('#ber-titel');
    const datumInput = body.querySelector('#ber-datum');
    const uhrzeitInput = body.querySelector('#ber-uhrzeit');
    const textArea = body.querySelector('#ber-text');

    function substitute(text) {
      return (text || '')
        .replaceAll('{{firma}}', settings.firmenname || '')
        .replaceAll('{{kunde}}', kunde?.firma || '')
        .replaceAll('{{projekt}}', projekt)
        .replaceAll('{{datum}}', formatDate(datumInput.value))
        .replaceAll('{{uhrzeit}}', uhrzeitInput.value || '');
    }
    function fillText() {
      const v = vorlagen.find((x) => x.id === vorlageSelect.value);
      titelInput.value = v?.name || 'Bericht';
      textArea.value = v ? substitute(v.textVorlage || '') : '';
    }
    vorlageSelect.addEventListener('change', fillText);
    fillText();
    body.querySelector('#btn-cancel').addEventListener('click', close);

    function currentDatumIso() {
      return new Date(`${datumInput.value || todayISO()}T${uhrzeitInput.value || '00:00'}:00`).toISOString();
    }
    function currentUntertitel() {
      return [kunde?.firma ? `Kunde: ${kunde.firma}` : '', projekt ? `Projekt: ${projekt}` : ''].filter(Boolean).join(' · ');
    }
    function currentFilename() {
      return `${(titelInput.value || 'Bericht').replace(/[^a-z0-9äöüß _-]/gi, '')}-${datumInput.value || todayISO()}.pdf`;
    }
    function buildPdf() {
      return buildBerichtPdfBlob({
        settings, titel: titelInput.value || 'Bericht',
        untertitel: currentUntertitel(), text: textArea.value, datum: currentDatumIso(),
      });
    }

    body.querySelector('#btn-save-pdf').addEventListener('click', async () => {
      let blob;
      try {
        blob = buildPdf();
      } catch (err) {
        toast(err.message, 'danger');
        return;
      }
      await saveDokument({
        bezugTyp, bezugId, kategorie: 'bericht',
        name: currentFilename(), mime: 'application/pdf', blob,
      });
      toast('Bericht gespeichert', 'success');
      close();
      load();
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
      whatsappBtn.addEventListener('click', () => {
        let blob;
        try {
          blob = buildPdf();
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

  async function load() {
    const dokumente = (await getAll('dokumente'))
      .filter((d) => d.bezugTyp === bezugTyp && d.bezugId === bezugId)
      .sort((a, b) => (b.erstelltAm || '').localeCompare(a.erstelltAm || ''));

    host.innerHTML = `
      <div class="flex-row" style="justify-content:space-between;margin-bottom:8px;flex-wrap:wrap">
        <h2 style="font-size:14px;margin:0">${escapeHtml(title)}</h2>
        <div class="flex-row">
          ${zeigeBerichtsVorlage ? '<button type="button" class="btn btn-sm" id="btn-bericht-vorlage">📝 Bericht aus Vorlage</button>' : ''}
          <select id="dok-kategorie" class="btn-sm" style="border:1px solid var(--border);border-radius:8px;padding:5px 8px;">
            ${kategorien.map((k) => `<option value="${k.id}">${escapeHtml(k.titel)}</option>`).join('')}
          </select>
          <label class="btn btn-sm" style="cursor:pointer">
            + Datei hinzufügen
            <input type="file" id="dok-input" hidden multiple>
          </label>
        </div>
      </div>
      <div class="dok-list" id="dok-list">
        ${dokumente.length === 0 ? '<p class="text-mute">Noch keine Dokumente.</p>' : dokumente.map((d) => `
          <div class="dok-row" data-id="${d.id}">
            <span class="dok-icon">${iconFor(d.mime)}</span>
            <div class="dok-info">
              <div class="dok-name">${escapeHtml(d.name)}</div>
              <div class="text-mute" style="font-size:11px">${escapeHtml(katLabel(d.kategorie))} · ${formatSize(d.groesse)} · ${formatDateTime(d.erstelltAm)}</div>
            </div>
            <a class="btn btn-sm dok-download" data-id="${d.id}" href="#" download="${escapeHtml(d.name)}">Öffnen</a>
            <button type="button" class="btn btn-sm btn-danger dok-del" data-id="${d.id}">✕</button>
          </div>
        `).join('')}
      </div>
    `;

    const berichtBtn = host.querySelector('#btn-bericht-vorlage');
    if (berichtBtn) berichtBtn.addEventListener('click', openBerichtVorlage);

    host.querySelectorAll('.dok-download').forEach((a) => {
      const doc = dokumente.find((d) => d.id === a.dataset.id);
      if (doc) a.href = URL.createObjectURL(doc.blob);
      a.addEventListener('click', () => setTimeout(() => URL.revokeObjectURL(a.href), 4000));
    });

    host.querySelector('#dok-input').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      const kategorie = host.querySelector('#dok-kategorie').value;
      const label = host.querySelector('label.btn');
      const originalText = label.textContent;
      label.textContent = 'Lädt ...';
      for (const file of files) {
        try {
          await saveDokument({ bezugTyp, bezugId, kategorie, name: file.name, mime: file.type, blob: file });
        } catch (err) {
          toast(err.message, 'danger');
        }
      }
      label.textContent = originalText;
      load();
    });

    host.querySelectorAll('.dok-del').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirmDelete('Dokument wirklich löschen?')) return;
        await remove('dokumente', btn.dataset.id);
        load();
      });
    });
  }

  load();
  return { reload: load };
}
