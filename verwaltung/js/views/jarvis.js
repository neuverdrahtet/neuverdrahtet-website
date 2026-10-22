import {
  chatMitJarvis, holeJarvisZentrale, sendeJarvisFreigabe, holeJarvisTagesbericht, holeJarvisControl, holeJarvisWochenbericht,
  analysiereJarvisTech, verknuepfeJarvisTechAnalyse, holeJarvisTechAnalysen, erstelleJarvisPruefprotokoll, aktualisiereJarvisPruefprotokoll, holeJarvisPruefprotokolle,
  dokumentiereDurchsichtPruefprotokoll, verifiziereJarvisHerstellerBefund,
  erstelleJarvisPruefnorm, setzeJarvisPruefnormAusserKraft, holeJarvisPruefnormen,
  holeJarvisStatus,
} from '../ai.js';
import { escapeHtml, toast, formatDateTime, compressImage } from '../utils.js';
import { isVoiceRecordingSupported, getSpeechRecognitionCtor } from '../voicenote.js';
import { getSession } from '../auth.js';
import { FIREBASE_ENABLED } from '../employeeAuth.js';
import { get, put, getAll, getSettings } from '../db.js';
import { openModal } from '../ui.js';

// Sprachausgabe ist eine Geräte-/Browsereinstellung, kein Werkora-Setting -
// bewusst wie beim bisherigen KI-Assistenten nur in localStorage.
const SPRACHAUSGABE_KEY = 'nv-jarvis-sprachausgabe';
const TAB_KEY = 'nv-jarvis-tab';

// Die KI-Kosten-Schätzung (siehe JARVIS_PREIS_JE_MIO_TOKEN_USD im Worker)
// ist in USD, nicht EUR - formatCurrency() in utils.js ist fest auf EUR
// formatiert, deshalb hier bewusst eine eigene, einfache USD-Formatierung.
function formatUsd(n) {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

function sprich(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  // iOS Safari lässt die Sprachausgabe-Warteschlange nach einem Tab-Wechsel/
  // Hintergrundaufenthalt manchmal "pausiert" zurück, ohne das selbst zu
  // melden - ein nachfolgendes speak() bleibt dann stumm, ohne Fehler.
  // resume() davor ist ein in der Praxis etabliertes, folgenloses Gegenmittel
  // (auf anderen Browsern ein No-Op, falls bereits "running").
  window.speechSynthesis.resume();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'de-DE';
  window.speechSynthesis.speak(utterance);
}

export async function render(container) {
  const session = getSession();

  // Doppelte Absicherung: ROUTE_ROLLEN (db.js) verhindert bereits, dass die
  // Seite für andere Rollen überhaupt verlinkt/erreichbar ist - diese
  // Prüfung hier ist nur die freundliche Fehlermeldung für den (seltenen)
  // Fall eines direkten Hash-Aufrufs. Die ECHTE Durchsetzung passiert
  // serverseitig im Worker (Actions "jarvis-chat"/"jarvis-zentrale"/
  // "jarvis-freigabe"/"jarvis-tagesbericht") bei jedem einzelnen Aufruf,
  // nicht hier im Browser.
  if (session?.role !== 'admin') {
    container.innerHTML = `
      <div class="view-header"><h1>JARVIS</h1></div>
      <p class="hint">JARVIS ist aktuell nur für Administratoren freigegeben.</p>
    `;
    return;
  }
  if (!FIREBASE_ENABLED) {
    container.innerHTML = `
      <div class="view-header"><h1>JARVIS</h1></div>
      <p class="hint">JARVIS benötigt eine eingerichtete Firebase-Anmeldung (Einstellungen → Zugangscode/Mitarbeiter-Login) - im reinen Zugangscode-Modus ohne Firebase-Projekt nicht verfügbar.</p>
    `;
    return;
  }

  const { auth } = await import('../firebase.js');
  const uid = auth.currentUser?.uid;
  if (!uid) {
    container.innerHTML = `
      <div class="view-header"><h1>JARVIS</h1></div>
      <p class="hint">Keine aktive Firebase-Anmeldung gefunden - bitte neu einloggen.</p>
    `;
    return;
  }

  let aktiverTab = (() => { try { return localStorage.getItem(TAB_KEY) || 'zentrale'; } catch { return 'zentrale'; } })();

  container.innerHTML = `
    <div class="view-header">
      <h1>🧠 JARVIS</h1>
    </div>
    <div class="tabs" id="jv-tabs">
      <button type="button" class="tab-item" data-tab="zentrale">📋 Zentrale</button>
      <button type="button" class="tab-item" data-tab="tech">🔧 TECH</button>
      <button type="button" class="tab-item" data-tab="mobile">📱 Mobile</button>
      <button type="button" class="tab-item" data-tab="status">📊 Status</button>
      <button type="button" class="tab-item" data-tab="chat">💬 Chat</button>
    </div>
    <div id="jv-tab-inhalt"></div>
  `;

  const inhaltEl = container.querySelector('#jv-tab-inhalt');
  const tabButtons = [...container.querySelectorAll('.tab-item')];

  function markiereAktivenTab() {
    tabButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === aktiverTab));
  }

  async function zeigeTab(tab) {
    aktiverTab = tab;
    try { localStorage.setItem(TAB_KEY, tab); } catch { /* Speicher evtl. nicht verfügbar */ }
    markiereAktivenTab();
    if (tab === 'chat') {
      await renderChat(inhaltEl, uid);
    } else if (tab === 'tech') {
      await renderTech(inhaltEl);
    } else if (tab === 'mobile') {
      await renderMobile(inhaltEl);
    } else if (tab === 'status') {
      await renderStatus(inhaltEl);
    } else {
      await renderZentrale(inhaltEl);
    }
  }

  tabButtons.forEach((btn) => btn.addEventListener('click', () => zeigeTab(btn.dataset.tab)));
  await zeigeTab(aktiverTab);
}

// =============================================================================
// JARVIS-Zentrale (Phase 5) - Dashboard über alle offenen Entwürfe/
// Vorschläge/Freigaben/Jobs/Kosten, siehe holeJarvisZentrale() in ai.js
// (ruft die Action "jarvis-zentrale" im Worker auf, die wiederum
// holeJarvisZentraleDaten() im Worker bündelt).
// =============================================================================

const KATEGORIEN = [
  { key: 'neueKundenanfragen', titel: 'Neue Kundenanfragen', typ: 'email', leer: 'Keine neuen Kundenanfragen.' },
  { key: 'vorbereiteteAntworten', titel: 'Vorbereitete E-Mail-Antworten', typ: 'email', leer: 'Keine vorbereiteten Antwortentwürfe.' },
  { key: 'angebotsentwuerfe', titel: 'Angebotsentwürfe', typ: 'angebot', leer: 'Keine offenen Angebotsentwürfe.' },
  { key: 'rechnungsentwuerfe', titel: 'Rechnungsentwürfe', typ: 'rechnung', leer: 'Keine offenen Rechnungsentwürfe.' },
  { key: 'mahnentwuerfe', titel: 'Mahnentwürfe', typ: 'mahnung', leer: 'Keine offenen Mahnentwürfe.' },
  { key: 'terminvorschlaege', titel: 'Wartungs- und Terminvorschläge', typ: 'termin', leer: 'Keine offenen Terminvorschläge.' },
  { key: 'offeneProjektaufgaben', titel: 'Offene Projektaufgaben', typ: 'projekt', leer: 'Keine auffälligen Projektaufgaben.' },
  { key: 'fehlgeschlageneAutomationen', titel: 'Fehlgeschlagene Automationen', typ: 'job', leer: 'Keine fehlgeschlagenen/unklaren Hintergrund-Jobs.' },
  { key: 'offeneFreigaben', titel: 'Offene Freigaben', typ: 'aktion', leer: 'Keine offenen Freigabe-Vorgänge.' },
];

function itemTitel(typ, item) {
  switch (typ) {
    case 'email': return `${item.status === 'verarbeitet' ? 'Kundenanfrage' : item.status} - ${item.aufgabeId || item.id}`;
    case 'angebot': return `Angebot ${item.angebotId}`;
    case 'rechnung': return `Projekt ${item.projektId} (${item.quelle === 'angebot' ? 'aus Angebot' : 'aus Zeiterfassung'})`;
    case 'mahnung': return `Rechnung ${item.rechnungId} - Mahnstufe ${item.stufe}`;
    case 'termin': return `${item.bezeichnung || item.anlageId} - fällig ${item.naechstePruefung || ''}`;
    case 'projekt': return `${item.titel || item.id}`;
    case 'job': return `${item.typ || item.id} - ${item.status}`;
    case 'aktion': return `${item.typ} (${item.id})`;
    default: return item.id;
  }
}

function itemDetails(typ, item) {
  switch (typ) {
    case 'email':
      return `Kunde: ${escapeHtml(item.kundeId || 'unbekannt')}${item.angebotId ? `<br>Angebotsentwurf: ${escapeHtml(item.angebotId)}` : ''}${(item.angebotFehlendeInfos || []).length ? `<br>Hinweise: ${escapeHtml(item.angebotFehlendeInfos.join(' | '))}` : ''}${item.gmailDraftSyncFehler ? `<br><span class="badge badge-danger">⚠ Gmail-Entwurf nicht synchronisiert - Freigabe blockiert, bis erneut bearbeitet: ${escapeHtml(item.gmailDraftSyncFehler)}</span>` : ''}`;
    case 'angebot':
      return `Kunde: ${escapeHtml(item.kundeId || 'unbekannt')}${(item.letzteWarnungen || []).length ? `<br>Warnungen: ${escapeHtml(item.letzteWarnungen.join(' | '))}` : ''}`;
    case 'rechnung':
      return `Positionen: ${(item.positionen || []).length}${(item.fehlendeInfos || []).length ? `<br>Hinweise: ${escapeHtml(item.fehlendeInfos.join(' | '))}` : ''}${(item.bekannteAbschlaege || []).length ? `<br>Bekannte Abschläge: ${item.bekannteAbschlaege.length}` : ''}`;
    case 'mahnung':
      return `Offener Betrag: ${item.offenerBetragBrutto != null ? `${item.offenerBetragBrutto.toFixed(2)} €` : 'unbekannt'}${item.neueFrist ? ` · Frist: ${escapeHtml(item.neueFrist)}` : ''}${item.aktuellerMahntext ? `<br>Bisheriger Mahntext: ${escapeHtml(item.aktuellerMahntext)}` : '<br>Noch kein Mahntext hinterlegt.'} - nicht versendet.`;
    case 'termin':
      return (item.vorschlaege || []).map((v, i) => `${i}: ${formatDateTime(v.start)} - ${formatDateTime(v.end)}`).join('<br>') || escapeHtml((item.fehlendeInfos || []).join(' | '));
    case 'projekt':
      return escapeHtml(item.beschreibung || '');
    case 'job':
      return `${escapeHtml(item.ergebnisZusammenfassung || item.fehler || '')}`;
    case 'aktion':
      return `Status: ${escapeHtml(item.status)}${item.fehler ? `<br>Fehler: ${escapeHtml(item.fehler)}` : ''}`;
    default: return '';
  }
}

function entityIdVon(typ, item) {
  if (typ === 'email') return item.id;
  if (typ === 'angebot') return item.angebotId;
  if (typ === 'rechnung') return item.projektId;
  if (typ === 'mahnung') return item.id;
  if (typ === 'termin') return item.id;
  return item.id;
}

