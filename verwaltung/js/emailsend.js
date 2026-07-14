import { openModal } from './ui.js';
import { escapeHtml, toast } from './utils.js';
import * as google from './google.js';

export function openEmailComposer({ to, subject, bodyText, filename, buildPdfBlob }) {
  const { body, close } = openModal({
    title: 'Per E-Mail senden',
    bodyHtml: `
      <form id="email-form">
        <div class="form-grid">
          <div class="field col-span-2"><label>An *</label><input type="email" name="to" required value="${escapeHtml(to || '')}"></div>
          <div class="field col-span-2"><label>Betreff</label><input name="subject" value="${escapeHtml(subject || '')}"></div>
          <div class="field col-span-2"><label>Nachricht</label><textarea name="body" rows="8">${escapeHtml(bodyText || '')}</textarea></div>
        </div>
        <p class="hint">Der Versand erfolgt über dein verbundenes Gmail-Konto (Einstellungen → Google-Verbindung). Das Dokument wird als PDF angehängt.</p>
        <div class="modal-actions">
          <span class="spacer"></span>
          <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
          <button type="submit" class="btn btn-primary" id="btn-send">Senden</button>
        </div>
      </form>
    `,
  });
  body.querySelector('#btn-cancel').addEventListener('click', close);
  body.querySelector('#email-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const to = (fd.get('to') || '').toString().trim();
    const subject = (fd.get('subject') || '').toString().trim();
    const bodyText = (fd.get('body') || '').toString();
    const sendBtn = body.querySelector('#btn-send');
    sendBtn.disabled = true;
    sendBtn.textContent = 'Wird gesendet ...';
    try {
      const blob = buildPdfBlob();
      await google.sendEmailWithAttachment({ to, subject, bodyText, attachmentName: filename, attachmentBlob: blob });
      toast('E-Mail gesendet', 'success');
      close();
    } catch (err) {
      toast(err.message, 'danger');
      sendBtn.disabled = false;
      sendBtn.textContent = 'Senden';
    }
  });
}
