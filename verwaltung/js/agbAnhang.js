// Hängt beim Versenden von Angeboten/Auftragsbestätigungen/Rechnungen
// optional AGB und/oder Widerrufsbelehrung als zusätzliche PDF-Seiten an
// (siehe emailsend.js für die Checkbox-UI, docpdf.js für das Rendern der
// Seiten). Zentral an einer Stelle, statt in jeder der drei Ansichten
// einzeln - Text kommt aus den Einstellungen (agbText/widerrufText,
// editierbar unter "Vorlagen & Texte"), nicht hart codiert.
import { getSettings } from './db.js';

// Reine Funktion (kein getSettings()-Zugriff) - deshalb eigenständig per
// Node-Unit-Test abgedeckt (siehe verwaltung/tests/agb-anhang.test.mjs),
// genau wie baueGirocodePayload() in girocode.js von der Browser-API-Hülle
// erzeugeGirocodeDataUrl() getrennt ist.
export function baueAnhaengeAusSettings({ agb, widerruf, settings }) {
  const anhaenge = [];
  if (agb && (settings.agbText || '').trim()) {
    anhaenge.push({ titel: 'Allgemeine Geschäftsbedingungen', text: settings.agbText });
  }
  if (widerruf && (settings.widerrufText || '').trim()) {
    anhaenge.push({ titel: 'Widerrufsbelehrung', text: settings.widerrufText });
  }
  return anhaenge;
}

export async function ermittleDokumentAnhaenge({ agb, widerruf }) {
  const settings = await getSettings();
  return baueAnhaengeAusSettings({ agb, widerruf, settings });
}
