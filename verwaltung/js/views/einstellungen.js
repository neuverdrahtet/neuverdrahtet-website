import { getSettings, setSettings, exportAll, importAll, getAll, put, remove, TEXTBAUSTEIN_KATEGORIEN, ZUGRIFFSROLLEN } from '../db.js';
import { uid, escapeHtml, toast, compressImage } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import * as google from '../google.js';

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Logo konnte nicht gelesen werden.'));
    reader.readAsDataURL(blob);
  });
}

const NAV = [
  { group: 'Unternehmen & Team', items: [
    { id: 'firma', icon: '🏢', label: 'Firmendaten' },
    { id: 'rollen', icon: '🛡️', label: 'Rollen & Berechtigungen' },
    { id: 'zugang', icon: '🔒', label: 'Zugangscode' },
  ] },
  { group: 'Finanzen & Kalkulation', items: [
    { id: 'nummern', icon: '#️⃣', label: 'Nummernkreise & Fristen' },
    { id: 'kalkulation', icon: '📈', label: 'Zuschläge & Kalkulation' },
  ] },
  { group: 'Personal & Zeit', items: [
    { id: 'zeit', icon: '⏱️', label: 'Zeiterfassung & Buchhaltung' },
  ] },
  { group: 'Vorlagen & Texte', items: [
    { id: 'textbausteine', icon: '📝', label: 'Textbausteine (Schlusstexte)' },
  ] },
  { group: 'Integrationen', items: [
    { id: 'google', icon: '📅', label: 'Google-Verbindung' },
    { id: 'ki', icon: '✨', label: 'KI-Angebotserstellung' },
  ] },
  { group: 'Daten & Sicherheit', items: [
    { id: 'daten', icon: '💾', label: 'Datensicherung / Geräte-Sync' },
  ] },
];

