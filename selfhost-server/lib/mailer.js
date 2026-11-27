// Mailversand für "Passwort vergessen" - rein über SMTP (nodemailer), damit
// der Server ohne Google/Firebase-Konto läuft. Komplett optional: ohne
// SMTP_HOST-Umgebungsvariable liefert createMailer() null zurück, der
// Reset-Link landet dann stattdessen in der Konsolenausgabe (siehe
// server.js) - genau wie das Admin-Passwort beim allerersten Start.
import nodemailer from 'nodemailer';

export function createMailer() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;

  const transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  });
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  async function sendResetMail(to, resetUrl) {
    await transport.sendMail({
      from,
      to,
      subject: 'Werkora - Passwort zurücksetzen',
      text: `Du hast ein neues Passwort für dein Werkora-Konto angefordert.\n\n` +
        `Link zum Zurücksetzen (gültig für 1 Stunde):\n${resetUrl}\n\n` +
        `Falls du das nicht warst, kannst du diese E-Mail ignorieren - ohne Klick auf den Link ändert sich nichts.`,
    });
  }

  return { sendResetMail };
}