// Baut die HTML-Ansicht der JARVIS-CONTROL-Daten (siehe holeJarvisControlDaten
// im Worker) - rein darstellend, keine eigene Berechnung im Client. Jede
// Kennzahl zeigt genau das, was der Worker bereits geprüft/markiert hat
// (z.B. "unvollstaendig" bei Projekt-Deckungsbeiträgen), damit nichts im
// Frontend zusätzlich interpretiert oder geschätzt wird.
function renderControlHtml(control) {
  const letzterMonat = control.umsatzverlauf[control.umsatzverlauf.length - 1];
  const umsatzZeilen = control.umsatzverlauf.map((m) => `
    <tr><td>${escapeHtml(m.monat)}</td><td>${m.rechnungsumsatzNetto.toFixed(2)} €</td><td>${m.rechnungsumsatzBrutto.toFixed(2)} €</td><td>${m.zahlungseingang.toFixed(2)} €</td><td>${m.anzahlRechnungen}</td></tr>
  `).join('');

  const ang = control.angeboteUndAuftragsbestand;
  const vollstaendigeProjekte = control.projektDeckungsbeitraege.filter((p) => !p.unvollstaendig);
  const unvollstaendigeProjekte = control.projektDeckungsbeitraege.filter((p) => p.unvollstaendig);

  return `
    <div class="kpi-grid" style="margin-top:8px">
      <div class="kpi"><div class="kpi-value">${(letzterMonat?.rechnungsumsatzNetto || 0).toFixed(2)} €</div><div class="kpi-label">Rechnungsumsatz netto (${escapeHtml(letzterMonat?.monat || '')})</div></div>
      <div class="kpi"><div class="kpi-value">${(letzterMonat?.zahlungseingang || 0).toFixed(2)} €</div><div class="kpi-label">Zahlungseingang (${escapeHtml(letzterMonat?.monat || '')})</div></div>
      <div class="kpi"><div class="kpi-value">${control.forderungen.offenBrutto.toFixed(2)} €</div><div class="kpi-label">Offene Forderungen (${control.forderungen.anzahlOffen})</div></div>
      <div class="kpi"><div class="kpi-value">${control.forderungen.ueberfaelligBrutto.toFixed(2)} €</div><div class="kpi-label">Davon überfällig (${control.forderungen.anzahlUeberfaellig})</div></div>
      <div class="kpi"><div class="kpi-value">${ang.auftragsbestandNetto.toFixed(2)} €</div><div class="kpi-label">Auftragsbestand netto</div></div>
      <div class="kpi"><div class="kpi-value">${ang.ohneRueckmeldung.length}</div><div class="kpi-label">Angebote ohne Rückmeldung</div></div>
    </div>

    <h3 style="font-size:13px;margin:16px 0 4px">Umsatzverlauf (letzte ${control.umsatzverlauf.length} Monate)</h3>
    <table class="data-table" style="width:100%">
      <thead><tr><th>Monat</th><th>Rechnungsumsatz netto</th><th>Rechnungsumsatz brutto</th><th>Zahlungseingang</th><th>Anzahl</th></tr></thead>
      <tbody>${umsatzZeilen}</tbody>
    </table>

    <h3 style="font-size:13px;margin:16px 0 4px">Angebote nach Status</h3>
    <p>${Object.entries(ang.nachStatus).map(([s, n]) => `${escapeHtml(s)}: ${n}`).join(' · ')}</p>
    <p class="text-mute" style="font-size:11px">${escapeHtml(ang.hinweis)}</p>

    <h3 style="font-size:13px;margin:16px 0 4px">Projekt-Deckungsbeiträge</h3>
    ${vollstaendigeProjekte.length ? `
      <table class="data-table" style="width:100%">
        <thead><tr><th>Projekt</th><th>Umsatz netto</th><th>Kosten</th><th>Deckungsbeitrag</th></tr></thead>
        <tbody>${vollstaendigeProjekte.map((p) => `<tr${p.deckungsbeitrag < 0 ? ' style="color:var(--danger,#d33)"' : ''}><td>${escapeHtml(p.titel)}</td><td>${p.umsatzNetto.toFixed(2)} €</td><td>${p.kostenGesamt.toFixed(2)} €</td><td>${p.deckungsbeitrag.toFixed(2)} €</td></tr>`).join('')}</tbody>
      </table>
    ` : '<p class="text-mute">Keine vollständig berechenbaren Projekte.</p>'}
    ${unvollstaendigeProjekte.length ? `<p class="hint" style="margin-top:8px">⚠️ ${unvollstaendigeProjekte.length} Projekt(e) mit unvollständiger Datengrundlage - Deckungsbeitrag NICHT berechnet: ${unvollstaendigeProjekte.map((p) => `${escapeHtml(p.titel)} (${escapeHtml(p.grund)})`).join(' | ')}</p>` : ''}

    <h3 style="font-size:13px;margin:16px 0 4px">Mitarbeiterauslastung (laufender Monat)</h3>
    ${control.mitarbeiterAuslastung.length ? `
      <table class="data-table" style="width:100%">
        <thead><tr><th>Mitarbeiter</th><th>Ist-Stunden</th><th>Soll-Stunden (Annahme)</th><th>Auslastung</th></tr></thead>
        <tbody>${control.mitarbeiterAuslastung.map((m) => `<tr><td>${escapeHtml(m.name)}</td><td>${m.istStunden}</td><td>${m.sollStunden}</td><td>${m.auslastungProzent ?? '–'}%</td></tr>`).join('')}</tbody>
      </table>
      <p class="text-mute" style="font-size:11px">Soll-Stunden sind eine Annahme (Wochenstunden/5 × 20 Arbeitstage) - Werkora führt keinen Arbeitszeitkalender. Nur Mitarbeiter mit hinterlegter Wochenstundenzahl werden gezeigt.</p>
    ` : '<p class="text-mute">Kein Mitarbeiter mit hinterlegter Wochenstundenzahl.</p>'}

    <h3 style="font-size:13px;margin:16px 0 4px">Wartungsverträge</h3>
    <p>${control.wartungsvertraege.anzahlVertraege} Vertrag/Verträge, davon ${control.wartungsvertraege.anzahlFaellig} fällig.</p>
    <p class="text-mute" style="font-size:11px">${escapeHtml(control.wartungsvertraege.hinweis)}</p>

    <h3 style="font-size:13px;margin:16px 0 4px">Aufgaben/Projektverzögerungen</h3>
    <p>${control.aufgabenUndVerzoegerungen.anzahlUeberfaelligeAufgaben} überfällige Aufgabe(n), ${control.aufgabenUndVerzoegerungen.anzahlVerzoegerteProjekte} verzögerte(s) Projekt(e)${control.aufgabenUndVerzoegerungen.verzoegerteProjekte.length ? `: ${control.aufgabenUndVerzoegerungen.verzoegerteProjekte.map((p) => `${escapeHtml(p.titel)} (Ende ${escapeHtml(p.endDatum)})`).join(', ')}` : ''}.</p>

    <p class="text-mute" style="font-size:11px;margin-top:12px">Stand: ${escapeHtml(control.heute)} - auf Abruf erzeugt, keine KI-Berechnung (rein regelbasiert aus echten Werkora-Daten).</p>
  `;
}

