import { getAll, put, remove, getSettings, SERVICEAUFTRAG_STATUS, STANDARD_WARTUNGSCHECKLISTE } from '../db.js';
import { uid, escapeHtml, toast, formatDate, formatCurrency, todayISO } from '../utils.js';
import { openModal } from '../ui.js';
import { renderDokumenteSection, SERVICEAUFTRAG_DOKUMENT_KATEGORIEN } from '../dokumente.js';
import { createBulkSelect } from '../bulkselect.js';

// Service-Auftragsverwaltung (Phase 1 der Service-/Techniker-/
// Personalverwaltung, siehe Architektur-/Sicherheitsbericht Phase 0) -
// externe Herstellerwartungsaufträge (z.B. Stiebel-Eltron-Wärmepumpenservice).
// Bewusst eine EIGENE Collection statt "projekte" (die bestehenden
// "service"/"wartung"-Ansichten sind nur bereichsgefilterte Projekt-Ansichten
// ohne externe Auftragsnummer, Hersteller/Anlagentyp oder Dublettenprüfung).
//
// Diese Ansicht ist bewusst nur für admin/büro (siehe ROUTE_ROLLEN/
// firestore.rules match /serviceauftraege/{docId}) - die mobile
// Techniker-Oberfläche (eigenes Mini-App verwaltung/techniker/, Phase 4)
// liest/schreibt dieselbe Collection mit eigenen, engeren Rechten.

const STATUS_LABEL = Object.fromEntries(SERVICEAUFTRAG_STATUS.map((s) => [s.id, s.titel]));
const STATUS_BADGE = {
  offen: 'badge-warn', zugewiesen: 'badge-accent', in_bearbeitung: 'badge-accent',
  abgeschlossen: 'badge-success', abgebrochen: 'badge-danger',
};

// Exportiert für Tests (siehe verwaltung/tests/serviceauftraege.test.mjs) -
// reine Funktionen, keine DOM-/Firestore-Abhängigkeit.
export function normalisiereAuftragsnummer(nummer) {
  return (nummer || '').toString().trim().toLowerCase();
}

// Dublettenprüfung: findet einen ANDEREN Serviceauftrag mit derselben
// externen Auftragsnummer (Herstellerportale/E-Mails können dieselbe
// Auftragsnummer versehentlich zweimal liefern, z.B. bei einer erneuten
// Zusendung). Bewusst kein hartes Verbot (der Hersteller KANN eine Nummer
// legitim erneut verwenden, z.B. bei einer stornierten und neu
// ausgestellten Beauftragung) - die Oberfläche warnt und lässt die
// Entscheidung bei admin/büro.
export function findeDublette(auftraege, externeAuftragsnummer, eigeneId) {
  const norm = normalisiereAuftragsnummer(externeAuftragsnummer);
  if (!norm) return null;
  return auftraege.find((a) => a.id !== eigeneId && normalisiereAuftragsnummer(a.externeAuftragsnummer) === norm) || null;
}

// Erkennt eine Auftragsnummer, die SICHTBAR ABGESCHNITTEN wirkt (endet auf
// "..." oder das einzelne Ellipsis-Zeichen "…") - KEIN Anzeigefehler
// dieser App (siehe renderListe: escapeHtml(a.externeAuftragsnummer) ohne
// jede Kürzung), sondern ein Hinweis darauf, dass das Partnerportal
// (z.B. WR-Gruppe) die Nummer selbst in einer zu schmalen Spalte gekürzt
// angezeigt hat und der Screenshot genau das wörtlich zeigte - die
// Bildauswertung erfindet bewusst keine fehlenden Ziffern (siehe
// PARTNERIMPORT_SYSTEM_PROMPT in worker.js), übernimmt die gekürzte Zeichen-
// kette also unverändert. Rein heuristisch (Textmuster), kein Beweis -
// dient nur dazu, verdächtige Fälle im Büro auffindbar zu machen.
export function wirktAuftragsnummerAbgeschnitten(auftragsnummer) {
  return /(\.{3}|…)$/.test((auftragsnummer || '').toString().trim());
}

export function istUeberfaellig(auftrag, heute = todayISO()) {
  if (!auftrag.auftragsfrist) return false;
  if (auftrag.status === 'abgeschlossen' || auftrag.status === 'abgebrochen') return false;
  return auftrag.auftragsfrist < heute;
}

function istAusgefuellt(wert) {
  return !!(wert ?? '').toString().trim();
}

// Datenvollständigkeits-Check für einen BEREITS ANGELEGTEN Serviceauftrag -
// unabhängig davon, ob er manuell erfasst oder aus einem Partner-Import
// übernommen wurde (anders als die reine Entwurfsprüfung in
// partnerimport.js, die nur VOR der Übernahme läuft). Soll im laufenden
// Betrieb auffallen lassen, wo noch Angaben fehlen, nicht nur direkt nach
// dem Import. "anlagenId"/Anlagendetails sind bewusst NICHT Teil dieser
// Liste - siehe Kopfkommentar zum Partner-Import in worker.js: keine
// automatische Anlagenzuordnung in dieser Phase, ein fehlender Wert dort
// ist also kein Datenfehler, den das Büro hier beheben müsste.
export const SERVICEAUFTRAG_PFLICHTFELDER = [
  { feld: 'kunde', label: 'Kunde', pruefe: (a) => istAusgefuellt(a.kundeId) || istAusgefuellt(a.kundenname) },
  { feld: 'serviceempfaenger', label: 'Serviceempfänger', pruefe: (a) => istAusgefuellt(a.serviceempfaenger) },
  { feld: 'einsatzadresse', label: 'Einsatzadresse', pruefe: (a) => istAusgefuellt(a.einsatzadresse) },
  { feld: 'telefonnummer', label: 'Telefonnummer', pruefe: (a) => istAusgefuellt(a.telefonnummer) },
  { feld: 'wartungsart', label: 'Wartungsart', pruefe: (a) => istAusgefuellt(a.wartungsart) },
  { feld: 'auftragsfrist', label: 'Auftragsfrist', pruefe: (a) => istAusgefuellt(a.auftragsfrist) },
];

export function fehlendeServiceauftragFelder(auftrag) {
  return SERVICEAUFTRAG_PFLICHTFELDER.filter((f) => !f.pruefe(auftrag || {})).map((f) => f.label);
}

