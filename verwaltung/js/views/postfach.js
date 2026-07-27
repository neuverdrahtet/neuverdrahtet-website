import { put, getAll, getSettings, setSettings, EMAIL_KATEGORIEN } from '../db.js';
import { uid, escapeHtml, toast, todayISO, formatDateTime } from '../utils.js';
import { openModal } from '../ui.js';
import * as google from '../google.js';
import { fullImport, incrementalSync, classifyPendingEmails } from '../emailsync.js';
import { analyzeBeleg } from '../ai.js';
import { KATEGORIEN as AUSGABEN_KATEGORIEN } from './ausgaben.js';

const LISTE_STANDARD_LIMIT = 200;

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
  let settings = await getSettings();

  if (!settings.googleClientId) {
    container.innerHTML = `
      <div class="view-header"><h1>📧 Postfach</h1></div>
      <div class="empty-state">Google ist noch nicht verbunden.<br>Bitte zuerst in Einstellungen → Google-Verbindung einrichten.</div>
    `;
    return;
  }

  if (!settings.emailImportDone) {
    renderImportGate();
    return;
  }

  renderMailbox();

  function renderImportGate() {
    container.innerHTML = `
      <div class="view-header"><h1>📧 Postfach</h1></div>
      <div class="card">
        <h2>Postfach importieren</h2>
        <p class="text-mute">Damit hier alle E-Mails aus Gmail auffindbar sind, wird das Postfach einmalig komplett in die Software übernommen. Je nach Größe des Postfachs kann das mehrere Minuten dauern. Danach werden neue E-Mails automatisch mit übernommen.</p>
        <div id="import-progress" class="text-mute" style="margin:10px 0"></div>
        <button class="btn btn-primary" id="btn-start-import">📥 Jetzt importieren</button>
      </div>
    `;
    container.querySelector('#btn-start-import').addEventListener('click', async (e) => {
      const btn = e.target;
      btn.disabled = true;
      const progressEl = container.querySelector('#import-progress');
      try {
        await fullImport({
          onProgress: ({ done, estimate }) => {
            progressEl.textContent = estimate ? `${done} von ca. ${estimate} E-Mails importiert ...` : `${done} E-Mails importiert ...`;
          },
        });
        toast('Postfach-Import abgeschlossen', 'success');
        render(container);
      } catch (err) {
        toast(`Import fehlgeschlagen: ${err.message}`, 'danger');
        btn.disabled = false;
      }
    });
  }

  async function renderMailbox() {
    let allEmails = (await getAll('emails')).sort((a, b) => (b.dateSort || '').localeCompare(a.dateSort || ''));
    let query = '';
    let richtungFilter = 'alle';
    let kategorieFilter = 'alle';
    let selectedId = null;

    container.innerHTML = `
      <div class="view-header">
        <h1>📧 Postfach</h1>
        <div class="actions">
          <button class="btn" id="btn-sync">🔄 Neue E-Mails holen</button>
          <button class="btn btn-primary" id="btn-compose">✏️ Neue E-Mail</button>
        </div>
      </div>
      <p class="text-mute" style="margin:-4px 0 10px">${allEmails.length} E-Mails importiert · zuletzt synchronisiert: ${settings.emailLastSyncAt ? formatDateTime(settings.emailLastSyncAt) : 'nie'} · <a href="#" id="link-reimport">Kompletten Neuimport starten</a> <span id="pf-kat-status" class="text-mute"></span></p>
      <div class="search-bar">
        <input type="search" id="pf-search" placeholder="Suche nach Betreff, Absender oder Text ...">
        <select id="pf-richtung">
          <option value="alle">Alle</option>
          <option value="eingang">📥 Eingang</option>
          <option value="ausgang">📤 Ausgang</option>
        </select>
        <select id="pf-kategorie">
          <option value="alle">Alle Kategorien</option>
          ${EMAIL_KATEGORIEN.map((k) => `<option value="${k.id}">${k.icon} ${escapeHtml(k.titel)}</option>`).join('')}
        </select>
      </div>
      <div class="postfach-layout">
        <div class="postfach-list" id="pf-list-host"></div>
        <div class="postfach-detail" id="pf-detail-host">
          <div class="empty-state">Wähle links eine E-Mail aus.</div>
        </div>
      </div>
    `;

    const listHost = container.querySelector('#pf-list-host');
    const detailHost = container.querySelector('#pf-detail-host');

    function matchesFilters(m) {
      const richtungOk = richtungFilter === 'alle' || (m.richtung || 'eingang') === richtungFilter;
      const kategorieOk = kategorieFilter === 'alle' || m.kategorie === kategorieFilter;
      return richtungOk && kategorieOk;
    }

    function filtered() {
      const base = allEmails.filter(matchesFilters);
      if (!query) return base.slice(0, LISTE_STANDARD_LIMIT);
      const q = query.toLowerCase();
      return base.filter((m) =>
        (m.subject || '').toLowerCase().includes(q) ||
        (m.from || '').toLowerCase().includes(q) ||
        (m.text || '').toLowerCase().includes(q)
      );
    }

    function renderList() {
      const list = filtered();
      const gefiltertGesamt = allEmails.filter(matchesFilters).length;
      if (list.length === 0) {
        listHost.innerHTML = `<div class="empty-state">Keine E-Mails gefunden.</div>`;
        return;
      }
      listHost.innerHTML = list.map((m) => {
        const kat = EMAIL_KATEGORIEN.find((k) => k.id === m.kategorie);
        const katBadge = kat ? `<span class="badge ${kat.badge}" title="${escapeHtml(kat.titel)}">${kat.icon} ${escapeHtml(kat.titel)}</span>` : '';
        return `
        <div class="postfach-row ${m.unread ? 'unread' : ''} ${m.id === selectedId ? 'active' : ''}" data-id="${m.id}">
          <div class="postfach-row-top">
            <strong>${escapeHtml((m.from || '').split('<')[0].trim() || m.from)}</strong>
            <span class="text-mute">${escapeHtml(m.date)}</span>
          </div>
          <div class="postfach-row-subject">${escapeHtml(m.subject)}</div>
          ${katBadge ? `<div class="postfach-row-kategorie">${katBadge}</div>` : ''}
          <div class="text-mute postfach-row-snippet">${escapeHtml((m.text || '').slice(0, 140))}</div>
        </div>
      `;
      }).join('') + (!query && gefiltertGesamt > LISTE_STANDARD_LIMIT ? `<p class="hint">Zeigt die neuesten ${LISTE_STANDARD_LIMIT} E-Mails – zum Durchsuchen des gesamten Postfachs oben suchen.</p>` : '');
      listHost.querySelectorAll('.postfach-row').forEach((row) => {
        row.addEventListener('click', () => openMessage(row.dataset.id));
      });
    }

    async function openMessage(id) {
      selectedId = id;
      renderList();
      const full = allEmails.find((m) => m.id === id);
      if (!full) return;

      if (full.unread) {
        full.unread = false;
        await put('emails', full);
        renderList();
        google.markAsRead(id).catch(() => { /* Lesestatus ist ein Komfort-Feature, kein kritischer Fehler */ });
      }

      let bodyHtml;
      if ((full.text || '').trim()) {
        bodyHtml = `<pre class="postfach-body-text">${escapeHtml(full.text)}</pre>`;
      } else if ((full.html || '').trim()) {
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

    container.querySelector('#btn-compose').addEventListener('click', () => openCompose());
    container.querySelector('#btn-sync').addEventListener('click', async () => {
      const btn = container.querySelector('#btn-sync');
      btn.disabled = true;
      btn.textContent = 'Synchronisiere ...';
      try {
        const result = await incrementalSync();
        settings = await getSettings();
        toast(`${result.neu} neue E-Mail(s) übernommen`, 'success');
        render(container);
      } catch (err) {
        toast(`Sync fehlgeschlagen: ${err.message}`, 'danger');
        btn.disabled = false;
        btn.textContent = '🔄 Neue E-Mails holen';
      }
    });
    container.querySelector('#link-reimport').addEventListener('click', async (e) => {
      e.preventDefault();
      await setSettings({ emailImportDone: false });
      render(container);
    });
    const searchInput = container.querySelector('#pf-search');
    searchInput.addEventListener('input', () => {
      query = searchInput.value.trim();
      renderList();
    });
    container.querySelector('#pf-richtung').addEventListener('change', (e) => {
      richtungFilter = e.target.value;
      renderList();
    });
    container.querySelector('#pf-kategorie').addEventListener('change', (e) => {
      kategorieFilter = e.target.value;
      renderList();
    });

    renderList();

    // Nur im Hintergrund synchronisieren, wenn bereits eine gültige Sitzung
    // besteht - sonst würde ensureToken() beim bloßen Öffnen der Seite
    // ungefragt ein Google-Login-Popup aufreißen. Ohne gültige Sitzung holt
    // der Nutzer neue Mails bewusst über "🔄 Neue E-Mails holen".
    (google.isConnected() ? incrementalSync() : Promise.resolve({ neu: 0 })).then((result) => {
      if (result.neu > 0) {
        getAll('emails').then((fresh) => {
          allEmails = fresh.sort((a, b) => (b.dateSort || '').localeCompare(a.dateSort || ''));
          renderList();
        });
      }
    }).catch(() => { /* stiller Hintergrund-Sync, Fehler nicht kritisch für die Anzeige */ });

    // Automatische KI-Sortierung: läuft bei jedem Öffnen des Postfachs im
    // Hintergrund für alle noch unkategorisierten Mails weiter (batchweise, damit
    // auch bei sehr großen Postfächern nach und nach alles einsortiert wird).
    if (settings.aiWorkerUrl) {
      const katStatusEl = container.querySelector('#pf-kat-status');
      classifyPendingEmails({
        onProgress: ({ done, total }) => {
          if (katStatusEl) katStatusEl.textContent = done < total ? `· 🏷️ kategorisiere ${done}/${total} ...` : '';
          getAll('emails').then((fresh) => {
            allEmails = fresh.sort((a, b) => (b.dateSort || '').localeCompare(a.dateSort || ''));
            renderList();
          });
        },
      }).catch(() => { /* Kategorisierung ist ein Komfort-Feature, Fehler nicht kritisch für die Anzeige */ });
    }
  }
}