async function renderZentrale(container) {
  container.innerHTML = '<p class="text-mute">Lade JARVIS-Zentrale …</p>';
  let daten;
  try {
    daten = await holeJarvisZentrale();
  } catch (err) {
    container.innerHTML = `<p class="hint">Konnte JARVIS-Zentrale nicht laden: ${escapeHtml(err.message)}</p>`;
    return;
  }

  const kostenZeile = `${formatUsd(daten.kiKostenMonat.usd)} geschätzt im ${daten.kiKostenMonat.monat} (${daten.kiKostenMonat.inputTokens + daten.kiKostenMonat.outputTokens} Tokens)`;
  const jobStatus = daten.jobsNachStatus;

  container.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="kpi-grid">
        ${KATEGORIEN.map((k) => `<div class="kpi"><div class="kpi-value">${(daten[k.key] || []).length}</div><div class="kpi-label">${escapeHtml(k.titel)}</div></div>`).join('')}
        <div class="kpi"><div class="kpi-value">${formatUsd(daten.kiKostenMonat.usd)}</div><div class="kpi-label">Aktuelle KI-Kosten (Monat)</div></div>
      </div>
      <p class="hint">${escapeHtml(kostenZeile)}</p>
    </div>

    <div class="card" style="margin-bottom:12px">
      <h2 style="font-size:14px;margin:0 0 8px">📊 JARVIS CONTROL - Unternehmensübersicht</h2>
      <p class="hint">Rein regelbasierte Auswertung der echten Werkora-Daten (keine KI beteiligt) - Rechnungsumsatz/Zahlungseingänge/Forderungen werden bewusst getrennt ausgewiesen, unvollständige Daten werden sichtbar markiert statt geschätzt.</p>
      <div class="actions">
        <button type="button" class="btn btn-sm" id="jv-control-btn">📊 Unternehmensübersicht laden</button>
        <button type="button" class="btn btn-sm" id="jv-wochenbericht-btn">📈 Wochenbericht anzeigen</button>
      </div>
      <div id="jv-control"></div>
      <div id="jv-wochenbericht"></div>
    </div>

    <div class="card" style="margin-bottom:12px">
      <h2 style="font-size:14px;margin:0 0 8px">Hintergrund-Jobs</h2>
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-value">${jobStatus.wartend}</div><div class="kpi-label">Wartend</div></div>
        <div class="kpi"><div class="kpi-value">${jobStatus.inBearbeitung}</div><div class="kpi-label">In Bearbeitung</div></div>
        <div class="kpi"><div class="kpi-value">${jobStatus.erfolgreich}</div><div class="kpi-label">Erfolgreich</div></div>
        <div class="kpi"><div class="kpi-value">${jobStatus.fehlgeschlagen}</div><div class="kpi-label">Fehlgeschlagen</div></div>
        <div class="kpi"><div class="kpi-value">${jobStatus.unklar}</div><div class="kpi-label">Unklar</div></div>
        <div class="kpi"><div class="kpi-value">${jobStatus.freigabeErforderlich}</div><div class="kpi-label">Freigabe erforderlich</div></div>
      </div>
      <button type="button" class="btn btn-sm" id="jv-tagesbericht-btn" style="margin-top:8px">📅 Tagesbericht anzeigen</button>
      <div id="jv-tagesbericht"></div>
    </div>

    ${KATEGORIEN.map((k) => `
      <div class="card" style="margin-bottom:12px">
        <h2 style="font-size:14px;margin:0 0 8px">${escapeHtml(k.titel)} (${(daten[k.key] || []).length})</h2>
        <div id="jv-liste-${k.key}">
          ${(daten[k.key] || []).length === 0 ? `<p class="text-mute">${escapeHtml(k.leer)}</p>` : (daten[k.key] || []).map((item, i) => `
            <div class="jv-item" style="border-top:1px solid var(--border,#333);padding:8px 0">
              <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px">
                <strong>${escapeHtml(itemTitel(k.typ, item))}</strong>
                ${['email', 'angebot', 'rechnung', 'mahnung', 'termin'].includes(k.typ) ? `
                  <span class="actions">
                    <button type="button" class="btn btn-sm jv-freigeben" data-typ="${k.typ}" data-idx="${i}" data-kat="${k.key}">✅ Freigeben</button>
                    <button type="button" class="btn btn-sm jv-ablehnen" data-typ="${k.typ}" data-idx="${i}" data-kat="${k.key}">❌ Ablehnen</button>
                    ${['angebot', 'rechnung', 'email', 'mahnung'].includes(k.typ) ? `<button type="button" class="btn btn-sm jv-bearbeiten" data-typ="${k.typ}" data-idx="${i}" data-kat="${k.key}">✏️ Bearbeiten</button>` : ''}
                  </span>
                ` : ''}
              </div>
              <div class="text-mute" style="font-size:12px;margin-top:4px">${itemDetails(k.typ, item)}</div>
              ${k.typ === 'termin' ? `
                <div class="field" style="margin-top:4px">
                  <label>Vorschlag auswählen (bei Freigeben)</label>
                  <select class="jv-slot-auswahl" data-kat="${k.key}" data-idx="${i}">
                    ${(item.vorschlaege || []).map((v, vi) => `<option value="${vi}">${formatDateTime(v.start)}</option>`).join('')}
                  </select>
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `).join('')}
  `;

  function holeItem(kat, idx) { return (daten[kat] || [])[idx]; }

  async function entscheide(typ, kat, idx, entscheidung) {
    const item = holeItem(kat, idx);
    if (!item) return;
    const entityId = entityIdVon(typ, item);
    const payload = { entscheidung, erwarteteVersion: item.version ?? 1 };
    if (typ === 'termin' && entscheidung === 'freigeben') {
      const select = container.querySelector(`.jv-slot-auswahl[data-kat="${kat}"][data-idx="${idx}"]`);
      payload.ausgewaehlterSlotIndex = Number(select?.value || 0);
    }
    try {
      await sendeJarvisFreigabe({ typ: `${typ}.pruefen`, entityId, payload });
      toast(entscheidung === 'freigeben' ? 'Freigegeben.' : 'Abgelehnt.', 'success');
      await renderZentrale(container);
    } catch (err) {
      toast(err.message, 'danger');
    }
  }

  // Sendet die Bearbeitung an den Worker (Aktionstyp "<typ>.bearbeiten") und
  // lädt die Zentrale danach neu. Jede Bearbeitung erhöht serverseitig die
  // Version und setzt freigabeStatus zurück auf "offen" (siehe worker.js) -
  // eine zuvor erteilte Freigabe bezieht sich also nachweislich nie auf die
  // nun geänderte Fassung.
  async function sendeBearbeitung(typ, entityId, erwarteteVersion, payload, close) {
    try {
      await sendeJarvisFreigabe({ typ: `${typ}.bearbeiten`, entityId, payload: { erwarteteVersion, ...payload } });
      close();
      toast('Entwurf aktualisiert - erneute Prüfung/Freigabe erforderlich.', 'success');
      await renderZentrale(container);
    } catch (err) {
      toast(err.message, 'danger');
    }
  }

  // Strukturiertes Formular für Positionen (Angebot/Rechnung) anstelle der
  // bisherigen rohen JSON-Eingabe (Vorgabe Phase 6 Punkt 1). Jede Zeile
  // entspricht exakt den Feldern, die der Worker erwartet (article_id bleibt
  // je Zeile erhalten, da er u.a. zur Dubletten-Plausibilitätsprüfung dient).
  function oeffnePositionenFormular(typ, entityId, erwarteteVersion, positionenRoh) {
    let zeilen = (positionenRoh || []).map((p) => ({ ...p }));
    const { body, close } = openModal({
      title: typ === 'angebot' ? 'Angebotspositionen bearbeiten' : 'Rechnungspositionen bearbeiten',
      wide: true,
      bodyHtml: `
        <form id="jv-pos-form">
          <table class="data-table" style="width:100%">
            <thead><tr><th>Bezeichnung</th><th>Einheit</th><th>Menge</th><th>Einzelpreis netto</th><th>MwSt %</th><th></th></tr></thead>
            <tbody id="jv-pos-rows"></tbody>
          </table>
          <button type="button" class="btn btn-sm" id="jv-pos-add" style="margin-top:8px">+ Position hinzufügen</button>
          <div class="modal-actions">
            <span class="spacer"></span>
            <button type="button" class="btn" id="jv-pos-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Speichern (erneute Freigabe erforderlich)</button>
          </div>
        </form>
      `,
    });

    function renderZeilen() {
      body.querySelector('#jv-pos-rows').innerHTML = zeilen.map((z, i) => `
        <tr>
          <td><input data-feld="title" data-i="${i}" value="${escapeHtml(z.title || '')}" required></td>
          <td><input data-feld="unit" data-i="${i}" value="${escapeHtml(z.unit || '')}" style="width:70px"></td>
          <td><input type="number" step="0.01" data-feld="quantity" data-i="${i}" value="${z.quantity ?? ''}" style="width:80px" required></td>
          <td><input type="number" step="0.01" data-feld="unit_price_net" data-i="${i}" value="${z.unit_price_net ?? ''}" style="width:100px" required></td>
          <td><input type="number" step="1" data-feld="vat_rate" data-i="${i}" value="${z.vat_rate ?? 19}" style="width:70px"></td>
          <td><button type="button" class="btn btn-sm btn-danger jv-pos-del" data-i="${i}">✕</button></td>
        </tr>
      `).join('') || '<tr><td colspan="6" class="text-mute">Keine Positionen - mit "+ Position hinzufügen" eine neue Zeile anlegen.</td></tr>';
      body.querySelectorAll('input[data-feld]').forEach((inp) => inp.addEventListener('input', () => {
        const i = Number(inp.dataset.i);
        zeilen[i][inp.dataset.feld] = inp.type === 'number' ? Number(inp.value) : inp.value;
      }));
      body.querySelectorAll('.jv-pos-del').forEach((btn) => btn.addEventListener('click', () => {
        zeilen.splice(Number(btn.dataset.i), 1);
        renderZeilen();
      }));
    }
    renderZeilen();

    body.querySelector('#jv-pos-add').addEventListener('click', () => {
      zeilen.push({ article_id: '', title: '', unit: 'Stk.', quantity: 1, unit_price_net: 0, vat_rate: 19 });
      renderZeilen();
    });
    body.querySelector('#jv-pos-cancel').addEventListener('click', close);
    body.querySelector('#jv-pos-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!zeilen.length) { toast('Mindestens eine Position erforderlich.', 'danger'); return; }
      sendeBearbeitung(typ, entityId, erwarteteVersion, { neuePositionen: zeilen }, close);
    });
  }

  // Strukturiertes Formular für den E-Mail-Antwortentwurf (Betreff/Text
  // einzeln editierbar statt JSON) - siehe bearbeiteEmailAntwortentwurf im
  // Worker für die bekannte Einschränkung bzgl. des alten Gmail-Entwurfs.
  function oeffneEmailFormular(entityId, erwarteteVersion, item) {
    const { body, close } = openModal({
      title: 'E-Mail-Antwortentwurf bearbeiten',
      bodyHtml: `
        <form id="jv-email-form">
          <p class="hint">Hinweis: JARVIS versucht, den bereits vorbereiteten Gmail-Entwurf zu ersetzen - gelingt das nicht, bleibt der alte Entwurf zusätzlich in Gmail bestehen und muss dort vor dem Versenden manuell verworfen werden.</p>
          <div class="field"><label>Betreff</label><input name="betreff" value="${escapeHtml(item.antwortentwurfBetreff || '')}"></div>
          <div class="field"><label>Text *</label><textarea name="text" rows="10" required>${escapeHtml(item.antwortentwurfText || '')}</textarea></div>
          <div class="modal-actions">
            <span class="spacer"></span>
            <button type="button" class="btn" id="jv-email-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Speichern (erneute Freigabe erforderlich)</button>
          </div>
        </form>
      `,
    });
    body.querySelector('#jv-email-cancel').addEventListener('click', close);
    body.querySelector('#jv-email-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      const text = String(form.get('text') || '').trim();
      if (!text) { toast('Text darf nicht leer sein.', 'danger'); return; }
      sendeBearbeitung('email', entityId, erwarteteVersion, {
        antwortentwurfBetreff: String(form.get('betreff') || ''), antwortentwurfText: text,
      }, close);
    });
  }

  // Strukturiertes Formular für den Mahntext (ändert über firestoreMergeFelder
  // NUR "text"/"gebuehr" auf der ECHTEN mahnungen-Collection, siehe
  // bearbeiteMahnEntwurf im Worker - rechnungId/stufe/neueFrist bleiben
  // unberührt). Vorbefüllt mit dem TATSÄCHLICHEN bisherigen Mahntext und
  // zeigt Mahnstufe/offenen Betrag/Frist zur Orientierung an (Vorgabe
  // Phase 7 Punkt 1 - vorher war das Formular immer "blind").
  function oeffneMahnungFormular(entityId, erwarteteVersion, item) {
    const { body, close } = openModal({
      title: 'Mahntext bearbeiten',
      bodyHtml: `
        <form id="jv-mahn-form">
          <p class="hint">
            Rechnung ${escapeHtml(item.rechnungId || '')} · Mahnstufe ${escapeHtml(String(item.stufe ?? '?'))}
            · Offener Betrag ${item.offenerBetragBrutto != null ? `${item.offenerBetragBrutto.toFixed(2)} €` : 'unbekannt'}
            ${item.neueFrist ? `· Frist ${escapeHtml(item.neueFrist)}` : ''}<br>
            Der eingegebene Text ersetzt den Mahntext auf der echten Mahnung (rechnungId/Stufe/Frist bleiben unverändert). Es wird NICHTS versendet.
          </p>
          <div class="field"><label>Mahntext *</label><textarea name="text" rows="8" required>${escapeHtml(item.aktuellerMahntext || '')}</textarea></div>
          <div class="field"><label>Mahngebühr € (optional, leer lassen = unverändert)</label><input type="number" step="0.01" name="gebuehr" value="${item.aktuelleGebuehr ?? ''}"></div>
          <div class="modal-actions">
            <span class="spacer"></span>
            <button type="button" class="btn" id="jv-mahn-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Speichern (erneute Freigabe erforderlich)</button>
          </div>
        </form>
      `,
    });
    body.querySelector('#jv-mahn-cancel').addEventListener('click', close);
    body.querySelector('#jv-mahn-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      const text = String(form.get('text') || '').trim();
      if (!text) { toast('Mahntext darf nicht leer sein.', 'danger'); return; }
      const gebuehrRoh = form.get('gebuehr');
      sendeBearbeitung('mahnung', entityId, erwarteteVersion, {
        text, gebuehr: gebuehrRoh ? Number(gebuehrRoh) : undefined,
      }, close);
    });
  }

  function bearbeiten(typ, kat, idx) {
    const item = holeItem(kat, idx);
    if (!item) return;
    const entityId = entityIdVon(typ, item);
    const erwarteteVersion = item.version ?? 1;
    if (typ === 'angebot' || typ === 'rechnung') {
      oeffnePositionenFormular(typ, entityId, erwarteteVersion, item.positionen || item.items || []);
    } else if (typ === 'email') {
      oeffneEmailFormular(entityId, erwarteteVersion, item);
    } else if (typ === 'mahnung') {
      oeffneMahnungFormular(entityId, erwarteteVersion, item);
    }
  }

  // Konkrete, NIEMALS übertriebene Auswirkungsbeschreibung je Aktionstyp -
  // deckt sich mit der Dokumentation der Aktionstypen in worker.js
  // (JARVIS_AKTIONS_AUSFUEHRUNG-Kopfkommentar): jede Freigabe ist eine reine
  // interne Status-Änderung, NIE ein automatischer Versand/eine automatische
  // Buchung.
  const FREIGABE_AUSWIRKUNG = {
    email: 'Setzt den Status dieses Antwortentwurfs auf "freigegeben". Es wird NICHTS automatisch verschickt - der Gmail-Entwurf bleibt zur manuellen Prüfung/zum manuellen Versand in Gmail liegen.',
    angebot: 'Setzt den Status dieser Angebotsprüfung auf "freigegeben". Das echte Angebot in Werkora wird dadurch NICHT verändert, verschickt oder storniert.',
    rechnung: 'Setzt den Status dieses Rechnungsentwurfs auf "freigegeben". Es wird KEINE echte Rechnung erzeugt oder versendet - das bleibt eine manuelle Aktion in Werkora.',
    mahnung: 'Setzt den Status dieses Mahnentwurfs auf "freigegeben". Die echte Mahnung wird dadurch NICHT automatisch versendet.',
    termin: 'Markiert den unten gezeigten Terminvorschlag als bestätigt. Es wird KEIN verbindlicher Werkora-Termin oder Google-Kalender-Eintrag automatisch angelegt.',
  };

  function freigabeDetailsHtml(typ, item, kat, idx) {
    if (typ === 'email') {
      return `
        <p><strong>Empfänger (Antwort an):</strong> ${escapeHtml(item.emailVon || 'unbekannt')}</p>
        <p><strong>Betreff:</strong> ${escapeHtml(item.antwortentwurfBetreff || '(kein Betreff)')}</p>
        <p><strong>Inhalt:</strong></p>
        <p class="text-mute" style="white-space:pre-wrap">${escapeHtml(item.antwortentwurfText || '(kein Text)')}</p>
        <p class="text-mute" style="font-size:12px">Betroffene Daten: jarvisEmailVerarbeitung/${escapeHtml(item.id || '')}</p>
      `;
    }
    if (typ === 'angebot') {
      const items = item.items || item.positionen || [];
      return `
        <p><strong>Kunde:</strong> ${escapeHtml(item.kundeId || 'unbekannt')}</p>
        ${items.length ? `<p><strong>Positionen:</strong></p><ul>${items.map((p) => `<li>${escapeHtml(p.title || p.bezeichnung || '')} - ${p.quantity ?? p.menge ?? ''} ${escapeHtml(p.unit || p.einheit || '')} x ${p.unit_price_net ?? p.einzelpreis ?? ''} €</li>`).join('')}</ul>` : '<p class="hint">Positionen nicht geladen - echte aktuelle Positionen siehe Werkora-Angebot.</p>'}
        <p class="text-mute" style="font-size:12px">Betroffene Daten: Angebot ${escapeHtml(item.angebotId || '')} (jarvisAngebotsPruefung-Status)</p>
      `;
    }
    if (typ === 'rechnung') {
      const items = item.positionen || [];
      return `
        <p><strong>Projekt:</strong> ${escapeHtml(item.projektId || 'unbekannt')}</p>
        ${items.length ? `<p><strong>Positionen:</strong></p><ul>${items.map((p) => `<li>${escapeHtml(p.title || '')} - ${p.quantity ?? ''} ${escapeHtml(p.unit || '')} x ${p.unit_price_net ?? ''} €</li>`).join('')}</ul>` : ''}
        <p class="text-mute" style="font-size:12px">Betroffene Daten: jarvisRechnungsEntwuerfe/${escapeHtml(item.projektId || '')}</p>
      `;
    }
    if (typ === 'mahnung') {
      return `
        <p><strong>Rechnung:</strong> ${escapeHtml(item.rechnungId || 'unbekannt')} · <strong>Mahnstufe:</strong> ${escapeHtml(String(item.stufe ?? '?'))}</p>
        <p><strong>Offener Betrag:</strong> ${item.offenerBetragBrutto != null ? `${item.offenerBetragBrutto.toFixed(2)} €` : 'unbekannt'} · <strong>Frist:</strong> ${escapeHtml(item.neueFrist || 'unbekannt')}</p>
        <p><strong>Mahntext:</strong></p>
        <p class="text-mute" style="white-space:pre-wrap">${escapeHtml(item.aktuellerMahntext || '(kein Text hinterlegt)')}</p>
        <p class="text-mute" style="font-size:12px">Betroffene Daten: Mahnung ${escapeHtml(item.mahnungId || '')} (echte mahnungen-Collection, nur text/gebuehr)</p>
      `;
    }
    if (typ === 'termin') {
      const select = container.querySelector(`.jv-slot-auswahl[data-kat="${kat}"][data-idx="${idx}"]`);
      const slotIndex = Number(select?.value || 0);
      const slot = (item.vorschlaege || [])[slotIndex];
      return `
        <p><strong>Anlage/Objekt:</strong> ${escapeHtml(item.bezeichnung || item.anlageId || 'unbekannt')}</p>
        <p><strong>Ausgewählter Termin:</strong> ${slot ? `${formatDateTime(slot.start)} – ${formatDateTime(slot.end)}` : 'kein Slot ausgewählt'}</p>
        <p class="text-mute" style="font-size:12px">Betroffene Daten: jarvisTerminVorschlaege/${escapeHtml(item.id || '')}</p>
      `;
    }
    return '';
  }

  // Phase 8 (Vorgabe Punkt 5 "Mobile Freigaben"): vor JEDER Freigabe - auch
  // und besonders am Handy, wo Einträge auf kleinem Bildschirm dicht
  // beieinander liegen und ein Button leicht aus Versehen getroffen wird -
  // zeigt ein eigenes Bestätigungs-Modal explizit Empfänger/Inhalt/
  // betroffene Daten UND die konkrete (sehr begrenzte) Auswirkung der
  // Freigabe, bevor sie tatsächlich ausgelöst wird. Ablehnen bleibt bewusst
  // ohne diese zusätzliche Stufe - das ist eine rein interne, folgenlose
  // Status-Änderung, keine "Freigabe" im Sinne der Vorgabe.
  function oeffneFreigabeBestaetigung(typ, kat, idx) {
    const item = holeItem(kat, idx);
    if (!item) return;
    const { body, close } = openModal({
      title: `Freigabe bestätigen - ${escapeHtml(itemTitel(typ, item))}`,
      bodyHtml: `
        ${freigabeDetailsHtml(typ, item, kat, idx)}
        <p class="hint" style="margin-top:10px"><strong>Konkrete Auswirkung:</strong> ${FREIGABE_AUSWIRKUNG[typ] || ''}</p>
        <div class="modal-actions">
          <span class="spacer"></span>
          <button type="button" class="btn" id="jv-freigabe-abbrechen">Abbrechen</button>
          <button type="button" class="btn btn-primary" id="jv-freigabe-bestaetigen">✅ Jetzt freigeben</button>
        </div>
      `,
    });
    body.querySelector('#jv-freigabe-abbrechen').addEventListener('click', close);
    body.querySelector('#jv-freigabe-bestaetigen').addEventListener('click', async () => {
      close();
      await entscheide(typ, kat, idx, 'freigeben');
    });
  }

  container.querySelectorAll('.jv-freigeben').forEach((btn) => btn.addEventListener('click', () => oeffneFreigabeBestaetigung(btn.dataset.typ, btn.dataset.kat, Number(btn.dataset.idx))));
  container.querySelectorAll('.jv-ablehnen').forEach((btn) => btn.addEventListener('click', () => entscheide(btn.dataset.typ, btn.dataset.kat, Number(btn.dataset.idx), 'ablehnen')));
  container.querySelectorAll('.jv-bearbeiten').forEach((btn) => btn.addEventListener('click', () => bearbeiten(btn.dataset.typ, btn.dataset.kat, Number(btn.dataset.idx))));

  container.querySelector('#jv-control-btn')?.addEventListener('click', async () => {
    const zielEl = container.querySelector('#jv-control');
    zielEl.innerHTML = '<p class="text-mute">Lade Unternehmensübersicht …</p>';
    try {
      const control = await holeJarvisControl();
      zielEl.innerHTML = renderControlHtml(control);
    } catch (err) {
      zielEl.innerHTML = `<p class="hint">${escapeHtml(err.message)}</p>`;
    }
  });

  container.querySelector('#jv-wochenbericht-btn')?.addEventListener('click', async () => {
    const zielEl = container.querySelector('#jv-wochenbericht');
    zielEl.innerHTML = '<p class="text-mute">Lade Wochenbericht …</p>';
    try {
      const bericht = await holeJarvisWochenbericht();
      zielEl.innerHTML = `
        <h3 style="font-size:13px;margin:12px 0 4px">Wochenbericht (${escapeHtml(bericht.zeitraum.von || '')} – ${escapeHtml(bericht.zeitraum.bis || '')})</h3>
        <p>Offene Entscheidungen: ${bericht.offeneEntscheidungen}</p>
        ${bericht.risiken.length ? `<p><strong>Risiken:</strong></p><ul>${bericht.risiken.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>` : '<p class="text-mute">Keine besonderen Risiken erkannt.</p>'}
        ${bericht.handlungsempfehlungen.length ? `<p><strong>Handlungsempfehlungen:</strong></p><ul>${bericht.handlungsempfehlungen.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>` : '<p class="text-mute">Keine Handlungsempfehlungen.</p>'}
        <p class="text-mute" style="font-size:11px">Stand: ${formatDateTime(bericht.erstelltAm)} - auf Abruf erzeugt, automatische wöchentliche Zustellung erst nach gesonderter Freigabe aktiv.</p>
      `;
    } catch (err) {
      zielEl.innerHTML = `<p class="hint">${escapeHtml(err.message)}</p>`;
    }
  });

  container.querySelector('#jv-tagesbericht-btn')?.addEventListener('click', async () => {
    const zielEl = container.querySelector('#jv-tagesbericht');
    zielEl.innerHTML = '<p class="text-mute">Lade Tagesbericht …</p>';
    try {
      const bericht = await holeJarvisTagesbericht();
      zielEl.innerHTML = `
        <ul style="margin:8px 0 0">
          <li>Neue Kundenanfragen: ${bericht.neueKundenanfragen}</li>
          <li>Vorbereitete Angebote: ${bericht.vorbereiteteAngebote}</li>
          <li>Offene Rechnungsentwürfe: ${bericht.offeneRechnungsentwuerfe}</li>
          <li>Fällige Wartungen: ${bericht.faelligeWartungen}</li>
          <li>Überfällige Aufgaben: ${bericht.ueberfaelligeAufgaben}</li>
          <li>Offene Freigaben: ${bericht.offeneFreigaben}</li>
          <li>Technische Fehler: ${bericht.technischeFehler}</li>
          <li>KI-Kosten diesen Monat: ${formatUsd(bericht.kiKostenMonatUsd)}</li>
        </ul>
        <p class="text-mute" style="font-size:11px">Stand: ${formatDateTime(bericht.erstelltAm)} - auf Abruf erzeugt, noch nicht automatisch per Cron verschickt.</p>
      `;
    } catch (err) {
      zielEl.innerHTML = `<p class="hint">${escapeHtml(err.message)}</p>`;
    }
  });
}

// =============================================================================
// JARVIS TECH (Phase 7) - Dokument-/Bild-/Text-Analyse (Typenschild/
// Fehlermeldung/Anlagenbild/Messprotokoll/Wartungsvorschlag) und DGUV-V3-/
// VDE-Prüfprotokoll-Entwürfe. Jede Aussage wird mit ihrer Herkunft (Messwert/
// Herstellerquelle/Diagnosehypothese) angezeigt - siehe worker.js für die
// serverseitige Durchsetzung dieser Kennzeichnung.
// =============================================================================

const TECH_ANALYSE_TYPEN = [
  { id: 'typenschild', titel: 'Typenschild auslesen' },
  { id: 'fehlermeldung', titel: 'Fehlermeldung/Fehlercode' },
  { id: 'anlagenbild', titel: 'Anlagenbild (Zustand)' },
  { id: 'messprotokoll', titel: 'Vorhandenes Messprotokoll auslesen' },
  { id: 'wartungsvorschlag', titel: 'Wartungsvorschlag (Wärmepumpe/PV/Klima/Wartung)' },
];

const HERKUNFT_BADGE = {
  messwert: '<span class="badge badge-accent">Messwert</span>',
  // Phase 8 Punkt 6: zwei getrennte Stufen statt einer - "hochgeladen" ist
  // ein ungeprüfter, nur eingefügter Text; "verifiziert" wird AUSSCHLIESSLICH
  // durch die separate, manuelle Aktion verifiziereJarvisHerstellerBefund
  // gesetzt, niemals durch die Analyse selbst.
  herstellertext_hochgeladen: '<span class="badge badge-warn">Herstellertext (ungeprüft hochgeladen)</span>',
  herstellerquelle_verifiziert: '<span class="badge badge-success">Herstellerquelle (verifiziert)</span>',
  diagnosehypothese: '<span class="badge badge-warn">Diagnosehypothese</span>',
};

const PROTOKOLL_ERGEBNIS_BADGE = {
  ohne_auffaelligkeiten: '<span class="badge badge-success">ohne Auffälligkeiten (Entwurf)</span>',
  auffaellig: '<span class="badge badge-danger">auffällig</span>',
  unvollstaendig: '<span class="badge badge-warn">unvollständig</span>',
};

const PROTOKOLL_HINWEIS = 'Entwurf zur Durchsicht durch eine Elektrofachkraft - KEIN rechtsverbindliches Prüfergebnis, keine automatische Bestätigung einer bestandenen Prüfung, keine Unterschrift/Freigabe.';

const PROTOKOLL_MESSWERT_STATUS_BADGE = {
  ok: '<span class="badge badge-success">ok</span>',
  auffaellig: '<span class="badge badge-danger">auffällig</span>',
  fehlend: '<span class="badge badge-warn">fehlend</span>',
  nicht_bewertbar: '<span class="badge badge-warn">nicht bewertbar</span>',
};

// Phase 8 (mobil/Kamera): Fotos werden vor dem Senden client-seitig verkleinert
// (wiederverwendet aus utils.js, dieselbe Funktion wie bei Zeiterfassungs-
// Fotos) - eine typische Handyfoto-Auflösung von 12+ MP würde sonst unnötig
// viele Daten über eine ggf. langsame Baustellen-Mobilfunkverbindung senden
// und unnötig nah an API-Größenlimits (Anthropic-Bildgröße) heranrücken.
// Der Rohgrößen-Cap gilt VOR der Komprimierung (fängt z.B. eine versehentlich
// ausgewählte Video-/RAW-Datei ab, bevor überhaupt versucht wird, sie zu
// verarbeiten) - PDFs werden nicht komprimiert, nur größenbeschränkt.
const TECH_UPLOAD_MAX_MB = 15;
const TECH_UPLOAD_MAX_BYTES = TECH_UPLOAD_MAX_MB * 1024 * 1024;

function dateiZuDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
    reader.readAsDataURL(file);
  });
}

function renderTechErgebnis(analyse) {
  const g = analyse.erkannteGeraetedaten || {};
  return `
    <div class="card" style="margin-top:8px">
      ${analyse.bildLesbar === false ? '<p class="hint">⚠️ Bild/Dokument war nicht auswertbar.</p>' : ''}
      <p><strong>Gerät:</strong> ${escapeHtml(g.hersteller || '–')} ${escapeHtml(g.modell || '')}${g.seriennummer ? ` (SN ${escapeHtml(g.seriennummer)})` : ''}${g.geraetetyp ? ` - ${escapeHtml(g.geraetetyp)}` : ''}</p>
      ${analyse.erkannterFehlercode ? `<p><strong>Fehlercode:</strong> ${escapeHtml(analyse.erkannterFehlercode)}</p>` : ''}
      ${(analyse.ausgeleseneMesswerte || []).length ? `<p><strong>Ausgelesene Messwerte:</strong></p><ul>${analyse.ausgeleseneMesswerte.map((m) => `<li>${escapeHtml(m.bezeichnung)}: ${escapeHtml(String(m.wert ?? '–'))} ${escapeHtml(m.einheit || '')}</li>`).join('')}</ul>` : ''}
      ${analyse.hatHerstellerquelle ? `<p class="text-mute">Herstellerquelle: ${escapeHtml(analyse.herstellerquelleName || 'ohne Dokumentname')}${analyse.herstellerquelleDatum ? ` (${escapeHtml(analyse.herstellerquelleDatum)})` : ''} - noch ungeprüft, bis einzelne Befunde unten explizit verifiziert wurden.</p>` : ''}
      <p><strong>Befunde:</strong></p>
      <ul id="jv-tech-befunde">${(analyse.befunde || []).map((b, i) => `<li data-i="${i}">${HERKUNFT_BADGE[b.herkunft] || ''} ${escapeHtml(b.aussage)}${b.quelle ? ` <span class="text-mute">(${escapeHtml(b.quelle)})</span>` : ''}
        ${b.herkunft === 'herstellertext_hochgeladen' ? ` <button type="button" class="btn btn-sm jv-tech-befund-verifizieren" data-i="${i}">Als verifiziert markieren</button>` : ''}
        ${b.herkunft === 'herstellerquelle_verifiziert' && b.verifizierteQuelle ? `<div class="text-mute" style="font-size:11px">Verifiziert von ${escapeHtml(b.verifizierteQuelle.pruefendePersonName || '')} am ${formatDateTime(b.verifiziertAm)} · ${escapeHtml(b.verifizierteQuelle.dokumentName || '')}${b.verifizierteQuelle.dokumentHersteller ? ` (${escapeHtml(b.verifizierteQuelle.dokumentHersteller)})` : ''}${b.verifizierteQuelle.dokumentVersionOderDatum ? `, ${escapeHtml(b.verifizierteQuelle.dokumentVersionOderDatum)}` : ''} · Fundstelle: ${escapeHtml(b.verifizierteQuelle.fundstelle || '')}</div>` : ''}</li>`).join('') || '<li class="text-mute">Keine Befunde.</li>'}</ul>
      <p class="hint">⚠️ ${escapeHtml(analyse.unsicherheitshinweis || '')}</p>
      <div id="jv-tech-verknuepfung"></div>
    </div>
  `;
}

function wireTechErgebnisAktionen(ergebnisEl, analyse, kunden, anlagen, session) {
  // Sowohl Verknüpfung als auch Befund-Verifizierung erhöhen die Version -
  // eine gemeinsame, mutable Variable statt zwei getrennter sorgt dafür,
  // dass die zweite Aktion nicht mit einer bereits veralteten erwarteten
  // Version abgelehnt wird (409), wenn zuvor schon die andere ausgeführt wurde.
  let aktuelleVersion = analyse.version ?? 1;

  // Phase 9 Sicherheitsprüfung Punkt 4: die Verifizierung ist eine
  // ausdrückliche fachliche Zusicherung ("ich habe das Originaldokument
  // persönlich geprüft") - deshalb ein eigenes Modal mit den geforderten
  // Nachweisfeldern statt eines einzelnen Klicks ohne jede Angabe.
  const befundeEl = ergebnisEl.querySelector('#jv-tech-befunde');
  if (befundeEl) {
    befundeEl.querySelectorAll('.jv-tech-befund-verifizieren').forEach((btn) => btn.addEventListener('click', () => {
      const i = Number(btn.dataset.i);
      const { body, close } = openModal({
        title: 'Herstellerquelle als verifiziert markieren',
        bodyHtml: `
          <p class="hint">Bestätigt ausdrücklich, dass du das genannte Originaldokument PERSÖNLICH geprüft hast - keine automatische Prüfung durch JARVIS.</p>
          <form id="jv-verifizieren-form">
            <div class="field"><label>Dokumentname *</label><input name="dokumentName" required placeholder="z.B. Montageanleitung Vitocal 200"></div>
            <div class="field"><label>Hersteller</label><input name="dokumentHersteller" placeholder="z.B. Viessmann"></div>
            <div class="field"><label>Dokumentversion/-datum</label><input name="dokumentVersionOderDatum" placeholder="z.B. Rev. 3 / 2024-01"></div>
            <div class="field"><label>Fundstelle *</label><input name="fundstelle" required placeholder="z.B. Abschnitt 4.2, Seite 12"></div>
            <div class="field"><label>Prüfende Person *</label><input name="pruefendePersonName" required value="${escapeHtml(session?.name || '')}"></div>
            <div class="modal-actions">
              <span class="spacer"></span>
              <button type="button" class="btn" id="jv-verifizieren-cancel">Abbrechen</button>
              <button type="submit" class="btn btn-primary">Verifizierung bestätigen</button>
            </div>
          </form>
        `,
      });
      body.querySelector('#jv-verifizieren-cancel').addEventListener('click', close);
      body.querySelector('#jv-verifizieren-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          await verifiziereJarvisHerstellerBefund({
            analyseId: analyse.id, erwarteteVersion: aktuelleVersion, befundIndex: i,
            dokumentName: fd.get('dokumentName'), dokumentHersteller: fd.get('dokumentHersteller'),
            dokumentVersionOderDatum: fd.get('dokumentVersionOderDatum'), fundstelle: fd.get('fundstelle'),
            pruefendePersonName: fd.get('pruefendePersonName'),
          });
          aktuelleVersion += 1;
          close();
          const li = befundeEl.querySelector(`li[data-i="${i}"]`);
          if (li) {
            li.querySelector('.badge')?.replaceWith(...new DOMParser().parseFromString(HERKUNFT_BADGE.herstellerquelle_verifiziert, 'text/html').body.childNodes);
            btn.remove();
          }
          toast('Befund als verifiziert markiert.', 'success');
        } catch (err) {
          toast(err.message, 'danger');
        }
      });
    }));
  }

  const zielEl = ergebnisEl.querySelector('#jv-tech-verknuepfung');
  if (!zielEl) return;
  if (analyse.verknuepftMitAnlageId) {
    zielEl.innerHTML = `<p class="text-mute">✅ Verknüpft mit Anlage ${escapeHtml(analyse.verknuepftMitAnlageId)}.</p>`;
    return;
  }
  zielEl.innerHTML = `
    <div class="field"><label>Mit echter Anlage verknüpfen (optional, NIEMALS automatisch)</label>
      <select id="jv-tech-verknuepfen-kunde"><option value="">Kunde wählen …</option>${kunden.map((k) => `<option value="${k.id}">${escapeHtml(k.firma || k.id)}</option>`).join('')}</select>
      <select id="jv-tech-verknuepfen-anlage"><option value="">–</option></select>
      <button type="button" class="btn btn-sm" id="jv-tech-verknuepfen-btn" style="margin-top:4px">Verknüpfen</button>
    </div>
  `;
  const kundeSel = zielEl.querySelector('#jv-tech-verknuepfen-kunde');
  const anlageSel = zielEl.querySelector('#jv-tech-verknuepfen-anlage');
  kundeSel.addEventListener('change', () => {
    const gefiltert = anlagen.filter((a) => a.kundeId === kundeSel.value);
    anlageSel.innerHTML = `<option value="">–</option>${gefiltert.map((a) => `<option value="${a.id}">${escapeHtml(a.bezeichnung)}</option>`).join('')}`;
  });
  zielEl.querySelector('#jv-tech-verknuepfen-btn').addEventListener('click', async () => {
    if (!anlageSel.value) { toast('Bitte eine Anlage auswählen.', 'danger'); return; }
    try {
      await verknuepfeJarvisTechAnalyse({ analyseId: analyse.id, erwarteteVersion: aktuelleVersion, anlagenId: anlageSel.value, kundeId: kundeSel.value });
      aktuelleVersion += 1;
      zielEl.innerHTML = '<p class="text-mute">✅ Verknüpft.</p>';
      toast('Verknüpft.', 'success');
    } catch (err) {
      toast(err.message, 'danger');
    }
  });
}

// Phase 8 Punkt 6: zeigt der Elektrofachkraft NEBEN der Bestätigungs-Checkbox
// den tatsächlichen Gültigkeitsbereich/die Bedingung des zu dieser Messgröße
// passenden, von Danny hinterlegten Grenzwerts - damit nicht einfach eine
// leere Checkbox blind bestätigt wird, sondern sichtbar ist, WOFÜR der
// Grenzwert gilt. Rein informativ, client-seitig - die verbindliche Prüfung
// inkl. normVersion/gueltigkeitsbereich läuft serverseitig in worker.js.
function gueltigkeitshinweisFuer(pruefart, bezeichnung, normen) {
  const treffer = (normen || []).find((n) => n.pruefart === pruefart && n.messgroesse === (bezeichnung || '').trim());
  if (!treffer) return '<span class="text-mute">kein hinterlegter Grenzwert</span>';
  const teile = [treffer.gueltigkeitsbereich, treffer.bedingung].filter(Boolean);
  return teile.length ? escapeHtml(teile.join(' · ')) : '<span class="text-mute">ohne Einschränkung</span>';
}

function messwertZeilenHtml(messwerte, { pruefart = '', normen = [] } = {}) {
  const liste = messwerte.length ? messwerte : [{ bezeichnung: '', wert: '', einheit: '', pruefbedingungBestaetigt: false }];
  return liste.map((m, i) => `
    <tr>
      <td><input data-feld="bezeichnung" data-i="${i}" value="${escapeHtml(m.bezeichnung || '')}" placeholder="z.B. Isolationswiderstand" required></td>
      <td><input data-feld="wert" data-i="${i}" value="${m.wert ?? ''}" style="width:90px"></td>
      <td><input data-feld="einheit" data-i="${i}" value="${escapeHtml(m.einheit || '')}" style="width:70px"></td>
      <td style="text-align:center"><input type="checkbox" data-feld="pruefbedingungBestaetigt" data-i="${i}" ${m.pruefbedingungBestaetigt ? 'checked' : ''}></td>
      <td style="font-size:11px;max-width:180px">${gueltigkeitshinweisFuer(pruefart, m.bezeichnung, normen)}</td>
      <td><button type="button" class="btn btn-sm btn-danger jv-messwert-del" data-i="${i}">✕</button></td>
    </tr>`).join('');
}

function wireMesswertZeilen(host, zeilen, renderFn) {
  host.querySelectorAll('[data-feld]').forEach((inp) => inp.addEventListener('input', () => {
    const i = Number(inp.dataset.i);
    zeilen[i][inp.dataset.feld] = inp.type === 'checkbox' ? inp.checked : inp.value;
  }));
  host.querySelectorAll('.jv-messwert-del').forEach((btn) => btn.addEventListener('click', () => { zeilen.splice(Number(btn.dataset.i), 1); renderFn(); }));
}

async function renderTech(container) {
  const session = getSession();
  const [kunden, anlagen] = await Promise.all([getAll('kunden'), getAll('anlagen')]);
  // Für den Gültigkeitshinweis bei den Messwert-Checkboxen (siehe
  // gueltigkeitshinweisFuer) - wird nach Anlegen/Außer-Kraft-Setzen einer
  // Fassung aktuell gehalten (ladeNormListe), damit neu geöffnete
  // Protokoll-Formulare die jeweils aktuell gültigen Grenzwerte zeigen.
  // Phase 9: läuft jetzt über die serverseitige Aktion (nicht mehr direkt
  // per Firestore-Client-Read), konsistent mit der restlichen Normen-
  // Verwaltung weiter unten.
  let normenCache = (await holeJarvisPruefnormen()).filter((n) => n.aktuell !== false);

  container.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <h2 style="font-size:14px;margin:0 0 8px">🔧 Technische Analyse</h2>
      <p class="hint">Elektrotechnik/Fehlersuche, DGUV-V3/DIN-VDE, Wärmepumpen, Photovoltaik, Klima-/Kältetechnik, Wartung. JARVIS unterstützt eine Elektrofachkraft, ersetzt sie nicht - jede Aussage ist klar als Messwert, Herstellerangabe oder fachliche Einschätzung gekennzeichnet.</p>
      <form id="jv-tech-form">
        <div class="form-grid">
          <div class="field"><label>Analyseart</label>
            <select name="analyseTyp">${TECH_ANALYSE_TYPEN.map((t) => `<option value="${t.id}">${escapeHtml(t.titel)}</option>`).join('')}</select>
          </div>
          <div class="field"><label>Kunde (optional, zur Anlagenauswahl)</label>
            <select id="jv-tech-kunde"><option value="">–</option>${kunden.map((k) => `<option value="${k.id}">${escapeHtml(k.firma || k.id)}</option>`).join('')}</select>
          </div>
          <div class="field"><label>Anlage (optional - echte Werkora-Daten fließen automatisch ein)</label>
            <select id="jv-tech-anlage"><option value="">–</option></select>
          </div>
          <div class="field col-span-2">
            <label>Foto/Dokument (Typenschild, Fehlermeldung, Messgerät, Anlage, Prüfprotokoll)</label>
            <div class="file-dropzone" id="jv-tech-dropzone" tabindex="0">
              <div class="dz-icon">📷</div>
              <div>Foto aufnehmen oder Datei wählen</div>
              <div class="dz-hint">JPEG/PNG/WebP/PDF · max. ${TECH_UPLOAD_MAX_MB} MB · Fotos werden vor dem Senden verkleinert</div>
              <div style="margin-top:10px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
                <button type="button" class="btn btn-sm" id="jv-tech-camera-btn">📷 Foto aufnehmen</button>
                <button type="button" class="btn btn-sm" id="jv-tech-datei-btn">📁 Datei wählen</button>
              </div>
              <input type="file" id="jv-tech-camera-input" accept="image/*" capture="environment" hidden>
              <input type="file" id="jv-tech-datei-input" accept="image/png,image/jpeg,image/webp,application/pdf" hidden>
            </div>
            <div id="jv-tech-preview"></div>
          </div>
          <div class="field col-span-2"><label>Symptom-/Kontextbeschreibung (optional)</label><textarea name="kontextText" rows="2" placeholder="z.B. „Wärmepumpe zeigt Fehlercode, Leistung seit gestern reduziert“"></textarea></div>
          <div class="field col-span-2"><label>Herstellerquelle (optional - nur ausfüllen, wenn ein echter Auszug aus einer Montage-/Bedienungsanleitung vorliegt; gilt zunächst nur als "hochgeladen, ungeprüft" - eine unabhängige Verifizierung erfolgt separat, siehe Ergebnis unten)</label><textarea name="herstellerquelleText" rows="3"></textarea></div>
          <div class="field"><label>Dokumentname der Quelle (optional)</label><input name="herstellerquelleName" placeholder="z.B. Montageanleitung WP-12kW Rev.3"></div>
          <div class="field"><label>Datum/Version der Quelle (optional)</label><input name="herstellerquelleDatum" placeholder="z.B. 2024-03 oder Rev. 3"></div>
        </div>
        <button type="submit" class="btn btn-primary" id="jv-tech-analysieren-btn">🔍 Analysieren</button>
      </form>
      <div id="jv-tech-ergebnis"></div>
    </div>

    <div class="card" style="margin-bottom:12px">
      <div class="flex-row" style="justify-content:space-between;align-items:center">
        <h2 style="font-size:14px;margin:0">Bisherige Analysen</h2>
        <button type="button" class="btn btn-sm" id="jv-tech-verlauf-btn">Laden</button>
      </div>
      <div id="jv-tech-verlauf"></div>
    </div>

    <div class="card" style="margin-bottom:12px">
      <h2 style="font-size:14px;margin:0 0 8px">📋 DGUV-V3-/VDE-Prüfprotokolle</h2>
      <p class="hint">${PROTOKOLL_HINWEIS} Grenzwerte werden NUR geprüft, wenn unten eine passende Prüfnorm hinterlegt ist.</p>
      <button type="button" class="btn btn-sm" id="jv-protokoll-neu-btn">+ Neues Prüfprotokoll</button>
      <div id="jv-protokoll-liste" style="margin-top:8px"></div>
    </div>

    <div class="card" style="margin-bottom:12px">
      <h2 style="font-size:14px;margin:0 0 8px">⚙️ Prüfnormen/Grenzwerte (von dir konfiguriert)</h2>
      <p class="hint">JARVIS kennt/erfindet selbst KEINE DIN-VDE-/DGUV-Grenzwerte - eine Grenzwertprüfung findet nur gegen hier eingetragene Werte statt.</p>
      <button type="button" class="btn btn-sm" id="jv-norm-neu-btn">+ Neue Prüfnorm anlegen</button>
      <div id="jv-norm-liste" style="margin-top:8px"></div>
    </div>
  `;

  const kundeSelect = container.querySelector('#jv-tech-kunde');
  const anlageSelect = container.querySelector('#jv-tech-anlage');
  function aktualisiereAnlagenOptionen() {
    const kundeId = kundeSelect.value;
    const gefiltert = kundeId ? anlagen.filter((a) => a.kundeId === kundeId) : anlagen;
    anlageSelect.innerHTML = `<option value="">–</option>${gefiltert.map((a) => `<option value="${a.id}">${escapeHtml(a.bezeichnung)}</option>`).join('')}`;
  }
  aktualisiereAnlagenOptionen();
  kundeSelect.addEventListener('change', aktualisiereAnlagenOptionen);

  // --- Kamera-/Datei-Upload (Phase 8) - wiederverwendet denselben Ansatz wie
  // der bestehende Zeiterfassungs-Foto-Upload (capture="environment" für
  // direkten Kamerazugriff auf dem iPhone, kein separates Plugin nötig).
  // Das Bild wird bereits HIER beim Auswählen (nicht erst beim Absenden)
  // komprimiert/geprüft, damit ein zu großes/falsches Foto sofort sichtbar
  // abgelehnt wird statt erst nach einem erfolglosen Analyse-Versuch.
  let ausgewaehlteBildDataUrl = null;
  const previewEl = container.querySelector('#jv-tech-preview');
  function zeigeVorschau(dataUrl, istBild) {
    previewEl.innerHTML = !dataUrl ? '' : `
      <div class="dz-preview-grid">
        <div class="dz-preview-item" style="width:92px;height:92px">
          ${istBild ? `<img src="${dataUrl}" alt="Vorschau">` : '<div class="dz-file-icon">📄</div>'}
          <button type="button" class="dz-remove" id="jv-tech-entfernen" title="Entfernen">✕</button>
        </div>
      </div>`;
    previewEl.querySelector('#jv-tech-entfernen')?.addEventListener('click', () => { ausgewaehlteBildDataUrl = null; zeigeVorschau(null); });
  }
  async function verarbeiteDatei(file) {
    if (!file) return;
    const istPdf = file.type === 'application/pdf';
    const istBild = file.type.startsWith('image/');
    if (!istPdf && !istBild) { toast(`Dateityp nicht unterstützt: ${file.type || file.name}`, 'danger'); return; }
    if (file.size > TECH_UPLOAD_MAX_BYTES) { toast(`Datei ist zu groß (max. ${TECH_UPLOAD_MAX_MB} MB).`, 'danger'); return; }
    try {
      const dataUrl = istBild
        ? await dateiZuDataUrl(await compressImage(file, { maxWidth: 1600, quality: 0.82 }))
        : await dateiZuDataUrl(file);
      ausgewaehlteBildDataUrl = dataUrl;
      zeigeVorschau(dataUrl, istBild);
    } catch (err) {
      toast(err.message || 'Datei konnte nicht verarbeitet werden.', 'danger');
    }
  }
  const camInput = container.querySelector('#jv-tech-camera-input');
  const datInput = container.querySelector('#jv-tech-datei-input');
  container.querySelector('#jv-tech-camera-btn').addEventListener('click', () => camInput.click());
  container.querySelector('#jv-tech-datei-btn').addEventListener('click', () => datInput.click());
  camInput.addEventListener('change', (e) => { verarbeiteDatei(e.target.files?.[0]); e.target.value = ''; });
  datInput.addEventListener('change', (e) => { verarbeiteDatei(e.target.files?.[0]); e.target.value = ''; });

  container.querySelector('#jv-tech-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const bildDataUrl = ausgewaehlteBildDataUrl || undefined;
    const kontextText = String(fd.get('kontextText') || '').trim();
    const herstellerquelleText = String(fd.get('herstellerquelleText') || '').trim();
    const herstellerquelleName = String(fd.get('herstellerquelleName') || '').trim();
    const herstellerquelleDatum = String(fd.get('herstellerquelleDatum') || '').trim();
    const anlagenId = anlageSelect.value || undefined;
    const kundeIdHinweis = kundeSelect.value || '';
    const analyseTyp = fd.get('analyseTyp');
    const btn = container.querySelector('#jv-tech-analysieren-btn');
    const ergebnisEl = container.querySelector('#jv-tech-ergebnis');
    btn.disabled = true; btn.textContent = 'Analysiert …';
    ergebnisEl.innerHTML = '';
    try {
      const analyse = await analysiereJarvisTech({
        analyseTyp, bildDataUrl, herstellerquelleText: herstellerquelleText || undefined,
        herstellerquelleName: herstellerquelleName || undefined, herstellerquelleDatum: herstellerquelleDatum || undefined,
        kontextText: kontextText || undefined, kundeIdHinweis, anlagenId,
      });
      ergebnisEl.innerHTML = renderTechErgebnis(analyse);
      wireTechErgebnisAktionen(ergebnisEl, analyse, kunden, anlagen, session);
      toast('Analyse abgeschlossen.', 'success');
    } catch (err) {
      ergebnisEl.innerHTML = `<p class="hint">${escapeHtml(err.message)}</p>`;
    } finally {
      btn.disabled = false; btn.textContent = '🔍 Analysieren';
    }
  });

  container.querySelector('#jv-tech-verlauf-btn').addEventListener('click', async () => {
    const zielEl = container.querySelector('#jv-tech-verlauf');
    zielEl.innerHTML = '<p class="text-mute">Lade …</p>';
    try {
      const analysen = await holeJarvisTechAnalysen();
      zielEl.innerHTML = analysen.length === 0 ? '<p class="text-mute">Noch keine Analysen.</p>' : `
        <ul class="cal-event-list">
          ${analysen.map((a) => `
            <li>
              <div><strong>${escapeHtml(TECH_ANALYSE_TYPEN.find((t) => t.id === a.analyseTyp)?.titel || a.analyseTyp)}</strong>
                <div class="text-mute">${formatDateTime(a.erstelltAm)}${a.verknuepftMitAnlageId ? ' · verknüpft' : ' · nicht verknüpft'}</div>
              </div>
            </li>`).join('')}
        </ul>`;
    } catch (err) {
      zielEl.innerHTML = `<p class="hint">${escapeHtml(err.message)}</p>`;
    }
  });

  async function ladeProtokollListe() {
    const listeEl = container.querySelector('#jv-protokoll-liste');
    listeEl.innerHTML = '<p class="text-mute">Lade …</p>';
    try {
      const protokolle = await holeJarvisPruefprotokolle();
      listeEl.innerHTML = protokolle.length === 0 ? '<p class="text-mute">Noch keine Prüfprotokolle.</p>' : `
        <ul class="cal-event-list">
          ${protokolle.map((p, i) => `
            <li data-idx="${i}" style="cursor:pointer">
              <div><strong>${escapeHtml(p.pruefart)} - Anlage ${escapeHtml(p.anlagenId)}</strong><div class="text-mute">${formatDateTime(p.erstelltAm)}${p.durchsicht ? ' · 👁️ durchgesehen' : ''}</div></div>
              ${PROTOKOLL_ERGEBNIS_BADGE[p.gesamtergebnis] || ''}
            </li>`).join('')}
        </ul>`;
      listeEl.querySelectorAll('[data-idx]').forEach((li) => li.addEventListener('click', () => oeffneProtokollBearbeiten(protokolle[Number(li.dataset.idx)])));
    } catch (err) {
      listeEl.innerHTML = `<p class="hint">${escapeHtml(err.message)}</p>`;
    }
  }

  function oeffneProtokollNeu() {
    let zeilen = [{ bezeichnung: '', wert: '', einheit: '', pruefbedingungBestaetigt: false }];
    const { body, close } = openModal({
      title: 'Neues Prüfprotokoll', wide: true,
      bodyHtml: `
        <form id="jv-protokoll-form">
          <div class="form-grid">
            <div class="field"><label>Kunde</label><select name="kundeId">${kunden.map((k) => `<option value="${k.id}">${escapeHtml(k.firma || k.id)}</option>`).join('')}</select></div>
            <div class="field"><label>Anlage *</label><select name="anlagenId" required></select></div>
            <div class="field"><label>Prüfart</label><select name="pruefart"><option value="dguv-v3">DGUV V3</option><option value="e-check">E-Check</option><option value="sonstiges">Sonstiges</option></select></div>
          </div>
          <table class="data-table" style="width:100%;margin-top:8px">
            <thead><tr><th>Messgröße</th><th>Wert</th><th>Einheit</th><th>Bedingung bestätigt</th><th>Gültigkeitsbereich</th><th></th></tr></thead>
            <tbody id="jv-protokoll-messwerte"></tbody>
          </table>
          <button type="button" class="btn btn-sm" id="jv-messwert-add" style="margin-top:8px">+ Messwert hinzufügen</button>
          <div class="modal-actions">
            <span class="spacer"></span>
            <button type="button" class="btn" id="jv-protokoll-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Entwurf erstellen</button>
          </div>
        </form>
      `,
    });
    const kundeSel = body.querySelector('select[name="kundeId"]');
    const anlageSel = body.querySelector('select[name="anlagenId"]');
    const pruefartSel = body.querySelector('select[name="pruefart"]');
    function aktAnlagen() {
      const gefiltert = anlagen.filter((a) => a.kundeId === kundeSel.value);
      anlageSel.innerHTML = gefiltert.map((a) => `<option value="${a.id}">${escapeHtml(a.bezeichnung)}</option>`).join('');
    }
    kundeSel.addEventListener('change', aktAnlagen);
    aktAnlagen();
    function renderZeilen() {
      body.querySelector('#jv-protokoll-messwerte').innerHTML = messwertZeilenHtml(zeilen, { pruefart: pruefartSel.value, normen: normenCache });
      wireMesswertZeilen(body.querySelector('#jv-protokoll-messwerte'), zeilen, renderZeilen);
    }
    renderZeilen();
    pruefartSel.addEventListener('change', renderZeilen);
    body.querySelector('#jv-messwert-add').addEventListener('click', () => { zeilen.push({ bezeichnung: '', wert: '', einheit: '', pruefbedingungBestaetigt: false }); renderZeilen(); });
    body.querySelector('#jv-protokoll-cancel').addEventListener('click', close);
    body.querySelector('#jv-protokoll-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!anlageSel.value) { toast('Bitte eine Anlage auswählen.', 'danger'); return; }
      try {
        await erstelleJarvisPruefprotokoll({ anlagenId: anlageSel.value, kundeId: kundeSel.value, pruefart: body.querySelector('select[name="pruefart"]').value, messwerte: zeilen });
        close();
        toast('Prüfprotokoll-Entwurf erstellt.', 'success');
        ladeProtokollListe();
      } catch (err) {
        toast(err.message, 'danger');
      }
    });
  }

  // Phase 8 Punkt 6: zeigt pro Messwert das serverseitig berechnete
  // grenzwertPruefung-Ergebnis (inkl. normVersion/gueltigkeitsbereich) aus dem
  // zuletzt gespeicherten Protokoll an - rein informativ/read-only.
  function protokollBewertungHtml(protokoll) {
    const bewertet = (protokoll.messwerte || []).filter((m) => m.grenzwertPruefung);
    if (!bewertet.length) return '';
    return `
      <table class="data-table" style="width:100%;margin-bottom:8px">
        <thead><tr><th>Messgröße</th><th>Ergebnis</th><th>Begründung</th><th>Norm</th><th>Version</th><th>Gültigkeitsbereich</th></tr></thead>
        <tbody>
          ${bewertet.map((m) => `
            <tr>
              <td>${escapeHtml(m.bezeichnung)}</td>
              <td>${PROTOKOLL_MESSWERT_STATUS_BADGE[m.grenzwertPruefung.status] || escapeHtml(m.grenzwertPruefung.status)}</td>
              <td style="font-size:11px">${escapeHtml(m.grenzwertPruefung.grund || '')}</td>
              <td>${escapeHtml(m.grenzwertPruefung.normReferenz || '–')}</td>
              <td>${m.grenzwertPruefung.normVersion ?? '–'}</td>
              <td style="font-size:11px">${escapeHtml(m.grenzwertPruefung.gueltigkeitsbereich || '–')}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  function durchsichtHtml(protokoll) {
    if (!protokoll.durchsicht) {
      return '<p class="hint">Noch keine Durchsicht dokumentiert.</p>';
    }
    const d = protokoll.durchsicht;
    return `<p class="hint">👁️ Durchsicht dokumentiert von <strong>${escapeHtml(d.vonName)}</strong> am ${formatDateTime(d.am)}${d.notiz ? `<br>Notiz: ${escapeHtml(d.notiz)}` : ''}<br><em>Dies ist KEINE Freigabe/Bestätigung einer bestandenen Prüfung, nur ein Vermerk, dass die Werte durchgesehen wurden.</em></p>`;
  }

  function oeffneDurchsichtModal(protokoll, aufFortschritt) {
    const { body, close } = openModal({
      title: 'Durchsicht dokumentieren',
      bodyHtml: `
        <p class="hint">Hält AUSDRÜCKLICH nur fest, dass eine Elektrofachkraft die Werte durchgesehen hat - KEINE automatische fachliche Prüfungsfreigabe, KEINE Bestätigung einer bestandenen Prüfung.</p>
        <form id="jv-durchsicht-form">
          <div class="field"><label>Name der Elektrofachkraft *</label><input name="vonName" required value="${escapeHtml(session.name || '')}"></div>
          <div class="field"><label>Notiz (optional)</label><textarea name="notiz" rows="3" placeholder="z.B. Werte vor Ort plausibilisiert"></textarea></div>
          <div class="modal-actions">
            <span class="spacer"></span>
            <button type="button" class="btn" id="jv-durchsicht-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Durchsicht dokumentieren</button>
          </div>
        </form>
      `,
    });
    body.querySelector('#jv-durchsicht-cancel').addEventListener('click', close);
    body.querySelector('#jv-durchsicht-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const vonName = String(fd.get('vonName') || '').trim();
      if (!vonName) { toast('Name darf nicht leer sein.', 'danger'); return; }
      try {
        const ergebnis = await dokumentiereDurchsichtPruefprotokoll({ protokollId: protokoll.id, erwarteteVersion: protokoll.version ?? 1, vonName, notiz: fd.get('notiz') });
        close();
        toast('Durchsicht dokumentiert.', 'success');
        ladeProtokollListe();
        if (aufFortschritt) aufFortschritt(ergebnis.durchsicht);
      } catch (err) {
        toast(err.message, 'danger');
      }
    });
  }

  function oeffneProtokollBearbeiten(protokoll) {
    let zeilen = protokoll.messwerte.map((m) => ({ bezeichnung: m.bezeichnung, wert: m.wert, einheit: m.einheit, pruefbedingungBestaetigt: m.pruefbedingungBestaetigt || false }));
    const { body, close } = openModal({
      title: `Prüfprotokoll bearbeiten - ${protokoll.pruefart}`, wide: true,
      bodyHtml: `
        <p class="hint">${PROTOKOLL_HINWEIS}</p>
        ${protokollBewertungHtml(protokoll)}
        <table class="data-table" style="width:100%">
          <thead><tr><th>Messgröße</th><th>Wert</th><th>Einheit</th><th>Bedingung bestätigt</th><th>Gültigkeitsbereich</th><th></th></tr></thead>
          <tbody id="jv-protokoll-messwerte-edit"></tbody>
        </table>
        <button type="button" class="btn btn-sm" id="jv-messwert-add-edit" style="margin-top:8px">+ Messwert hinzufügen</button>
        <div class="modal-actions">
          <span class="spacer"></span>
          <button type="button" class="btn" id="jv-protokoll-edit-cancel">Abbrechen</button>
          <button type="button" class="btn btn-primary" id="jv-protokoll-edit-speichern">Speichern (erneute Prüfung erforderlich)</button>
        </div>
        <hr>
        <div id="jv-protokoll-durchsicht">${durchsichtHtml(protokoll)}</div>
        <button type="button" class="btn btn-sm" id="jv-durchsicht-btn">👁️ Durchsicht dokumentieren</button>
      `,
    });
    function renderZeilen() {
      body.querySelector('#jv-protokoll-messwerte-edit').innerHTML = messwertZeilenHtml(zeilen, { pruefart: protokoll.pruefart, normen: normenCache });
      wireMesswertZeilen(body.querySelector('#jv-protokoll-messwerte-edit'), zeilen, renderZeilen);
    }
    renderZeilen();
    body.querySelector('#jv-messwert-add-edit').addEventListener('click', () => { zeilen.push({ bezeichnung: '', wert: '', einheit: '', pruefbedingungBestaetigt: false }); renderZeilen(); });
    body.querySelector('#jv-protokoll-edit-cancel').addEventListener('click', close);
    body.querySelector('#jv-durchsicht-btn').addEventListener('click', () => oeffneDurchsichtModal(protokoll, (durchsicht) => {
      body.querySelector('#jv-protokoll-durchsicht').innerHTML = durchsichtHtml({ ...protokoll, durchsicht });
    }));
    body.querySelector('#jv-protokoll-edit-speichern').addEventListener('click', async () => {
      try {
        await aktualisiereJarvisPruefprotokoll({ protokollId: protokoll.id, erwarteteVersion: protokoll.version ?? 1, messwerte: zeilen });
        close();
        toast('Prüfprotokoll aktualisiert.', 'success');
        ladeProtokollListe();
      } catch (err) {
        toast(err.message, 'danger');
      }
    });
  }

  container.querySelector('#jv-protokoll-neu-btn').addEventListener('click', oeffneProtokollNeu);
  ladeProtokollListe();

  // Phase 9 Sicherheitsprüfung Punkt 3: Prüfnormen sind jetzt eine
  // unveränderliche Versionshistorie (siehe worker.js erstelleJarvisPruefnorm/
  // setzeJarvisPruefnormAusserKraft) - KEINE Löschfunktion mehr im UI, nur
  // noch "Neue Fassung erstellen" (ersetzt die aktuelle, alte bleibt als
  // Historie erhalten) und "Außer Kraft setzen" (ohne Nachfolger).
  const NORM_STATUS_BADGE = {
    aktuell: '<span class="badge badge-success">aktuell</span>',
    abgeloest: '<span class="badge badge-warn">abgelöst durch neuere Fassung</span>',
    ausserKraft: '<span class="badge badge-danger">außer Kraft gesetzt</span>',
  };
  function normStatus(n) {
    if (n.aktuell === false && n.abgeloestDurchId) return 'abgeloest';
    if (n.aktuell === false) return 'ausserKraft';
    return 'aktuell';
  }

  async function ladeNormListe() {
    const alleNormen = await holeJarvisPruefnormen();
    normenCache = alleNormen.filter((n) => n.aktuell !== false);
    const listeEl = container.querySelector('#jv-norm-liste');
    listeEl.innerHTML = alleNormen.length === 0 ? '<p class="text-mute">Noch keine Grenzwerte hinterlegt.</p>' : `
      <table class="data-table" style="width:100%">
        <thead><tr><th>Status</th><th>Prüfart</th><th>Messgröße</th><th>Bereich</th><th>Bedingung</th><th>Gültigkeitsbereich</th><th>Norm</th><th>Version</th><th>Ersteller/Grund</th><th></th></tr></thead>
        <tbody>
          ${alleNormen.map((n) => {
            const status = normStatus(n);
            return `
            <tr>
              <td>${NORM_STATUS_BADGE[status]}</td>
              <td>${escapeHtml(n.pruefart)}</td><td>${escapeHtml(n.messgroesse)}</td>
              <td>${n.grenzwertMin ?? '-∞'} – ${n.grenzwertMax ?? '∞'} ${escapeHtml(n.einheit || '')}</td>
              <td>${escapeHtml(n.bedingung || '')}</td><td>${escapeHtml(n.gueltigkeitsbereich || '')}</td><td>${escapeHtml(n.normReferenz || '')}</td>
              <td>${n.version ?? 1}</td>
              <td style="font-size:11px">${formatDateTime(n.erstelltAm)}${n.aenderungsgrund ? `<br>Grund: ${escapeHtml(n.aenderungsgrund)}` : ''}${n.ausserKraftGrund ? `<br>Außer Kraft: ${escapeHtml(n.ausserKraftGrund)}` : ''}</td>
              <td>${status === 'aktuell' ? `
                <button type="button" class="btn btn-sm jv-norm-neue-fassung" data-id="${n.id}">Neue Fassung</button>
                <button type="button" class="btn btn-sm btn-danger jv-norm-ausser-kraft" data-id="${n.id}">Außer Kraft</button>
              ` : ''}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
    listeEl.querySelectorAll('.jv-norm-neue-fassung').forEach((btn) => btn.addEventListener('click', () => oeffneNormFormular(alleNormen.find((n) => n.id === btn.dataset.id))));
    listeEl.querySelectorAll('.jv-norm-ausser-kraft').forEach((btn) => btn.addEventListener('click', () => oeffneAusserKraftModal(btn.dataset.id)));
  }

  function oeffneAusserKraftModal(normId) {
    const { body, close } = openModal({
      title: 'Prüfnorm-Fassung außer Kraft setzen',
      bodyHtml: `
        <p class="hint">Setzt diese Fassung außer Kraft, OHNE sie zu löschen - sie bleibt für bereits damit bewertete Prüfprotokolle nachvollziehbar erhalten, wird aber für neue Protokolle nicht mehr angewendet.</p>
        <form id="jv-norm-ak-form">
          <div class="field"><label>Grund *</label><textarea name="grund" rows="2" required placeholder="z.B. Messgröße wird nicht mehr geprüft"></textarea></div>
          <div class="modal-actions">
            <span class="spacer"></span>
            <button type="button" class="btn" id="jv-norm-ak-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-danger">Außer Kraft setzen</button>
          </div>
        </form>
      `,
    });
    body.querySelector('#jv-norm-ak-cancel').addEventListener('click', close);
    body.querySelector('#jv-norm-ak-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const grund = String(new FormData(e.target).get('grund') || '').trim();
      if (!grund) { toast('Grund darf nicht leer sein.', 'danger'); return; }
      try {
        await setzeJarvisPruefnormAusserKraft({ normId, grund });
        close();
        toast('Fassung außer Kraft gesetzt.', 'success');
        ladeNormListe();
      } catch (err) {
        toast(err.message, 'danger');
      }
    });
  }

  // vorgaenger: vorhandene aktuelle Fassung, die ersetzt werden soll - oder
  // null/undefined für eine komplett neue Messgröße.
  function oeffneNormFormular(vorgaenger) {
    const istNeueFassung = !!vorgaenger;
    const { body, close } = openModal({
      title: istNeueFassung ? `Neue Fassung erstellen - ${vorgaenger.messgroesse}` : 'Neue Prüfnorm anlegen',
      bodyHtml: `
        ${istNeueFassung ? `<p class="hint">Ersetzt Version ${vorgaenger.version ?? 1} - die bisherige Fassung bleibt als Historie erhalten, wird aber für neue Protokolle nicht mehr angewendet.</p>` : ''}
        <form id="jv-norm-form">
          <div class="form-grid">
            <div class="field"><label>Prüfart</label><select name="pruefart" ${istNeueFassung ? 'disabled' : ''}><option value="dguv-v3">DGUV V3</option><option value="e-check">E-Check</option><option value="sonstiges">Sonstiges</option></select></div>
            <div class="field"><label>Messgröße *</label><input name="messgroesse" required placeholder="z.B. Auslösezeit RCD" ${istNeueFassung ? 'readonly' : ''} value="${istNeueFassung ? escapeHtml(vorgaenger.messgroesse) : ''}"></div>
            <div class="field"><label>Einheit</label><input name="einheit" placeholder="z.B. ms, MΩ, V" value="${istNeueFassung ? escapeHtml(vorgaenger.einheit || '') : ''}"></div>
            <div class="field"><label>Minimalwert (optional)</label><input type="number" step="any" name="grenzwertMin" value="${istNeueFassung && vorgaenger.grenzwertMin != null ? vorgaenger.grenzwertMin : ''}"></div>
            <div class="field"><label>Maximalwert (optional)</label><input type="number" step="any" name="grenzwertMax" value="${istNeueFassung && vorgaenger.grenzwertMax != null ? vorgaenger.grenzwertMax : ''}"></div>
            <div class="field col-span-2"><label>Bedingung</label><input name="bedingung" placeholder="z.B. bei 1x I∆n, Typ AC/A" value="${istNeueFassung ? escapeHtml(vorgaenger.bedingung || '') : ''}"></div>
            <div class="field col-span-2"><label>Gültigkeitsbereich (für welche Anlagen/Fälle gilt dieser Grenzwert - wird der Elektrofachkraft beim Bestätigen angezeigt)</label><input name="gueltigkeitsbereich" placeholder="z.B. Endstromkreise TN-S-Netz, Nennspannung 230V" value="${istNeueFassung ? escapeHtml(vorgaenger.gueltigkeitsbereich || '') : ''}"></div>
            <div class="field col-span-2"><label>Normreferenz (deine Angabe - JARVIS erfindet hier nichts)</label><input name="normReferenz" placeholder="z.B. DIN VDE 0100-410" value="${istNeueFassung ? escapeHtml(vorgaenger.normReferenz || '') : ''}"></div>
            ${istNeueFassung ? '<div class="field col-span-2"><label>Änderungsgrund *</label><textarea name="aenderungsgrund" rows="2" required placeholder="z.B. Grenzwert gemäß neuer Herstellerangabe angepasst"></textarea></div>' : ''}
          </div>
          <div class="modal-actions">
            <span class="spacer"></span>
            <button type="button" class="btn" id="jv-norm-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Speichern</button>
          </div>
        </form>
      `,
    });
    body.querySelector('#jv-norm-cancel').addEventListener('click', close);
    body.querySelector('#jv-norm-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const messgroesse = String(fd.get('messgroesse') || '').trim();
      if (!messgroesse) { toast('Messgröße darf nicht leer sein.', 'danger'); return; }
      try {
        await erstelleJarvisPruefnorm({
          pruefart: istNeueFassung ? vorgaenger.pruefart : fd.get('pruefart'), messgroesse,
          einheit: String(fd.get('einheit') || '').trim(),
          grenzwertMin: fd.get('grenzwertMin') || null, grenzwertMax: fd.get('grenzwertMax') || null,
          bedingung: String(fd.get('bedingung') || '').trim(),
          gueltigkeitsbereich: String(fd.get('gueltigkeitsbereich') || '').trim(),
          normReferenz: String(fd.get('normReferenz') || '').trim(),
          vorherigeVersionId: istNeueFassung ? vorgaenger.id : undefined,
          aenderungsgrund: fd.get('aenderungsgrund') || undefined,
        });
        close();
        toast('Prüfnorm-Fassung gespeichert.', 'success');
        ladeNormListe();
      } catch (err) {
        toast(err.message, 'danger');
      }
    });
  }

  container.querySelector('#jv-norm-neu-btn').addEventListener('click', () => oeffneNormFormular(null));

  ladeNormListe();
}

