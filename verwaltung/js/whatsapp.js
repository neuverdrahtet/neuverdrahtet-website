import { toast } from './utils.js';

export function toWhatsAppNumber(phone) {
  if (!phone) return '';
  let digits = phone.trim().replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = '49' + digits.slice(1);
  return digits;
}

export function openWhatsApp(phone, text) {
  const number = toWhatsAppNumber(phone);
  if (!number) {
    toast('Keine Telefonnummer hinterlegt', 'danger');
    return;
  }
  const url = `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'noopener');
}

export function sendDocumentViaWhatsApp({ phone, text, pdfBlob, filename }) {
  if (!toWhatsAppNumber(phone)) {
    toast('Keine Telefonnummer hinterlegt', 'danger');
    return;
  }
  if (pdfBlob) {
    const url = URL.createObjectURL(pdfBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast('PDF wird heruntergeladen – bitte gleich im WhatsApp-Chat manuell anhängen (WhatsApp erlaubt keinen automatischen Dateiversand per Link).', 'info');
  }
  setTimeout(() => openWhatsApp(phone, text), pdfBlob ? 600 : 0);
}
