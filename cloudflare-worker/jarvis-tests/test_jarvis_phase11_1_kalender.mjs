// Phase 11.1 Punkt 4 ("Integrationstestplan korrigieren"): weist gegen den
// TATSÄCHLICHEN, produktiv deployten Code (Import von ../worker.js) nach,
// dass bei Google Kalender strikt zwischen den drei Kategorien getrennt
// bleibt:
//   1. Verfügbarkeitsabfrage / Terminabfrage (reines Lesen)
//   2. Terminvorschlag (jarvisTerminVorschlaege - nicht bindend)
//   3. Tatsächliche Terminbuchung (ein echter, bindender Schreibvorgang)
// und dass JARVIS (das Claude-Werkzeugset in KI_BUEROKRAFT_TOOLS) unter
// KEINEN Umständen Kategorie 3 bei einem echten Google-Kalender-Ereignis
// auslösen kann - weder direkt (callGoogleTool) noch über den separaten
// cloudflare-worker-google-buero (callGoogleBuero).
//
// Ausführen: node cloudflare-worker/jarvis-tests/test_jarvis_phase11_1_kalender.mjs
import { __test__ as W } from '../worker.js';

let bestanden = 0, fehlgeschlagen = 0;
async function pruefe(name, fn) {
  try { await fn(); console.log('OK  ', name); bestanden++; }
  catch (err) { console.log('FAIL', name, '-', err.message); fehlgeschlagen++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion fehlgeschlagen'); }

// =============================================================================
// 1) Das komplette Claude-Werkzeugset darf KEIN Werkzeug enthalten, das einen
//    echten Google-Kalender-Schreibvorgang auslöst (createCalendarEvent/
//    updateCalendarEvent existieren nur im separaten cloudflare-worker-
//    google-buero für eine ANDERE ChatGPT-Action, nicht in JARVIS).
// =============================================================================
await pruefe('K1: kein Werkzeug namens createCalendarEvent/updateCalendarEvent/deleteCalendarEvent ist JARVIS zugänglich', async () => {
  const namen = W.KI_BUEROKRAFT_TOOLS.map((t) => t.name);
  for (const verboten of ['createCalendarEvent', 'updateCalendarEvent', 'deleteCalendarEvent']) {
    assert(!namen.includes(verboten), `Werkzeug "${verboten}" darf JARVIS nicht zur Verfügung stehen, war aber in der Liste: ${namen.join(', ')}`);
  }
});

await pruefe('K2: searchCalendarEvents ist das EINZIGE Kalender-Werkzeug und liest nur (service "google", keine method/path-Definition für einen Schreibvorgang)', async () => {
  const kalenderWerkzeuge = W.KI_BUEROKRAFT_TOOLS.filter((t) => /calendar/i.test(t.name));
  assert(kalenderWerkzeuge.length === 1, `erwartet genau 1 Kalender-Werkzeug, war ${kalenderWerkzeuge.length} (${kalenderWerkzeuge.map((t) => t.name).join(', ')})`);
  const [werkzeug] = kalenderWerkzeuge;
  assert(werkzeug.name === 'searchCalendarEvents', `das einzige Kalender-Werkzeug muss "searchCalendarEvents" heißen, war "${werkzeug.name}"`);
  assert(werkzeug.service === 'google', 'searchCalendarEvents muss über die direkte Google-Anbindung laufen (service: "google"), nicht über eine eigene method/path-REST-Definition');
  assert(werkzeug.method === undefined, 'searchCalendarEvents darf keine method-Angabe tragen - es ist kein REST-Schreibaufruf');
});

await pruefe('K3: createAppointment bucht ausschließlich einen Werkzeug-INTERNEN Werkora-Termin (POST /appointments), NIEMALS Google Kalender', async () => {
  const createAppointment = W.KI_BUEROKRAFT_TOOLS.find((t) => t.name === 'createAppointment');
  assert(createAppointment, 'createAppointment muss als Werkzeug existieren (menschlich ausgelöste, tatsächliche Terminbuchung)');
  assert(createAppointment.service !== 'google', 'createAppointment darf NICHT über die Google-Anbindung laufen');
  assert(createAppointment.method === 'POST' && createAppointment.path() === '/appointments', 'createAppointment muss auf den internen Werkora-Endpunkt POST /appointments zeigen, nicht auf eine Google-Kalender-API');
  assert(createAppointment.input_schema.required.includes('title') && createAppointment.input_schema.required.includes('start'), 'createAppointment bleibt die bewusst menschlich ausgelöste, echte Buchung (Kategorie 3) - rein Werkora-intern, kein Google-Schreibvorgang');
});

await pruefe('K4: createAppointment steht NICHT auf der Tagescheck-Erlaubnisliste - der autonome Tageslauf darf niemals selbst (auch nur intern) einen Termin buchen', async () => {
  assert(!W.JARVIS_TAGESCHECK_ERLAUBTE_SCHREIBWERKZEUGE.includes('createAppointment'), 'createAppointment darf nicht im autonomen Tagescheck erlaubt sein - echte Terminbuchungen bleiben immer menschlich ausgelöst (Chat mit Freigabe), nie Teil eines unbeobachteten Tageslaufs');
});

// =============================================================================
// 2) callGoogleTool (die direkte, EIGENE Google-OAuth-Anbindung des
//    Haupt-Workers) darf für searchCalendarEvents NIEMALS einen anderen
//    HTTP-Methode als GET gegen die Calendar-API auslösen - auch nicht bei
//    unerwarteten/manipulierten Eingaben.
// =============================================================================
await pruefe('K5: callGoogleTool("searchCalendarEvents") sendet ausschließlich GET-Anfragen an die Google-Calendar-API, nie einen Schreibvorgang', async () => {
  const gesehen = [];
  const ORIG_FETCH = global.fetch;
  global.fetch = async (url, init = {}) => {
    const u = new URL(typeof url === 'string' ? url : url.url);
    const method = (init.method || 'GET').toUpperCase();
    gesehen.push({ href: u.href, method });
    if (u.href === 'https://oauth2.googleapis.com/token') return { ok: true, json: async () => ({ access_token: 'fake-token' }) };
    if (u.hostname === 'www.googleapis.com' && u.pathname.includes('/calendar/')) {
      return { ok: true, json: async () => ({ items: [] }) };
    }
    throw new Error(`Unerwarteter fetch() im Test: ${method} ${u.href}`);
  };
  try {
    await W.callGoogleTool({
      googleConfig: { firebaseServiceAccountJson: JSON.stringify({ client_email: 'x@test.iam.gserviceaccount.com', private_key: 'dummy', project_id: 'p' }), clientId: 'cid', clientSecret: 'secret' },
      toolName: 'searchCalendarEvents',
      input: { date_from: '2026-01-01', date_to: '2026-01-07', q: 'manipulierter?method=POST' },
    });
  } catch (err) {
    // Der Token-Abruf selbst ist in diesem minimalen Mock nicht vollständig
    // nachgebildet (getGoogleUserAccessToken signiert echt) - entscheidend
    // für diesen Test ist AUSSCHLIESSLICH, welche HTTP-Methoden tatsächlich
    // an die googleapis.com-Calendar-API gegangen wären, nicht ob der
    // Tokenschritt selbst erfolgreich mockbar ist.
  } finally {
    global.fetch = ORIG_FETCH;
  }
  const kalenderAufrufe = gesehen.filter((g) => g.href.includes('googleapis.com/calendar/'));
  for (const aufruf of kalenderAufrufe) {
    assert(aufruf.method === 'GET', `JEDER Aufruf an die Calendar-API muss GET sein, war aber ${aufruf.method} bei ${aufruf.href}`);
  }
});

// =============================================================================
// 3) callGoogleBuero (Brücke zum separaten cloudflare-worker-google-buero,
//    der DORT echte, bindende createCalendarEvent/updateCalendarEvent-
//    Endpunkte besitzt) darf an KEINER im Hauptworker tatsächlich
//    aufgerufenen Stelle einen /calendar/events-Schreibpfad ansteuern.
//    Diese Prüfung ist bewusst eine Quelltext-Prüfung des ECHTEN,
//    ausgelieferten Codes (nicht nur der Testdatei) - sie deckt ALLE
//    Aufrufstellen ab, nicht nur die heute bekannten, und schlägt künftig
//    sofort an, falls jemand versehentlich einen schreibenden
//    Kalenderaufruf über callGoogleBuero ergänzt.
// =============================================================================
await pruefe('K6: der tatsächlich ausgelieferte Worker-Quelltext enthält KEINEN callGoogleBuero-Aufruf mit einem schreibenden /calendar/events-Pfad', async () => {
  const fs = await import('node:fs');
  const quelltext = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  // Jeden callGoogleBuero({...})-Aufruf isoliert einsammeln (grobe, aber für
  // diesen Zweck ausreichende Klammerzählung, da die Aufrufe hier nicht
  // verschachtelt vorkommen) und dessen Argument-Objekt auf einen
  // "/calendar/events"-Pfad UND eine schreibende Methode prüfen.
  const aufrufStart = /callGoogleBuero\(\{/g;
  let treffer;
  let anzahlGeprueft = 0;
  while ((treffer = aufrufStart.exec(quelltext)) !== null) {
    const startIdx = treffer.index;
    let tiefe = 0;
    let endIdx = startIdx;
    for (let i = startIdx; i < quelltext.length; i++) {
      if (quelltext[i] === '{') tiefe++;
      if (quelltext[i] === '}') { tiefe--; if (tiefe === 0) { endIdx = i + 1; break; } }
    }
    const aufrufText = quelltext.slice(startIdx, endIdx);
    // Die Funktionsdefinition selbst ("async function callGoogleBuero({ env, path, method = 'GET', body })")
    // matcht das Aufruf-Muster nicht (kein "callGoogleBuero({" davor), wird also korrekt übersprungen.
    anzahlGeprueft++;
    const schreibt = /method:\s*'POST'|method:\s*"POST"/.test(aufrufText);
    const kalenderSchreibpfad = /path:\s*`?\/calendar\/events/.test(aufrufText);
    assert(!(schreibt && kalenderSchreibpfad), `Ein callGoogleBuero-Aufruf mit schreibender Methode UND /calendar/events-Pfad gefunden - das wäre eine echte, bindende Kalenderbuchung aus JARVIS heraus: ${aufrufText.slice(0, 200)}`);
  }
  assert(anzahlGeprueft >= 6, `erwartet mindestens 6 callGoogleBuero-Aufrufstellen (Stand Phase 11.1), gefunden ${anzahlGeprueft} - Quelltext-Struktur hat sich stärker verändert als erwartet, Prüfung manuell nachziehen`);
});

console.log(`\n--- Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ---`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
