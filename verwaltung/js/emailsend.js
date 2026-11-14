import { openModal } from './ui.js';
import { escapeHtml, toast, formatDateTime } from './utils.js';
import { getAll } from './db.js';
import * as google from './google.js';
import { ermittleDokumentAnhaenge, listeBerichte, holeDokumentBlob } from './agbAnhang.js';

// kundeIstPrivatperson (14.11.2026): steuert nur den VOREINSTELLUNGS-Haken
// der Widerrufsbelehrung-Checkbox (gesetzliches Widerrufsrecht gilt nur für
// Verbraucher, § 13 BGB) - Danny kann beide Haken pro Versand trotzdem frei
// umschalten, nichts ist fest verdrahtet. zeigeAgbOptionen blendet die
// Anlagen-Auswahl überhaupt erst ein (nur für Angebote/Auftragsbestätigungen/
// Rechnungen angefordert) - bei Mahnungen/Gutschriften/Dokumenten-Export
// bleibt der Dialog unverändert, damit dort kein wirkungsloses Häkchen
// auftaucht (deren buildPdfBlob kennt das anhaenge-Argument nicht). projektId
// (optional) schaltet zusätzlich Stundennachweis + vorhandene Berichte frei -
// ohne projektId bleiben nur AGB/Widerruf wählbar.
export function openEmailComposer({
  to, subject, bodyText, filename, buildPdfBlob, onSent,
  kundeIstPrivatperson = false, zeigeAgbOptionen = false, projektId = '',
}) {
  const { body, close } = openModal({
    title: 'Per E-Mail senden',
    bodyHtml: `
      <form id="email-form">
        <div class="form-grid">
          <div class="field col-span-2"><label>An *</label><input type="email" name="to" required value="${escapeHtml(to || '')}"></div>
          <div class="field col-span-2"><label>Betreff</label><input name="subject" value="${escapeHtml(subject || '')}"></div>
          <div class="field col-span-2"><label>Nachricht</label><textarea name="body" rows="8">${escapeHtml(bodyText || '')}</textarea></div>
          ${zeigeAgbOptionen ? `
          <div class="field col-span-2">
            <label class="field-checkbox"><input type="checkbox" name="agbBeifuegen" checked> AGB beifügen</label>
            <label class="field-checkbox"><input type="checkbox" name="widerrufBeifuegen" ${kundeIstPrivatperson ? 'checked' : ''}> Widerrufsbelehrung beifügen (nur bei Verbrauchern nötig)</label>
            <div id="weitere-anlagen"></div>
          </div>` : ''}
        </div>
        <p class="hint">Der Versand erfolgt über dein verbundenes Gmail-Konto (Einstellungen → Google-Verbindung). Das Dokument wird als PDF angehängt${zeigeAgbOptionen ? ', Text-Anhänge als zusätzliche Seiten im selben PDF, Berichte als eigene Anhänge' : ''}.</p>
        <div class="modal-actions">
          <span class="spacer"></span>
          <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
          <button type="submit" class="btn btn-primary" id="btn-send">Senden</button>
        </div>
      </form>
    `,
  });

  if (zeigeAgbOptionen && projektId) ladeWeitereAnlagen();
  async function ladeWeitereAnlagen() {
    const host = body.querySelector('#weitere-anlagen');
    const [alleEintraege, berichte] = await Promise.all([
      getAll('zeiterfassung'),
      listeBerichte(projektId),
    ]);
    const eintraege = alleEintraege.filter((e) => e.projektId === projektId);
    const teile = [];
    if (eintraege.length) {
      teile.push(`<label class="field-checkbox"><input type="checkbox" name="stundennachweisBeifuegen"> Stundennachweis beifügen (${eintraege.length} Einträge)</label>`);
    }
    if (berichte.length) {
      teile.push('<p class="text-mute" style="font-size:12px;margin:6px 0 2px">Vorhandene Berichte als eigene Anhänge:</p>');
      berichte.forEach((b) => {
        teile.push(`<label class="field-checkbox"><input type="checkbox" name="berichtIds" value="${escapeHtml(b.id)}"> ${escapeHtml(b.name)} (${formatDateTime(b.erstelltAm)})</label>`);
      });
    }
    if (host) host.innerHTML = teile.join('');
  }

  body.querySelector('#btn-cancel').addEventListener('click', close);
  body.querySelector('#email-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const to = (fd.get('to') || '').toString().trim();
    const subject = (fd.get('subject') || '').toString().trim();
    const bodyText = (fd.get('body') || '').toString();
    const agb = fd.get('agbBeifuegen') === 'on';
    const widerruf = fd.get('widerrufBeifuegen') === 'on';
    const stundennachweis = fd.get('stundennachweisBeifuegen') === 'on';
    const berichtIds = fd.getAll('berichtIds');
    const sendBtn = body.querySelector('#btn-send');
    sendBtn.disabled = true;
    sendBtn.textContent = 'Wird gesendet ...';
    try {
      const anhaenge = await ermittleDokumentAnhaenge({ agb, widerruf, stundennachweis, projektId });
      const hauptBlob = await buildPdfBlob(anhaenge);
      const attachments = [{ name: filename, blob: hauptBlob, mimeType: 'application/pdf' }];
      if (berichtIds.length) {
        const berichte = await listeBerichte(projektId);
        for (const id of berichtIds) {
          const bericht = berichte.find((b) => b.id === id);
          if (!bericht) continue;
          attachments.push({ name: bericht.name, blob: await holeDokumentBlob(bericht), mimeType: bericht.mime || 'application/pdf' });
        }
      }
      await google.sendEmailWithAttachments({ to, subject, bodyText, attachments });
      toast('E-Mail gesendet', 'success');
      if (onSent) await onSent().catch(() => { /* Folgeaktion ist ein Komfort-Feature, Versand ist bereits erfolgt */ });
      close();
    } catch (err) {
      toast(err.message, 'danger');
      sendBtn.disabled = false;
      sendBtn.textContent = 'Senden';
    }
  });
}