// Findet DUBLETTEN unter BEREITS ANGELEGTEN Serviceaufträgen (gleiche
// externe Auftragsnummer, unabhängig vom Partner - dieselbe Normalisierung
// wie findeDublette oben) - z.B. wenn derselbe Auftrag versehentlich sowohl
// manuell erfasst als auch per Partner-Import übernommen wurde, oder ein
// Import zweimal lief, bevor die Dublettenprüfung des Imports griff.
// Liefert nur ECHTE Gruppen (Länge > 1), eine leere Auftragsnummer bildet
// NIE eine Gruppe (sonst würden alle Aufträge ohne Nummer fälschlich als
// eine riesige Dublettengruppe erscheinen).
export function findeServiceauftragDubletten(auftraege) {
  const gruppenByNummer = new Map();
  for (const a of (auftraege || [])) {
    const norm = normalisiereAuftragsnummer(a.externeAuftragsnummer);
    if (!norm) continue;
    if (!gruppenByNummer.has(norm)) gruppenByNummer.set(norm, []);
    gruppenByNummer.get(norm).push(a);
  }
  return [...gruppenByNummer.values()].filter((gruppe) => gruppe.length > 1);
}

// Der VOLLSTÄNDIGSTE Auftrag einer Dublettengruppe (wenigste fehlende
// Pflichtfelder, siehe fehlendeServiceauftragFelder) bleibt beim
// Zusammenführen bestehen - bei Gleichstand der ZUERST erstellte. So geht
// bei einer Zusammenführung möglichst wenig manuell nachgetragene
// Information verloren.
export function waehlePrimaerenAuftrag(gruppe) {
  return [...gruppe].sort((a, b) => {
    const fehlendA = fehlendeServiceauftragFelder(a).length;
    const fehlendB = fehlendeServiceauftragFelder(b).length;
    if (fehlendA !== fehlendB) return fehlendA - fehlendB;
    return (a.erstelltAm || '').localeCompare(b.erstelltAm || '');
  })[0];
}

// Freitext-/Referenzfelder, die beim Zusammenführen zweier Dubletten
// übernommen werden können. Bewusst NICHT enthalten: id/status/
// technikerIds/checklistenPunkte/maengel/zusatzarbeitVorschlag/
// berichtsentwurf/terminId/erstelltAm/herkunftPartnerImport* - der
// laufende Arbeitsstand (Zuweisung, Checkliste, Technikerdokumentation,
// Termin) des primären Auftrags darf eine Zusammenführung NIE verändern,
// exakt dieselbe Regel wie beim Partner-Re-Import (siehe worker.js
// baueServiceauftragAktualisierungAusPartnerImportZeile).
export const SERVICEAUFTRAG_MERGE_FELDER = [
  'kundeId', 'kundenname', 'serviceempfaenger', 'anlagenId', 'einsatzadresse', 'telefonnummer',
  'wartungsart', 'wartungsdauerPartnerText', 'auftragsfrist', 'herstellerUndAnlagentyp',
  'anlagenmodell', 'seriennummer', 'partnerSachbearbeiter', 'partnerStatusText', 'hinweise',
];

// Reine Merge-Funktion für GENAU EIN Paar - wie mergePartnerImportFeld in
// worker.js: ein bereits befülltes Feld des primären Auftrags wird NIE
// stillschweigend durch einen abweichenden Wert der Dublette ersetzt,
// sondern als Konflikt zurückgemeldet (zur manuellen Prüfung) - nur ein
// beim primären Auftrag LEERES Feld wird aus der Dublette übernommen.
export function mergeServiceauftraege(primaer, sekundaer) {
  const merged = { ...primaer };
  const konflikte = [];
  for (const feld of SERVICEAUFTRAG_MERGE_FELDER) {
    const a = (primaer[feld] ?? '').toString().trim();
    const b = (sekundaer[feld] ?? '').toString().trim();
    if (!b) continue;
    if (!a) { merged[feld] = sekundaer[feld]; continue; }
    if (a.toLowerCase() !== b.toLowerCase()) {
      konflikte.push({ feld, primaerWert: primaer[feld], sekundaerWert: sekundaer[feld] });
    }
  }
  return { merged, konflikte };
}

// Baut die Checkliste aus den vom Büro eingegebenen Textzeilen (eine je
// Position, optional mit einer vom technikerCheckbox-Textformat ("[x] "/
// "[ ] ") erzeugten Markierung, die beim erneuten Einlesen ignoriert wird).
// Eine Zeile, deren Titel unverändert einem vorherigen Punkt entspricht,
// behält dessen erledigt-/Notiz-Stand (z.B. vom Techniker bereits
// abgehakt) - nur eine inhaltlich geänderte oder neue Zeile startet
// wieder bei "offen". So verliert das Büro keine Technikerfortschritte,
// solange es die Zeilen nicht selbst umformuliert.
export function baueChecklistenPunkte(zeilenText, vorherigePunkte) {
  const vorherigeByTitel = Object.fromEntries((vorherigePunkte || []).map((p) => [p.titel, p]));
  return (zeilenText || '')
    .split('\n')
    .map((zeile) => zeile.replace(/^\[[xX ]?\]\s*/, '').trim())
    .filter(Boolean)
    .map((titel) => (vorherigeByTitel[titel] ? { ...vorherigeByTitel[titel] } : { titel, erledigt: false, notiz: '' }));
}

function checklistenPunkteAlsText(punkte) {
  return (punkte || []).map((p) => `${p.erledigt ? '[x]' : '[ ]'} ${p.titel}`).join('\n');
}

// --- Phase 7: Google-Kalender-Integration für die Terminierung ---
//
// Bewusst KEINE eigene Google-Calendar-API-Anbindung für Serviceaufträge:
// ein verknüpfter Eintrag in der bestehenden "termine"-Collection nimmt
// automatisch an der bereits vorhandenen, nutzergesteuerten Kalender-
// Synchronisation teil (siehe googlesync.js syncCalendar(), aufgerufen
// von dashboard.js/plantafel.js) - dieselbe Dreiteilung wie bei JARVIS
// (Verfügbarkeit/Vorschlag/Buchung, siehe staging/README.md): hier ist
// das Büro selbst die bedienende Person, die Synchronisation also bereits
// die geforderte menschliche Freigabe, ohne dass ein weiterer Schritt
// erfunden werden müsste.

