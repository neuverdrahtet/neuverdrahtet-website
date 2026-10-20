import { chatMitJarvis, holeJarvisZentrale, sendeJarvisFreigabe, holeJarvisTagesbericht } from '../ai.js';
import { escapeHtml, toast, formatDateTime } from '../utils.js';
import { isVoiceRecordingSupported, getSpeechRecognitionCtor } from '../voicenote.js';
import { getSession } from '../auth.js';
import { FIREBASE_ENABLED } from '../employeeAuth.js';
import { get, put } from '../db.js';

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
                    ${['angebot', 'rechnung'].includes(k.typ) ? `<button type="button" class="btn btn-sm jv-bearbeiten" data-typ="${k.typ}" data-idx="${i}" data-kat="${k.key}">✏️ Bearbeiten</button>` : ''}
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

  async function bearbeiten(typ, kat, idx) {
    const item = holeItem(kat, idx);
    if (!item) return;
    const aktuellePositionen = JSON.stringify(item.positionen || item.items || [], null, 2);
    const neueEingabe = window.prompt('Positionen als JSON bearbeiten (article_id, title, unit, quantity, unit_price_net, vat_rate):', aktuellePositionen);
    if (neueEingabe === null) return;
    let neuePositionen;
    try {
      neuePositionen = JSON.parse(neueEingabe);
    } catch {
      toast('Ungültiges JSON.', 'danger');
      return;
    }
    const entityId = entityIdVon(typ, item);
    try {
      await sendeJarvisFreigabe({ typ: `${typ}.bearbeiten`, entityId, payload: { erwarteteVersion: item.version ?? 1, neuePositionen } });
      toast('Entwurf aktualisiert - erneute Prüfung/Freigabe erforderlich.', 'success');
      await renderZentrale(container);
    } catch (err) {
      toast(err.message, 'danger');
    }
  }

  container.querySelectorAll('.jv-freigeben').forEach((btn) => btn.addEventListener('click', () => entscheide(btn.dataset.typ, btn.dataset.kat, Number(btn.dataset.idx), 'freigeben')));
  container.querySelectorAll('.jv-ablehnen').forEach((btn) => btn.addEventListener('click', () => entscheide(btn.dataset.typ, btn.dataset.kat, Number(btn.dataset.idx), 'ablehnen')));
  container.querySelectorAll('.jv-bearbeiten').forEach((btn) => btn.addEventListener('click', () => bearbeiten(btn.dataset.typ, btn.dataset.kat, Number(btn.dataset.idx))));

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
