import { put, getAll, getSettings } from '../db.js';
import { uid, escapeHtml, toast, todayISO } from '../utils.js';
import { openModal } from '../ui.js';
import * as google from '../google.js';
import { analyzeBeleg } from '../ai.js';
import { KATEGORIEN as AUSGABEN_KATEGORIEN } from './ausgaben.js';

function extractEmailAddress(fromHeader) {
  const match = /<([^>]+)>/.exec(fromHeader || '');
  return match ? match[1] : (fromHeader || '').trim();
}

function bytesToBlob(bytes, mimeType) {
  return new Blob([bytes], { type: mimeType || 'application/octet-stream' });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
    reader.readAsDataURL(blob);
  });
}

function calcBrutto(netto, steuersatz) {
  return Math.round(netto * (1 + (Number(steuersatz) || 0) / 100) * 100) / 100;
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.round(bytes / 1024)} KB`;
}

export async function render(container) {
  const settings = await getSettings();
  let messages = [];
  let nextPageToken = null;
  let currentQuery = 'in:inbox';
  let selectedId = null;

  container.innerHTML = `
    <div class="view-header">
      <h1>📧 Postfach</h1>
      <div class="actions">
        <button class="btn" id="btn-refresh">🔄 Aktualisieren</button>
        <button class="btn btn-primary" id="btn-compose">✏️ Neue E-Mail</button>
      </div>
    </div>
    <div class="search-bar">
      <input type="search" id="pf-search" placeholder="Gmail-Suche (z.B. from:kunde@example.com) ...">
    </div>
    <div class="postfach-layout">
      <div class="postfach-list" id="pf-list-host">
        <div class="empty-state">Lädt Postfach ...</div>
      </div>
      <div class="postfach-detail" id="pf-detail-host">
        <div class="empty-state">Wähle links eine E-Mail aus.</div>
      </div>
    </div>
  `;

  const listHost = container.querySelector('#pf-list-host');
  const detailHost = container.querySelector('#pf-detail-host');

  if (!settings.googleClientId) {
    listHost.innerHTML = `<div class="empty-state">Google ist noch nicht verbunden.<br>Bitte zuerst in Einstellungen → Google-Verbindung einrichten.</div>`;
    return;
  }

  async function loadList() {
    listHost.innerHTML = `<div class="empty-state">Lädt Postfach ...</div>`;
    try {
      const result = await google.listInboxMessages({ query: currentQuery, maxResults: 25 });
      messages = result.messages;
      nextPageToken = result.nextPageToken;
      renderList();
    } catch (err) {
      listHost.innerHTML = `<div class="empty-state">Fehler beim Laden: ${escapeHtml(err.message)}</div>`;
    }
  }

  function renderList() {
    if (messages.length === 0) {
      listHost.innerHTML = `<div class="empty-state">Keine E-Mails gefunden.</div>`;
      return;
    }
    listHost.innerHTML = messages.map((m) => `
      <div class="postfach-row ${m.unread ? 'unread' : ''} ${m.id === selectedId ? 'active' : ''}" data-id="${m.id}">
        <div class="postfach-row-top">
          <strong>${escapeHtml(m.from.split('<')[0].trim() || m.from)}</strong>
          <span class="text-mute">${escapeHtml(m.date)}</span>
        </div>
        <div class="postfach-row-subject">${escapeHtml(m.subject)}</div>
        <div class="text-mute postfach-row-snippet">${escapeHtml(m.snippet)}</div>
      </div>
    `).join('') + (nextPageToken ? `<button class="btn" id="pf-load-more" style="width:100%;margin-top:8px">Weitere laden ...</button>` : '');
    listHost.querySelectorAll('.postfach-row').forEach((row) => {
      row.addEventListener('click', () => openMessage(row.dataset.id));
    });
    const moreBtn = listHost.querySelector('#pf-load-more');
    if (moreBtn) {
      moreBtn.addEventListener('click', async () => {
        moreBtn.textContent = 'Lädt ...';
        try {
          const result = await google.listInboxMessages({ query: currentQuery, maxResults: 25, pageToken: nextPageToken });
          messages = messages.concat(result.messages);
          nextPageToken = result.nextPageToken;
          renderList();
        } catch (err) {
          toast(`Fehler: ${err.message}`, 'danger');
        }
      });
    }
  }

  async function openMessage(id) {
    selectedId = id;
    renderList();
    detailHost.innerHTML = `<div class="empty-state">Lädt ...</div>`;
    let full;
    try {
      full = await google.getMessageFull(id);
    } catch (err) {
      detailHost.innerHTML = `<div class="empty-state">Fehler beim Laden: ${escapeHtml(err.message)}</div>`;
      return;
    }
    const listEntry = messages.find((m) => m.id === id);
    if (listEntry && listEntry.unread) {
      listEntry.unread = false;
      renderList();
      google.markAsRead(id).catch(() => { /* Lesestatus ist ein Komfort-Feature, kein kritischer Fehler */ });
    }

    let bodyHtml;
    if (full.text.trim()) {
      bodyHtml = `<pre class="postfach-body-text">${escapeHtml(full.text)}</pre>`;
    } else if (full.html.trim()) {
      bodyHtml = `<iframe class="postfach-body-iframe" sandbox="" referrerpolicy="no-referrer" srcdoc="${escapeHtml(full.html)}"></iframe>`;
    } else {
      bodyHtml = `<p class="text-mute">(kein Textinhalt)</p>`;
    }

    detailHost.innerHTML = `
      <div class="postfach-detail-header">
        <h2>${escapeHtml(full.subject)}</h2>
        <p class="text-mute">Von: ${escapeHtml(full.from)}<br>An: ${escapeHtml(full.to)} · ${escapeHtml(full.date)}</p>
        <div class="actions">
          <button class="btn" id="pf-reply-btn">↩️ Antworten</button>
          <button class="btn" id="pf-task-btn">✅ Als Aufgabe anlegen</button>
        </div>
      </div>
      <div class="postfach-body-host">${bodyHtml}</div>
      ${full.attachments.length ? `
        <div class="postfach-attachments">
          <h3>Anhänge</h3>
          ${full.attachments.map((a, i) => `
            <div class="postfach-attachment-row">
              <span>📎 ${escapeHtml(a.filename)} <span class="text-mute">(${formatSize(a.size)})</span></span>
              <div class="actions">
                <button class="btn btn-sm" data-attidx="${i}" data-action="download">Herunterladen</button>
                <button class="btn btn-sm" data-attidx="${i}" data-action="beleg">Als Beleg übernehmen</button>
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}
    `;

    detailHost.querySelector('#pf-reply-btn').addEventListener('click', () => openCompose({ replyTo: full }));
    detailHost.querySelector('#pf-task-btn').addEventListener('click', () => openTaskFromMessage(full));
    detailHost.querySelectorAll('[data-action="download"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const att = full.attachments[Number(btn.dataset.attidx)];
        btn.disabled = true;
        btn.textContent = 'Lädt ...';
        try {
          const bytes = await google.getAttachmentData(full.id, att.attachmentId);
          const blob = bytesToBlob(bytes, att.mimeType);
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = att.filename;
          a.click();
          URL.revokeObjectURL(url);
        } catch (err) {
          toast(`Download fehlgeschlagen: ${err.message}`, 'danger');
        }
        btn.disabled = false;
        btn.textContent = 'Herunterladen';
      });
    });
    detailHost.querySelectorAll('[data-action="beleg"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const att = full.attachments[Number(btn.dataset.attidx)];
        btn.disabled = true;
        btn.textContent = 'Übernehme ...';
        try {
          await uebernehmeAlsBeleg(full, att);
        } catch (err) {
          toast(`Übernahme fehlgeschlagen: ${err.message}`, 'danger');
        }
        btn.disabled = false;
        btn.textContent = 'Als Beleg übernehmen';
      });
    });
  }

  async function uebernehmeAlsBeleg(message, attachment) {
    const bytes = await google.getAttachmentData(message.id, attachment.attachmentId);
    const blob = bytesToBlob(bytes, attachment.mimeType);
    let prefill = {
      id: uid(), datum: todayISO(), kategorie: AUSGABEN_KATEGORIEN[AUSGABEN_KATEGORIEN.length - 1], beschreibung: `Anhang aus E-Mail: ${message.subject}`,
      lieferant: extractEmailAddress(message.from), betragNetto: 0, steuersatz: settings.standardSteuersatz || 19, betragBrutto: 0,
      bezahltMit: 'überweisung', beleg: blob, projektId: '', kundeId: '', kalkKategorie: '',
    };
    if (attachment.mimeType.startsWith('image/')) {
      try {
        const imageDataUrl = await blobToDataUrl(blob);
        const result = await analyzeBeleg({ imageDataUrl, kategorien: AUSGABEN_KATEGORIEN });
        const kategorie = AUSGABEN_KATEGORIEN.includes(result.kategorie) ? result.kategorie : prefill.kategorie;
        const steuersatz = [0, 7, 19].includes(Number(result.steuersatz)) ? Number(result.steuersatz) : prefill.steuersatz;
        const datum = /^\d{4}-\d{2}-\d{2}$/.test(result.datum || '') ? result.datum : prefill.datum;
        prefill = {
          ...prefill,
          datum, kategorie, steuersatz,
          beschreibung: `${!result.lesbar || !result.kategorieSicher ? '⚠️ Bitte prüfen: ' : ''}${result.beschreibung || prefill.beschreibung}`.trim(),
          lieferant: result.haendler || prefill.lieferant,
          betragNetto: Number(result.betragNetto) || 0,
          betragBrutto: calcBrutto(Number(result.betragNetto) || 0, steuersatz),
        };
      } catch { /* KI-Erkennung ist optional – Anhang wird trotzdem als Beleg gespeichert */ }
    }
    await put('ausgaben', prefill);
    toast('Anhang als Ausgabe/Beleg gespeichert – bitte in Ausgaben prüfen', 'success');
  }

  async function openTaskFromMessage(message) {
    const aufgabenStatus = await getAll('aufgabenStatus');
    aufgabenStatus.sort((a, b) => (a.reihenfolge ?? 0) - (b.reihenfolge ?? 0));
    const offenStatus = aufgabenStatus.find((s) => !s.geschlossen) || aufgabenStatus[0];
    const { body, close } = openModal({
      title: 'Als Aufgabe anlegen',
      bodyHtml: `
        <form id="pf-task-form">
          <div class="form-grid">
            <div class="field col-span-2"><label>Titel *</label><input name="titel" required value="${escapeHtml(message.subject)}"></div>
            <div class="field col-span-2"><label>Beschreibung</label><textarea name="beschreibung">${escapeHtml(`Anfrage von: ${message.from}\n\n${(message.text || '').slice(0, 1000)}`)}</textarea></div>
            <div class="field"><label>Fällig am</label><input type="date" name="faelligAm"></div>
          </div>
          <div class="modal-actions">
            <span class="spacer"></span>
            <button type="button" class="btn" id="pf-task-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Anlegen</button>
          </div>
        </form>
      `,
    });
    body.querySelector('#pf-task-cancel').addEventListener('click', close);
    body.querySelector('#pf-task-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const aufgabe = {
        id: uid(), titel: (fd.get('titel') || '').toString().trim(), beschreibung: (fd.get('beschreibung') || '').toString().trim(),
        zugewiesenAn: '', erstelltVon: '', faelligAm: (fd.get('faelligAm') || '').toString(), prioritaet: 'normal',
        status: offenStatus?.id || 'offen', projektId: '', kundeId: '', createdAt: new Date().toISOString(), erledigtAm: '',
      };
      if (!aufgabe.titel) return;
      await put('aufgaben', aufgabe);
      toast('Aufgabe angelegt', 'success');
      close();
    });
  }

  function openCompose({ replyTo } = {}) {
    const to = replyTo ? extractEmailAddress(replyTo.from) : '';
    const subject = replyTo ? (/^re:/i.test(replyTo.subject) ? replyTo.subject : `Re: ${replyTo.subject}`) : '';
    const bodyText = replyTo
      ? `\n\n--- Ursprüngliche Nachricht von ${replyTo.from} am ${replyTo.date} ---\n${(replyTo.text || '').split('\n').map((l) => `> ${l}`).join('\n').slice(0, 3000)}`
      : '';
    const { body, close } = openModal({
      title: replyTo ? 'Antworten' : 'Neue E-Mail',
      wide: true,
      bodyHtml: `
        <form id="pf-compose-form">
          <div class="form-grid">
            <div class="field col-span-2"><label>An *</label><input name="to" required value="${escapeHtml(to)}"></div>
            <div class="field col-span-2"><label>Betreff *</label><input name="subject" required value="${escapeHtml(subject)}"></div>
            <div class="field col-span-2"><label>Nachricht</label><textarea name="bodyText" rows="12">${escapeHtml(bodyText)}</textarea></div>
          </div>
          <div class="modal-actions">
            <span class="spacer"></span>
            <button type="button" class="btn" id="pf-compose-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Senden</button>
          </div>
        </form>
      `,
    });
    body.querySelector('#pf-compose-cancel').addEventListener('click', close);
    body.querySelector('#pf-compose-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const submitBtn = e.target.querySelector('button[type=submit]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sende ...';
      try {
        await google.sendEmail({
          to: (fd.get('to') || '').toString().trim(),
          subject: (fd.get('subject') || '').toString().trim(),
          bodyText: (fd.get('bodyText') || '').toString(),
          inReplyTo: replyTo?.messageIdHeader || undefined,
          referencesHeader: replyTo?.referencesHeader || undefined,
          threadId: replyTo?.threadId || undefined,
        });
        toast('E-Mail gesendet', 'success');
        close();
      } catch (err) {
        toast(`Senden fehlgeschlagen: ${err.message}`, 'danger');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Senden';
      }
    });
  }

  container.querySelector('#btn-refresh').addEventListener('click', loadList);
  container.querySelector('#btn-compose').addEventListener('click', () => openCompose());
  const searchInput = container.querySelector('#pf-search');
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      currentQuery = searchInput.value.trim() || 'in:inbox';
      loadList();
    }
  });

  loadList();
}