// Zwei Zeiträume (start/ende als "YYYY-MM-DDTHH:MM", vergleichbar wie an
// jeder anderen Stelle dieser App per String-Vergleich) überlappen sich.
export function terminUeberlappt(a, b) {
  const aStart = a.start || '', aEnde = a.ende || aStart;
  const bStart = b.start || '', bEnde = b.ende || bStart;
  return aStart < bEnde && bStart < aEnde;
}

// Doppelbelegung eines Technikers: findet andere Termine (irgendeines
// Typs - auch Urlaub/Krank/ein anderer Serviceauftrag), die sich mit dem
// geplanten Zeitraum überlappen UND mindestens einen der hier
// zugewiesenen Techniker betreffen. Bewusst kein hartes Verbot (z.B. zwei
// kurze Außendienst-Termine am selben Tag können sich überschneiden und
// trotzdem machbar sein) - die Oberfläche warnt, admin/büro entscheidet.
export function findeTerminKonflikte(alleTermine, mitarbeiterIds, start, ende, eigeneTerminId) {
  if (!start || !(mitarbeiterIds || []).length) return [];
  const kandidat = { start, ende };
  return alleTermine.filter((t) => t.id !== eigeneTerminId
    && (t.mitarbeiterIds || []).some((id) => mitarbeiterIds.includes(id))
    && terminUeberlappt(t, kandidat));
}

// Spezifikationsauflage "bereits bestätigte Kundentermine dürfen nicht
// ohne erneute Bürofreigabe verschoben werden": sobald ein Termin
// kundenBestaetigtAm trägt, muss eine Verschiebung von Datum/Uhrzeit
// extra bestätigt werden (siehe mountTerminSection unten, confirm()-
// Dialog) - das Setzen anderer Felder (z.B. Techniker-Notiz) oder ein
// unveränderter Zeitraum braucht keine erneute Rückfrage.
export function brauchtBestaetigungVorVerschieben(vorherigerTermin, neuerStart, neuesEnde) {
  if (!vorherigerTermin || !vorherigerTermin.kundenBestaetigtAm) return false;
  return vorherigerTermin.start !== neuerStart || (vorherigerTermin.ende || '') !== (neuesEnde || '');
}

// Datetime-local-Eingabe ("YYYY-MM-DDTHH:MM") + Dauer in Stunden -> Ende
// im selben String-Format (keine Date-Arithmetik über Mitternacht/
// Zeitzonen hinaus nötig, da hier ausschließlich mit lokalen
// Wanduhrzeiten gerechnet wird, genau wie der Rest der App).
export function berechneTerminEnde(start, dauerStunden) {
  if (!start) return '';
  const [datum, uhrzeit] = start.split('T');
  if (!uhrzeit) return start;
  const [h, m] = uhrzeit.split(':').map(Number);
  const gesamtMinuten = (h * 60 + m) + Math.round((Number(dauerStunden) || 0) * 60);
  const tag = new Date(`${datum}T00:00`);
  tag.setMinutes(gesamtMinuten);
  const pad = (n) => String(n).padStart(2, '0');
  return `${tag.getFullYear()}-${pad(tag.getMonth() + 1)}-${pad(tag.getDate())}T${pad(tag.getHours())}:${pad(tag.getMinutes())}`;
}

