// Hängt beim Versenden von Angeboten/Auftragsbestätigungen/Rechnungen
// optional weitere Dokumente an (siehe emailsend.js für die Checkbox-UI,
// docpdf.js für das Rendern von Text-/Tabellen-Seiten):
// - AGB/Widerrufsbelehrung: fester Text aus den Einstellungen, als
//   zusätzliche Seiten IM SELBEN PDF (kein Geheimnis, editierbar unter
//   "Vorlagen & Texte").
// - Stundennachweis: neu berechnete Tabelle aus den Zeiterfassungs-
//   Einträgen eines Projekts, ebenfalls als zusätzliche Seite im selben PDF.
// - Berichte: bereits vorhandene, in "dokumente" gespeicherte PDFs (z.B.
//   Wartungsbericht) - diese werden NICHT neu gerendert, sondern als
//   EIGENE, zusätzliche E-Mail-Anhänge mitgeschickt (siehe
//   google.sendEmailWithAttachments), weil sie Fotos/Checklisten/Tabellen
//   enthalten können, die sich nicht sinnvoll als Text nachbilden lassen.
import { getAll, getSettings, TAETIGKEITEN } from './db.js';
import { formatDate } from './utils.js';

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

// Ebenfalls reine Funktion (kein getAll()-Zugriff) - nimmt die bereits
// geladenen Zeiterfassungs-Einträge entgegen statt sie selbst zu holen.
// Liefert null, wenn es nichts zu zeigen gibt (kein Anhang statt leerer
// Tabelle mit 0 Zeilen).
export function baueStundennachweisAnhang({ eintraege }) {
  if (!eintraege || !eintraege.length) return null;
  const taetigkeitTitel = (id) => TAETIGKEITEN.find((t) => t.id === id)?.titel || id || '';
  const sortiert = eintraege.slice().sort((a, b) => (a.datum || '').localeCompare(b.datum || ''));
  const rows = sortiert.map((e) => [
    formatDate(e.datum),
    taetigkeitTitel(e.taetigkeit),
    e.beschreibung || '',
    ((e.dauerMinuten || 0) / 60).toFixed(2).replace('.', ',') + ' h',
  ]);
  const gesamtMinuten = eintraege.reduce((s, e) => s + (e.dauerMinuten || 0), 0);
  return {
    titel: 'Stundennachweis',
    tabelle: {
      spalten: ['Datum', 'Tätigkeit', 'Beschreibung', 'Dauer'],
      rows,
      summeText: `Gesamt: ${(gesamtMinuten / 60).toFixed(2).replace('.', ',')} Stunden`,
    },
  };
}

export async function ermittleDokumentAnhaenge({ agb, widerruf, stundennachweis, projektId }) {
  const settings = await getSettings();
  const anhaenge = baueAnhaengeAusSettings({ agb, widerruf, settings });
  if (stundennachweis && projektId) {
    const eintraege = (await getAll('zeiterfassung')).filter((e) => e.projektId === projektId);
    const anhang = baueStundennachweisAnhang({ eintraege });
    if (anhang) anhaenge.push(anhang);
  }
  return anhaenge;
}

// Listet die bereits gespeicherten Berichte (Kategorie "bericht" in
// "dokumente") zu einem Projekt auf - zum Anzeigen als Checkbox-Liste im
// Versand-Dialog (emailsend.js), nicht zum erneuten Erzeugen der PDFs.
export async function listeBerichte(projektId) {
  if (!projektId) return [];
  return (await getAll('dokumente'))
    .filter((d) => d.bezugTyp === 'projekt' && d.bezugId === projektId && d.kategorie === 'bericht')
    .sort((a, b) => (b.erstelltAm || '').localeCompare(a.erstelltAm || ''));
}

// Holt die tatsächlichen Datei-Bytes eines bereits gespeicherten Dokuments
// (Firebase Storage über die gespeicherte URL, oder direkt den Blob im
// Offline-/Emulator-Fallback - siehe saveDokument() in dokumente.js).
export async function holeDokumentBlob(dokument) {
  if (dokument.blob) return dokument.blob;
  if (dokument.url) {
    const res = await fetch(dokument.url);
    if (!res.ok) throw new Error(`Dokument "${dokument.name}" konnte nicht geladen werden (${res.status})`);
    return res.blob();
  }
  throw new Error(`Dokument "${dokument.name}" hat weder gespeicherten Blob noch URL.`);
}
