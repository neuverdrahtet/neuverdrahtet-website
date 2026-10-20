import { chatMitJarvis, holeJarvisZentrale, sendeJarvisFreigabe, holeJarvisTagesbericht, holeJarvisControl, holeJarvisWochenbericht } from '../ai.js';
import { escapeHtml, toast, formatDateTime } from '../utils.js';
import { isVoiceRecordingSupported, getSpeechRecognitionCtor } from '../voicenote.js';
import { getSession } from '../auth.js';
import { FIREBASE_ENABLED } from '../employeeAuth.js';
import { get, put } from '../db.js';
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
      return `Kunde: ${escapeHtml(item.kundeId || 'unbekannt')}${item.angebotId ? `<br>Angebotsentwurf: ${escapeHtml(item.angebotId)}` : ''}${(item.angebotFehlendeInfos || []).length ? `<br>Hinweise: ${escapeHtml(item.angebotFehlendeInfos.join(' | '))}` : ''}`;
    case 'angebot':
      return `Kunde: ${escapeHtml(item.kundeId || 'unbekannt')}${(item.letzteWarnungen || []).length ? `<br>Warnungen: ${escapeHtml(item.letzteWarnungen.join(' | '))}` : ''}`;
    case 'rechnung':
      return `Positionen: ${(item.positionen || []).length}${(item.fehlendeInfos || []).length ? `<br>Hinweise: ${escapeHtml(item.fehlendeInfos.join(' | '))}` : ''}${(item.bekannteAbschlaege || []).length ? `<br>Bekannte Abschläge: ${item.bekannteAbschlaege.length}` : ''}`;
    case 'mahnung':
      return `Kein Mahntext hinterlegt (noch zu ergänzen in Werkora) - nicht versendet.`;
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
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
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
  // unberührt). Kein Vorbefüllen mit dem aktuellen echten Mahntext, da die
  // Zentrale-Übersicht diesen (noch) nicht mit ausliefert - deshalb der
  // deutliche Hinweis im Formular.
  function oeffneMahnungFormular(entityId, erwarteteVersion) {
    const { body, close } = openModal({
      title: 'Mahntext bearbeiten',
      bodyHtml: `
        <form id="jv-mahn-form">
          <p class="hint">Der eingegebene Text ersetzt den Mahntext auf der echten Mahnung (rechnungId/Stufe/Frist bleiben unverändert). Es wird NICHTS versendet.</p>
          <div class="field"><label>Mahntext *</label><textarea name="text" rows="8" required placeholder="Mahntext eingeben …"></textarea></div>
          <div class="field"><label>Mahngebühr € (optional, leer lassen = unverändert)</label><input type="number" step="0.01" name="gebuehr"></div>
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
      oeffneMahnungFormular(entityId, erwarteteVersion);
    }
  }

  container.querySelectorAll('.jv-freigeben').forEach((btn) => btn.addEventListener('click', () => entscheide(btn.dataset.typ, btn.dataset.kat, Number(btn.dataset.idx), 'freigeben')));
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