// =============================================================================
// JARVIS MOBILE (Phase 8) - Siri-Kurzbefehle: Verwaltung widerrufbarer,
// zeitlich begrenzter, PRO GERÄT AUSGESTELLTER Bearer-Tokens (siehe
// worker.js fuehreSiriAbfrageAus für die serverseitige Durchsetzung).
// Phase 9 Sicherheitsprüfung: dies ist AUSDRÜCKLICH keine kryptografisch
// nachweisbare Gerätebindung, nur ein gewöhnliches, widerrufbares
// Bearer-Token, das im iOS-Kurzbefehl gespeichert wird - siehe Hinweistext
// im UI unten. Das rohe Token wird NUR client-seitig erzeugt und NUR EINMAL
// angezeigt - gespeichert wird ausschließlich sein SHA-256-Hash (als
// Dokument-ID), niemals das Token selbst. Es gibt bewusst KEINEN
// "Token erneut anzeigen"-Button.
// =============================================================================

const SIRI_INTENT_LABELS = {
  'taetigkeiten-morgen': 'Was steht morgen an (Termine/Aufgaben)',
  'angebote-offen': 'Welche Angebote sind offen',
  'freigaben-offen': 'Zeige offene JARVIS-Freigaben (nur Anzeige, keine Freigabe per Sprache)',
};

