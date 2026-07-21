import { getSettings, setSettings, exportAll, importAll, ZUGRIFFSROLLEN } from '../db.js';
import { escapeHtml, toast, compressImage, formatDateTime } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import * as google from '../google.js';
import * as lexoffice from '../lexoffice.js';
import { FIREBASE_ENABLED } from '../employeeAuth.js';
import { previewLegacyData, migrateLegacyData } from '../migrate.js';

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
  { group: 'Vorlagen & Texte', items: [
    { id: 'layout', icon: '🎨', label: 'Layout (Dokument-Design)' },
  ] },
  { group: 'Integrationen', items: [
    { id: 'google', icon: '📅', label: 'Google-Verbindung' },
    { id: 'lexoffice', icon: '🧾', label: 'lexoffice-Verbindung' },
  ] },
  { group: 'Daten & Sicherheit', items: [
    { id: 'daten', icon: '💾', label: 'Datensicherung / Geräte-Sync' },
  ] },
];

export async function render(container) {
  const settings = await getSettings();
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

        <div class="card settings-panel" data-panel="layout" hidden>
          <h2>Layout (Dokument-Design)</h2>
          <p class="hint">Gilt für Berichte/Protokolle (PDF). Die Fußzeile mit Firmendaten, Bankverbindung und Seitenzahl ist immer am unteren Rand jeder Seite fixiert und verschiebt sich nicht, egal wie viel Text im Hauptteil steht.</p>
          <form id="layout-form">
            <div class="form-grid">
              <div class="field"><label>Akzentfarbe (Tabellenköpfe)</label><input type="color" name="dokAkzentfarbe" id="layout-akzent" value="${escapeHtml(settings.dokAkzentfarbe || '#0f1b2d')}"></div>
              <div class="field"><label>Schriftgröße Fließtext (pt)</label><input type="number" min="8" max="14" step="0.5" name="dokSchriftgroesse" id="layout-schriftgroesse" value="${settings.dokSchriftgroesse || 10}"></div>
            </div>
            <div class="modal-actions" style="border:none;padding-top:10px"><button type="submit" class="btn btn-primary">Speichern</button></div>
          </form>
          <div class="divider"></div>
          <h3 style="font-size:13px;margin:0 0 8px">Vorschau</h3>
          <div class="dok-layout-preview" id="layout-preview" style="--dok-akzent:${escapeHtml(settings.dokAkzentfarbe || '#0f1b2d')};--dok-fontsize:${settings.dokSchriftgroesse || 10}px">
            <div class="dlp-header">
              <div>${escapeHtml(settings.firmenname || 'Musterfirma GmbH')}</div>
              <div class="dlp-titel">Bericht</div>
            </div>
            <table class="dlp-table">
              <thead><tr><th>Raum / Bereich</th><th>Beschreibung / Zustand</th></tr></thead>
              <tbody><tr><td>Beispiel-Raum</td><td>Beispiel-Text</td></tr></tbody>
            </table>
            <div class="dlp-footer">${escapeHtml(settings.firmenname || 'Musterfirma GmbH')} · Fußzeile bleibt immer am unteren Rand</div>
          </div>
        </div>

        <div class="card settings-panel" data-panel="google" hidden>
          <h2>Google-Verbindung (Kalender &amp; Gmail)</h2>
          <p class="hint">
            Verbindet die Verwaltung mit deinem Google-Konto, damit Termine mit Google Kalender abgeglichen werden und du Dokumente/Berichte direkt per Gmail verschicken kannst.
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

        <div class="card settings-panel" data-panel="lexoffice" hidden>
          <h2>lexoffice-Verbindung</h2>
          <p class="hint">
            Überträgt Zeiterfassung und verwendete Leistungen/Material je Auftrag als Rechnungsentwurf nach lexoffice – die eigentlichen Preise kommen dabei aus deinem lexoffice-Artikelstamm, nicht aus dieser App.
            Den API-Key erzeugst du einmalig in deinem lexoffice-Konto unter Einstellungen → Öffentliche API.
          </p>
          <form id="lexoffice-form">
            <div class="form-grid">
              <div class="field col-span-2"><label>API-Key</label><input type="password" name="lexofficeApiKey" value="${escapeHtml(settings.lexofficeApiKey || '')}"></div>
            </div>
            <div class="modal-actions" style="border:none;padding-top:10px">
              <span id="lexoffice-status" class="badge ${settings.lexofficeApiKey ? 'badge-success' : 'badge'}">${settings.lexofficeApiKey ? 'Key hinterlegt' : 'Kein Key hinterlegt'}</span>
              <span class="spacer"></span>
              <button type="button" class="btn" id="btn-lexoffice-test">Verbindung testen</button>
              <button type="submit" class="btn btn-primary">Speichern</button>
            </div>
          </form>
          <div class="divider"></div>
          <h2 style="font-size:14px">Arbeitsstunde-Artikel</h2>
          <p class="hint">Beim „An lexoffice übertragen"-Button in der Projekt-Akte wird die erfasste Zeit als Menge dieses lexoffice-Artikels auf dem Rechnungsentwurf abgebildet.</p>
          <div class="flex-row" style="gap:10px;align-items:center">
            <span id="lexoffice-arbeitsstunde-status">${settings.lexofficeArbeitsstundeArtikelName ? `Ausgewählt: <strong>${escapeHtml(settings.lexofficeArbeitsstundeArtikelName)}</strong>` : 'Noch kein Artikel ausgewählt.'}</span>
            <span class="spacer"></span>
            <button type="button" class="btn" id="btn-lexoffice-arbeitsstunde-choose">Artikel wählen ...</button>
          </div>
        </div>

        <div class="card settings-panel" data-panel="daten" hidden>
          <h2>Datensicherung / Geräte-Sync</h2>
          <p class="hint">Alle Daten werden nur lokal in diesem Browser gespeichert. Über Export/Import können Daten als Datei zwischen Geräten oder mit Mitarbeitern ausgetauscht werden.</p>
          <div class="flex-row flex-wrap">
            <button class="btn" id="btn-export">Daten exportieren (JSON)</button>
            <button class="btn" id="btn-import">Daten importieren ...</button>
            <input type="file" id="import-file" accept="application/json" hidden>
          </div>

          ${FIREBASE_ENABLED ? `
            <h2 style="margin-top:28px">Alte lokale Daten von diesem Gerät übertragen</h2>
            <p class="hint">
              Falls auf <strong>diesem Gerät</strong> noch Daten aus der Zeit vor der gemeinsamen Datenbank liegen
              (z.B. Mitarbeiter, Kunden, Katalog, Firmendaten/Logo, die hier nicht mehr auftauchen), können sie
              hierüber einmalig in die neue gemeinsame Datenbank übertragen werden. Nichts wird dabei gelöscht.
              Fotos/Belege/Unterschriften, die zu groß für die aktuelle Datenbank sind, werden übersprungen und
              am Ende gemeldet – dafür kommt später eine eigene Lösung.
            </p>
            <div class="flex-row flex-wrap">
              <button class="btn" id="btn-migrate-check">Lokale Altdaten auf diesem Gerät prüfen</button>
            </div>
            <div id="migrate-host"></div>
          ` : ''}

          <h2 style="margin-top:28px">Automatisches Cloud-Backup (Google Drive)</h2>
          <p class="hint">
            Sichert die Daten zusätzlich in deinem Google Drive (eigener Ordner, nur für diese App sichtbar).
            Läuft automatisch mit, sobald die Google-Verbindung aktiv ist (max. 1x pro Tag) – dafür muss die
            Google-Verbindung (siehe Einstellungen → Google-Verbindung) eingerichtet sein. Ohne aktiv geöffnete
            Verwaltung/Verbindung kann kein Backup laufen, daher zusätzlich den "Jetzt sichern"-Button nutzen,
            wenn du sichergehen willst.
          </p>
          <div class="field field-checkbox"><input type="checkbox" id="drive-backup-enabled" ${settings.driveBackupEnabled ? 'checked' : ''}><label for="drive-backup-enabled">Automatisches Backup aktivieren</label></div>
          <p class="hint" id="drive-backup-last">Letztes Backup: ${settings.driveBackupLastAt ? escapeHtml(formatDateTime(settings.driveBackupLastAt)) : 'noch nie'}</p>
          <div class="flex-row flex-wrap">
            <button class="btn" id="btn-backup-now">☁️ Jetzt sichern</button>
            <button class="btn" id="btn-backup-list">Verfügbare Backups anzeigen</button>
          </div>
          <div id="drive-backup-list-host"></div>
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
    await setSettings(update);
    toast('Firmendaten gespeichert', 'success');
  });

  const layoutPreview = container.querySelector('#layout-preview');
  const layoutAkzentInput = container.querySelector('#layout-akzent');
  const layoutSchriftInput = container.querySelector('#layout-schriftgroesse');
  layoutAkzentInput.addEventListener('input', () => {
    layoutPreview.style.setProperty('--dok-akzent', layoutAkzentInput.value);
  });
  layoutSchriftInput.addEventListener('input', () => {
    layoutPreview.style.setProperty('--dok-fontsize', `${Number(layoutSchriftInput.value) || 10}px`);
  });
  container.querySelector('#layout-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await setSettings({
      dokAkzentfarbe: (fd.get('dokAkzentfarbe') || '#0f1b2d').toString(),
      dokSchriftgroesse: Number(fd.get('dokSchriftgroesse')) || 10,
    });
    toast('Layout gespeichert', 'success');
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

  container.querySelector('#lexoffice-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await setSettings({ lexofficeApiKey: (fd.get('lexofficeApiKey') || '').toString().trim() });
    toast('lexoffice-Einstellungen gespeichert', 'success');
    render(container);
  });

  container.querySelector('#btn-lexoffice-test').addEventListener('click', async (e) => {
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = 'Teste ...';
    try {
      const profile = await lexoffice.testConnection();
      toast(`Verbindung erfolgreich${profile?.companyName ? ` (${profile.companyName})` : ''}`, 'success');
    } catch (err) {
      toast(err.message, 'danger');
    }
    btn.disabled = false;
    btn.textContent = 'Verbindung testen';
  });

  container.querySelector('#btn-lexoffice-arbeitsstunde-choose').addEventListener('click', async (e) => {
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = 'Lade ...';
    let artikel;
    try {
      artikel = await lexoffice.fetchArtikel();
    } catch (err) {
      toast(err.message, 'danger');
      btn.disabled = false;
      btn.textContent = 'Artikel wählen ...';
      return;
    }
    btn.disabled = false;
    btn.textContent = 'Artikel wählen ...';
    const { body, close } = openModal({
      title: 'Arbeitsstunde-Artikel wählen',
      bodyHtml: `
        <p class="hint">Wähle den Artikel aus deinem lexoffice-Artikelstamm, der beim Übertragen einer Zeiterfassung als Menge (Stunden) verwendet wird.</p>
        <table class="data-table">
          <thead><tr><th>Bezeichnung</th><th>Einheit</th><th class="text-right">Preis</th><th></th></tr></thead>
          <tbody>
            ${artikel.map((a) => `
              <tr>
                <td>${escapeHtml(a.title || a.name || '')}</td>
                <td>${escapeHtml(a.unitName || '')}</td>
                <td class="text-right">${a.price?.netPrice != null ? `${a.price.netPrice.toFixed(2)} €` : ''}</td>
                <td><button type="button" class="btn btn-sm" data-id="${escapeHtml(a.id)}" data-name="${escapeHtml(a.title || a.name || '')}">Wählen</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="modal-actions"><span class="spacer"></span><button type="button" class="btn" id="btn-cancel">Schließen</button></div>
      `,
    });
    body.querySelectorAll('button[data-id]').forEach((choose) => {
      choose.addEventListener('click', async () => {
        await setSettings({ lexofficeArbeitsstundeArtikelId: choose.dataset.id, lexofficeArbeitsstundeArtikelName: choose.dataset.name });
        toast('Arbeitsstunde-Artikel gespeichert', 'success');
        close();
        render(container);
      });
    });
    body.querySelector('#btn-cancel').addEventListener('click', close);
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

  if (FIREBASE_ENABLED) {
    const migrateHost = container.querySelector('#migrate-host');
    container.querySelector('#btn-migrate-check').addEventListener('click', async () => {
      migrateHost.innerHTML = '<p class="hint">Suche lokale Daten auf diesem Gerät ...</p>';
      let preview;
      try {
        preview = await previewLegacyData();
      } catch (err) {
        migrateHost.innerHTML = `<p class="hint">Fehler beim Prüfen: ${escapeHtml(err.message)}</p>`;
        return;
      }
      if (preview.total === 0) {
        migrateHost.innerHTML = '<p class="hint">Keine lokalen Altdaten auf diesem Gerät gefunden.</p>';
        return;
      }
      const rows = Object.entries(preview.counts).map(([store, count]) => `<li>${escapeHtml(store)}: ${count} Datensätze</li>`).join('');
      migrateHost.innerHTML = `
        <p class="hint">Gefunden (insgesamt ${preview.total} Datensätze):</p>
        <ul class="cal-event-list">${rows}</ul>
        <button class="btn btn-primary" id="btn-migrate-run">Jetzt in die gemeinsame Datenbank übertragen</button>
      `;
      migrateHost.querySelector('#btn-migrate-run').addEventListener('click', async () => {
        if (!confirmDelete(`${preview.total} Datensätze jetzt übertragen? Bestehende Einträge mit gleicher ID in der gemeinsamen Datenbank werden dabei überschrieben.`)) return;
        migrateHost.innerHTML = '<p class="hint">Übertrage Daten ...</p>';
        const result = await migrateLegacyData();
        const summary = Object.entries(result).map(([store, r]) => {
          const failedNote = r.failed > 0 ? ` <span style="color:var(--danger)">(${r.failed} fehlgeschlagen, meist zu große Fotos/Belege)</span>` : '';
          return `<li>${escapeHtml(store)}: ${r.migrated} / ${r.total} übertragen${failedNote}</li>`;
        }).join('');
        migrateHost.innerHTML = `<p class="hint">Fertig:</p><ul class="cal-event-list">${summary}</ul><p class="hint">Bitte die Seite neu laden, damit die neuen Daten überall angezeigt werden.</p>`;
        toast('Altdaten übertragen', 'success');
      });
    });
  }

  container.querySelector('#drive-backup-enabled').addEventListener('change', async (e) => {
    await setSettings({ driveBackupEnabled: e.target.checked });
    toast(e.target.checked ? 'Automatisches Backup aktiviert' : 'Automatisches Backup deaktiviert', 'success');
  });

  container.querySelector('#btn-backup-now').addEventListener('click', async () => {
    const btn = container.querySelector('#btn-backup-now');
    btn.disabled = true;
    btn.textContent = 'Sichere ...';
    try {
      await google.runBackupNow();
      const updated = await getSettings();
      container.querySelector('#drive-backup-last').textContent = `Letztes Backup: ${formatDateTime(updated.driveBackupLastAt)}`;
      toast('Backup zu Google Drive hochgeladen', 'success');
    } catch (err) {
      toast(`Backup fehlgeschlagen: ${err.message}`, 'danger');
    }
    btn.disabled = false;
    btn.textContent = '☁️ Jetzt sichern';
  });

  container.querySelector('#btn-backup-list').addEventListener('click', async () => {
    const listHost = container.querySelector('#drive-backup-list-host');
    listHost.innerHTML = '<p class="text-mute">Lädt ...</p>';
    try {
      const files = await google.listDriveBackups();
      if (files.length === 0) {
        listHost.innerHTML = '<p class="text-mute">Noch keine Backups in Drive vorhanden.</p>';
        return;
      }
      listHost.innerHTML = `<ul class="cal-event-list">${files.map((f) => `
        <li>
          <div>
            <strong>${escapeHtml(f.name)}</strong>
            <div class="text-mute">${escapeHtml(formatDateTime(f.createdTime))}</div>
          </div>
          <button class="btn btn-sm" data-fileid="${f.id}">Wiederherstellen</button>
        </li>
      `).join('')}</ul>`;
      listHost.querySelectorAll('button[data-fileid]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirmDelete('Dieses Backup wiederherstellen? Vorhandene Einträge mit gleicher ID werden überschrieben.')) return;
          btn.disabled = true;
          btn.textContent = 'Lädt ...';
          try {
            const text = await google.downloadDriveFileContent(btn.dataset.fileid);
            const data = JSON.parse(text);
            await importAll(data, { replace: false });
            toast('Wiederherstellung erfolgreich. Seite wird neu geladen.', 'success');
            setTimeout(() => window.location.reload(), 1200);
          } catch (err) {
            toast(`Wiederherstellung fehlgeschlagen: ${err.message}`, 'danger');
            btn.disabled = false;
            btn.textContent = 'Wiederherstellen';
          }
        });
      });
    } catch (err) {
      listHost.innerHTML = `<p class="text-mute">Fehler beim Laden: ${escapeHtml(err.message)}</p>`;
    }
  });
}