export async function render(container) {
  const settings = await getSettings();
  const textbausteine = await getAll('textbausteine');
  textbausteine.sort((a, b) => (a.titel || '').localeCompare(b.titel || ''));
  const isLight = settings.theme === 'light';

  container.innerHTML = `
    <div class="view-header">
      <h1>Einstellungen</h1>
      <div class="actions">
        <label class="theme-switch" title="Hell-/Dunkelmodus">
          <span>☀️</span>
          <input type="checkbox" id="theme-toggle" ${isLight ? 'checked' : ''}>
          <span class="theme-switch-track"></span>
          <span>🌙</span>
        </label>
      </div>
    </div>

    <div class="settings-layout">
      <nav class="settings-nav" id="settings-nav">
        ${NAV.map((g) => `
          <div class="settings-nav-group">
            <h3>${escapeHtml(g.group)}</h3>
            ${g.items.map((it) => `<button type="button" class="settings-nav-item" data-panel="${it.id}">${it.icon} ${escapeHtml(it.label)}</button>`).join('')}
          </div>
        `).join('')}
      </nav>
      <div class="settings-content" id="settings-content">

        <div class="card settings-panel" data-panel="firma" hidden>
          <h2>Firmendaten</h2>
          <form id="firma-form">
            <div class="form-grid">
              <div class="field col-span-2">
                <label>Firmenlogo (für PDFs)</label>
                <div class="flex-row" style="align-items:flex-start">
                  <div id="logo-preview" style="width:88px;height:88px;border:1px solid var(--border);border-radius:8px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:var(--card-2);flex-shrink:0">
                    ${settings.logoDataUrl ? `<img src="${settings.logoDataUrl}" alt="Logo" style="max-width:100%;max-height:100%;object-fit:contain">` : '<span class="text-mute" style="font-size:11px">Kein Logo</span>'}
                  </div>
                  <div class="flex-row flex-wrap">
                    <label class="btn btn-sm" style="cursor:pointer">
                      Logo hochladen
                      <input type="file" id="logo-input" accept="image/*" hidden>
                    </label>
                    ${settings.logoDataUrl ? '<button type="button" class="btn btn-sm btn-danger" id="btn-logo-remove">Entfernen</button>' : ''}
                  </div>
                </div>
              </div>
              <div class="field col-span-2"><label>Firmenname</label><input name="firmenname" value="${escapeHtml(settings.firmenname)}"></div>
              <div class="field"><label>Straße &amp; Hausnr.</label><input name="strasse" value="${escapeHtml(settings.strasse)}"></div>
              <div class="field"><label>PLZ &amp; Ort</label><input name="plzOrt" value="${escapeHtml(settings.plzOrt)}"></div>
              <div class="field"><label>Telefon</label><input name="telefon" value="${escapeHtml(settings.telefon)}"></div>
              <div class="field"><label>E-Mail</label><input type="email" name="email" value="${escapeHtml(settings.email)}"></div>
              <div class="field"><label>USt-IdNr.</label><input name="ustId" value="${escapeHtml(settings.ustId)}"></div>
              <div class="field"><label>Steuernummer</label><input name="steuernummer" value="${escapeHtml(settings.steuernummer)}"></div>
              <div class="field"><label>IBAN</label><input name="iban" value="${escapeHtml(settings.iban)}"></div>
              <div class="field"><label>BIC</label><input name="bic" value="${escapeHtml(settings.bic)}"></div>
              <div class="field"><label>Bank</label><input name="bank" value="${escapeHtml(settings.bank)}"></div>
              <div class="field"><label>Inhaber</label><input name="inhaber" value="${escapeHtml(settings.inhaber || '')}"></div>
              <div class="field field-checkbox col-span-2"><input type="checkbox" name="kleinunternehmer" id="ku" ${settings.kleinunternehmer ? 'checked' : ''}><label for="ku">Kleinunternehmer nach §19 UStG (keine USt. ausweisen)</label></div>
            </div>
            <div class="modal-actions" style="border:none;padding-top:10px"><button type="submit" class="btn btn-primary">Speichern</button></div>
          </form>
        </div>

        <div class="card settings-panel" data-panel="rollen" hidden>
          <h2>Rollen &amp; Berechtigungen</h2>
          <p class="hint">Jeder Mitarbeiter kann in der Personalakte (Menü „Mitarbeiter“) einen eigenen Zugangscode und eine der folgenden Rollen bekommen. Die Rolle steuert, welche Menüpunkte sichtbar und nutzbar sind.</p>
          <ul class="cal-event-list">
            ${ZUGRIFFSROLLEN.map((r) => `
              <li>
                <div>
                  <strong>${escapeHtml(r.titel)}</strong>
                  <div class="text-mute">${escapeHtml(r.beschreibung)}</div>
                </div>
              </li>
            `).join('')}
          </ul>
          <p class="hint">Wichtig: Diese App läuft komplett lokal im Browser ohne Server – der Zugangscode ist eine einfache Bedienungssperre für dieses Gerät, kein vollwertiges Benutzerkonto mit Verschlüsselung.</p>
          <a class="btn btn-sm" href="#/mitarbeiter">Zu den Mitarbeitern →</a>
        </div>

        <div class="card settings-panel" data-panel="zugang" hidden>
          <h2>Zugangscode</h2>
          <p class="hint">Optionaler Zugangscode für dieses Gerät (Administrator-Zugang). Hinweis: Dies ist kein vollwertiger Passwortschutz, sondern nur eine einfache Zugriffshürde – die Daten liegen unverschlüsselt im Browser dieses Geräts.</p>
          <form id="pw-form">
            <div class="form-grid">
              <div class="field"><label>Zugangscode (leer = kein Schutz)</label><input name="passcode" value="${escapeHtml(settings.passcode || '')}"></div>
            </div>
            <div class="modal-actions" style="border:none;padding-top:10px"><button type="submit" class="btn btn-primary">Speichern</button></div>
          </form>
        </div>

        <div class="card settings-panel" data-panel="nummern" hidden>
          <h2>Nummernkreise &amp; Fristen</h2>
          <form id="nr-form">
            <div class="form-grid">
              <div class="field"><label>Angebots-Präfix</label><input name="angebotPrefix" value="${escapeHtml(settings.angebotPrefix)}"></div>
              <div class="field"><label>Nächste Angebotsnummer</label><input type="number" min="1" name="naechsteAngebotNr" value="${settings.naechsteAngebotNr}"></div>
              <div class="field"><label>Rechnungs-Präfix</label><input name="rechnungPrefix" value="${escapeHtml(settings.rechnungPrefix)}"></div>
              <div class="field"><label>Nächste Rechnungsnummer</label><input type="number" min="1" name="naechsteRechnungNr" value="${settings.naechsteRechnungNr}"></div>
              <div class="field"><label>Standard USt.-Satz (%)</label><input type="number" name="standardSteuersatz" value="${settings.standardSteuersatz}"></div>
              <div class="field"><label>Angebot gültig (Tage)</label><input type="number" name="angebotGueltigTage" value="${settings.angebotGueltigTage}"></div>
              <div class="field"><label>Zahlungsziel Rechnung (Tage)</label><input type="number" name="zahlungszielTage" value="${settings.zahlungszielTage}"></div>
              <div class="field"><label>Mahnfrist (Tage)</label><input type="number" name="mahnfristTage" value="${settings.mahnfristTage}"></div>
              <div class="field"><label>Mahngebühr Stufe 1 (€)</label><input type="number" step="0.01" name="mahn1" value="${settings.mahnGebuehr?.[1] ?? 0}"></div>
              <div class="field"><label>Mahngebühr Stufe 2 (€)</label><input type="number" step="0.01" name="mahn2" value="${settings.mahnGebuehr?.[2] ?? 0}"></div>
              <div class="field"><label>Mahngebühr Stufe 3 (€)</label><input type="number" step="0.01" name="mahn3" value="${settings.mahnGebuehr?.[3] ?? 0}"></div>
            </div>
            <div class="modal-actions" style="border:none;padding-top:10px"><button type="submit" class="btn btn-primary">Speichern</button></div>
          </form>
        </div>

        <div class="card settings-panel" data-panel="kalkulation" hidden>
          <h2>Zuschläge &amp; Kalkulation</h2>
          <p class="hint">Wird als Vorschlag für den Zuschlag (%) beim Anlegen neuer Artikel/Leistungen/Pakete im Katalog verwendet (EK × (1 + Zuschlag/100) = VK). Lässt sich pro Eintrag weiterhin frei anpassen.</p>
          <form id="kalk-form">
            <div class="form-grid">
              <div class="field"><label>Standard-Zuschlag (%)</label><input type="number" step="1" min="0" name="standardAufschlagProzent" value="${settings.standardAufschlagProzent ?? 20}"></div>
            </div>
            <div class="modal-actions" style="border:none;padding-top:10px"><button type="submit" class="btn btn-primary">Speichern</button></div>
          </form>
        </div>

        <div class="card settings-panel" data-panel="zeit" hidden>
          <h2>Zeiterfassung &amp; Buchhaltung</h2>
          <form id="buch-form">
            <div class="form-grid">
              <div class="field"><label>Stundensatz für Zeiterfassung (€)</label><input type="number" step="0.01" min="0" name="stundensatz" value="${settings.stundensatz}"></div>
              <div class="field"></div>
              <div class="field"><label>DATEV Berater-Nr.</label><input name="datevBeraterNr" value="${escapeHtml(settings.datevBeraterNr || '')}"></div>
              <div class="field"><label>DATEV Mandanten-Nr.</label><input name="datevMandantNr" value="${escapeHtml(settings.datevMandantNr || '')}"></div>
              <div class="field"><label>Erlöskonto (SKR)</label><input name="datevErloesKonto" value="${escapeHtml(settings.datevErloesKonto)}"></div>
              <div class="field"><label>Aufwandskonto (SKR)</label><input name="datevAufwandKonto" value="${escapeHtml(settings.datevAufwandKonto)}"></div>
            </div>
            <p class="hint">Die DATEV-Felder werden nur für den Buchhaltungsexport benötigt – bitte mit deinem Steuerberater abstimmen.</p>
            <div class="modal-actions" style="border:none;padding-top:10px"><button type="submit" class="btn btn-primary">Speichern</button></div>
          </form>
        </div>

        <div class="card settings-panel" data-panel="textbausteine" hidden>
          <h2>Textbausteine (Schlusstexte)</h2>
          <p class="hint">Wiederverwendbare Schlusstexte für Angebote/Rechnungen – dort per Mehrfachauswahl in die Notizen einfügbar.</p>
          <div id="tb-list"></div>
          <button class="btn btn-sm" id="btn-tb-new" style="margin-top:8px">+ Neuer Textbaustein</button>
        </div>

        <div class="card settings-panel" data-panel="google" hidden>
          <h2>Google-Verbindung (Kalender &amp; Gmail)</h2>
          <p class="hint">
            Verbindet die Verwaltung mit deinem Google-Konto, damit Termine mit Google Kalender abgeglichen werden und du Angebote/Rechnungen/Mahnungen direkt per Gmail verschicken kannst.
            Dafür brauchst du einmalig eine kostenlose <strong>Google Client-ID</strong> aus der Google Cloud Console – frag mich im Chat, wenn du dabei Hilfe brauchst.
            Die Verbindung gilt jeweils nur für die aktuelle Browser-Sitzung; nach dem Schließen des Browsers musst du dich beim nächsten Mal neu verbinden.
          </p>
          <form id="google-form">
            <div class="form-grid">
              <div class="field col-span-2"><label>Google Client-ID</label><input name="googleClientId" placeholder="xxxxxxxx.apps.googleusercontent.com" value="${escapeHtml(settings.googleClientId || '')}"></div>
              <div class="field col-span-2"><label>Kalender-ID</label><input name="googleCalendarId" value="${escapeHtml(settings.googleCalendarId || 'primary')}"><span class="hint mb-0">Meist reicht "primary" (dein Hauptkalender).</span></div>
            </div>
            <div class="modal-actions" style="border:none;padding-top:10px">
              <span id="google-status" class="badge ${google.isConnected() ? 'badge-success' : 'badge'}">${google.isConnected() ? 'Verbunden' : 'Nicht verbunden'}</span>
              <span class="spacer"></span>
              <button type="button" class="btn" id="btn-google-disconnect" ${google.isConnected() ? '' : 'disabled'}>Trennen</button>
              <button type="button" class="btn" id="btn-google-connect">Mit Google verbinden</button>
              <button type="submit" class="btn btn-primary">Speichern</button>
            </div>
          </form>
        </div>

        <div class="card settings-panel" data-panel="ki" hidden>
          <h2>KI-Angebotserstellung</h2>
          <p class="hint">
            Erstellt Angebotspositionen automatisch aus Stichpunkten (z.B. auf der Baustelle diktiert). Dafür wird ein kleiner, separater Cloud-Vermittler (Cloudflare Worker) benötigt, der deinen Anthropic-API-Schlüssel sicher verwahrt – der Schlüssel selbst liegt niemals im Browser. Details/Einrichtung: Ordner <code>cloudflare-worker/</code> im Projekt bzw. frag im Chat nach.
          </p>
          <form id="ai-form">
            <div class="form-grid">
              <div class="field col-span-2"><label>Worker-URL</label><input name="aiWorkerUrl" placeholder="https://neuverdrahtet-ki-angebote.DEIN-SUBDOMAIN.workers.dev" value="${escapeHtml(settings.aiWorkerUrl || '')}"></div>
              <div class="field col-span-2"><label>App-Secret (im Worker als APP_SECRET hinterlegt)</label><input type="password" name="aiAppSecret" value="${escapeHtml(settings.aiAppSecret || '')}"></div>
            </div>
            <div class="modal-actions" style="border:none;padding-top:10px"><button type="submit" class="btn btn-primary">Speichern</button></div>
          </form>
        </div>

        <div class="card settings-panel" data-panel="daten" hidden>
          <h2>Datensicherung / Geräte-Sync</h2>
          <p class="hint">Alle Daten werden nur lokal in diesem Browser gespeichert. Über Export/Import können Daten als Datei zwischen Geräten oder mit Mitarbeitern ausgetauscht werden.</p>
          <div class="flex-row flex-wrap">
            <button class="btn" id="btn-export">Daten exportieren (JSON)</button>
            <button class="btn" id="btn-import">Daten importieren ...</button>
            <input type="file" id="import-file" accept="application/json" hidden>
          </div>
        </div>

      </div>
    </div>
  `;

  const nav = container.querySelector('#settings-nav');
  function showPanel(id) {
    container.querySelectorAll('.settings-panel').forEach((p) => { p.hidden = p.dataset.panel !== id; });
    nav.querySelectorAll('.settings-nav-item').forEach((b) => b.classList.toggle('active', b.dataset.panel === id));
    try { sessionStorage.setItem('nv-settings-panel', id); } catch { /* ignore */ }
  }
  nav.querySelectorAll('.settings-nav-item').forEach((btn) => {
    btn.addEventListener('click', () => showPanel(btn.dataset.panel));
  });
  const lastPanel = (() => { try { return sessionStorage.getItem('nv-settings-panel'); } catch { return null; } })();
  const firstPanelId = NAV[0].items[0].id;
  const allIds = NAV.flatMap((g) => g.items.map((i) => i.id));
  showPanel(allIds.includes(lastPanel) ? lastPanel : firstPanelId);

  container.querySelector('#theme-toggle').addEventListener('change', async (e) => {
    const theme = e.target.checked ? 'light' : 'dark';
    await setSettings({ theme });
    document.documentElement.dataset.theme = theme;
    toast('Darstellung gespeichert', 'success');
  });

  const tbListHost = container.querySelector('#tb-list');
  function renderTbList() {
    tbListHost.innerHTML = textbausteine.length === 0
      ? '<p class="text-mute">Noch keine Textbausteine angelegt.</p>'
      : `<ul class="cal-event-list">${textbausteine.map((t) => `
          <li data-id="${t.id}">
            <div>
              <strong>${escapeHtml(t.titel)}</strong>
              <div class="text-mute">${escapeHtml(TEXTBAUSTEIN_KATEGORIEN.find((k) => k.id === t.kategorie)?.titel || '')} · ${escapeHtml((t.text || '').slice(0, 60))}${(t.text || '').length > 60 ? '…' : ''}</div>
            </div>
            <div class="flex-row">
              <button type="button" class="btn btn-sm btn-ghost btn-tb-edit">Bearbeiten</button>
              <button type="button" class="btn btn-sm btn-ghost btn-tb-del">Löschen</button>
            </div>
          </li>
        `).join('')}</ul>`;
    tbListHost.querySelectorAll('.btn-tb-edit').forEach((btn) => {
      btn.addEventListener('click', () => openTbForm(textbausteine.find((t) => t.id === btn.closest('li').dataset.id)));
    });
    tbListHost.querySelectorAll('.btn-tb-del').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('li').dataset.id;
        const t = textbausteine.find((x) => x.id === id);
        if (!confirmDelete(`Textbaustein "${t.titel}" wirklich löschen?`)) return;
        await remove('textbausteine', id);
        const i = textbausteine.findIndex((x) => x.id === id);
        textbausteine.splice(i, 1);
        renderTbList();
        toast('Textbaustein gelöscht');
      });
    });
  }
  function openTbForm(t) {
    const isEdit = !!t;
    const data = t || { id: uid(), titel: '', text: '', kategorie: 'beide' };
    const { body, close } = openModal({
      title: isEdit ? 'Textbaustein bearbeiten' : 'Neuer Textbaustein',
      bodyHtml: `
        <form id="tb-form">
          <div class="form-grid">
            <div class="field col-span-2"><label>Titel *</label><input name="titel" required value="${escapeHtml(data.titel)}"></div>
            <div class="field col-span-2"><label>Verwendung</label>
              <select name="kategorie">${TEXTBAUSTEIN_KATEGORIEN.map((k) => `<option value="${k.id}" ${k.id === data.kategorie ? 'selected' : ''}>${escapeHtml(k.titel)}</option>`).join('')}</select>
            </div>
            <div class="field col-span-2"><label>Text *</label><textarea name="text" required style="min-height:100px">${escapeHtml(data.text)}</textarea></div>
          </div>
          <div class="modal-actions">
            <span class="spacer"></span>
            <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Speichern</button>
          </div>
        </form>
      `,
    });
    body.querySelector('#btn-cancel').addEventListener('click', close);
    body.querySelector('#tb-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data, titel: (fd.get('titel') || '').toString().trim(), text: (fd.get('text') || '').toString().trim(), kategorie: fd.get('kategorie') || 'beide' };
      if (!updated.titel || !updated.text) return;
      await put('textbausteine', updated);
      if (!isEdit) textbausteine.push(updated);
      else Object.assign(t, updated);
      textbausteine.sort((a, b) => (a.titel || '').localeCompare(b.titel || ''));
      toast(isEdit ? 'Textbaustein aktualisiert' : 'Textbaustein angelegt', 'success');
      close();
      renderTbList();
    });
  }
  renderTbList();
  container.querySelector('#btn-tb-new').addEventListener('click', () => openTbForm());

  container.querySelector('#logo-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const blob = await compressImage(file, { maxWidth: 400, quality: 0.9 });
      const dataUrl = await blobToDataUrl(blob);
      await setSettings({ logoDataUrl: dataUrl });
      toast('Logo gespeichert', 'success');
      render(container);
    } catch (err) {
      toast(err.message, 'danger');
    }
  });
  const logoRemoveBtn = container.querySelector('#btn-logo-remove');
  if (logoRemoveBtn) {
    logoRemoveBtn.addEventListener('click', async () => {
      await setSettings({ logoDataUrl: '' });
      toast('Logo entfernt');
      render(container);
    });
  }

  container.querySelector('#firma-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const update = {};
    for (const key of ['firmenname', 'strasse', 'plzOrt', 'telefon', 'email', 'ustId', 'steuernummer', 'iban', 'bic', 'bank', 'inhaber']) {
      update[key] = (fd.get(key) || '').toString().trim();
    }
    update.kleinunternehmer = fd.get('kleinunternehmer') === 'on';
    await setSettings(update);
    toast('Firmendaten gespeichert', 'success');
  });

  container.querySelector('#kalk-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await setSettings({ standardAufschlagProzent: Number(fd.get('standardAufschlagProzent')) || 0 });
    toast('Kalkulationseinstellungen gespeichert', 'success');
  });

  container.querySelector('#buch-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await setSettings({
      stundensatz: Number(fd.get('stundensatz')) || 0,
      datevBeraterNr: (fd.get('datevBeraterNr') || '').toString().trim(),
      datevMandantNr: (fd.get('datevMandantNr') || '').toString().trim(),
      datevErloesKonto: (fd.get('datevErloesKonto') || '8400').toString().trim(),
      datevAufwandKonto: (fd.get('datevAufwandKonto') || '4900').toString().trim(),
    });
    toast('Gespeichert', 'success');
  });

  container.querySelector('#ai-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await setSettings({
      aiWorkerUrl: (fd.get('aiWorkerUrl') || '').toString().trim(),
      aiAppSecret: (fd.get('aiAppSecret') || '').toString().trim(),
    });
    toast('KI-Einstellungen gespeichert', 'success');
  });

  container.querySelector('#google-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await setSettings({
      googleClientId: (fd.get('googleClientId') || '').toString().trim(),
      googleCalendarId: (fd.get('googleCalendarId') || 'primary').toString().trim() || 'primary',
    });
    toast('Google-Einstellungen gespeichert', 'success');
  });

  container.querySelector('#btn-google-connect').addEventListener('click', async () => {
    try {
      await google.connect();
      toast('Mit Google verbunden', 'success');
      render(container);
    } catch (err) {
      toast(err.message, 'danger');
    }
  });

  container.querySelector('#btn-google-disconnect').addEventListener('click', () => {
    google.disconnect();
    toast('Google-Verbindung getrennt');
    render(container);
  });

  container.querySelector('#nr-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await setSettings({
      angebotPrefix: fd.get('angebotPrefix') || 'AN-',
      naechsteAngebotNr: Number(fd.get('naechsteAngebotNr')) || 1,
      rechnungPrefix: fd.get('rechnungPrefix') || 'RE-',
      naechsteRechnungNr: Number(fd.get('naechsteRechnungNr')) || 1,
      standardSteuersatz: Number(fd.get('standardSteuersatz')) || 19,
      angebotGueltigTage: Number(fd.get('angebotGueltigTage')) || 30,
      zahlungszielTage: Number(fd.get('zahlungszielTage')) || 14,
      mahnfristTage: Number(fd.get('mahnfristTage')) || 10,
      mahnGebuehr: [0, Number(fd.get('mahn1')) || 0, Number(fd.get('mahn2')) || 0, Number(fd.get('mahn3')) || 0],
    });
    toast('Einstellungen gespeichert', 'success');
  });

  container.querySelector('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await setSettings({ passcode: (fd.get('passcode') || '').toString().trim() });
    toast('Zugangscode gespeichert. Wird nach Neuladen aktiv.', 'success');
  });

  container.querySelector('#btn-export').addEventListener('click', async () => {
    const data = await exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `neuverdrahtet-verwaltung-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Export erstellt', 'success');
  });

  const fileInput = container.querySelector('#import-file');
  container.querySelector('#btn-import').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (!confirmDelete('Import fügt Daten hinzu bzw. überschreibt vorhandene Einträge mit gleicher ID. Fortfahren?')) {
      fileInput.value = '';
      return;
    }
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await importAll(data, { replace: false });
      toast('Import erfolgreich. Seite wird neu geladen.', 'success');
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      toast('Import fehlgeschlagen: ' + err.message, 'danger');
    }
    fileInput.value = '';
  });
}