async function sha256HexBrowser(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function erzeugeZufallsToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function siriTokenStatus(token) {
  if (token.widerrufenAm) return { text: 'Widerrufen', klasse: 'badge-danger' };
  const heute = new Date().toISOString().slice(0, 10);
  if (token.ablaufAm && token.ablaufAm < heute) return { text: 'Abgelaufen', klasse: 'badge-warn' };
  return { text: 'Aktiv', klasse: 'badge-success' };
}

async function renderMobile(container) {
  const settings = await getSettings();
  const siriUrl = settings.aiWorkerUrl ? `${settings.aiWorkerUrl.replace(/\/$/, '')}/siri-abfrage` : null;
  // Phase 9 Sicherheitsprüfung: Token-Erstellung/-Widerruf ist bereits
  // ausschließlich für eingeloggte Admins möglich (firestore.rules
  // siriGeraeteTokens: allow read, write: if isAdmin() - das ist eine
  // SERVERSEITIGE Prüfung, Firestore-Regeln laufen auf Googles Servern,
  // nicht im Browser). erstelltVonUid ergänzt zusätzlich einen Audit-Trail,
  // WER welches Token angelegt hat (bisher nur beim Widerruf nachvollziehbar).
  const { auth } = await import('../firebase.js');
  const erstellerUid = auth.currentUser?.uid || '';

  async function ladeTokenListe() {
    const listeEl = container.querySelector('#jv-siri-liste');
    const tokens = (await getAll('siriGeraeteTokens')).sort((a, b) => (b.erstelltAm || '').localeCompare(a.erstelltAm || ''));
    listeEl.innerHTML = tokens.length === 0 ? '<p class="text-mute">Noch keine Gerätetokens erstellt.</p>' : `
      <ul class="cal-event-list">
        ${tokens.map((t, i) => {
          const status = siriTokenStatus(t);
          return `
            <li data-idx="${i}">
              <div>
                <strong>${escapeHtml(t.label || t.id.slice(0, 8))}</strong> <span class="badge ${status.klasse}">${status.text}</span>
                <div class="text-mute" style="font-size:12px">
                  Erstellt ${formatDateTime(t.erstelltAm)} · Läuft ab ${escapeHtml(t.ablaufAm || '–')}${t.letzteNutzungAm ? ` · Zuletzt genutzt ${formatDateTime(t.letzteNutzungAm)}` : ' · noch nie genutzt'}<br>
                  Erlaubt: ${(t.erlaubteIntents || []).map((id) => escapeHtml(SIRI_INTENT_LABELS[id] || id)).join('; ') || '–'} · Endung …${escapeHtml(t.anzeigeSuffix || '')}
                </div>
              </div>
              ${!t.widerrufenAm ? `<button type="button" class="btn btn-sm btn-danger jv-siri-widerrufen" data-idx="${i}">Widerrufen</button>` : ''}
            </li>`;
        }).join('')}
      </ul>`;
    listeEl.querySelectorAll('.jv-siri-widerrufen').forEach((btn) => btn.addEventListener('click', async () => {
      const token = tokens[Number(btn.dataset.idx)];
      if (!window.confirm(`Gerätetoken "${token.label || token.id.slice(0, 8)}" wirklich widerrufen? Der zugehörige Kurzbefehl funktioniert danach nicht mehr.`)) return;
      await put('siriGeraeteTokens', { ...token, widerrufenAm: new Date().toISOString(), widerrufenVonUid: erstellerUid });
      toast('Gerätetoken widerrufen.', 'success');
      ladeTokenListe();
    }));
  }

  container.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <h2 style="font-size:14px;margin:0 0 8px">📱 JARVIS auf dem iPhone</h2>
      <p class="hint">Die JARVIS-Zentrale ist eine normale Webseite - auf dem iPhone über Safari "Zum Home-Bildschirm hinzufügen", damit sie sich wie eine eigene App öffnet (kein separater App-Store-Download nötig). Chat, Freigabecenter, Berichte, CONTROL und TECH sind vollständig mobil nutzbar, inklusive Kamera-Upload in TECH.</p>
    </div>

    <div class="card" style="margin-bottom:12px">
      <h2 style="font-size:14px;margin:0 0 8px">🗣️ Siri-Kurzbefehle</h2>
      <p class="hint">Jedes Gerätetoken ist read-only, zeitlich begrenzt und jederzeit widerrufbar - über Siri lässt sich NIEMALS etwas freigeben, bearbeiten oder verändern, nur abfragen. Ein Kurzbefehl kann z.B. „Hey Siri, JARVIS fragen“ heißen und ruft die unten stehende Adresse per „Inhalte von URL abrufen“ (POST) mit dem Token als Authorization-Header auf.<br><strong>Wichtig:</strong> Das ist ein gewöhnliches, widerrufbares Zugangs-Token, keine kryptografisch nachweisbare Gerätebindung - wer das Token kennt (z.B. nach Verlust des entsperrten iPhones), kann es bis zum Widerruf von jedem Gerät aus nutzen. Bei Verlust/Diebstahl des iPhones das zugehörige Token sofort unten widerrufen.</p>
      ${siriUrl ? `<p class="text-mute" style="font-size:12px;word-break:break-all">Adresse für den Kurzbefehl: <code>${escapeHtml(siriUrl)}</code><br>Header: <code>Authorization: Bearer &lt;Gerätetoken&gt;</code><br>Body (JSON): <code>{"intent": "taetigkeiten-morgen"}</code> (oder "angebote-offen"/"freigaben-offen")<br>Antwort auswerten: Feld <code>sprachantwort</code> aus der JSON-Antwort vorlesen lassen ("Text aussprechen").</p>` : '<p class="hint">KI-Worker-URL noch nicht eingerichtet (Einstellungen → KI-Angebotserstellung).</p>'}
      <button type="button" class="btn btn-sm" id="jv-siri-neu-btn">+ Neues Gerätetoken erstellen</button>
      <div id="jv-siri-liste" style="margin-top:8px"></div>
    </div>
  `;

  container.querySelector('#jv-siri-neu-btn').addEventListener('click', () => {
    const { body, close } = openModal({
      title: 'Neues Gerätetoken erstellen',
      bodyHtml: `
        <form id="jv-siri-form">
          <div class="field"><label>Bezeichnung (z.B. "iPhone Danny")</label><input name="label" required placeholder="iPhone Danny"></div>
          <div class="field"><label>Gültig für wie viele Tage?</label><input type="number" name="tage" value="90" min="1" max="365"></div>
          <div class="field" style="margin-top:8px"><label>Erlaubte Abfragen</label>
            ${Object.entries(SIRI_INTENT_LABELS).map(([id, label]) => `
              <label style="display:flex;align-items:center;gap:6px;font-weight:400;margin-top:4px"><input type="checkbox" name="intent" value="${id}" checked> ${escapeHtml(label)}</label>
            `).join('')}
          </div>
          <div class="modal-actions">
            <span class="spacer"></span>
            <button type="button" class="btn" id="jv-siri-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Erstellen</button>
          </div>
        </form>
      `,
    });
    body.querySelector('#jv-siri-cancel').addEventListener('click', close);
    body.querySelector('#jv-siri-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const label = String(fd.get('label') || '').trim();
      const tage = Number(fd.get('tage')) || 90;
      const erlaubteIntents = [...body.querySelectorAll('input[name="intent"]:checked')].map((el) => el.value);
      if (!erlaubteIntents.length) { toast('Mindestens eine erlaubte Abfrage auswählen.', 'danger'); return; }
      const rawToken = erzeugeZufallsToken();
      const hash = await sha256HexBrowser(rawToken);
      const ablaufAm = new Date(Date.now() + tage * 86400000).toISOString().slice(0, 10);
      await put('siriGeraeteTokens', {
        id: hash, label, erlaubteIntents, erstelltAm: new Date().toISOString(), ablaufAm, widerrufenAm: null,
        letzteNutzungAm: null, anzeigeSuffix: rawToken.slice(-6), erstelltVonUid: erstellerUid,
      });
      close();
      const { body: tokenBody, close: closeToken } = openModal({
        title: 'Gerätetoken erstellt - jetzt kopieren!',
        bodyHtml: `
          <p class="hint">⚠️ Dieses Token wird NUR JETZT angezeigt und nirgends im Klartext gespeichert. Jetzt in den iOS-Kurzbefehl eintragen - danach lässt es sich nicht erneut anzeigen (nur widerrufen und neu erstellen).</p>
          <div class="field"><label>Gerätetoken</label><input readonly id="jv-siri-token-wert" value="${escapeHtml(rawToken)}" style="font-family:monospace;font-size:12px" onclick="this.select()"></div>
          <div class="modal-actions">
            <span class="spacer"></span>
            <button type="button" class="btn btn-primary" id="jv-siri-token-schliessen">Verstanden, gespeichert</button>
          </div>
        `,
      });
      tokenBody.querySelector('#jv-siri-token-schliessen').addEventListener('click', closeToken);
      toast('Gerätetoken erstellt.', 'success');
      ladeTokenListe();
    });
  });

  ladeTokenListe();
}

// =============================================================================
// JARVIS STATUS (Phase 10 Punkt 5) - zentrale Pilotüberwachungs-Anzeige:
// Dienste, letzter erfolgreicher Cron-Lauf je Job, API-Verbindungsfehler,
// offene/unklare Aktionen, KI-Kosten, Feature-Flags, letzte erfolgreiche
// Synchronisierung. WICHTIG: ein fehlgeschlagener Lauf wird NIEMALS als
// erfolgreich angezeigt (siehe worker.js holeJarvisStatusUebersicht -
// "letzterErfolgAm" kommt ausschließlich aus Jobs mit status "done").
// =============================================================================

const JOB_TYP_LABEL = {
  'email-check': 'E-Mail-Check', 'rechnung-check': 'Rechnungs-Check', 'mahnung-check': 'Mahnungs-Check',
  'wartung-check': 'Wartungs-Check', 'projekt-check': 'Projekt-Check', 'control-check': 'CONTROL-Check',
};
const FEATURE_FLAG_LABEL = {
  JARVIS_EMAIL_AKTIV: 'Autonomer E-Mail-Check', JARVIS_ANGEBOT_AKTIV: 'Autonome Angebotsentwürfe',
  JARVIS_RECHNUNG_AKTIV: 'Autonome Rechnungsentwürfe', JARVIS_MAHNUNG_AKTIV: 'Autonome Mahnentwürfe',
  JARVIS_WARTUNG_AKTIV: 'Autonome Wartungsvorschläge', JARVIS_PROJEKT_AKTIV: 'Autonome Projekthinweise',
  JARVIS_CONTROL_AKTIV: 'Autonomer CONTROL-Check', JARVIS_TAGESCHECK_AKTIV: 'Autonomer täglicher Büro-Check',
};
const JOB_STATUS_BADGE = {
  done: '<span class="badge badge-success">erfolgreich</span>',
  failed: '<span class="badge badge-danger">fehlgeschlagen</span>',
  running: '<span class="badge badge-accent">läuft gerade</span>',
  unklar: '<span class="badge badge-danger">unklar - prüfen!</span>',
  noch_nie_gelaufen: '<span class="badge badge-warn">noch nie gelaufen</span>',
};

function statusZeile(label, ok) {
  return `<div class="flex-row" style="justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-color,#eee)">
    <span>${escapeHtml(label)}</span><span>${ok ? '✅' : '❌'}</span>
  </div>`;
}

async function renderStatus(container) {
  container.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="flex-row" style="justify-content:space-between;align-items:center">
        <h2 style="font-size:14px;margin:0">📊 Pilotüberwachung</h2>
        <button type="button" class="btn btn-sm" id="jv-status-reload">🔄 Aktualisieren</button>
      </div>
      <p class="hint">Rein lesend - zeigt NIEMALS Secret-Werte, nur ob eine Anbindung eingerichtet ist. Ein fehlgeschlagener Lauf wird hier nie als erfolgreich dargestellt.</p>
      <div id="jv-status-inhalt"><p class="text-mute">Lade …</p></div>
    </div>
  `;

  async function laden() {
    const zielEl = container.querySelector('#jv-status-inhalt');
    zielEl.innerHTML = '<p class="text-mute">Lade …</p>';
    try {
      const s = await holeJarvisStatus();
      zielEl.innerHTML = `
        <h3 style="font-size:13px">Dienste</h3>
        ${statusZeile('Anthropic-API-Schlüssel konfiguriert', s.dienste.anthropicKonfiguriert)}
        ${statusZeile('Firebase-Service-Account konfiguriert', s.dienste.firebaseKonfiguriert)}
        ${statusZeile('Google-Büro-Anbindung (Service Binding/URL)', s.dienste.googleBueroBindingVorhanden)}
        ${statusZeile('KI-Bürokraft-Anbindung (Service Binding/URL)', s.dienste.kiBuerokraftBindingVorhanden)}
        ${statusZeile('Google-Konto verbunden (Gmail/Kalender)', s.dienste.googleKontoVerbunden)}
        ${statusZeile('Rate-Limiter konfiguriert (sonst sperren sich /kunde-upload und /siri-abfrage selbst)', s.dienste.rateLimiterKonfiguriert)}

        <h3 style="font-size:13px;margin-top:14px">Letzte Cron-Läufe</h3>
        <table class="data-table" style="width:100%">
          <thead><tr><th>Job</th><th>Letzter Versuch</th><th>Zeitpunkt</th><th>Letzter ERFOLG</th></tr></thead>
          <tbody>
            ${s.cronLaeufe.map((j) => `
              <tr>
                <td>${escapeHtml(JOB_TYP_LABEL[j.typ] || j.typ)}</td>
                <td>${JOB_STATUS_BADGE[j.letzterVersuchStatus] || escapeHtml(j.letzterVersuchStatus)}${j.letzterFehler ? `<div class="text-mute" style="font-size:11px">${escapeHtml(j.letzterFehler)}</div>` : ''}</td>
                <td>${j.letzterVersuchAm ? formatDateTime(j.letzterVersuchAm) : '–'}</td>
                <td>${j.letzterErfolgAm ? formatDateTime(j.letzterErfolgAm) : '<span class="text-mute">noch nie</span>'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
        <p class="text-mute" style="font-size:12px">Letzte erfolgreiche Synchronisierung insgesamt: ${s.letzteErfolgreicheSynchronisierungAm ? formatDateTime(s.letzteErfolgreicheSynchronisierungAm) : 'noch keine'}</p>

        <h3 style="font-size:13px;margin-top:14px">Aktionen</h3>
        <p>Offen: <strong>${s.offeneAktionen}</strong> · Unklar (Absturz-Verdacht, manuell prüfen): <strong style="${s.unklareAktionen > 0 ? 'color:var(--danger-color,#c0392b)' : ''}">${s.unklareAktionen}</strong></p>

        <h3 style="font-size:13px;margin-top:14px">KI-Kosten (${escapeHtml(s.kiKosten.monat)})</h3>
        <p>${s.kiKosten.geschaetzteKostenUsd.toFixed(2)} USD geschätzt${s.kiKosten.limitUsd ? ` von ${s.kiKosten.limitUsd} USD Limit` : ' (kein Limit gesetzt)'}</p>

        <h3 style="font-size:13px;margin-top:14px">Feature-Flags (autonome Funktionen)</h3>
        ${Object.entries(s.featureFlags).map(([flag, aktiv]) => statusZeile(FEATURE_FLAG_LABEL[flag] || flag, aktiv)).join('')}

        <h3 style="font-size:13px;margin-top:14px">Letzte API-Verbindungsfehler</h3>
        ${s.apiVerbindungsfehler.length === 0 ? '<p class="text-mute">Keine.</p>' : `
          <ul class="cal-event-list">
            ${s.apiVerbindungsfehler.map((e) => `<li><strong>${escapeHtml(e.quelle)}</strong><div class="text-mute" style="font-size:12px">${formatDateTime(e.zeitstempel)} - ${escapeHtml(e.fehler)}</div></li>`).join('')}
          </ul>`}
      `;
    } catch (err) {
      zielEl.innerHTML = `<p class="hint">${escapeHtml(err.message)}</p>`;
    }
  }

  container.querySelector('#jv-status-reload').addEventListener('click', laden);
  await laden();
}

// =============================================================================
// JARVIS-Chat (seit Phase 1 unverändert, nur in eine eigene Funktion
// verschoben, damit die neue Zentrale als zweiter Tab danebensteht).
// =============================================================================
async function renderChat(container, uid) {
  const voiceInputSupported = isVoiceRecordingSupported();
  const voiceOutputSupported = !!window.speechSynthesis;
  let sprachausgabeAn = (() => { try { return localStorage.getItem(SPRACHAUSGABE_KEY) === '1'; } catch { return false; } })();

  // Gesprächsverlauf: EIN fortlaufendes Dokument je Firebase-Nutzer (siehe
  // firestore.rules jarvisGespraeche - Dokument-ID = uid, damit "eigene
  // Unterhaltung lesen/schreiben" ein einfacher direkter get()/put() bleibt
  // statt einer Query mit Listenrecht. Bewusst uid statt mitarbeiterId, da
  // nicht jeder Nutzer - insbesondere ein admin ohne eigenen Mitarbeiter-
  // Datensatz - zwingend ein mitarbeiterId hat).
  let gespraech = await get('jarvisGespraeche', uid);
  let verlauf = gespraech?.nachrichten || [];

  async function speichereVerlauf() {
    await put('jarvisGespraeche', {
      id: uid, uid, nachrichten: verlauf,
      aktualisiertAm: new Date().toISOString(),
    });
  }

  container.innerHTML = `
    <div class="actions" style="margin-bottom:8px">
      ${verlauf.length > 0 ? '<button type="button" class="btn btn-sm" id="jv-clear">Verlauf löschen</button>' : ''}
      ${voiceOutputSupported ? `<button type="button" class="btn btn-sm" id="jv-voice-toggle">${sprachausgabeAn ? '🔊 Sprachausgabe an' : '🔇 Sprachausgabe aus'}</button>` : ''}
    </div>
    <p class="hint">JARVIS nutzt dieselbe KI-Bürokraft-Anbindung wie bisher der KI-Assistent, prüft jetzt aber bei jedem Aufruf serverseitig deinen Login und deine Rolle. Aktuell nur für admin freigegeben. Schreibende Aktionen mit Außenwirkung (Versand, verbindliche Termine) erfordern weiterhin eine ausdrückliche Freigabe in Werkora selbst.</p>
    <div class="card">
      <div class="ka-list" id="jv-list"></div>
      <form id="jv-form" class="tc-input-row">
        <textarea id="jv-input" placeholder="Frag JARVIS, z.B. „Erstelle mir eine Tagesübersicht“" rows="2"></textarea>
        ${voiceInputSupported ? `<button type="button" class="btn" id="jv-mic" title="Reinsprechen">🎤</button>` : ''}
        <button type="submit" class="btn btn-primary" id="jv-send">Senden</button>
      </form>
    </div>
  `;

  const listEl = container.querySelector('#jv-list');
  const formEl = container.querySelector('#jv-form');
  const inputEl = container.querySelector('#jv-input');
  const sendBtn = container.querySelector('#jv-send');
  const micBtn = container.querySelector('#jv-mic');
  const voiceToggleBtn = container.querySelector('#jv-voice-toggle');
  const clearBtn = container.querySelector('#jv-clear');

  function renderZeile(text) {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  function renderListe() {
    if (verlauf.length === 0) {
      listEl.innerHTML = '<p class="text-mute">Noch kein Gespräch. Stell einfach eine Frage oder gib einen Auftrag.</p>';
      return;
    }
    listEl.innerHTML = verlauf.map((m) => `
      <div class="ka-msg ka-msg-${m.role}">
        <div class="tc-msg-head"><strong>${m.role === 'user' ? 'Du' : 'JARVIS'}</strong></div>
        <div class="tc-msg-text">${renderZeile(m.content)}</div>
      </div>
    `).join('');
    listEl.scrollTop = listEl.scrollHeight;
  }

  function setDenktNach(an) {
    let el = listEl.querySelector('.ka-thinking');
    if (an) {
      if (el) return;
      el = document.createElement('div');
      el.className = 'ka-msg ka-msg-assistant ka-thinking';
      el.innerHTML = '<div class="tc-msg-text text-mute">Denkt nach …</div>';
      listEl.appendChild(el);
      listEl.scrollTop = listEl.scrollHeight;
    } else if (el) {
      el.remove();
    }
  }

  renderListe();

  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text) return;

    verlauf.push({ role: 'user', content: text });
    renderListe();
    inputEl.value = '';
    inputEl.disabled = true;
    sendBtn.disabled = true;
    setDenktNach(true);

    try {
      const result = await chatMitJarvis({ messages: verlauf });
      setDenktNach(false);
      if (result.error) {
        verlauf.push({ role: 'assistant', content: `Fehler: ${result.error}` });
      } else {
        const antwort = result.reply || '(keine Antwort)';
        verlauf.push({ role: 'assistant', content: antwort });
        if (sprachausgabeAn) {
          try { sprich(antwort); } catch { /* Sprachausgabe ist nur ein Zusatz */ }
        }
      }
      await speichereVerlauf();
    } catch (err) {
      setDenktNach(false);
      verlauf.push({ role: 'assistant', content: `Fehler: ${err.message}` });
    } finally {
      renderListe();
      inputEl.disabled = false;
      sendBtn.disabled = false;
      inputEl.focus();
    }
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      formEl.requestSubmit();
    }
  });

  voiceToggleBtn?.addEventListener('click', () => {
    sprachausgabeAn = !sprachausgabeAn;
    try { localStorage.setItem(SPRACHAUSGABE_KEY, sprachausgabeAn ? '1' : '0'); } catch { /* Speicher evtl. nicht verfügbar */ }
    voiceToggleBtn.textContent = sprachausgabeAn ? '🔊 Sprachausgabe an' : '🔇 Sprachausgabe aus';
    if (!sprachausgabeAn) window.speechSynthesis?.cancel();
  });

  clearBtn?.addEventListener('click', async () => {
    verlauf = [];
    await speichereVerlauf();
    renderListe();
    toast('Verlauf gelöscht', 'success');
  });

  if (micBtn) {
    const SpeechRecognitionCtor = getSpeechRecognitionCtor();
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'de-DE';
    recognition.continuous = false;
    recognition.interimResults = false;
    let laeuft = false;

    recognition.addEventListener('result', (e) => {
      const transcript = e.results[0]?.[0]?.transcript?.trim();
      if (transcript) {
        inputEl.value = transcript;
        formEl.requestSubmit();
      }
    });
    recognition.addEventListener('error', (e) => {
      if (e.error !== 'aborted' && e.error !== 'no-speech') {
        toast(`Spracherkennung fehlgeschlagen: ${e.error}`, 'danger');
      }
    });
    recognition.addEventListener('end', () => {
      laeuft = false;
      micBtn.classList.remove('is-recording');
      micBtn.textContent = '🎤';
    });

    micBtn.addEventListener('click', () => {
      if (laeuft) {
        recognition.stop();
        return;
      }
      window.speechSynthesis?.cancel();
      laeuft = true;
      micBtn.classList.add('is-recording');
      micBtn.textContent = '⏹️';
      try {
        recognition.start();
      } catch {
        laeuft = false;
        micBtn.classList.remove('is-recording');
        micBtn.textContent = '🎤';
      }
    });
  }
}