export async function render(container) {
  let [auftraege, kunden, anlagen, mitarbeiter, settings, termine, aufgaben] = await Promise.all([
    getAll('serviceauftraege'), getAll('kunden'), getAll('anlagen'), getAll('mitarbeiter'), getSettings(), getAll('termine'), getAll('aufgaben'),
  ]);
  auftraege.sort((a, b) => (b.erstelltAm || '').localeCompare(a.erstelltAm || ''));
  const kundenById = Object.fromEntries(kunden.map((k) => [k.id, k]));
  const anlagenById = Object.fromEntries(anlagen.map((a) => [a.id, a]));
  const techniker = mitarbeiter.filter((m) => m.zugriffsrolle === 'techniker');
  const technikerById = Object.fromEntries(mitarbeiter.map((m) => [m.id, m]));

  // Büro-Dashboard (Phase 3): Techniker-Auslastung auf einen Blick + Hinweis
  // auf wartende JARVIS-SmartDispatch-Vorschläge (Phase 2). Die eigentlichen
  // Vorschlagsdaten (jarvisTechnikerVorschlaege) sind bewusst admin-only
  // (wie alle jarvis*-Collections) - hier zählt daher die vom Dispatch-Check
  // angelegte BEGLEITAUFGABE (quelle 'jarvis-dispatch'), die regulär über
  // die bereits für büro lesbare "aufgaben"-Collection sichtbar ist.
  const aktiveAuftraege = auftraege.filter((a) => !['abgeschlossen', 'abgebrochen'].includes(a.status));
  const auslastungProTechniker = techniker.map((t) => ({
    name: t.name, anzahl: aktiveAuftraege.filter((a) => (a.technikerIds || []).includes(t.id)).length,
  })).sort((a, b) => b.anzahl - a.anzahl);
  const offeneDispatchVorschlaege = aufgaben.filter((a) => a.quelle === 'jarvis-dispatch' && a.status === 'offen').length;

  container.innerHTML = `
    <div class="view-header">
      <h1>Serviceaufträge</h1>
      <div class="actions">
        <button class="btn" id="btn-dubletten">Dubletten prüfen</button>
        <button class="btn btn-primary" id="btn-new">+ Serviceauftrag</button>
      </div>
    </div>
    <p class="hint">Externe Herstellerwartungsaufträge (z.B. Wärmepumpen-Service). Zuweisen, planen und Checkliste vorbereiten hier - die Techniker arbeiten eigene zugewiesene Aufträge über ihre mobile Ansicht (/verwaltung/techniker/) ab.</p>
    <div class="kpi-grid">
      <div class="kpi-card kpi-clickable kpi-warn" id="kpi-offen"><div class="kpi-value">${auftraege.filter((a) => a.status === 'offen').length}</div><div class="kpi-label">Offen (nicht zugewiesen)</div></div>
      <div class="kpi-card kpi-clickable" id="kpi-zugewiesen"><div class="kpi-value">${auftraege.filter((a) => a.status === 'zugewiesen' || a.status === 'in_bearbeitung').length}</div><div class="kpi-label">Zugewiesen / in Bearbeitung</div></div>
      <div class="kpi-card kpi-clickable kpi-danger" id="kpi-ueberfaellig"><div class="kpi-value">${auftraege.filter((a) => istUeberfaellig(a)).length}</div><div class="kpi-label">Frist überschritten</div></div>
      <div class="kpi-card kpi-clickable kpi-success" id="kpi-abgeschlossen"><div class="kpi-value">${auftraege.filter((a) => a.status === 'abgeschlossen').length}</div><div class="kpi-label">Abgeschlossen</div></div>
      <div class="kpi-card kpi-clickable kpi-warn" id="kpi-fehlende-daten"><div class="kpi-value">${auftraege.filter((a) => fehlendeServiceauftragFelder(a).length > 0).length}</div><div class="kpi-label">Mit fehlenden Daten</div></div>
      <div class="kpi-card kpi-clickable kpi-warn" id="kpi-gekuerzt"><div class="kpi-value">${auftraege.filter((a) => wirktAuftragsnummerAbgeschnitten(a.externeAuftragsnummer)).length}</div><div class="kpi-label">Auftragsnummer evtl. gekürzt</div></div>
      <div class="kpi-card kpi-clickable kpi-danger" id="kpi-dubletten"><div class="kpi-value">${findeServiceauftragDubletten(auftraege).length}</div><div class="kpi-label">Dublettengruppen</div></div>
      ${offeneDispatchVorschlaege > 0 ? `<div class="kpi-card kpi-accent"><div class="kpi-value">🤖 ${offeneDispatchVorschlaege}</div><div class="kpi-label">JARVIS-Zuweisungsvorschläge warten auf Freigabe (JARVIS-Zentrale)</div></div>` : ''}
    </div>
    ${techniker.length > 0 ? `
      <h3 style="margin-top:20px">Techniker-Auslastung</h3>
      <table class="data-table" style="max-width:420px">
        <thead><tr><th>Techniker</th><th>Offene/laufende Aufträge</th></tr></thead>
        <tbody>${auslastungProTechniker.map((t) => `<tr><td>${escapeHtml(t.name)}</td><td>${t.anzahl}</td></tr>`).join('')}</tbody>
      </table>
    ` : ''}
    <h3 style="margin-top:20px">Alle Serviceaufträge</h3>
    <div id="liste-host"></div>
  `;

  // KPI-Karten, die beim Klick die Liste unten auf genau diese Kennzahl
  // filtern (gleiches Muster wie ki-aktivitaet.js: kpi-clickable/kpi-active,
  // erneuter Klick auf die aktive Karte hebt den Filter wieder auf). Die
  // Dubletten-Karte ist bewusst NICHT hier drin - sie öffnet stattdessen das
  // Zusammenführen-Modal (siehe openDublettenModal), filtert nicht die Liste.
  const KPI_FILTER = {
    'kpi-offen': { label: 'nur offene (nicht zugewiesene)', pruefe: (a) => a.status === 'offen' },
    'kpi-zugewiesen': { label: 'nur zugewiesene / in Bearbeitung', pruefe: (a) => a.status === 'zugewiesen' || a.status === 'in_bearbeitung' },
    'kpi-ueberfaellig': { label: 'nur überfällige', pruefe: (a) => istUeberfaellig(a) },
    'kpi-abgeschlossen': { label: 'nur abgeschlossene', pruefe: (a) => a.status === 'abgeschlossen' },
    'kpi-fehlende-daten': { label: 'nur mit fehlenden Daten', pruefe: (a) => fehlendeServiceauftragFelder(a).length > 0 },
    'kpi-gekuerzt': { label: 'nur mit evtl. gekürzter Auftragsnummer', pruefe: (a) => wirktAuftragsnummerAbgeschnitten(a.externeAuftragsnummer) },
  };
  let aktiverKpiFilter = null;
  // Mehrfachauswahl+Löschen über das App-weit gemeinsame bulkselect.js-Modul
  // (gleiche Leiste/Checkboxen wie in kunden.js/aufgaben.js/projekte.js usw.)
  // statt einer eigenen Implementierung - "serviceauftraege" steht NICHT in
  // db.js TRASH_STORES, bulk.wire() löscht hier also endgültig (kein
  // Papierkorb) und sagt das im Bestätigungsdialog auch so.
  const bulk = createBulkSelect('serviceauftraege', { label: 'Serviceaufträge' });

  function markActiveKpi() {
    container.querySelectorAll('.kpi-card').forEach((el) => el.classList.remove('kpi-active'));
    if (aktiverKpiFilter) container.querySelector(`#${aktiverKpiFilter}`)?.classList.add('kpi-active');
  }

  function renderListe() {
    const host = container.querySelector('#liste-host');
    const filterDef = aktiverKpiFilter ? KPI_FILTER[aktiverKpiFilter] : null;
    const sichtbareAuftraege = filterDef ? auftraege.filter(filterDef.pruefe) : auftraege;
    const filterHinweis = filterDef
      ? `<p class="hint">Gefiltert: ${filterDef.label} (${sichtbareAuftraege.length} von ${auftraege.length}). <button type="button" class="btn btn-sm" id="btn-filter-reset">Filter zurücksetzen</button></p>`
      : '';

    if (sichtbareAuftraege.length === 0) {
      host.innerHTML = filterDef
        ? `${bulk.barHtml()}${filterHinweis}<div class="empty-state">Keine Serviceaufträge für diesen Filter.</div>`
        : `${bulk.barHtml()}<div class="empty-state">Noch keine Serviceaufträge erfasst.</div>`;
      host.querySelector('#btn-filter-reset')?.addEventListener('click', () => { aktiverKpiFilter = null; markActiveKpi(); renderListe(); });
      bulk.wire(host, { onChange: renderListe, onDeleted: (ids) => { auftraege = auftraege.filter((a) => !ids.includes(a.id)); renderListe(); } });
      return;
    }
    host.innerHTML = `
      ${bulk.barHtml()}
      ${filterHinweis}
      <table class="data-table">
        <thead><tr>${bulk.headerCell()}<th>Auftragsnummer</th><th>Kunde / Auftraggeber</th><th>Anlage</th><th>Techniker</th><th>Frist</th><th>Status</th><th>Datencheck</th><th></th></tr></thead>
        <tbody>
          ${sichtbareAuftraege.map((a) => {
            const fehlend = fehlendeServiceauftragFelder(a);
            return `
            <tr data-id="${a.id}">
              ${bulk.rowCell(a.id)}
              <td>${escapeHtml(a.externeAuftragsnummer || '–')}${wirktAuftragsnummerAbgeschnitten(a.externeAuftragsnummer) ? ' <span class="badge badge-warn" title="Wirkt im Portal gekürzt - bitte in der aufgeklappten Detailansicht des Partnerportals prüfen">⚠️ evtl. gekürzt</span>' : ''}</td>
              <td>${escapeHtml(kundenById[a.kundeId]?.firma || a.kundenname || '–')}${a.serviceempfaenger ? `<div class="text-mute" style="font-size:12px">Service bei: ${escapeHtml(a.serviceempfaenger)}</div>` : ''}${a.auftraggeber ? `<div class="text-mute" style="font-size:12px">${escapeHtml(a.auftraggeber)}</div>` : ''}</td>
              <td>${escapeHtml(anlagenById[a.anlagenId]?.bezeichnung || a.herstellerUndAnlagentyp || '–')}</td>
              <td>${(a.technikerIds || []).map((id) => escapeHtml(technikerById[id]?.name || '?')).join(', ') || '–'}</td>
              <td>${a.auftragsfrist ? formatDate(a.auftragsfrist) : '–'}${istUeberfaellig(a) ? ' <span class="badge badge-danger">überfällig</span>' : ''}</td>
              <td><span class="badge ${STATUS_BADGE[a.status] || ''}">${STATUS_LABEL[a.status] || a.status}</span></td>
              <td>${fehlend.length === 0 ? '<span class="badge badge-success">vollständig</span>' : `<span class="badge badge-warn">unvollständig</span><div class="text-mute" style="font-size:12px">Fehlt: ${escapeHtml(fehlend.join(', '))}</div>`}</td>
              <td><button type="button" class="btn btn-sm btn-edit" data-id="${a.id}" onclick="event.stopPropagation()">Bearbeiten</button></td>
            </tr>
          `;
          }).join('')}
        </tbody>
      </table>
    `;
    host.querySelector('#btn-filter-reset')?.addEventListener('click', () => { aktiverKpiFilter = null; markActiveKpi(); renderListe(); });
    bulk.wire(host, { onChange: renderListe, onDeleted: (ids) => { auftraege = auftraege.filter((a) => !ids.includes(a.id)); renderListe(); } });
    host.querySelectorAll('tbody tr[data-id]').forEach((row) => {
      row.addEventListener('click', () => openForm(auftraege.find((a) => a.id === row.dataset.id)));
    });
    host.querySelectorAll('.btn-edit').forEach((btn) => {
      btn.addEventListener('click', () => openForm(auftraege.find((a) => a.id === btn.dataset.id)));
    });
  }

  function kundenOptionen(ausgewaehlt) {
    return `<option value="">– kein Kunde zugeordnet –</option>` + kunden.map((k) => `<option value="${k.id}" ${k.id === ausgewaehlt ? 'selected' : ''}>${escapeHtml(k.firma || k.ansprechpartner || '(ohne Name)')}</option>`).join('');
  }
  function anlagenOptionen(kundeId, ausgewaehlt) {
    const gefiltert = kundeId ? anlagen.filter((a) => a.kundeId === kundeId) : [];
    return `<option value="">– keine Anlage zugeordnet –</option>` + gefiltert.map((a) => `<option value="${a.id}" ${a.id === ausgewaehlt ? 'selected' : ''}>${escapeHtml(a.bezeichnung)}</option>`).join('');
  }
  function technikerCheckboxen(ausgewaehlt) {
    if (techniker.length === 0) return '<p class="hint">Noch keine Mitarbeiter mit Zugriffsrolle "Techniker" angelegt.</p>';
    return techniker.map((t) => `
      <label class="field-checkbox" style="border:1px solid var(--border);border-radius:8px;padding:5px 10px;">
        <input type="checkbox" name="technikerIds" value="${t.id}" ${(ausgewaehlt || []).includes(t.id) ? 'checked' : ''}> ${escapeHtml(t.name)}
      </label>
    `).join('');
  }

  // Siehe Kommentar bei terminUeberlappt/findeTerminKonflikte oben für die
  // Begründung ("bewusst kein eigener Google-Calendar-Code hier"). Mutiert
  // "auftrag" (= "data" aus openForm, dieselbe Objektreferenz wie in der
  // Liste) direkt bei terminId, damit ein anschließendes Absenden des
  // Hauptformulars die Verknüpfung nicht versehentlich wieder verwirft.
  function mountTerminSection(host, auftrag) {
    function draw() {
      const termin = auftrag.terminId ? termine.find((t) => t.id === auftrag.terminId) : null;
      if (!termin) {
        host.innerHTML = `
          <p class="hint">Noch kein Termin geplant.</p>
          <div class="form-grid">
            <div class="field"><label>Start</label><input type="datetime-local" id="termin-start"></div>
            <div class="field"><label>Dauer (Std.)</label><input type="number" step="0.5" min="0.5" id="termin-dauer" value="${auftrag.geplanteWartungsdauer || 2}"></div>
          </div>
          <button type="button" class="btn btn-sm btn-primary" id="termin-anlegen">Termin planen</button>
        `;
        host.querySelector('#termin-anlegen').addEventListener('click', () => speichern(null));
        return;
      }
      const technikerNamen = (termin.mitarbeiterIds || []).map((id) => technikerById[id]?.name).filter(Boolean).join(', ') || '–';
      const dauerStd = termin.ende ? Math.max(0.5, (new Date(termin.ende) - new Date(termin.start)) / 3600000) : (auftrag.geplanteWartungsdauer || 2);
      host.innerHTML = `
        <p class="hint">${escapeHtml(technikerNamen)}${termin.kundenBestaetigtAm ? ' · <span class="badge badge-success">beim Kunden bestätigt</span>' : ''}</p>
        <div class="form-grid">
          <div class="field"><label>Start</label><input type="datetime-local" id="termin-start" value="${escapeHtml(termin.start || '')}"></div>
          <div class="field"><label>Dauer (Std.)</label><input type="number" step="0.5" min="0.5" id="termin-dauer" value="${dauerStd}"></div>
          <label class="field-checkbox col-span-2"><input type="checkbox" id="termin-bestaetigt" ${termin.kundenBestaetigtAm ? 'checked' : ''}> Beim Kunden bestätigt (eine Verschiebung danach braucht erneute Rückfrage)</label>
        </div>
        <div class="flex-row flex-wrap">
          <button type="button" class="btn btn-sm btn-primary" id="termin-speichern">Speichern</button>
          <button type="button" class="btn btn-sm btn-danger" id="termin-loeschen">Termin entfernen</button>
        </div>
      `;
      host.querySelector('#termin-speichern').addEventListener('click', () => speichern(termin));
      host.querySelector('#termin-loeschen').addEventListener('click', async () => {
        if (!confirm('Termin wirklich entfernen? Ein zugehöriger Kalendereintrag verschwindet beim nächsten Sync ebenfalls.')) return;
        await remove('termine', termin.id);
        termine = termine.filter((t) => t.id !== termin.id);
        auftrag.terminId = '';
        await put('serviceauftraege', { ...auftrag, terminId: '' });
        toast('Termin entfernt', 'success');
        draw();
      });
    }

    async function speichern(vorherigerTermin) {
      const start = host.querySelector('#termin-start').value;
      const dauer = Number(host.querySelector('#termin-dauer').value || 0);
      if (!start) { toast('Bitte Startzeit angeben', 'error'); return; }
      if ((auftrag.technikerIds || []).length === 0 && !confirm('Noch kein Techniker zugewiesen - Termin trotzdem ohne Techniker planen?')) return;
      const ende = berechneTerminEnde(start, dauer);

      if (brauchtBestaetigungVorVerschieben(vorherigerTermin, start, ende)
          && !confirm('Dieser Termin ist bereits beim Kunden bestätigt. Wirklich verschieben? Der Kunde muss dann erneut informiert werden.')) {
        return;
      }

      const konflikte = findeTerminKonflikte(termine, auftrag.technikerIds, start, ende, vorherigerTermin?.id);
      if (konflikte.length > 0) {
        const liste = konflikte.map((k) => `${k.titel || 'Termin'} (${formatDate((k.start || '').slice(0, 10))})`).join(', ');
        if (!confirm(`Terminkonflikt mit: ${liste}. Trotzdem speichern?`)) return;
      }

      const neu = {
        id: vorherigerTermin?.id || uid(),
        titel: `Serviceauftrag ${auftrag.externeAuftragsnummer || ''}`.trim(),
        typ: 'service',
        start, ende,
        mitarbeiterIds: [...(auftrag.technikerIds || [])],
        kundeId: auftrag.kundeId || '',
        ort: auftrag.einsatzadresse || '',
        beschreibung: auftrag.hinweise || '',
        serviceauftragId: auftrag.id,
        kundenBestaetigtAm: host.querySelector('#termin-bestaetigt')?.checked
          ? (vorherigerTermin?.kundenBestaetigtAm || new Date().toISOString())
          : '',
      };
      await put('termine', neu);
      const idx = termine.findIndex((t) => t.id === neu.id);
      if (idx === -1) termine.push(neu); else termine[idx] = neu;
      if (auftrag.terminId !== neu.id) {
        auftrag.terminId = neu.id;
        await put('serviceauftraege', { ...auftrag, terminId: neu.id });
      }
      toast('Termin gespeichert', 'success');
      draw();
    }

    draw();
  }

  function openForm(auftrag) {
    const isEdit = !!auftrag;
    const data = auftrag || {
      id: uid(), externeAuftragsnummer: '', auftraggeber: '', kundeId: '', kundenname: '', serviceempfaenger: '', telefonnummer: '', einsatzadresse: '',
      anlagenId: '', herstellerUndAnlagentyp: '', anlagenmodell: '', seriennummer: '', wartungsart: '',
      auftragsfrist: '', geplanteWartungsdauer: '', geplanterNettoumsatz: '', hinweise: '',
      technikerIds: [], status: 'offen', technikerNotizen: '',
      checklistenPunkte: [], maengel: '', zusatzarbeitVorschlag: '', berichtsentwurf: '', terminId: '',
    };
    const { body, close } = openModal({
      // Anders als z.B. "Rechnung ${data.nummer}" in anderen Ansichten ist
      // externeAuftragsnummer KEINE intern erzeugte Sequenznummer, sondern
      // ein vom Hersteller/Auftraggeber per E-Mail/Portal übernommener Wert
      // (siehe findeDublette oben) - openModal() setzt den title ungeprüft
      // als innerHTML (siehe ui.js), deshalb hier explizit escapeHtml().
      title: isEdit ? `Serviceauftrag ${escapeHtml(data.externeAuftragsnummer || '')}` : 'Neuer Serviceauftrag',
      wide: true,
      bodyHtml: `
        <form id="sa-form">
          <div class="form-grid">
            <div class="field"><label>Externe Auftragsnummer *</label><input name="externeAuftragsnummer" required value="${escapeHtml(data.externeAuftragsnummer)}"></div>
            <div class="field"><label>Auftraggeber / Hersteller</label><input name="auftraggeber" value="${escapeHtml(data.auftraggeber || '')}" placeholder="z.B. Stiebel Eltron"></div>

            <div class="field"><label>Kunde (falls bereits in Werkora)</label>
              <select name="kundeId">${kundenOptionen(data.kundeId)}</select>
            </div>
            <div class="field"><label>Anlage (falls bereits in Werkora)</label>
              <select name="anlagenId">${anlagenOptionen(data.kundeId, data.anlagenId)}</select>
            </div>

            <div class="field"><label>Kundenname (frei, z.B. aus Herstellerportal)</label><input name="kundenname" value="${escapeHtml(data.kundenname || '')}"></div>
            <div class="field"><label>Serviceempfänger (wo die Leistung vor Ort ausgeführt wird, falls abweichend vom Kunden)</label><input name="serviceempfaenger" value="${escapeHtml(data.serviceempfaenger || '')}"></div>
            <div class="field"><label>Telefonnummer</label><input name="telefonnummer" value="${escapeHtml(data.telefonnummer || '')}"></div>
            <div class="field col-span-2"><label>Einsatzadresse</label><input name="einsatzadresse" value="${escapeHtml(data.einsatzadresse || '')}"></div>

            <div class="field"><label>Hersteller &amp; Anlagentyp</label><input name="herstellerUndAnlagentyp" value="${escapeHtml(data.herstellerUndAnlagentyp || '')}" placeholder="z.B. Stiebel Eltron WPL 25"></div>
            <div class="field"><label>Anlagenmodell</label><input name="anlagenmodell" value="${escapeHtml(data.anlagenmodell || '')}"></div>
            <div class="field"><label>Seriennummer</label><input name="seriennummer" value="${escapeHtml(data.seriennummer || '')}"></div>
            <div class="field"><label>Wartungsart</label><input name="wartungsart" value="${escapeHtml(data.wartungsart || '')}" placeholder="z.B. Jahreswartung, Störung"></div>

            <div class="field"><label>Auftragsfrist</label><input type="date" name="auftragsfrist" value="${escapeHtml(data.auftragsfrist || '')}"></div>
            <div class="field"><label>Geplante Wartungsdauer (Std.)</label><input type="number" step="0.5" min="0" name="geplanteWartungsdauer" value="${escapeHtml(String(data.geplanteWartungsdauer ?? ''))}"></div>
            <div class="field"><label>Geplanter Nettoumsatz (EUR)</label><input type="number" step="0.01" min="0" name="geplanterNettoumsatz" value="${escapeHtml(String(data.geplanterNettoumsatz ?? ''))}"></div>
            <div class="field"><label>Status</label>
              <select name="status">${SERVICEAUFTRAG_STATUS.map((s) => `<option value="${s.id}" ${s.id === data.status ? 'selected' : ''}>${s.titel}</option>`).join('')}</select>
            </div>

            <div class="field col-span-2"><label>Techniker-Zuweisung</label>${technikerCheckboxen(data.technikerIds)}</div>
            <div class="field col-span-2"><label>Hinweise</label><textarea name="hinweise">${escapeHtml(data.hinweise || '')}</textarea></div>

            <div class="field col-span-2">
              <label>Checkliste (eine Position je Zeile, von der mobilen Techniker-Ansicht abgehakt)</label>
              <textarea name="checklistenPunkteText" rows="5" placeholder="z.B.&#10;Sichtprüfung der Anlage durchgeführt&#10;Filter/Verschleißteile geprüft">${escapeHtml(checklistenPunkteAlsText(data.checklistenPunkte))}</textarea>
              <button type="button" class="btn btn-sm" id="sa-standard-checkliste" style="margin-top:6px">Standard-Checkliste einfügen</button>
            </div>

            ${isEdit && data.technikerNotizen ? `<div class="field col-span-2"><label>Notizen des Technikers (nur lesend)</label><p class="hint">${escapeHtml(data.technikerNotizen)}</p></div>` : ''}
            ${isEdit && data.maengel ? `<div class="field col-span-2"><label>⚠️ Vom Techniker gemeldete Mängel (nur lesend)</label><p class="hint">${escapeHtml(data.maengel)}</p></div>` : ''}
            ${isEdit && data.zusatzarbeitVorschlag ? `<div class="field col-span-2"><label>💡 Zusatzarbeit-Vorschlag des Technikers (nur lesend)</label><p class="hint">${escapeHtml(data.zusatzarbeitVorschlag)}</p></div>` : ''}
            ${isEdit && data.berichtsentwurf ? `<div class="field col-span-2"><label>📝 Berichtsentwurf des Technikers (nur lesend - als Grundlage für den Bericht unten verwenden)</label><p class="hint">${escapeHtml(data.berichtsentwurf)}</p></div>` : ''}
          </div>
          ${isEdit ? `
            <h3 style="margin-top:24px">Termin</h3>
            <div id="termin-host"></div>

            <h3 style="margin-top:24px">Wartungsdokumentation</h3>
            <p class="hint">Wartungsprotokoll (Checkliste, Ja/Nein-Abschnitte, Unterschrift) aus Vorlage erzeugen, Fotos und Stundenzettel anhängen. Technikerrückmeldungen (oben: Mängel/Zusatzarbeit/Berichtsentwurf) hier als Grundlage verwenden - der eigentliche Versand bleibt bewusst Büro-Sache.</p>
            <div id="dok-host"></div>
          ` : ''}
          <div class="modal-actions">
            <span class="spacer"></span>
            <button type="button" class="btn" id="sa-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">${isEdit ? 'Speichern' : 'Anlegen'}</button>
          </div>
        </form>
      `,
    });
    body.querySelector('#sa-cancel').addEventListener('click', close);
    body.querySelector('select[name="kundeId"]').addEventListener('change', (e) => {
      const sel = body.querySelector('select[name="anlagenId"]');
      sel.innerHTML = anlagenOptionen(e.target.value, '');
    });
    body.querySelector('#sa-standard-checkliste').addEventListener('click', () => {
      body.querySelector('textarea[name="checklistenPunkteText"]').value = STANDARD_WARTUNGSCHECKLISTE.join('\n');
    });
    if (isEdit) {
      mountTerminSection(body.querySelector('#termin-host'), data);
      const technikerNamen = (data.technikerIds || []).map((id) => technikerById[id]?.name).filter(Boolean).join(', ');
      renderDokumenteSection(body.querySelector('#dok-host'), 'serviceauftrag', data.id, {
        kategorien: SERVICEAUFTRAG_DOKUMENT_KATEGORIEN, title: 'Dokumente',
        berichtContext: {
          settings, kunde: kundenById[data.kundeId] || null,
          projekt: data.externeAuftragsnummer || '', mitarbeiter: technikerNamen,
        },
      });
    }
    body.querySelector('#sa-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const externeAuftragsnummer = (fd.get('externeAuftragsnummer') || '').toString().trim();
      if (!externeAuftragsnummer) { toast('Externe Auftragsnummer ist Pflicht', 'error'); return; }

      const dublette = findeDublette(auftraege, externeAuftragsnummer, data.id);
      if (dublette && !confirm(`Es existiert bereits ein Serviceauftrag mit der Auftragsnummer "${externeAuftragsnummer}" (Status: ${STATUS_LABEL[dublette.status] || dublette.status}). Trotzdem speichern?`)) {
        return;
      }

      const updated = {
        ...data,
        externeAuftragsnummer,
        auftraggeber: (fd.get('auftraggeber') || '').toString().trim(),
        kundeId: (fd.get('kundeId') || '').toString(),
        anlagenId: (fd.get('anlagenId') || '').toString(),
        kundenname: (fd.get('kundenname') || '').toString().trim(),
        serviceempfaenger: (fd.get('serviceempfaenger') || '').toString().trim(),
        telefonnummer: (fd.get('telefonnummer') || '').toString().trim(),
        einsatzadresse: (fd.get('einsatzadresse') || '').toString().trim(),
        herstellerUndAnlagentyp: (fd.get('herstellerUndAnlagentyp') || '').toString().trim(),
        anlagenmodell: (fd.get('anlagenmodell') || '').toString().trim(),
        seriennummer: (fd.get('seriennummer') || '').toString().trim(),
        wartungsart: (fd.get('wartungsart') || '').toString().trim(),
        auftragsfrist: (fd.get('auftragsfrist') || '').toString(),
        geplanteWartungsdauer: fd.get('geplanteWartungsdauer') ? Number(fd.get('geplanteWartungsdauer')) : '',
        geplanterNettoumsatz: fd.get('geplanterNettoumsatz') ? Number(fd.get('geplanterNettoumsatz')) : '',
        status: (fd.get('status') || 'offen').toString(),
        technikerIds: fd.getAll('technikerIds').map((v) => v.toString()),
        hinweise: (fd.get('hinweise') || '').toString().trim(),
        checklistenPunkte: baueChecklistenPunkte((fd.get('checklistenPunkteText') || '').toString(), data.checklistenPunkte),
        erstelltAm: data.erstelltAm || new Date().toISOString(),
        aktualisiertAm: new Date().toISOString(),
      };
      await put('serviceauftraege', updated);
      const idx = auftraege.findIndex((a) => a.id === updated.id);
      if (idx === -1) auftraege.unshift(updated); else auftraege[idx] = updated;
      toast(isEdit ? 'Serviceauftrag gespeichert' : 'Serviceauftrag angelegt', 'success');
      close();
      renderListe();
    });
  }

  // Dubletten-Zusammenführung: bereits angelegte Serviceaufträge mit
  // gleicher externer Auftragsnummer (siehe findeServiceauftragDubletten)
  // zu EINEM zusammenführen, statt sie als getrennte Datensätze stehen zu
  // lassen - z.B. wenn derselbe Auftrag versehentlich doppelt erfasst oder
  // importiert wurde. Nicht-destruktiv wie der Partner-Re-Import: ein
  // bereits befülltes Feld des bleibenden Auftrags wird NIE überschrieben,
  // ein Widerspruch wird gemeldet statt automatisch aufgelöst. Löschen der
  // Dublette(n) passiert erst nach expliziter Bestätigung.
  function openDublettenModal() {
    const { body, close } = openModal({ title: 'Mögliche Dubletten', wide: true, bodyHtml: '<div id="dubletten-host"></div>' });

    function zeichneDubletten() {
      const gruppen = findeServiceauftragDubletten(auftraege);
      const host = body.querySelector('#dubletten-host');
      if (gruppen.length === 0) { host.innerHTML = '<p class="hint">Keine Dubletten (mehr) vorhanden.</p>'; return; }
      host.innerHTML = gruppen.map((gruppe, gi) => {
        const primaer = waehlePrimaerenAuftrag(gruppe);
        return `
          <div class="card" style="margin-bottom:16px;padding:12px;border:1px solid var(--border);border-radius:8px">
            <p style="margin:0 0 8px"><strong>${escapeHtml(primaer.externeAuftragsnummer || '–')}</strong> - ${gruppe.length} Einträge mit derselben Auftragsnummer</p>
            <table class="data-table" style="margin-bottom:8px">
              <thead><tr><th></th><th>Status</th><th>Kunde</th><th>Serviceempfänger</th><th>Adresse</th><th>Erstellt</th></tr></thead>
              <tbody>
                ${gruppe.map((a) => `
                  <tr>
                    <td>${a.id === primaer.id ? '<span class="badge badge-accent">bleibt</span>' : '<span class="badge">wird entfernt</span>'}</td>
                    <td>${escapeHtml(STATUS_LABEL[a.status] || a.status || '–')}</td>
                    <td>${escapeHtml(a.kundenname || '–')}</td>
                    <td>${escapeHtml(a.serviceempfaenger || '–')}</td>
                    <td>${escapeHtml(a.einsatzadresse || '–')}</td>
                    <td>${a.erstelltAm ? formatDate(a.erstelltAm.slice(0, 10)) : '–'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
            <button type="button" class="btn btn-sm btn-primary" data-merge-gruppe="${gi}">Zusammenführen (${gruppe.length - 1} Dublette(n) entfernen)</button>
          </div>
        `;
      }).join('');
      host.querySelectorAll('[data-merge-gruppe]').forEach((btn) => {
        btn.addEventListener('click', () => fuehreZusammenfuehrungAus(gruppen[Number(btn.dataset.mergeGruppe)]));
      });
    }

    async function fuehreZusammenfuehrungAus(gruppe) {
      const primaerStart = waehlePrimaerenAuftrag(gruppe);
      const sekundaere = gruppe.filter((a) => a.id !== primaerStart.id);
      if (!confirm(`${sekundaere.length} Dublette(n) von Auftrag "${primaerStart.externeAuftragsnummer}" werden gelöscht, ihre Daten (soweit beim bleibenden Auftrag noch leer) übernommen. Bereits vorhandene Angaben werden NIE überschrieben. Fortfahren?`)) return;
      let merged = primaerStart;
      const alleKonflikte = [];
      for (const sek of sekundaere) {
        const { merged: neu, konflikte } = mergeServiceauftraege(merged, sek);
        merged = neu;
        alleKonflikte.push(...konflikte);
      }
      merged = { ...merged, aktualisiertAm: new Date().toISOString() };
      await put('serviceauftraege', merged);
      for (const sek of sekundaere) await remove('serviceauftraege', sek.id);
      auftraege = auftraege.filter((a) => !sekundaere.some((s) => s.id === a.id));
      const idx = auftraege.findIndex((a) => a.id === merged.id);
      if (idx !== -1) auftraege[idx] = merged;
      if (alleKonflikte.length > 0) {
        toast(`Zusammengeführt - ${alleKonflikte.length} widersprüchliche Angabe(n) NICHT übernommen (bereits vorhandener Wert bleibt), bitte bei "${merged.externeAuftragsnummer}" manuell prüfen: ${[...new Set(alleKonflikte.map((k) => k.feld))].join(', ')}`, 'danger');
      } else {
        toast('Dublette(n) erfolgreich zusammengeführt', 'success');
      }
      renderListe();
      zeichneDubletten();
    }

    zeichneDubletten();
  }

  container.querySelector('#btn-dubletten').addEventListener('click', openDublettenModal);
  container.querySelector('#btn-new').addEventListener('click', () => openForm());
  container.querySelector('#kpi-dubletten').addEventListener('click', openDublettenModal);
  Object.keys(KPI_FILTER).forEach((kpiId) => {
    container.querySelector(`#${kpiId}`).addEventListener('click', () => {
      aktiverKpiFilter = aktiverKpiFilter === kpiId ? null : kpiId;
      markActiveKpi();
      renderListe();
    });
  });
  renderListe();
}
