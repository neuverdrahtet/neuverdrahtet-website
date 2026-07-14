import { getSettings, setSettings, exportAll, importAll } from '../db.js';
import { escapeHtml, toast } from '../utils.js';
import { confirmDelete } from '../ui.js';
import * as google from '../google.js';

export async function render(container) {
  const settings = await getSettings();

  container.innerHTML = `
    <div class="view-header"><h1>Einstellungen</h1></div>

    <div class="card">
      <h2>Firmendaten</h2>
      <form id="firma-form">
        <div class="form-grid">
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
          <div class="field field-checkbox col-span-2"><input type="checkbox" name="kleinunternehmer" id="ku" ${settings.kleinunternehmer ? 'checked' : ''}><label for="ku">Kleinunternehmer nach §19 UStG (keine USt. ausweisen)</label></div>
        </div>
        <div class="modal-actions" style="border:none;padding-top:10px"><button type="submit" class="btn btn-primary">Speichern</button></div>
      </form>
    </div>

    <div class="card">
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

    <div class="card">
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

    <div class="card">
      <h2>Zugangscode</h2>
      <p class="hint">Optionaler Zugangscode für dieses Gerät. Hinweis: Dies ist kein vollwertiger Passwortschutz, sondern nur eine einfache Zugriffshürde – die Daten liegen unverschlüsselt im Browser dieses Geräts.</p>
      <form id="pw-form">
        <div class="form-grid">
          <div class="field"><label>Zugangscode (leer = kein Schutz)</label><input name="passcode" value="${escapeHtml(settings.passcode || '')}"></div>
        </div>
        <div class="modal-actions" style="border:none;padding-top:10px"><button type="submit" class="btn btn-primary">Speichern</button></div>
      </form>
    </div>

    <div class="card">
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

    <div class="card">
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

    <div class="card">
      <h2>Datensicherung / Geräte-Sync</h2>
      <p class="hint">Alle Daten werden nur lokal in diesem Browser gespeichert. Über Export/Import können Daten als Datei zwischen Geräten oder mit Mitarbeitern ausgetauscht werden.</p>
      <div class="flex-row flex-wrap">
        <button class="btn" id="btn-export">Daten exportieren (JSON)</button>
        <button class="btn" id="btn-import">Daten importieren ...</button>
        <input type="file" id="import-file" accept="application/json" hidden>
      </div>
    </div>
  `;

  container.querySelector('#firma-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const update = {};
    for (const key of ['firmenname', 'strasse', 'plzOrt', 'telefon', 'email', 'ustId', 'steuernummer', 'iban', 'bic', 'bank']) {
      update[key] = (fd.get(key) || '').toString().trim();
    }
    update.kleinunternehmer = fd.get('kleinunternehmer') === 'on';
    await setSettings(update);
    toast('Firmendaten gespeichert', 'success');
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
