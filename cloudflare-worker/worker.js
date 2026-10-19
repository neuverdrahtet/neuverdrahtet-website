/**
 * neuverdrahtet Verwaltung – KI-Angebotserstellung + Fremdangebot-Import + Beleg-Scan + Push-Versand + GAEB-Preisrecherche + Social-Media-Post + KI-Assistent-Chat (Cloudflare Worker)
 *
 * Nimmt Stichpunkte entgegen und lässt Claude daraus strukturierte
 * Angebotspositionen erzeugen, liest wahlweise ein hochgeladenes fremdes
 * Angebot (PDF/Foto, z.B. von einem Mitbewerber) aus und übernimmt dessen
 * Positionen 1:1, analysiert ein fotografiertes Beleg-Bild und liefert
 * Händler/Datum/Betrag/Kategorie zurück, recherchiert für unbepreiste
 * GAEB-Positionen per Web-Search-Tool marktübliche Preise, erzeugt aus
 * einem Baustellen-/Projektfoto passende Social-Media-Texte je Kanal
 * (Instagram/Facebook/LinkedIn/Google Unternehmensprofil), erstellt aus
 * gesprochenen/diktierten Stichpunkten strukturierte Daten für neue Kunden,
 * Projekte, Termine oder Berichte/Protokolle ("Mit KI aus Sprache erstellen"
 * in den jeweiligen Ansichten, Action "entity-stichpunkte"), beantwortet als
 * interner KI-Assistent (Chat) Fragen zu den echten Firmendaten per
 * Tool-Use-Loop gegen die KI-Bürokraft-API, oder löst eine Firebase-Cloud-
 * Messaging-Push-Benachrichtigung an einzelne Geräte-Tokens aus. Zusätzlich
 * läuft einmal täglich morgens automatisch ein "Büro-Check" (Cloudflare Cron
 * Trigger, siehe scheduled()): dieselbe Tool-Loop wie der Chat prüft ohne
 * Mitarbeiter-Interaktion Aufgaben/Rechnungen/Termine/Leads, unvollständige
 * Belege (per bulkFixReceipts automatisch per KI ausgelesen und übernommen),
 * einen Soll-/Ist-Zeitvergleich (kalkulierte Std.-Positionen vs. echte
 * Zeiterfassung) sowie - falls eingerichtet - ungelesene E-Mails/Kalender-
 * termine (Gmail/Google Kalender, direkt in diesem Worker per eigenem
 * Google-OAuth angebunden, siehe unten), legt bei Bedarf neue Aufgaben an
 * und schickt danach eine Push-Benachrichtigung. Die Geheimnisse
 * (Anthropic-API-Key, Firebase-Service-Account, Google-OAuth-Client) bleiben
 * ausschließlich hier im Worker (als Secrets) – sie werden NIE an den
 * Browser geschickt.
 *
 * Die KI-Angebotserstellung nutzt dabei den mitgelieferten Katalog IMMER
 * zuerst - nur für Positionen ohne Katalogtreffer wird per Web-Search-Tool
 * ein echter aktueller Marktpreis recherchiert (Fallback: vorsichtige
 * Schätzung). Jede so recherchierte Position wird im Ergebnis markiert
 * (imKatalog:false + quelle), damit die Verwaltungs-Oberfläche sie deutlich
 * zur Prüfung kennzeichnet, statt sie unmarkiert zu übernehmen.
 *
 * Zusätzlich läuft, angehängt an denselben täglichen Cron Trigger, aber nur
 * montags (siehe scheduled()), eine automatische Katalog-Aktualisierung:
 * recherchiert für einen rotierenden Ausschnitt des bestehenden Artikel-/
 * Leistungskatalogs aktuelle Marktpreise und schlägt vereinzelt
 * offensichtlich fehlende Standardpositionen vor. Ändert dabei NIE direkt
 * den Katalog, sondern schreibt jedes Ergebnis nur als Vorschlag in die
 * Firestore-Collection "katalogVorschlaege" - ein Mensch prüft/übernimmt
 * sie in der Verwaltung unter Katalog -> "Preis-Vorschläge" (siehe
 * runKatalogAktualisierung()). Dafür wird zusätzlich
 * FIREBASE_SERVICE_ACCOUNT_JSON benötigt (ohnehin für
 * Push-Benachrichtigungen vorgesehen) - ohne dieses Secret läuft der
 * wöchentliche Teil einfach nicht, alle anderen Funktionen bleiben
 * unberührt. Bewusst EIN einziger Cron Trigger statt zwei separater:
 * Cloudflare Workers Free begrenzt Cron Trigger auf 5 PRO ACCOUNT (nicht
 * pro Worker) - ein zweiter Trigger würde den automatischen Deploy je nach
 * Kontostand mit "Workers Free limit of 5 cron triggers" scheitern lassen.
 *
 * Damit der tägliche Büro-Check (inkl. der montäglichen
 * Katalog-Aktualisierung) tatsächlich läuft, muss im Cloudflare-Dashboard
 * bei diesem Worker unter Settings -> Triggers -> Cron Triggers einmalig
 * ein Trigger hinzugefügt werden (z.B. "0 5 * * *" für ca. 6-7 Uhr
 * deutscher Zeit, je nach Sommer-/Winterzeit) - das lässt sich nicht per
 * Quick-Edit-Code allein einrichten (per "wrangler deploy", z.B. über den
 * GitHub-Actions-Workflow, passiert das automatisch).
 *
 * Deployment: siehe README.md in diesem Ordner.
 *
 * Benötigte Secrets/Variablen (Cloudflare Dashboard -> Worker -> Settings -> Variables):
 *   ANTHROPIC_API_KEY  (Secret, erforderlich) – dein Anthropic-API-Schlüssel
 *   APP_SECRET         (Secret, erforderlich) – frei wählbares Passwort, das
 *                        auch in der Verwaltungs-Software (Einstellungen) hinterlegt wird
 *   ALLOWED_ORIGINS     (Variable, optional) – Komma-getrennte Liste erlaubter
 *                        Herkünfte, Standard: https://neuverdrahtet.com,https://www.neuverdrahtet.com
 *   MODEL_ID            (Variable, optional) – Standard: claude-opus-4-8
 *                        (günstigere Alternative z.B. claude-haiku-4-5)
 *   FIREBASE_SERVICE_ACCOUNT_JSON (Secret, nur für Push-Benachrichtigungen/
 *                        Google-Büro-Anbindung nötig) – kompletter Inhalt
 *                        einer Firebase-Service-Account-JSON-Datei (Firebase-
 *                        Konsole -> Projekteinstellungen -> Dienstkonten ->
 *                        Neuen privaten Schlüssel generieren), als
 *                        einzeiliger String.
 *   KI_BUEROKRAFT_URL  (Variable, nur für den KI-Assistenten-Chat nötig) –
 *                        Basis-URL des cloudflare-worker-ki-buerokraft-Workers,
 *                        z.B. https://neuverdrahtet-ki-buerokraft.<konto>.workers.dev
 *   KI_BUEROKRAFT_API_KEY (Secret, nur für den KI-Assistenten-Chat nötig) –
 *                        derselbe API_KEY, den der KI-Bürokraft-Worker erwartet
 *                        (siehe cloudflare-worker-ki-buerokraft/README.md).
 *                        Ohne diese beiden Variablen läuft der Chat trotzdem,
 *                        kann dann aber keine echten Firmendaten abrufen.
 *
 *   Google-Büro-Anbindung (Gmail/Kalender, alles optional - ohne diese
 *   Variablen funktionieren alle anderen Funktionen unverändert, nur
 *   searchEmails/searchCalendarEvents bleiben aus):
 *   GOOGLE_OAUTH_CLIENT_ID     (Secret) – aus der Google-Cloud-Konsole
 *                        (OAuth-Client, Typ "Web-Anwendung").
 *   GOOGLE_OAUTH_CLIENT_SECRET (Secret) – aus derselben Stelle.
 *   OAUTH_SETUP_SECRET  (Secret, frei gewählt) – schützt /oauth/authorize
 *                        davor, dass jemand anderes die Google-Verbindung
 *                        kapert.
 *   GOOGLE_CALENDAR_ID  (Variable, optional) – Standard: "primary".
 *   In der Google-Cloud-Konsole muss beim OAuth-Client als "Autorisierte
 *   Weiterleitungs-URI" genau https://<diese-worker-url>/oauth/callback
 *   eingetragen sein. Einmalige Anmeldung danach: im Browser
 *   https://<diese-worker-url>/oauth/authorize?setup_key=<OAUTH_SETUP_SECRET>
 *   aufrufen und das neuverdrahtet-Google-Konto bestätigen.
 *
 *   Externer Kunden-Upload-Link (POST /kunde-upload, siehe handleKundenUpload
 *   unten und verwaltung/js/views/kunden.js "Upload-Link erstellen" +
 *   upload.html am Repo-Root) - braucht NUR das ohnehin vorhandene
 *   FIREBASE_SERVICE_ACCOUNT_JSON (muss Storage-Schreibrechte haben, hat das
 *   Standard-Firebase-Admin-Dienstkonto bereits). Optional zusätzlich:
 *   FIREBASE_STORAGE_BUCKET (Variable) – nur nötig, falls der Storage-Bucket
 *   NICHT dem Standard-Schema "<project_id>.firebasestorage.app" entspricht.
 *   RATE_LIMITER (Binding, siehe wrangler.toml [[ratelimits]]) wird beim
 *   Deploy automatisch angelegt, keine manuelle Einrichtung nötig.
 */

const DEFAULT_ALLOWED_ORIGINS = [
  'https://neuverdrahtet.com',
  'https://www.neuverdrahtet.com',
];

function getAllowedOrigins(env) {
  if (env.ALLOWED_ORIGINS) {
    return env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  }
  return DEFAULT_ALLOWED_ORIGINS;
}

function corsHeaders(origin, env) {
  const allowed = getAllowedOrigins(env);
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-App-Secret',
    'Vary': 'Origin',
  };
}

const POSITIONEN_SCHEMA = {
  type: 'object',
  properties: {
    betreff: { type: 'string' },
    einleitung: { type: 'string' },
    positionen: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          bezeichnung: { type: 'string' },
          beschreibung: { type: 'string' },
          einheit: { type: 'string' },
          menge: { type: 'number' },
          einzelpreis: { type: 'number' },
          steuersatz: { type: 'number' },
          imKatalog: { type: 'boolean' },
          quelle: { type: 'string' },
          annahme: { type: 'string' },
        },
        required: ['bezeichnung', 'beschreibung', 'einheit', 'menge', 'einzelpreis', 'steuersatz', 'imKatalog', 'quelle', 'annahme'],
        additionalProperties: false,
      },
    },
  },
  required: ['betreff', 'einleitung', 'positionen'],
  additionalProperties: false,
};

function buildSystemPrompt(standardSteuersatz, ort) {
  return `Du hilfst einem deutschen Elektro-Handwerksbetrieb (neuverdrahtet), aus kurzen Stichpunkten eines Mitarbeiters ein vollständiges, realistisches Angebot bzw. eine Rechnung mit Positionen zu erstellen. Diese Positionen werden sowohl für Angebote als auch für Rechnungen verwendet.
${ort ? `\nEinsatzort dieses Auftrags: ${ort}. Berücksichtige das bei der Internet-Preisrecherche unten, da Material-/Lohnpreise je nach Region unterschiedlich sein können (z.B. Großstadt vs. ländlicher Raum).\n` : ''}

Vollständigkeit der Leistungen - wie ein erfahrener Elektromeister denken:
- Leite aus den Stichpunkten das komplette, für eine fachgerechte Ausführung tatsächlich nötige Leistungsspektrum ab, nicht nur die wörtlich genannten Stichworte.
- Ergänze branchenübliche Begleitarbeiten, die zur genannten Aufgabe gehören, sofern fachlich sinnvoll, z.B.: Kabel verlegen/anschließen, Wand schlitzen und Schlitze verschließen/verputzen (bei Unterputz-Arbeiten im Bestand), Anschluss- und Funktionsprüfung, Beschriftung/Dokumentation, Entsorgung von Verpackung/Altmaterial, Anfahrt/Fahrzeit als eigene Position bei größeren Einsätzen.
- Trenne Material und Arbeitszeit/Lohn nach Möglichkeit in eigene Positionen (branchenübliche Praxis), statt beides in einer Pauschale zu vermischen - außer der Stichpunkt beschreibt ausdrücklich eine Pauschalleistung.
- Erfinde keine Leistungen, die thematisch nicht zur Anfrage passen (z.B. keine Photovoltaik ergänzen, wenn nur eine Steckdose gewünscht ist). Vollständigkeit heißt: den realistischen Umfang der genannten Aufgabe abbilden, nicht branchenfremde Zusatzverkäufe erfinden.

Realistische Preise (netto, Deutschland) als Orientierung, wenn kein Katalogtreffer existiert - an Umfang/Komplexität der jeweiligen Position anpassen, nicht immer denselben Wert nehmen:
- Facharbeiter-Stundensatz Elektroinstallation: ca. 65-95 EUR/Std. (einfache Standardarbeiten eher 65-75, komplexere/Spezialarbeiten eher 85-95).
- Hilfsarbeiten/Auszubildende: ca. 35-50 EUR/Std.
- Anfahrt/Fahrzeit: wie Arbeitszeit oder als Pauschale 20-50 EUR, je nach Entfernung/Aufwand.
- Übliche Kleinteile/Material (Richtwerte inkl. Handelsspanne): Steckdose/Schalter UP-Serie 8-20 EUR/Stk., NYM-J-Kabel 3x1,5mm² ca. 1-2 EUR/m, 5x1,5mm² ca. 2-3 EUR/m, Leitungsschutzschalter (LS) 15-25 EUR/Stk., FI/RCD-Schutzschalter 40-90 EUR/Stk., kleine Unterverteilung (bis 12 Module) 150-350 EUR, einfache LED-Deckenleuchte 25-60 EUR/Stk., Rauchmelder 15-30 EUR/Stk.
- E-Check/Prüfung: ca. 80-180 EUR pauschal für eine Wohnung/kleines Gewerbeobjekt, je nach Umfang.
- Bei Unsicherheit lieber eine vorsichtige, plausible Schätzung innerhalb der genannten Rahmen als eine runde Zahl ohne Bezug.

Katalog zuerst, Internet-Recherche nur als Ergänzung:
- Nutze, wenn im mitgelieferten Katalog ein passender Artikel/eine passende Leistung existiert, dessen Bezeichnung, Einheit und Preis unverändert. Setze dafür "imKatalog": true und "quelle": "Katalog".
- Existiert für eine benötigte Position KEIN Katalogtreffer, nutze das web_search-Werkzeug, um einen echten, aktuellen Preis zu recherchieren. neuverdrahtet bezieht Material überwiegend aus Baumärkten (z.B. Hornbach, Bauhaus, OBI, toom) und Online-Händlern (z.B. Amazon, Obeta-Webshop, Voltimum, Contorion, Electronic-Star) - suche BEVORZUGT dort nach dem aktuellen Verkaufspreis. Hersteller-Websites/Fachgroßhändler nur ergänzend, falls dort kein Preis zu finden ist. Rate NICHT einfach ins Blaue aus eigenem Wissen. Setze dafür "imKatalog": false und "quelle" auf eine kurze Angabe, worauf sich der Preis stützt (z.B. Händlername), max. ca. 60 Zeichen.
- Nur falls die Recherche trotz Versuch keinen brauchbaren Treffer liefert, nutze als letzten Ausweg eine vorsichtige Schätzung anhand der folgenden Richtwerte, setze "imKatalog": false und "quelle": "Schätzung, keine Recherche möglich".
- Erfinde keine Quellen - "quelle" muss ehrlich wiedergeben, ob wirklich recherchiert wurde.

Richtwerte (netto, Deutschland) nur für den Fall, dass eine Recherche keinen Treffer liefert - an Umfang/Komplexität der jeweiligen Position anpassen, nicht immer denselben Wert nehmen:
- Facharbeiter-Stundensatz Elektroinstallation: ca. 65-95 EUR/Std. (einfache Standardarbeiten eher 65-75, komplexere/Spezialarbeiten eher 85-95).
- Hilfsarbeiten/Auszubildende: ca. 35-50 EUR/Std.
- Anfahrt/Fahrzeit: wie Arbeitszeit oder als Pauschale 20-50 EUR, je nach Entfernung/Aufwand.
- Übliche Kleinteile/Material (Richtwerte inkl. Handelsspanne): Steckdose/Schalter UP-Serie 8-20 EUR/Stk., NYM-J-Kabel 3x1,5mm² ca. 1-2 EUR/m, 5x1,5mm² ca. 2-3 EUR/m, Leitungsschutzschalter (LS) 15-25 EUR/Stk., FI/RCD-Schutzschalter 40-90 EUR/Stk., kleine Unterverteilung (bis 12 Module) 150-350 EUR, einfache LED-Deckenleuchte 25-60 EUR/Stk., Rauchmelder 15-30 EUR/Stk.
- E-Check/Prüfung: ca. 80-180 EUR pauschal für eine Wohnung/kleines Gewerbeobjekt, je nach Umfang.

Weitere Regeln:
- Antworte ausschließlich auf Deutsch.
- "einheit" ist z.B. "Std.", "Stk.", "m", "pauschal".
- "steuersatz" ist in der Regel ${standardSteuersatz} (Prozent, als Zahl ohne %-Zeichen), außer es gibt einen klaren fachlichen Grund für einen anderen Satz.
- "betreff" ist eine kurze, prägnante Überschrift (max. ca. 80 Zeichen).
- "einleitung" ist ein kurzer, freundlicher Einleitungssatz für das Anschreiben (1-2 Sätze).
- Wenn Mengenangaben fehlen, nimm eine plausible Menge anhand der Beschreibung (z.B. Kabellänge nach typischer Raumgröße), sonst eine sinnvolle Standardmenge (z.B. 1).
- "annahme": War die Menge, Material-/Ausführungsqualität oder der genaue Umfang einer Position nicht eindeutig aus den Stichpunkten ersichtlich, sodass du etwas annehmen musstest (z.B. welche Qualitätsklasse, welche Verlegeart, ob Vorarbeiten/Entsorgung enthalten sind) - beschreibe in max. ca. 100 Zeichen knapp, wovon du ausgegangen bist, z.B. "Standardqualität, gerade Verlegung, keine Durchbrüche". War die Position durch die Stichpunkte eindeutig vorgegeben (z.B. ein Katalogtreffer mit exakt passender Bezeichnung), lasse "annahme" als leeren String.`;
}

async function callClaude({ apiKey, model, stichpunkte, kundeName, katalog, standardSteuersatz, ort }) {
  const katalogText = (katalog || [])
    .slice(0, 200)
    .map((k) => `- ${k.bezeichnung} | Einheit: ${k.einheit || ''} | Preis netto: ${k.preis} EUR | USt: ${k.steuersatz}%`)
    .join('\n');

  const initialContent = [
    kundeName ? `Kunde: ${kundeName}` : null,
    'Stichpunkte des Mitarbeiters:',
    stichpunkte,
    katalogText ? `\nVerfügbarer Katalog (Artikel/Leistungen):\n${katalogText}` : null,
  ].filter(Boolean).join('\n\n');

  let messages = [{ role: 'user', content: initialContent }];
  let data;

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        system: buildSystemPrompt(standardSteuersatz || 19, ort),
        messages,
        // allowed_callers: ['direct'] ist nötig, damit auch günstigere Modelle
        // ohne Unterstützung für "programmatic tool calling" diesen
        // Tool-Aufruf ausführen können - siehe callClaudeGaebPreise.
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 20, allowed_callers: ['direct'] }],
        output_config: {
          format: { type: 'json_schema', schema: POSITIONEN_SCHEMA },
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Anthropic-API-Fehler (${res.status}): ${text.slice(0, 300)}`);
    }

    data = await res.json();
    if (data.stop_reason === 'refusal') {
      throw new Error('Die Anfrage wurde von Claude aus Sicherheitsgründen abgelehnt.');
    }
    if (data.stop_reason === 'pause_turn') {
      messages = [{ role: 'user', content: initialContent }, { role: 'assistant', content: data.content }];
      continue;
    }
    break;
  }

  const textBlock = (data.content || []).filter((b) => b.type === 'text').pop();
  if (!textBlock) {
    throw new Error('Keine Antwort erhalten.');
  }
  try {
    return JSON.parse(textBlock.text);
  } catch {
    const match = /\{[\s\S]*\}/.exec(textBlock.text);
    if (match) return JSON.parse(match[0]);
    throw new Error('Antwort der KI konnte nicht als JSON gelesen werden.');
  }
}

/**
 * Baut das Antwort-Schema für die Sprach-/Stichpunkte-Erfassung von Kunden,
 * Projekten, Terminen, Aufgaben und Berichten (jeweils "Mit KI aus Sprache
 * erstellen" in den entsprechenden Ansichten) - ein Anthropic-Aufruf pro
 * Erfassung, Enum-Listen (kundeId/gewerk/typ/zugewiesenAn) stammen aus den
 * bereits in der App vorhandenen Stammdaten, damit die KI niemals einen
 * erfundenen Datensatz referenziert.
 */
function buildEntityStichpunkteSchema(entityType, kontext) {
  if (entityType === 'kunde') {
    return {
      type: 'object',
      properties: {
        firma: { type: 'string' },
        ansprechpartner: { type: 'string' },
        strasse: { type: 'string' },
        plz: { type: 'string' },
        ort: { type: 'string' },
        telefon: { type: 'string' },
        email: { type: 'string' },
        notizen: { type: 'string' },
        istPrivatperson: { type: 'boolean' },
      },
      required: ['firma', 'ansprechpartner', 'strasse', 'plz', 'ort', 'telefon', 'email', 'notizen', 'istPrivatperson'],
      additionalProperties: false,
    };
  }
  if (entityType === 'projekt') {
    const kundenIds = (kontext?.kunden || []).map((k) => k.id);
    const gewerkeIds = (kontext?.gewerke || []).map((g) => g.id);
    return {
      type: 'object',
      properties: {
        titel: { type: 'string' },
        beschreibung: { type: 'string' },
        start: { type: 'string' },
        ende: { type: 'string' },
        kundeId: { type: 'string', enum: ['', ...kundenIds] },
        gewerk: { type: 'string', enum: ['', ...gewerkeIds] },
      },
      required: ['titel', 'beschreibung', 'start', 'ende', 'kundeId', 'gewerk'],
      additionalProperties: false,
    };
  }
  if (entityType === 'termin') {
    const kundenIds = (kontext?.kunden || []).map((k) => k.id);
    const typIds = (kontext?.typen || []).map((t) => t.id);
    return {
      type: 'object',
      properties: {
        titel: { type: 'string' },
        datum: { type: 'string' },
        uhrzeit: { type: 'string' },
        ort: { type: 'string' },
        notizen: { type: 'string' },
        kundeId: { type: 'string', enum: ['', ...kundenIds] },
        typ: { type: 'string', enum: typIds.length ? typIds : [''] },
      },
      required: ['titel', 'datum', 'uhrzeit', 'ort', 'notizen', 'kundeId', 'typ'],
      additionalProperties: false,
    };
  }
  if (entityType === 'aufgabe') {
    const mitarbeiterIds = (kontext?.mitarbeiter || []).map((m) => m.id);
    const kundenIds = (kontext?.kunden || []).map((k) => k.id);
    const projektIds = (kontext?.projekte || []).map((p) => p.id);
    return {
      type: 'object',
      properties: {
        titel: { type: 'string' },
        beschreibung: { type: 'string' },
        faelligAm: { type: 'string' },
        prioritaet: { type: 'string', enum: ['niedrig', 'normal', 'hoch'] },
        zugewiesenAn: { type: 'string', enum: ['', ...mitarbeiterIds] },
        kundeId: { type: 'string', enum: ['', ...kundenIds] },
        projektId: { type: 'string', enum: ['', ...projektIds] },
      },
      required: ['titel', 'beschreibung', 'faelligAm', 'prioritaet', 'zugewiesenAn', 'kundeId', 'projektId'],
      additionalProperties: false,
    };
  }
  if (entityType === 'bericht') {
    return {
      type: 'object',
      properties: {
        text: { type: 'string' },
        raeume: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              raum: { type: 'string' },
              beschreibung: { type: 'string' },
              laenge: { type: 'string' },
              breite: { type: 'string' },
              hoehe: { type: 'string' },
            },
            required: ['raum', 'beschreibung', 'laenge', 'breite', 'hoehe'],
            additionalProperties: false,
          },
        },
      },
      required: ['text', 'raeume'],
      additionalProperties: false,
    };
  }
  throw new Error(`Unbekannter entityType: ${entityType}`);
}

function buildEntityStichpunktePrompt(entityType, heute, kontext) {
  if (entityType === 'kunde') {
    return `Du liest aus kurzen Stichpunkten oder einer gesprochenen Beschreibung eines Mitarbeiters eines deutschen Elektro-Handwerksbetriebs (neuverdrahtet) die Stammdaten EINES NEUEN Kunden heraus.

Regeln:
- Antworte ausschließlich auf Deutsch, erfinde KEINE Angaben, die nicht genannt wurden - lieber ein Feld leer lassen als zu raten.
- "firma": Firmenname, oder bei einer Privatperson der vollständige Name.
- "ansprechpartner": nur befüllen, wenn zusätzlich zur Firma eine separate Kontaktperson genannt wird.
- "istPrivatperson": true nur, wenn klar eine Privatperson gemeint ist (kein Unternehmen).
- "strasse"/"plz"/"ort": Adresse, so genau wie genannt.
- "telefon"/"email": wie genannt, keine Formatierung erfinden.
- "notizen": alles Weitere, was zum Kunden gesagt wurde und in kein anderes Feld passt.`;
  }
  if (entityType === 'projekt') {
    const kundenListe = (kontext?.kunden || []).map((k) => `- ${k.id}: ${k.firma}`).join('\n') || '(keine Kunden vorhanden)';
    const gewerkeListe = (kontext?.gewerke || []).map((g) => `- ${g.id}: ${g.titel}`).join('\n') || '(keine Gewerke hinterlegt)';
    return `Du liest aus kurzen Stichpunkten oder einer gesprochenen Beschreibung eines Mitarbeiters eines deutschen Elektro-Handwerksbetriebs (neuverdrahtet) die Daten für EIN NEUES Projekt/einen neuen Auftrag heraus.

Heutiges Datum: ${heute}. Löse relative Datumsangaben ("morgen", "nächste Woche", "ab Montag") darauf auf.

Bereits vorhandene Kunden (für "kundeId" GENAU eine dieser IDs verwenden, wenn der genannte Kunde eindeutig zu einem davon passt, sonst leeren String zurückgeben):
${kundenListe}

Verfügbare Gewerke (für "gewerk" GENAU eine dieser IDs verwenden, wenn eindeutig passend, sonst leeren String):
${gewerkeListe}

Regeln:
- Antworte ausschließlich auf Deutsch, erfinde KEINE Angaben, die nicht genannt wurden.
- "titel": kurzer, prägnanter Projekttitel.
- "beschreibung": alles Weitere zum Projekt/Auftrag als Fließtext.
- "start"/"ende": Datum im Format YYYY-MM-DD, "ende" nur bei mehrtägigen Projekten angeben, sonst leer.
- "kundeId": wie oben beschrieben - NUR eine der gelisteten IDs oder leer, niemals einen Namen eintragen.
- "gewerk": wie oben beschrieben - NUR eine der gelisteten IDs oder leer.`;
  }
  if (entityType === 'termin') {
    const kundenListe = (kontext?.kunden || []).map((k) => `- ${k.id}: ${k.firma}`).join('\n') || '(keine Kunden vorhanden)';
    const typenListe = (kontext?.typen || []).map((t) => `- ${t.id}: ${t.titel}`).join('\n') || '(keine Terminarten hinterlegt)';
    return `Du liest aus kurzen Stichpunkten oder einer gesprochenen Beschreibung eines Mitarbeiters eines deutschen Elektro-Handwerksbetriebs (neuverdrahtet) die Daten für EINEN NEUEN Termin heraus.

Heutiges Datum: ${heute}. Löse relative Datums-/Zeitangaben ("morgen", "übermorgen", "nächsten Montag", "in zwei Wochen") darauf auf.

Bereits vorhandene Kunden (für "kundeId" GENAU eine dieser IDs verwenden, wenn eindeutig passend, sonst leeren String zurückgeben):
${kundenListe}

Verfügbare Terminarten (für "typ" GENAU eine dieser IDs verwenden, wenn eindeutig passend, sonst leeren String):
${typenListe}

Regeln:
- Antworte ausschließlich auf Deutsch, erfinde KEINE Angaben, die nicht genannt wurden.
- "titel": kurzer, prägnanter Titel des Termins.
- "datum": Format YYYY-MM-DD - Pflichtfeld, bei fehlender Angabe das heutige Datum verwenden.
- "uhrzeit": Format HH:MM (24h), leer lassen falls keine Uhrzeit genannt wurde.
- "ort": Adresse/Ort, falls genannt, sonst leer.
- "notizen": alles Weitere zum Termin, das in kein anderes Feld passt.
- "kundeId"/"typ": wie oben beschrieben - NUR eine der gelisteten IDs oder leer.`;
  }
  if (entityType === 'aufgabe') {
    const mitarbeiterListe = (kontext?.mitarbeiter || []).map((m) => `- ${m.id}: ${m.name}`).join('\n') || '(keine Mitarbeiter hinterlegt)';
    const kundenListe = (kontext?.kunden || []).map((k) => `- ${k.id}: ${k.firma}`).join('\n') || '(keine Kunden vorhanden)';
    const projekteListe = (kontext?.projekte || []).map((p) => `- ${p.id}: ${p.titel}`).join('\n') || '(keine Projekte vorhanden)';
    return `Du liest aus kurzen Stichpunkten oder einer gesprochenen Beschreibung eines Mitarbeiters eines deutschen Elektro-Handwerksbetriebs (neuverdrahtet) die Daten für EINE NEUE Aufgabe heraus.

Heutiges Datum: ${heute}. Löse relative Datumsangaben ("morgen", "bis Freitag", "nächste Woche") darauf auf.

Bereits vorhandene Mitarbeiter (für "zugewiesenAn" GENAU eine dieser IDs verwenden, wenn eindeutig genannt, sonst leeren String zurückgeben):
${mitarbeiterListe}

Bereits vorhandene Kunden (für "kundeId" GENAU eine dieser IDs verwenden, wenn eindeutig passend, sonst leeren String):
${kundenListe}

Bereits vorhandene Projekte (für "projektId" GENAU eine dieser IDs verwenden, wenn eindeutig passend, sonst leeren String):
${projekteListe}

Regeln:
- Antworte ausschließlich auf Deutsch, erfinde KEINE Angaben, die nicht genannt wurden.
- "titel": kurzer, prägnanter Titel der Aufgabe.
- "beschreibung": alles Weitere zur Aufgabe als Fließtext.
- "faelligAm": Datum im Format YYYY-MM-DD, leer lassen falls keine Frist genannt wurde.
- "prioritaet": "niedrig"/"normal"/"hoch" - "normal" als Standard, falls keine Dringlichkeit genannt wird.
- "zugewiesenAn"/"kundeId"/"projektId": wie oben beschrieben - NUR eine der gelisteten IDs oder leer.`;
  }
  if (entityType === 'bericht') {
    return `Du hilfst, aus einer gesprochenen/diktierten Beschreibung eines Mitarbeiters eines deutschen Elektro-Handwerksbetriebs (neuverdrahtet) den Inhalt für einen Bericht/ein Protokoll (z.B. Aufmaßprotokoll, Mängelprotokoll, Wartungsbericht) zu erstellen.

Regeln:
- Antworte ausschließlich auf Deutsch.
- "text": zusammenhängender, gut lesbarer Fließtext der ausgeführten Arbeiten/Beobachtungen - KEINE Anrede, KEIN Briefkopf, KEINE Grußformel (wird an anderer Stelle automatisch ergänzt).
- "raeume": NUR befüllen, wenn einzelne Räume mit Maßen genannt werden (z.B. "Wohnzimmer 5 mal 4 Meter, Höhe 2,50"). Je Zeile: "raum" (Bezeichnung), "beschreibung" (zusätzliche Notiz zur Zeile, sonst leer), "laenge"/"breite"/"hoehe" in Metern als Zahl-Text (z.B. "5" oder "2.5"), leer lassen falls eine Maßangabe fehlt. Werden keine Räume/Maße genannt, gib ein leeres Array zurück.`;
  }
  throw new Error(`Unbekannter entityType: ${entityType}`);
}

async function callClaudeEntityStichpunkte({ apiKey, model, entityType, stichpunkte, heute, kontext }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system: buildEntityStichpunktePrompt(entityType, heute, kontext),
      messages: [{ role: 'user', content: stichpunkte }],
      output_config: {
        format: { type: 'json_schema', schema: buildEntityStichpunkteSchema(entityType, kontext) },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Anthropic-API-Fehler (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  if (data.stop_reason === 'refusal') {
    throw new Error('Die Anfrage wurde von Claude aus Sicherheitsgründen abgelehnt.');
  }
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) {
    throw new Error('Keine Antwort erhalten.');
  }
  return JSON.parse(textBlock.text);
}

function buildAngebotImportSystemPrompt(standardSteuersatz) {
  return `Du liest ein fremdes Angebot/einen Kostenvoranschlag aus einem hochgeladenen PDF oder Foto aus und übernimmst dessen Positionen 1:1 in das gleiche strukturierte Format wie eigene Angebote. Das Dokument kann von einem Mitbewerber stammen (zum Preisvergleich) oder von einem Lieferanten/Großhändler/Partnerbetrieb (um dessen Positionen als Basis für ein eigenes Angebot zu übernehmen) - lies die Positionen in beiden Fällen gleich sorgfältig und unverändert aus.

Regeln:
- Antworte ausschließlich auf Deutsch.
- Übernimm NUR die Positionen, die im Dokument tatsächlich als einzelne Leistungs-/Materialzeilen aufgeführt sind - erfinde KEINE zusätzlichen Positionen und lasse keine sichtbare Position weg.
- "bezeichnung": kurzer Titel der Position, wie im Dokument.
- "beschreibung": ggf. vorhandener Zusatztext/Detailbeschreibung zur Position, sonst leer lassen.
- "einheit" ist z.B. "Std.", "Stk.", "m", "pauschal" - wie im Dokument angegeben oder sinngemäß übertragen.
- "menge" und "einzelpreis" (netto, ohne Währungssymbol) exakt wie im Dokument übernehmen. Ist nur ein Bruttopreis sichtbar, rechne mit dem erkannten bzw. dem Standard-Steuersatz (${standardSteuersatz}%) auf netto um.
- "steuersatz" wie im Dokument erkennbar, sonst ${standardSteuersatz} annehmen.
- "betreff": eine kurze Überschrift, die das Angebot beschreibt (z.B. aus einer Betreffzeile oder Projektbezeichnung im Dokument), sonst leer lassen.
- "einleitung": leer lassen (wird bei einem Import nicht benötigt).
- Ist das Dokument kein erkennbares Angebot mit Positionen (z.B. eine private Rechnung, ein unleserliches Foto), liefere eine leere "positionen"-Liste statt zu raten.`;
}

async function callClaudeAngebotImport({ apiKey, model, fileDataUrl, standardSteuersatz }) {
  const match = /^data:(image\/(?:png|jpe?g|webp)|application\/pdf);base64,(.+)$/.exec(fileDataUrl || '');
  if (!match) {
    throw new Error('Ungültiges Dateiformat (unterstützt: JPEG/PNG/WebP-Fotos oder PDF).');
  }
  const [, mediaType, base64Data] = match;
  const fileBlock = mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: mediaType, data: base64Data } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: buildAngebotImportSystemPrompt(standardSteuersatz || 19),
      messages: [{
        role: 'user',
        content: [
          fileBlock,
          { type: 'text', text: 'Übernimm die Positionen aus diesem fremden Angebot in das vorgegebene Format.' },
        ],
      }],
      output_config: {
        format: { type: 'json_schema', schema: POSITIONEN_SCHEMA },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Anthropic-API-Fehler (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  if (data.stop_reason === 'refusal') {
    throw new Error('Die Anfrage wurde von Claude aus Sicherheitsgründen abgelehnt.');
  }
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) {
    throw new Error('Keine Antwort erhalten.');
  }
  return JSON.parse(textBlock.text);
}

const BELEG_SCHEMA = {
  type: 'object',
  properties: {
    dokumenttyp: { type: 'string', enum: ['eingangsrechnung', 'ausgangsrechnung', 'mahnung', 'sonstiges'] },
    haendler: { type: 'string' },
    datum: { type: 'string' },
    betragNetto: { type: 'number' },
    betragBrutto: { type: 'number' },
    steuersatz: { type: 'number' },
    kategorie: { type: 'string' },
    kategorieSicher: { type: 'boolean' },
    beschreibung: { type: 'string' },
    lesbar: { type: 'boolean' },
  },
  required: ['dokumenttyp', 'haendler', 'datum', 'betragNetto', 'betragBrutto', 'steuersatz', 'kategorie', 'kategorieSicher', 'beschreibung', 'lesbar'],
  additionalProperties: false,
};

function buildBelegSystemPrompt(kategorien) {
  const liste = (kategorien && kategorien.length ? kategorien : ['Material', 'Werkzeug/Maschinen', 'Fahrzeug/Sprit', 'Miete', 'Versicherung', 'Büro/Verwaltung', 'Personal', 'Sonstiges']).join(', ');
  return `Du liest ein Dokument (fotografierter Kassenbon, PDF, XRechnung im XML-Format z.B. nach EN 16931/UBL/CII, oder ein sonstiges Schriftstück) für einen deutschen Handwerksbetrieb aus, das als "Ausgaben-Beleg" hochgeladen oder aus einer E-Mail übernommen wurde. Bei einer XRechnung stehen die Werte als strukturierte XML-Felder vor (z.B. "PayableAmount", "InvoicedQuantity", Verkäufer-/Käufer-Blöcke) statt als Bild - lies sie aus dem XML-Text statt aus einem Bild.

WICHTIG - nicht jedes hochgeladene Dokument ist tatsächlich eine Eingangsrechnung (ein eigener Einkauf/eine Ausgabe). Bestimme deshalb IMMER zuerst "dokumenttyp", bevor du die übrigen Felder befüllst:
- "eingangsrechnung": eine Rechnung/ein Kassenbon/Beleg, den der Betrieb selbst als Käufer/Kunde von einem Lieferanten/Dienstleister erhalten hat (ein echter eigener Einkauf/Kosten). NUR in diesem Fall sind Betrag/Kategorie für die Ausgaben-Erfassung wirklich gemeint.
- "ausgangsrechnung": eine vom Betrieb SELBST an einen eigenen Kunden gestellte Rechnung (z.B. eine Kopie/ein Anhang der eigenen Rechnung, erkennbar am eigenen Firmennamen als Rechnungssteller/Absender) - das ist eine EINNAHME, kein Einkauf, gehört NICHT in die Ausgaben.
- "mahnung": eine Zahlungserinnerung/Mahnung (egal ob der Betrieb selbst gemahnt wird, weil er eine Rechnung nicht bezahlt hat, oder eine Kopie einer eigenen Mahnung an einen Kunden) - das ist selbst KEIN neuer Einkauf/keine neue Ausgabe, sondern bezieht sich auf eine bereits an anderer Stelle erfasste Rechnung.
- "sonstiges": alles andere, das keinen Bezug zur Buchhaltung hat oder keine abrechenbare Ausgabe darstellt - z.B. AGB, Verträge, Datenblätter, Werbung, allgemeine Korrespondenz, Lieferscheine ohne Preisangabe, Angebote (noch keine Rechnung).
Sei bei "eingangsrechnung" nicht übervorsichtig (ein normaler Kassenbon/eine normale Lieferantenrechnung ist der Normalfall), aber wähle "ausgangsrechnung"/"mahnung"/"sonstiges" bewusst, wenn das Dokument eindeutig danach aussieht - lieber einmal zu vorsichtig einsortieren als eine AGB oder die eigene Ausgangsrechnung als Ausgabe verbuchen.

Regeln für die übrigen Felder (bei "dokumenttyp" ungleich "eingangsrechnung" nur so gut wie möglich ausfüllen, wird von der aufrufenden Software ohnehin nicht als Ausgabe übernommen):
- Antworte ausschließlich auf Deutsch.
- "haendler": bei "eingangsrechnung" der Name des Lieferanten/Geschäfts (z.B. "Hornbach", "Esso"); bei anderen Typen der erkennbare Absender/Aussteller des Dokuments.
- "datum": Belegdatum im Format JJJJ-MM-TT. Wenn nicht lesbar, leer lassen.
- "betragBrutto": Gesamtbetrag (inkl. USt.) als Zahl, ohne Währungssymbol.
- "steuersatz": erkannter USt.-Satz in Prozent als Zahl (meist 19 oder 7). Wenn nicht erkennbar, 19 annehmen.
- "betragNetto": betragBrutto / (1 + steuersatz/100), gerundet auf 2 Nachkommastellen.
- "kategorie": wähle GENAU einen Eintrag aus dieser Liste, der am besten passt: ${liste}.
- "kategorieSicher": true nur wenn du dir bei Händler UND Kategorie wirklich sicher bist. Bei Unsicherheit, schlechter Bildqualität oder einem für die Kategorie untypischen Beleg: false.
- "beschreibung": sehr kurze Zusammenfassung, was gekauft/bezahlt wurde bzw. worum es im Dokument geht (max. ca. 60 Zeichen).
- "lesbar": false, wenn das Bild kein auswertbares Dokument ist oder die wichtigsten Felder (Betrag, Händler) nicht erkennbar sind. In diesem Fall die übrigen Felder so gut wie möglich schätzen bzw. leer/0 lassen.
- Erfinde keine Beträge - wenn ein Betrag nicht lesbar ist, setze ihn auf 0 und "lesbar" auf false.`;
}

// Wandelt einen ArrayBuffer ohne Zwischenstring-Explosion in Base64 um (der
// naive Weg über String.fromCharCode(...new Uint8Array(buf)) sprengt bei
// größeren PDFs den Funktionsargument-Stack).
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Lädt einen bereits gespeicherten Beleg (z.B. eine Firebase-Storage-URL)
 * server-seitig herunter, statt ihn dem Browser zu überlassen - Firebase
 * Storage erlaubt standardmäßig kein Cross-Origin-fetch() aus dem Browser
 * (CORS), ein Server-zu-Server-Aufruf hier im Worker ist davon nicht
 * betroffen. Wird für das nachträgliche Neu-Einlesen bereits importierter
 * Belege in Werkora (Ausgaben -> "Ausgaben prüfen") genutzt.
 */
async function ladeBelegVonUrl(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Beleg konnte nicht geladen werden (${res.status}).`);
  }
  const contentType = (res.headers.get('content-type') || '').split(';')[0].trim();
  if (contentType.includes('xml')) {
    return { xmlText: await res.text() };
  }
  const buffer = await res.arrayBuffer();
  const mediaType = /^image\/(png|jpe?g|webp)$/.test(contentType) || contentType === 'application/pdf'
    ? contentType
    : 'application/pdf'; // Firebase liefert für hochgeladene PDFs teils generische Content-Types
  return { imageDataUrl: `data:${mediaType};base64,${arrayBufferToBase64(buffer)}` };
}

async function callClaudeBelegScan({ apiKey, model, imageDataUrl, xmlText, belegUrl, kategorien }) {
  if (belegUrl) {
    const geladen = await ladeBelegVonUrl(belegUrl);
    imageDataUrl = geladen.imageDataUrl;
    xmlText = geladen.xmlText;
  }
  // XRechnungen kommen als reiner XML-Text (kein Bild/PDF) - dafür einen
  // Text-Content-Block statt eines Bild-/Dokument-Blocks bauen. Auf ca.
  // 50.000 Zeichen begrenzt, damit eine unerwartet riesige XML-Datei nicht
  // den Kontext des Modells sprengt (echte XRechnungen sind normalerweise
  // deutlich kleiner).
  let content;
  if (xmlText) {
    content = [
      { type: 'text', text: `Folgende XRechnung (XML) auslesen:\n\n${xmlText.slice(0, 50000)}` },
    ];
  } else {
    const match = /^data:(image\/(?:png|jpe?g|webp)|application\/pdf);base64,(.+)$/.exec(imageDataUrl || '');
    if (!match) {
      throw new Error('Ungültiges Beleg-Format (unterstützt: JPEG/PNG/WebP-Fotos, PDF oder XRechnung-XML).');
    }
    const [, mediaType, base64Data] = match;
    // PDFs gehen als "document"-Content-Block, Fotos als "image" - Claude liest beide Typen.
    const belegBlock = mediaType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: mediaType, data: base64Data } }
      : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } };
    content = [belegBlock, { type: 'text', text: 'Lies diesen Beleg aus und liefere die strukturierten Daten.' }];
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: buildBelegSystemPrompt(kategorien),
      messages: [{ role: 'user', content }],
      output_config: {
        format: { type: 'json_schema', schema: BELEG_SCHEMA },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Anthropic-API-Fehler (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  if (data.stop_reason === 'refusal') {
    throw new Error('Die Anfrage wurde von Claude aus Sicherheitsgründen abgelehnt.');
  }
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) {
    throw new Error('Keine Antwort erhalten.');
  }
  return JSON.parse(textBlock.text);
}

const EMAIL_KLASSIFIZIERUNG_SCHEMA = {
  type: 'object',
  properties: {
    ergebnisse: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          kategorie: { type: 'string', enum: ['kundenanfrage', 'rechnung-lieferant', 'werbung', 'sonstiges'] },
          kontakt: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              email: { type: 'string' },
              telefon: { type: 'string' },
              anliegen: { type: 'string' },
            },
            required: ['name', 'email', 'telefon', 'anliegen'],
            additionalProperties: false,
          },
          termin: {
            type: 'object',
            properties: {
              datum: { type: 'string' },
              uhrzeit: { type: 'string' },
            },
            required: ['datum', 'uhrzeit'],
            additionalProperties: false,
          },
        },
        required: ['id', 'kategorie', 'kontakt', 'termin'],
        additionalProperties: false,
      },
    },
  },
  required: ['ergebnisse'],
  additionalProperties: false,
};

function buildEmailKlassifizierungPrompt(heute) {
  return `Du sortierst E-Mails eines deutschen Elektro-Handwerksbetriebs (neuverdrahtet) nach Art. Für jede E-Mail in der Liste (id, Betreff, Absender, kurzer Textauszug) wählst du GENAU eine Kategorie:
- "kundenanfrage": Anfragen, Rückfragen oder sonstige Kommunikation mit (potenziellen) Kunden zu Aufträgen, Terminen oder Angeboten - auch eigene gesendete Antworten darauf.
- "rechnung-lieferant": Rechnungen, Bestellbestätigungen oder Belege von Lieferanten, Dienstleistern oder Software-Abos.
- "werbung": Newsletter, Marketing-/Werbe-Mails, Produktangebote, Social-Media- oder Blog-Benachrichtigungen.
- "sonstiges": alles andere, z.B. interne Mails, Kalendererinnerungen, Systembenachrichtigungen oder unklare Fälle.

Zusätzlich lieferst du für JEDE E-Mail ein "kontakt"-Objekt mit den Feldern name, email, telefon, anliegen (jeweils als String, leer "" wenn nicht zutreffend oder nicht auffindbar):
- NUR bei Kategorie "kundenanfrage" befüllen: den Namen und die E-Mail-Adresse des tatsächlichen (potenziellen) Kunden - falls die Mail über ein Kontaktformular der eigenen Webseite eingeht, steht der echte Absender meist im Textauszug (z.B. "Name: ...", "E-Mail: ..."), NICHT im "Absender"-Feld, das dann nur den Formular-Versanddienst zeigt. Telefonnummer nur, wenn im Text explizit genannt. "anliegen" ist eine knappe 1-2 Satz Zusammenfassung, worum es geht.
- Bei allen anderen Kategorien: alle vier Felder als leeren String "" lassen.

Außerdem lieferst du für JEDE E-Mail ein "termin"-Objekt mit den Feldern datum (Format "JJJJ-MM-TT") und uhrzeit (Format "SS:MM"):
- NUR bei Kategorie "kundenanfrage" befüllen, und NUR wenn im Text ein konkreter, eindeutiger Terminwunsch mit Datum UND Uhrzeit steht (z.B. "können Sie am 15.08. um 10 Uhr vorbeikommen?" oder "nächsten Dienstag um 14 Uhr passt mir"). Heutiges Datum ist ${heute || 'unbekannt'} - rechne relative Angaben ("nächsten Dienstag", "übermorgen") in ein konkretes Datum um.
- Bei vagen oder mehrdeutigen Angaben (z.B. nur "nächste Woche" ohne Wochentag, "irgendwann im August", oder wenn Datum ODER Uhrzeit fehlt) beide Felder als leeren String "" lassen - lieber nichts eintragen als einen falschen Termin erfinden.
- Bei allen anderen Kategorien: beide Felder als leeren String "" lassen.

Antworte für JEDE übergebene E-Mail mit exakt ihrer id, der gewählten Kategorie, dem kontakt-Objekt und dem termin-Objekt, in derselben Reihenfolge wie die Eingabe. Erfinde keine zusätzlichen oder fehlenden Einträge und keine Kontakt- oder Termindaten, die nicht im Text stehen.`;
}

// Schneidet nie mitten in einem Surrogatpaar ab (z.B. Emoji, die in JS als
// zwei UTF-16-Einheiten codiert sind) - sonst bleibt ein einzelnes, ungültiges
// High-Surrogate-Zeichen übrig, das die Anthropic-API mit "no low surrogate
// in string" ablehnt.
function safeSlice(str, maxLen) {
  if (!str || str.length <= maxLen) return str || '';
  let end = maxLen;
  const code = str.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return str.slice(0, end);
}

async function callClaudeEmailClassify({ apiKey, model, emails, heute }) {
  const liste = emails
    .map((e) => `id: ${e.id}\nBetreff: ${e.subject || '(kein Betreff)'}\nAbsender: ${e.from || ''}\nAuszug: ${safeSlice(e.snippet || '', 1200)}`)
    .join('\n---\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: buildEmailKlassifizierungPrompt(heute),
      messages: [{ role: 'user', content: `Ordne folgende E-Mails ein:\n\n${liste}` }],
      output_config: {
        format: { type: 'json_schema', schema: EMAIL_KLASSIFIZIERUNG_SCHEMA },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Anthropic-API-Fehler (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  if (data.stop_reason === 'refusal') {
    throw new Error('Die Anfrage wurde von Claude aus Sicherheitsgründen abgelehnt.');
  }
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) {
    throw new Error('Keine Antwort erhalten.');
  }
  return JSON.parse(textBlock.text);
}

const GAEB_PREISVORSCHLAEGE_SCHEMA = {
  type: 'object',
  properties: {
    ergebnisse: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'number' },
          einzelpreis: { type: 'number' },
          gefunden: { type: 'boolean' },
          quelle: { type: 'string' },
        },
        required: ['index', 'einzelpreis', 'gefunden', 'quelle'],
        additionalProperties: false,
      },
    },
  },
  required: ['ergebnisse'],
  additionalProperties: false,
};

const GAEB_PREISE_SYSTEM_PROMPT = `Du recherchierst für einen deutschen Elektro-/Handwerksbetrieb aktuelle, marktübliche Netto-Verkaufspreise für Positionen aus einem Leistungsverzeichnis (GAEB-Import), indem du gezielt im Internet suchst. Der Betrieb bezieht sein Material überwiegend aus Baumärkten (z.B. Hornbach, Bauhaus, OBI, toom) und Online-Händlern (z.B. Amazon, Obeta-Webshop, Voltimum, Contorion, Electronic-Star) - suche BEVORZUGT dort nach dem aktuellen Preis. Hersteller-Websites (z.B. Hager, Gira, Busch-Jaeger, ABB, Siemens, OBO Bettermann, Jung) oder Fachgroßhändler (z.B. Sonepar, Rexel) nur ergänzend, falls dort kein Preis zu finden ist.

Regeln:
- Antworte ausschließlich auf Deutsch.
- Für jede Position (gekennzeichnet mit [index] Bezeichnung/Beschreibung/Menge/Einheit) suchst du im Internet nach dem passenden Artikel bzw. der passenden Leistung und lieferst einen realistischen Netto-Einzelpreis (EUR) je Einheit, wie ihn ein Handwerksbetrieb einem Kunden in Rechnung stellen würde (inkl. üblicher Handelsspanne, nicht nur der reine Einkaufspreis). Bei reinen Arbeitsleistungen ohne Materialbezug (z.B. "Montage", "Anschluss", "Std.") schätze einen branchenüblichen Stundensatz bzw. Pauschalpreis.
- "index" muss exakt der Zahl in eckigen Klammern der jeweiligen Position entsprechen.
- "gefunden": true nur, wenn du eine belastbare, tatsächlich recherchierte Preisgrundlage gefunden hast. false, wenn du keinen passenden Treffer findest oder nur raten würdest - in diesem Fall trotzdem "einzelpreis" mit einer vorsichtigen Schätzung befüllen, aber "gefunden" auf false setzen.
- "quelle": kurze Angabe, worauf sich der Preis stützt (z.B. Hersteller-/Händlername oder "Schätzung, kein Treffer gefunden"), max. ca. 60 Zeichen.
- Erfinde keine Quellen - wenn du nicht wirklich recherchiert hast, gib das ehrlich über "gefunden": false an.
- Liefere für JEDE übergebene Position genau ein Ergebnis, keine zusätzlichen oder fehlenden Einträge.`;

async function callClaudeGaebPreise({ apiKey, model, positionen }) {
  const listText = positionen
    .map((p, i) => `[${i}] ${p.bezeichnung || ''}${p.beschreibung ? ' - ' + p.beschreibung : ''} | Menge: ${p.menge ?? 1} ${p.einheit || ''}`)
    .join('\n');

  const initialContent = `Recherchiere für folgende Positionen eines Leistungsverzeichnisses marktübliche Netto-Einzelpreise:\n\n${listText}`;
  let messages = [{ role: 'user', content: initialContent }];
  let data;

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        system: GAEB_PREISE_SYSTEM_PROMPT,
        messages,
        // allowed_callers: ['direct'] ist nötig, damit auch günstigere Modelle
        // ohne Unterstützung für "programmatic tool calling" (z.B. Haiku, siehe
        // MODEL_ID-Hinweis oben) diesen Tool-Aufruf ausführen können - ohne das
        // lehnt die Anthropic-API die Anfrage mit einem 400er ab.
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: positionen.length * 2 + 5, allowed_callers: ['direct'] }],
        output_config: {
          format: { type: 'json_schema', schema: GAEB_PREISVORSCHLAEGE_SCHEMA },
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Anthropic-API-Fehler (${res.status}): ${text.slice(0, 300)}`);
    }

    data = await res.json();
    if (data.stop_reason === 'refusal') {
      throw new Error('Die Anfrage wurde von Claude aus Sicherheitsgründen abgelehnt.');
    }
    if (data.stop_reason === 'pause_turn') {
      messages = [{ role: 'user', content: initialContent }, { role: 'assistant', content: data.content }];
      continue;
    }
    break;
  }

  const textBlock = (data.content || []).filter((b) => b.type === 'text').pop();
  if (!textBlock) {
    throw new Error('Keine Antwort erhalten.');
  }
  try {
    return JSON.parse(textBlock.text);
  } catch {
    const match = /\{[\s\S]*\}/.exec(textBlock.text);
    if (match) return JSON.parse(match[0]);
    throw new Error('Antwort der KI konnte nicht als JSON gelesen werden.');
  }
}

// --- Wöchentliche Katalog-Aktualisierung (siehe scheduled()/
// runKatalogAktualisierung weiter unten): recherchiert per Web-Search-Tool
// aktuelle Marktpreise für einen rotierenden Ausschnitt des bestehenden
// Artikel-/Leistungskatalogs und schlägt vereinzelt branchenübliche, noch
// fehlende Positionen vor. Schreibt NIE direkt in den Katalog - jedes
// Ergebnis landet nur als Vorschlag in der Firestore-Collection
// "katalogVorschlaege" und muss in der Verwaltung (Ansicht
// "Katalog-Vorschläge") von einem Menschen geprüft/übernommen werden. ---

const KATALOG_AKTUALISIERUNG_SCHEMA = {
  type: 'object',
  properties: {
    preise: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'number' },
          neuerPreis: { type: 'number' },
          gefunden: { type: 'boolean' },
          quelle: { type: 'string' },
        },
        required: ['index', 'neuerPreis', 'gefunden', 'quelle'],
        additionalProperties: false,
      },
    },
    neueVorschlaege: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          typ: { type: 'string', enum: ['artikel', 'leistung'] },
          bezeichnung: { type: 'string' },
          einheit: { type: 'string' },
          preis: { type: 'number' },
          gewerk: { type: 'string' },
          begruendung: { type: 'string' },
          quelle: { type: 'string' },
        },
        required: ['typ', 'bezeichnung', 'einheit', 'preis', 'gewerk', 'begruendung', 'quelle'],
        additionalProperties: false,
      },
    },
  },
  required: ['preise', 'neueVorschlaege'],
  additionalProperties: false,
};

function buildKatalogAktualisierungSystemPrompt(gewerkeListe) {
  return `Du prüfst für einen deutschen Handwerksbetrieb (Gewerke: ${gewerkeListe.join(', ') || 'diverse'}) einen Ausschnitt des bestehenden Artikel-/Leistungskatalogs auf aktuelle Marktpreise, indem du gezielt im Internet suchst. Der Betrieb bezieht sein Material überwiegend aus Baumärkten (z.B. Hornbach, Bauhaus, OBI, toom) und Online-Händlern (z.B. Amazon, Obeta-Webshop, Voltimum, Contorion, Electronic-Star) - suche BEVORZUGT dort nach dem aktuellen Preis. Hersteller-Websites/Fachgroßhändler nur ergänzend, falls dort kein Preis zu finden ist.

Aufgabe 1 - Preise prüfen:
- Für jede übergebene Position (gekennzeichnet mit [index] Bezeichnung/Einheit/Gewerk/aktueller Preis) recherchierst du den aktuellen marktüblichen Netto-Preis (EUR) je Einheit, wie ihn ein Handwerksbetrieb einem Kunden in Rechnung stellen würde (inkl. üblicher Handelsspanne).
- "index" muss exakt der Zahl in eckigen Klammern entsprechen. Liefere für JEDE übergebene Position genau ein Ergebnis.
- "gefunden": true nur bei einer belastbaren, tatsächlich recherchierten Preisgrundlage, sonst false (dann trotzdem eine vorsichtige Schätzung in "neuerPreis" angeben).
- "quelle": kurze Angabe, worauf sich der Preis stützt (z.B. Hersteller-/Händlername), max. ca. 60 Zeichen. Erfinde keine Quellen.
- Wenn der aktuelle Preis weiterhin zutreffend erscheint, trage ihn trotzdem unverändert als "neuerPreis" ein (wird dann als "keine nennenswerte Änderung" erkannt).

Aufgabe 2 - Fehlende Positionen (sparsam, max. 5):
- Du bekommst zusätzlich die Liste ALLER bereits im Katalog vorhandenen Bezeichnungen (nicht nur der oben geprüften Positionen). Schlage NUR Artikel/Leistungen vor, die dort wirklich nirgends auftauchen - auch nicht unter leicht anderem Namen/Schreibweise. Prüfe diese Liste sorgfältig, BEVOR du einen Vorschlag machst - ein Vorschlag, der bereits (auch nur ähnlich benannt) vorhanden ist, erzeugt einen Katalog-Dublikat-Eintrag.
- Schlage höchstens 5 häufig benötigte Artikel/Leistungen vor, die zu den oben genannten Gewerken gehören - nur offensichtliche, branchenübliche Standardpositionen, keine exotischen Spezialfälle.
- "begruendung": 1 kurzer Satz, warum diese Position fehlt/sinnvoll ist.
- "preis": recherchierter oder vorsichtig geschätzter Netto-Verkaufspreis je Einheit.
- Lieber weniger oder gar keine Vorschläge als unsichere/erfundene oder möglicherweise schon vorhandene.

Antworte ausschließlich auf Deutsch.`;
}

async function callClaudeKatalogAktualisierung({ apiKey, model, items, gewerke, vorhandeneBezeichnungen }) {
  const listText = items
    .map((it) => `[${it.index}] ${it.bezeichnung} | Einheit: ${it.einheit || ''} | Gewerk: ${it.gewerk || '–'} | aktueller Preis: ${it.aktuellerPreis} EUR netto`)
    .join('\n');
  // Vollständige Liste ALLER bereits vorhandenen Katalog-Bezeichnungen (nicht
  // nur des aktuell geprüften 25er-Ausschnitts) - sonst hält die KI bei
  // Aufgabe 2 (fehlende Positionen vorschlagen) Einträge für fehlend, die im
  // Katalog längst existieren, nur eben gerade nicht im Ausschnitt dieses
  // Laufs auftauchen, und erzeugt dadurch Duplikate.
  const bezeichnungenText = (vorhandeneBezeichnungen || []).join('\n');

  const initialContent = `Prüfe folgende Katalog-Positionen auf aktuelle Marktpreise und schlage ggf. fehlende Standardpositionen vor:\n\n${listText}\n\nBereits vorhandene Bezeichnungen im GESAMTEN Katalog (für Aufgabe 2 - schlage NICHTS vor, das hier (auch sinngemäß/unter leicht anderem Namen) schon enthalten ist):\n${bezeichnungenText}`;
  let messages = [{ role: 'user', content: initialContent }];
  let data;

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        system: buildKatalogAktualisierungSystemPrompt(gewerke),
        messages,
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: items.length * 2 + 10, allowed_callers: ['direct'] }],
        output_config: {
          format: { type: 'json_schema', schema: KATALOG_AKTUALISIERUNG_SCHEMA },
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Anthropic-API-Fehler (${res.status}): ${text.slice(0, 300)}`);
    }

    data = await res.json();
    if (data.stop_reason === 'refusal') {
      throw new Error('Die Anfrage wurde von Claude aus Sicherheitsgründen abgelehnt.');
    }
    if (data.stop_reason === 'pause_turn') {
      messages = [{ role: 'user', content: initialContent }, { role: 'assistant', content: data.content }];
      continue;
    }
    break;
  }

  const textBlock = (data.content || []).filter((b) => b.type === 'text').pop();
  if (!textBlock) {
    throw new Error('Keine Antwort erhalten.');
  }
  try {
    return JSON.parse(textBlock.text);
  } catch {
    const match = /\{[\s\S]*\}/.exec(textBlock.text);
    if (match) return JSON.parse(match[0]);
    throw new Error('Antwort der KI konnte nicht als JSON gelesen werden.');
  }
}

const SOCIAL_POST_SCHEMA = {
  type: 'object',
  properties: {
    altText: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
    instagram: { type: 'string' },
    facebook: { type: 'string' },
    linkedin: { type: 'string' },
    googleBusiness: { type: 'string' },
  },
  required: ['altText', 'hashtags', 'instagram', 'facebook', 'linkedin', 'googleBusiness'],
  additionalProperties: false,
};

function buildSocialPostSystemPrompt({ firmenname, ort, gewerk, leistung, kontext }) {
  return `Du bist Social-Media-/Local-SEO-Texter für den deutschen Handwerksbetrieb "${firmenname || 'den Betrieb'}". Der Betrieb ist ein Mehrgewerke-Betrieb (u.a. Elektro, Fliesen, Bodenleger, Maler, Trockenbau, Putz/Stuckateur, Komplettbad, Wohnungssanierung/Renovierung, Abbruch) - schließe NIEMALS allein aus dem Firmennamen auf ein bestimmtes Gewerk, insbesondere nicht automatisch auf "Elektro". Welches Gewerk/Thema dieser konkrete Beitrag hat, ergibt sich ausschließlich aus den unten angegebenen Feldern (Gewerk/Leistung) und dem, was auf dem Foto tatsächlich zu sehen ist. Du bekommst ein Foto (z.B. von einer fertiggestellten Baustelle, einem Einsatz oder Produkt) und schreibst dazu Beitragstexte für vier Kanäle, in deutscher Sprache.

Kontext, den du nutzen darfst (nur was hier steht bzw. auf dem Foto wirklich zu sehen ist - nichts erfinden):
${gewerk ? `- Gewerk dieses Beitrags: ${gewerk}` : '- Kein Gewerk angegeben - leite es ausschließlich aus dem Foto und den übrigen Feldern ab, rate nicht auf Elektro.'}
${ort ? `- Einsatzort/Region: ${ort}` : '- Kein Ort angegeben - keinen erfinden, dann allgemein bleiben.'}
${leistung ? `- Leistung/Anlass: ${leistung}` : ''}
${kontext ? `- Zusätzliche Stichpunkte vom Mitarbeiter: ${kontext}` : ''}

Regeln je Feld:
- "altText": sachliche, kurze Bildbeschreibung (max. ca. 120 Zeichen) für Barrierefreiheit und Bild-SEO - beschreibt, was auf dem Foto zu sehen ist.
- "hashtags": 6-10 relevante deutsche Hashtags ohne Leerzeichen (inkl. #), passend zum oben genannten Gewerk/zur Leistung dieses Beitrags (z.B. bei Gewerk "Fliesen": #Fliesenleger, #Badsanierung - NICHT pauschal Elektro-Hashtags verwenden, außer das Gewerk ist tatsächlich Elektro) und - falls ein Ort angegeben ist - ein passendes Orts-/Regions-Hashtag (z.B. #FliesenlegerEssen) für lokale Auffindbarkeit. Keine doppelten, keine generischen Massen-Hashtags wie #love #instagood.
- "instagram": lebendiger, bildbezogener Text (ca. 2-5 Sätze), gerne 1-3 passende Emojis, endet mit dezentem Call-to-Action (z.B. "Anfrage über den Link in der Bio"). KEINE Hashtags im Text selbst einbauen (die kommen separat in "hashtags").
- "facebook": ähnlich wie Instagram, etwas ausführlicher/informativer (3-6 Sätze), sprich die Zielgruppe direkt an ("Ihr", "Sie" - einheitlich eine Anredeform wählen, Standard: "Sie"), max. 1-2 Emojis, Call-to-Action mit Kontaktmöglichkeit.
- "linkedin": sachlich-professioneller Ton, keine Emojis (oder höchstens 1 dezentes), betont fachliche Kompetenz/Qualität, 2-4 Sätze, ohne Hashtags im Text.
- "googleBusiness": kurzer, informativer "Neuigkeiten"-Beitrag fürs Google Unternehmensprofil (max. ca. 300 Zeichen), lokal-SEO-optimiert: nennt natürlich die Leistung UND - falls angegeben - den Ort/die Region, klingt wie eine sachliche Ankündigung/News, endet mit klarer Handlungsaufforderung (z.B. anrufen, Angebot anfordern). Keine Hashtags, keine Emojis.
- Erfinde keine konkreten Fakten (keine Preise, Fristen, Kundennamen, Adressen), die nicht im Kontext oder erkennbar auf dem Foto stehen.
- Wenn das Bild kein erkennbares Handwerks-/Baustellenmotiv zeigt, trotzdem plausible, generische Texte zur angegebenen Leistung liefern (nicht verweigern).`;
}

async function callClaudeSocialPost({ apiKey, model, imageDataUrl, firmenname, ort, gewerk, leistung, kontext }) {
  const match = /^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/.exec(imageDataUrl || '');
  if (!match) {
    throw new Error('Ungültiges Bildformat.');
  }
  const [, mediaType, base64Data] = match;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system: buildSocialPostSystemPrompt({ firmenname, ort, gewerk, leistung, kontext }),
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
          { type: 'text', text: 'Erstelle für dieses Foto die Social-Media-Texte gemäß Vorgaben.' },
        ],
      }],
      output_config: {
        format: { type: 'json_schema', schema: SOCIAL_POST_SCHEMA },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Anthropic-API-Fehler (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  if (data.stop_reason === 'refusal') {
    throw new Error('Die Anfrage wurde von Claude aus Sicherheitsgründen abgelehnt.');
  }
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) {
    throw new Error('Keine Antwort erhalten.');
  }
  return JSON.parse(textBlock.text);
}

// --- KI-Assistent (Chat) für die Verwaltungs-Software: ein Claude-Tool-Use-
// Loop gegen die bestehende Werkora-API für die KI-Bürokraft
// (cloudflare-worker-ki-buerokraft/, eigene README dort). Statt Firestore
// direkt anzusprechen, ruft dieser Worker die andere REST-API server-zu-
// server auf (mit deren API_KEY) - genau wie es sonst ChatGPT über die
// Custom-GPT-Action tut, nur jetzt direkt in der Verwaltungs-Oberfläche
// (verwaltung/js/views/ki-assistent.js) nutzbar. Bewusst nur eine kuratierte
// Auswahl der dortigen Endpunkte (die für ein Gespräch nützlichsten), keine
// 1:1-Kopie der kompletten chatgpt-actions-schema.json - siehe README. ---

function buildQuery(input, keys) {
  const params = new URLSearchParams();
  for (const key of keys) {
    const val = input[key];
    if (val === undefined || val === null || val === '') continue;
    params.set(key, String(val));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** Entfernt "id" (dient nur der Pfad-Ersetzung) aus dem an die API gesendeten JSON-Body. */
function bodyOhneId(input) {
  const { id, ...rest } = input || {};
  return rest;
}

const KI_BUEROKRAFT_TOOLS = [
  {
    name: 'getDashboard',
    method: 'GET',
    path: () => '/assistant/dashboard',
    description: 'Kompakte Unternehmensübersicht: neue Leads, offene Aufgaben, überfällige Rechnungen usw.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'searchCustomers',
    method: 'GET',
    path: (i) => '/customers' + buildQuery(i, ['email', 'phone', 'name', 'postal_code', 'city']),
    description: 'Kunden suchen. Vor dem Anlegen eines neuen Kunden IMMER zuerst hiermit prüfen, ob er schon existiert (per E-Mail oder Telefon).',
    input_schema: {
      type: 'object',
      properties: {
        email: { type: 'string' },
        phone: { type: 'string' },
        name: { type: 'string', description: 'Sucht in Firma/Name und Ansprechpartner.' },
        postal_code: { type: 'string' },
        city: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'getCustomer',
    method: 'GET',
    path: (i) => `/customers/${encodeURIComponent(i.id)}`,
    description: 'Einen Kunden per ID abrufen.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'createCustomer',
    method: 'POST',
    path: () => '/customers',
    body: bodyOhneId,
    description: 'Neuen Kunden anlegen (bekommt automatisch Status "lead"). Vorher IMMER mit searchCustomers prüfen, ob er schon existiert - sonst 409-Fehler.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Firma oder vollständiger Name (Pflicht, wenn "company" fehlt).' },
        company: { type: 'string' },
        type: { type: 'string', enum: ['private', 'company'] },
        contact_name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        street: { type: 'string' },
        postal_code: { type: 'string' },
        city: { type: 'string' },
        notes: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'searchLeads',
    method: 'GET',
    path: (i) => '/leads' + buildQuery(i, ['status']),
    description: 'Leads abrufen (Kunden im Status "lead" oder einem anderen Status). Ohne Angabe: nur "lead".',
    input_schema: { type: 'object', properties: { status: { type: 'string', description: 'z.B. lead, interessent, kunde, verloren.' } }, additionalProperties: false },
  },
  {
    name: 'createLead',
    method: 'POST',
    path: () => '/leads',
    body: bodyOhneId,
    description: 'Lead anlegen (neuer Kunde oder Notiz an bestehendem Kunden).',
    input_schema: {
      type: 'object',
      properties: {
        customer_id: { type: 'string', description: 'Falls der Kunde schon existiert (per searchCustomers gefunden).' },
        title: { type: 'string', description: 'Pflicht, wenn kein customer_id angegeben ist.' },
        description: { type: 'string' },
        trade: { type: 'string', description: 'Gewerk, z.B. elektro.' },
        source: { type: 'string' },
        priority: { type: 'string' },
        estimated_value: { type: 'number' },
        next_action: { type: 'string' },
        next_action_date: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'updateLead',
    method: 'PATCH',
    path: (i) => `/leads/${encodeURIComponent(i.id)}`,
    body: bodyOhneId,
    description: 'Lead aktualisieren (Status, nächster Schritt, Notiz). Nur bekannte Werkora-Status-Werte ändern den Status wirklich, sonst wird nur eine Notiz vermerkt.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        status: { type: 'string' },
        next_action: { type: 'string' },
        next_action_date: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'searchProjects',
    method: 'GET',
    path: (i) => '/projects' + buildQuery(i, ['customer_id', 'status']),
    description: 'Projekte abrufen.',
    input_schema: { type: 'object', properties: { customer_id: { type: 'string' }, status: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'getProject',
    method: 'GET',
    path: (i) => `/projects/${encodeURIComponent(i.id)}`,
    description: 'Ein Projekt per ID abrufen.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'searchTasks',
    method: 'GET',
    path: (i) => '/tasks' + buildQuery(i, ['status', 'priority', 'due_date', 'customer_id', 'project_id', 'assigned_to', 'count', 'limit']),
    description: 'Aufgaben abrufen. Bei reinen Zählfragen ("Wie viele offene Aufgaben haben wir?") count=true statt der vollen Liste nutzen.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'offen, in-arbeit, klaerung, erledigt' },
        priority: { type: 'string' },
        due_date: { type: 'string' },
        customer_id: { type: 'string' },
        project_id: { type: 'string' },
        assigned_to: { type: 'string' },
        count: { type: 'boolean' },
        limit: { type: 'integer' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'createTask',
    method: 'POST',
    path: () => '/tasks',
    body: bodyOhneId,
    description: 'Aufgabe erstellen.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string', description: 'niedrig, normal, hoch' },
        due_date: { type: 'string', description: 'YYYY-MM-DD' },
        customer_id: { type: 'string' },
        project_id: { type: 'string' },
        assigned_to: { type: 'string' },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'updateTask',
    method: 'PATCH',
    path: (i) => `/tasks/${encodeURIComponent(i.id)}`,
    body: bodyOhneId,
    description: 'Aufgabe aktualisieren oder abschließen. status="completed" schließt die Aufgabe ab.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        status: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string' },
        due_date: { type: 'string' },
        assigned_to: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'searchAppointments',
    method: 'GET',
    path: (i) => '/appointments' + buildQuery(i, ['customer_id', 'project_id', 'date_from', 'date_to']),
    description: 'Termine abrufen.',
    input_schema: {
      type: 'object',
      properties: { customer_id: { type: 'string' }, project_id: { type: 'string' }, date_from: { type: 'string' }, date_to: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'createAppointment',
    method: 'POST',
    path: () => '/appointments',
    body: bodyOhneId,
    description: 'Termin erstellen.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        start: { type: 'string', description: 'z.B. 2026-08-14T09:00' },
        end: { type: 'string' },
        customer_id: { type: 'string' },
        project_id: { type: 'string' },
        address: { type: 'string' },
        assigned_employee_ids: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
      },
      required: ['title', 'start'],
      additionalProperties: false,
    },
  },
  {
    name: 'searchQuotes',
    method: 'GET',
    path: (i) => '/quotes' + buildQuery(i, ['customer_id', 'project_id', 'status', 'date_from', 'date_to', 'count', 'limit']),
    description: 'Angebote abrufen. Bei reinen Zählfragen count=true statt der vollen Liste nutzen.',
    input_schema: {
      type: 'object',
      properties: {
        customer_id: { type: 'string' },
        project_id: { type: 'string' },
        status: { type: 'string', description: 'draft, sent, accepted, rejected' },
        date_from: { type: 'string' },
        date_to: { type: 'string' },
        count: { type: 'boolean' },
        limit: { type: 'integer' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'createQuoteDraft',
    method: 'POST',
    path: () => '/quotes',
    body: bodyOhneId,
    description: 'Angebotsentwurf erstellen (immer Status "draft" - Versand/Freigabe ist über die API gesperrt und muss in Werkora selbst erfolgen).',
    input_schema: {
      type: 'object',
      properties: {
        customer_id: { type: 'string' },
        project_id: { type: 'string' },
        title: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              quantity: { type: 'number' },
              unit: { type: 'string' },
              unit_price_net: { type: 'number' },
              vat_rate: { type: 'number', description: 'z.B. 19' },
            },
            additionalProperties: false,
          },
        },
      },
      required: ['customer_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'searchInvoices',
    method: 'GET',
    path: (i) => '/invoices' + buildQuery(i, ['status', 'customer_id', 'project_id', 'date_from', 'date_to', 'count', 'limit']),
    description: 'Rechnungen abrufen, inkl. überfällige (status=overdue). Anlegen/Versenden ist über die API gesperrt (GoBD) - das läuft ausschließlich über Werkora selbst.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'draft, sent, paid, overdue, cancelled' },
        customer_id: { type: 'string' },
        project_id: { type: 'string' },
        date_from: { type: 'string' },
        date_to: { type: 'string' },
        count: { type: 'boolean' },
        limit: { type: 'integer' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'getPriceList',
    method: 'GET',
    path: (i) => '/price-list' + buildQuery(i, ['trade', 'count', 'limit']),
    description: 'Komplette Preisliste (Artikel+Leistungen) abrufen (nur lesen).',
    input_schema: { type: 'object', properties: { trade: { type: 'string' }, count: { type: 'boolean' }, limit: { type: 'integer' } }, additionalProperties: false },
  },
  {
    name: 'searchExpenses',
    method: 'GET',
    path: (i) => '/expenses' + buildQuery(i, ['customer_id', 'project_id', 'category', 'supplier', 'date_from', 'date_to', 'status', 'incomplete', 'offset', 'limit']),
    description: 'Ausgaben/Belege abrufen (inkl. Beleg-URL/-Dateityp, falls in Werkora bereits ein Beleg hochgeladen wurde). incomplete=true filtert auf Belege ohne Betrag oder mit 0 Euro. Antwort ist { items, total, offset, limit, has_more } statt einer reinen Liste - offset erhöhen, bis has_more false ist, für die komplette Liste.',
    input_schema: {
      type: 'object',
      properties: {
        customer_id: { type: 'string' },
        project_id: { type: 'string' },
        category: { type: 'string' },
        supplier: { type: 'string' },
        date_from: { type: 'string' },
        date_to: { type: 'string' },
        status: { type: 'string' },
        incomplete: { type: 'boolean', description: 'true = nur Belege ohne bzw. mit 0 Euro Betrag.' },
        offset: { type: 'integer' },
        limit: { type: 'integer' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'updateExpense',
    method: 'PATCH',
    path: (i) => `/expenses/${encodeURIComponent(i.id)}`,
    body: bodyOhneId,
    description: 'Eine einzelne Ausgabe/einen Beleg nachträglich korrigieren (z.B. Kategorie zuordnen, Betrag/Lieferant/Datum berichtigen).',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        category: { type: 'string' },
        description: { type: 'string' },
        supplier: { type: 'string' },
        amount_net: { type: 'number' },
        amount_gross: { type: 'number' },
        vat_rate: { type: 'number' },
        date: { type: 'string' },
        customer_id: { type: 'string' },
        project_id: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'bulkFixReceipts',
    method: 'POST',
    path: () => '/expenses/bulk-fix-receipts',
    body: bodyOhneId,
    description: 'Verarbeitet in einem Aufruf mehrere unvollständige Belege (ohne/mit 0 Euro Betrag) automatisch per KI-Belegerkennung: liest jeden Beleg wirklich aus und übernimmt bei sicher lesbaren Belegen Betrag/Datum/Lieferant sofort (Kategorie nur bei hoher KI-Sicherheit, sonst bleibt sie unverändert). Nicht sicher lösbare Belege werden mit kiAnalyseUnsicher=true markiert (verschwinden dadurch aus dem Kandidatenkreis künftiger Aufrufe) und im Feld needs_manual_review gemeldet - erfinde bei denen nichts, sondern melde sie ehrlich als "manuell zu prüfen". Antwort: { processed, updated, needs_manual_review, remaining_incomplete, has_more }. Bei has_more=true erneut aufrufen, um den restlichen Rückstand abzuarbeiten - dabei die Anzahl Aufrufe pro Gespräch/Lauf sinnvoll begrenzen (z.B. höchstens 6), der Rest folgt beim nächsten Lauf.',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'Wie viele Belege je Aufruf verarbeitet werden (Standard 10, maximal 25).' } },
      additionalProperties: false,
    },
  },
  {
    name: 'searchTimeEntries',
    method: 'GET',
    path: (i) => '/time-entries' + buildQuery(i, ['project_id', 'employee_id', 'date_from', 'date_to', 'count', 'offset', 'limit']),
    description: 'Echte erfasste Arbeitszeit (Zeiterfassung/Stechuhr, nicht die freiwilligen Arbeitsberichte) abrufen - das ist die maßgebliche Quelle für einen Soll-/Ist-Zeitvergleich gegen kalkulierte Std.-Positionen eines Angebots. Antwort enthält immer sum_minutes (Summe der gefilterten Einträge). Bei reinen Summenfragen count=true nutzen statt der vollen Liste.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        employee_id: { type: 'string' },
        date_from: { type: 'string' },
        date_to: { type: 'string' },
        count: { type: 'boolean' },
        offset: { type: 'integer' },
        limit: { type: 'integer' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'searchEmails',
    service: 'google', // läuft direkt im Worker (callGoogleTool), kein path/method nötig
    description: 'E-Mails im geschäftlichen Gmail-Postfach durchsuchen (max. 25 Treffer, neueste zuerst). "after"/"before" im Format YYYY/MM/DD, "q" ist normale Gmail-Suchsyntax. Nur verfügbar, wenn die Google-Anbindung eingerichtet und einmalig per /oauth/authorize verbunden ist (sonst kommt ein klarer Fehler zurück).',
    input_schema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Freie Gmail-Suchsyntax, z.B. "Rechnung" oder "from:kunde@example.com".' },
        unread: { type: 'boolean' },
        from: { type: 'string' },
        to: { type: 'string' },
        subject: { type: 'string' },
        after: { type: 'string', description: 'Format YYYY/MM/DD.' },
        before: { type: 'string', description: 'Format YYYY/MM/DD.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'searchCalendarEvents',
    service: 'google', // läuft direkt im Worker (callGoogleTool), kein path/method nötig
    description: 'Termine im geschäftlichen Google-Kalender abrufen (max. 50 Treffer). Nur verfügbar, wenn die Google-Anbindung eingerichtet und einmalig per /oauth/authorize verbunden ist (sonst kommt ein klarer Fehler zurück).',
    input_schema: {
      type: 'object',
      properties: { date_from: { type: 'string' }, date_to: { type: 'string' }, q: { type: 'string' } },
      additionalProperties: false,
    },
  },
];

async function callKiBuerokraft({ kiBuerokraftUrl, kiBuerokraftApiKey, tool, input }) {
  const path = tool.path(input || {});
  const url = `${kiBuerokraftUrl.replace(/\/$/, '')}${path}`;
  const options = {
    method: tool.method,
    headers: { Authorization: `Bearer ${kiBuerokraftApiKey}` },
  };
  if (tool.method !== 'GET') {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(tool.body ? tool.body(input || {}) : (input || {}));
  }
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const FORMULAR_FELD_TYPEN = ['text', 'mehrzeilig', 'zahl', 'datum', 'checkbox', 'auswahl'];

const FORMULAR_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    beschreibung: { type: 'string' },
    felder: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          typ: { type: 'string', enum: FORMULAR_FELD_TYPEN },
          label: { type: 'string' },
          pflicht: { type: 'boolean' },
          optionen: { type: 'array', items: { type: 'string' } },
        },
        required: ['typ', 'label', 'pflicht', 'optionen'],
        additionalProperties: false,
      },
    },
  },
  required: ['name', 'beschreibung', 'felder'],
  additionalProperties: false,
};

function buildFormularSystemPrompt() {
  return `Du hilfst einem deutschen Elektro-Handwerksbetrieb (neuverdrahtet), in der internen Verwaltungs-Software ein freies Formular (z.B. eine Sicherheitscheckliste, eine interne Abfrage, ein Freigabe-Formular) mit passenden Feldern zusammenzustellen - entweder aus einer hochgeladenen Vorlage (PDF/Foto eines bestehenden Formulars/Checkliste) oder aus kurzen Stichpunkten eines Mitarbeiters, was das Formular erfassen soll.

Verfügbare Feld-Typen (Wert für "typ", exakt so verwenden):
- "text": einzeiliges Textfeld (kurze Angaben, Namen, Orte).
- "mehrzeilig": mehrzeiliges Textfeld (Notizen, Beschreibungen, längere Freitexte).
- "zahl": numerisches Feld (Mengen, Beträge, Messwerte).
- "datum": Datumsfeld.
- "checkbox": einfaches Ja/Nein-Feld (z.B. "Erledigt", "In Ordnung", "Vorhanden").
- "auswahl": Dropdown mit fester Optionsliste (nur wenn die Vorlage/Stichpunkte eine klare, überschaubare Auswahl an Werten nahelegen, z.B. Ampel-Status, Ja/Nein/Teilweise).

Regeln:
- Antworte ausschließlich auf Deutsch.
- Ist eine Vorlage (Datei) beigefügt: baue die darin sichtbaren Felder/Abschnitte/Checklisten-Punkte so genau wie möglich nach - Reihenfolge, Beschriftungen und erkennbare Pflichtfelder (z.B. durch "*" markiert) übernehmen. Rein dekorative Elemente (Logo, Layout-Linien) werden nicht als Feld übernommen.
- Sind nur Stichpunkte (Text) gegeben: leite daraus ein sinnvolles, vollständiges Set an Feldern ab - für jeden inhaltlich eigenständigen Punkt ein eigenes Feld, mit dem am besten passenden Typ.
- Sind BEIDE gegeben (Vorlage UND Stichpunkte): die Vorlage ist die Basis, die Stichpunkte sind zusätzliche Anweisungen/Ergänzungen dazu (z.B. "und noch ein Feld für die Unterschrift").
- "optionen": NUR bei "typ":"auswahl" eine Liste der Auswahlwerte, sonst immer ein leeres Array [].
- "pflicht": true nur für Felder, die erkennbar zwingend sind (z.B. durch "*" markiert) oder inhaltlich offensichtlich nicht leer bleiben dürfen (z.B. "Name des Prüfers"). Im Zweifel false.
- "name": kurzer, prägnanter Formular-Titel (max. ca. 60 Zeichen).
- "beschreibung": ein kurzer Satz, wofür das Formular gedacht ist, oder leer lassen, wenn nicht klar ersichtlich.
- Erzeuge KEINE Felder für Dinge, die die Software bereits automatisch erfasst (Datum/Uhrzeit der Erfassung, Name des Ausfüllenden) - diese werden von der Software selbst hinzugefügt.
- Ist weder aus der Vorlage noch aus den Stichpunkten ein sinnvolles Formular ableitbar, liefere eine leere "felder"-Liste statt zu raten.`;
}

async function callClaudeFormularGenerieren({ apiKey, model, stichpunkte, fileDataUrl }) {
  const content = [];
  if (fileDataUrl) {
    const match = /^data:(image\/(?:png|jpe?g|webp)|application\/pdf);base64,(.+)$/.exec(fileDataUrl);
    if (!match) {
      throw new Error('Ungültiges Dateiformat (unterstützt: JPEG/PNG/WebP-Fotos oder PDF).');
    }
    const [, mediaType, base64Data] = match;
    content.push(mediaType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: mediaType, data: base64Data } }
      : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } });
  }
  content.push({
    type: 'text',
    text: [
      fileDataUrl ? 'Baue aus dieser Vorlage ein Formular nach.' : null,
      stichpunkte ? `Stichpunkte des Mitarbeiters:\n${stichpunkte}` : null,
    ].filter(Boolean).join('\n\n'),
  });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: buildFormularSystemPrompt(),
      messages: [{ role: 'user', content }],
      output_config: {
        format: { type: 'json_schema', schema: FORMULAR_SCHEMA },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Anthropic-API-Fehler (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  if (data.stop_reason === 'refusal') {
    throw new Error('Die Anfrage wurde von Claude aus Sicherheitsgründen abgelehnt.');
  }
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) {
    throw new Error('Keine Antwort erhalten.');
  }
  return JSON.parse(textBlock.text);
}

const ASSISTENT_CHAT_SYSTEM_PROMPT = `Du bist der interne KI-Assistent in der Verwaltungs-Software (Werkora) des deutschen Elektro-Handwerksbetriebs neuverdrahtet. Du sprichst mit einem Mitarbeiter/der Geschäftsführung, nicht mit Kunden.

Du hast über die bereitgestellten Werkzeuge (Tools) LESENDEN und teilweise SCHREIBENDEN Zugriff auf die echten Firmendaten (Kunden, Leads, Projekte, Aufgaben, Termine, Angebote, Rechnungen, Preisliste). Wichtige Regeln:
- Nutze die Tools aktiv, um Fragen zu beantworten - rate nichts, was du stattdessen nachschlagen kannst.
- Vor dem Anlegen eines neuen Kunden IMMER zuerst mit searchCustomers prüfen, ob er schon existiert (E-Mail/Telefon).
- Bei reinen Zählfragen ("Wie viele offene Aufgaben haben wir?") das jeweilige Tool nach Möglichkeit mit count=true aufrufen statt die volle Liste zu laden.
- Rechnungen anlegen, Angebote/Rechnungen versenden oder freigeben sowie jedes Löschen ist über diese API technisch gesperrt (Sicherheitsregeln der Werkora-API) - wenn danach gefragt wird, erkläre freundlich, dass das aktuell nur direkt in Werkora selbst geht, und biete stattdessen die verfügbare Alternative an (z.B. einen Angebots-Entwurf statt einer Rechnung anlegen).
- Unvollständige Belege/Ausgaben (ohne oder mit 0 Euro Betrag) kannst du eigenständig per bulkFixReceipts automatisch nachlesen und korrigieren lassen - das liest den tatsächlichen Beleginhalt per KI aus, erfindet nichts. Nicht sicher lösbare Belege werden ehrlich als "manuell zu prüfen" gemeldet (needs_manual_review), nie als erledigt ausgegeben. Bei vielen offenen Belegen mehrere bulkFixReceipts-Aufrufe hintereinander nutzen (has_more prüfen), aber sinnvoll begrenzen statt endlos zu wiederholen.
- Erfinde niemals Ergebnisse, IDs oder Daten - nutze ausschließlich das, was die Tools tatsächlich zurückgeben. Bei einem Tool-Fehler erkläre ehrlich, was schiefging.
- Antworte präzise und knapp auf Deutsch. Bei Listen mit vielen Treffern eine sinnvolle, kompakte Zusammenfassung liefern statt jeden Datensatz einzeln auszuschreiben, außer explizit nach Details gefragt wird.
- Schreibende Aktionen (Kunde/Lead/Aufgabe/Termin/Angebot anlegen oder ändern) nur nach klarem Auftrag ausführen, nicht auf Verdacht.
- searchEmails/searchCalendarEvents greifen auf das geschäftliche Gmail-Postfach/Google-Kalender zu (separate Anbindung, nicht auf jedem Worker eingerichtet) - kommt ein klarer Fehler zurück, dass diese Anbindung fehlt, erkläre das ehrlich statt es zu ignorieren oder zu erfinden.

Internetrecherche, Kalkulation und Datenpflege:
- Fehlende Informationen (Artikelbezeichnungen, Hersteller/Modellnummern, technische Daten, Materialeigenschaften, Produktvarianten, marktübliche Materialpreise, Lieferbarkeit, typische Montageschritte/Arbeitsabläufe/Zeitansätze, benötigtes Material, übliche Zusatzarbeiten, technische Voraussetzungen) darfst du eigenständig per Web-Suche recherchieren statt sie sofort zurückzugeben - bevorzugt in dieser Reihenfolge: 1) Herstellerangaben/technische Datenblätter, 2) offizielle Dokumentationen/Norm- oder Regelwerksinformationen, 3) Großhändler/etablierte Fachhändler, 4) seriöse Brancheninformationen, 5) andere nachvollziehbare Quellen. Gleiche geschäftlich wichtige Angaben nach Möglichkeit mit mehreren Quellen ab und nenne bei Bedarf Quelle und Recherchedatum.
- Reihenfolge beim Nachschlagen fehlender Informationen: erst per Tools die echten Werkora-Daten prüfen (Kunden/Projekte per searchCustomers/searchProjects, Preise per getPriceList) - erst wenn dort nichts Passendes zu finden ist, im Internet recherchieren und Ergebnisse miteinander vergleichen. Frage den Nutzer nur, wenn eine Information danach immer noch nicht zuverlässig bestimmbar ist.
- Soll-/Ist-Zeitvergleich: searchTimeEntries liefert die echte erfasste Arbeitszeit (Zeiterfassung/Stechuhr, project_id + sum_minutes) - das ist die Istzeit. Die Sollzeit ergibt sich aus den kalkulierten Std.-Positionen im zugehörigen Angebot (searchQuotes). Vergleiche beide nur, wenn du echte Werte aus beiden Quellen hast - erfinde nie eine Sollzeit ohne passende Angebots-Position. Nenne bei einer Abweichung immer beide Werte (Sollzeit, Istzeit) und ob/wie stark sie abweichen, als "Beobachtung/Empfehlung" (siehe Kennzeichnungsregel unten) - keine automatische Anpassung von Kalkulationswerten daraus.
- Preise: ein bereits in der Werkora-Preisliste (getPriceList) hinterlegter Preis hat IMMER Vorrang vor einem recherchierten Internetpreis. Recherchierte Preise sind nur eine Kalkulationsgrundlage, nicht automatisch der Verkaufspreis von neuverdrahtet. Erfinde niemals Materialaufschläge, Stundensätze oder sonstige Kalkulationsregeln - nutze ausschließlich das, was in Werkora hinterlegt ist.
- Du hast ohnehin kein Werkzeug, um Preise/Aufschläge/Stundensätze zu ändern - das ist Absicht. Erkennst du trotzdem eine sinnvolle Anpassung (z.B. weil ein Materialpreis sich laut Recherche deutlich verändert hat), ändere nichts direkt, sondern: fasse Recherche/Analyse samt Auswirkung zusammen -> lege per createTask eine Aufgabe für die Geschäftsführung an, die den bisherigen Wert, den Änderungsvorschlag und die Begründung/Quellen konkret nennt -> reserviere per createAppointment einen Termin zur Prüfung/Freigabe. Erst nach ausdrücklicher Freigabe durch den Nutzer gilt ein neuer Wert als verbindlich - ändere niemals eigenständig zentrale Verkaufspreise oder Kalkulationsregeln, wenn dadurch künftige Angebote/Rechnungen finanziell beeinflusst würden.
- Kennzeichne jede von dir gelieferte Information eindeutig als "intern bestätigt" (direkt aus Werkora-Daten), "extern verifiziert" (per Internetrecherche bestätigt, mit Quelle und Datum) oder "Schätzung/Empfehlung" (abgeleiteter/geschätzter Wert ohne gesicherte Quelle) - der Nutzer muss jederzeit erkennen können, woher ein Wert stammt. Speichere bzw. behaupte unsichere Informationen niemals als gesicherte Tatsache.`;

// Neben den eigenen Werkora-Werkzeugen (client-seitig ausgeführt, siehe
// callKiBuerokraft) bekommt der Assistent hiermit Web-Suche als serverseitig
// von Anthropic selbst ausgeführtes Tool - für fehlende technische Daten/
// Marktpreise/Herstellerangaben (siehe Regeln in ASSISTENT_CHAT_SYSTEM_PROMPT).
// max_uses begrenzt die Recherchetiefe pro Chat-Antwort aus Kosten-/
// Zeitgründen. allowed_callers:['direct'] wie beim GAEB-Preis-Tool, damit
// auch günstigere Modelle ohne "programmatic tool calling" den Aufruf nutzen
// dürfen.
const ASSISTENT_WEB_SEARCH_TOOL = { type: 'web_search_20260209', name: 'web_search', max_uses: 5, allowed_callers: ['direct'] };

async function callClaudeAssistentChat({ apiKey, model, messages, kiBuerokraftUrl, kiBuerokraftApiKey, googleConfig }) {
  let conversation = messages;
  // Sammelt jeden Tool-Aufruf mit Rohantwort - hilft bei der Fehlersuche, weil
  // das Modell einen Tool-Fehler sonst nur in eigenen (oft zu vagen) Worten
  // zusammenfasst, statt den tatsächlichen Fehlertext zu zeigen. Wird im
  // JSON-Response als "debugLog" mitgeschickt (nur zur Diagnose gedacht,
  // keine sensiblen Daten - dieselben Werte, die eh im Browser-Payload/den
  // Chat-Nachrichten sichtbar sind).
  const debugLog = [];

  // 20 statt vorher 10 Runden, damit der tägliche Büro-Check auch mehrere
  // bulkFixReceipts-Aufrufe (Beleg-Rückstand abarbeiten) hintereinander
  // durchführen kann, ohne vorzeitig abgebrochen zu werden - im normalen
  // interaktiven Chat werden davon fast nie mehr als 2-3 Runden gebraucht.
  for (let iteration = 0; iteration < 20; iteration++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        system: ASSISTENT_CHAT_SYSTEM_PROMPT,
        messages: conversation,
        tools: [...KI_BUEROKRAFT_TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema })), ASSISTENT_WEB_SEARCH_TOOL],
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Anthropic-API-Fehler (${res.status}): ${text.slice(0, 300)}`);
    }

    const data = await res.json();
    if (data.stop_reason === 'refusal') {
      throw new Error('Die Anfrage wurde von Claude aus Sicherheitsgründen abgelehnt.');
    }

    // Eine mehrstufige Web-Suche kann Anthropic mitten in der Recherche
    // anhalten (pause_turn) und um Fortsetzung bitten - das ist keine Bitte
    // um ein Tool-Ergebnis von uns, sondern läuft serverseitig weiter, sobald
    // wir denselben Content unverändert als nächste Assistenten-Runde
    // zurückschicken (analog zum GAEB-Preisrecherche-Tool).
    if (data.stop_reason === 'pause_turn') {
      conversation = [...conversation, { role: 'assistant', content: data.content }];
      continue;
    }

    const toolUses = (data.content || []).filter((b) => b.type === 'tool_use');
    if (toolUses.length === 0 || data.stop_reason !== 'tool_use') {
      const textBlock = (data.content || []).filter((b) => b.type === 'text').pop();
      return { reply: textBlock ? textBlock.text : 'Dazu kann ich gerade nichts sagen.', debugLog };
    }

    conversation = [...conversation, { role: 'assistant', content: data.content }];

    // Google-Werkzeuge (service: 'google') laufen direkt im Worker (siehe
    // callGoogleTool), alle anderen über die externe KI-Bürokraft-API -
    // jedes Werkzeug bekommt einzeln geprüft, ob die dafür nötige Anbindung
    // eingerichtet ist, statt bei fehlender Google-Anbindung gleich ALLE
    // Werkzeuge (auch die KI-Bürokraft-Werkzeuge) zu blockieren.
    const toolResults = [];
    for (const toolUse of toolUses) {
      const tool = KI_BUEROKRAFT_TOOLS.find((t) => t.name === toolUse.name);
      if (!tool) {
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: `Unbekanntes Werkzeug: ${toolUse.name}`, is_error: true });
        debugLog.push({ tool: toolUse.name, input: toolUse.input, error: 'Unbekanntes Werkzeug' });
        continue;
      }
      if (tool.service === 'google') {
        if (!googleConfig) {
          const meldung = 'Die Google-Anbindung (Gmail/Kalender) ist auf diesem Worker nicht eingerichtet (GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET fehlen oder das Google-Konto wurde noch nicht per /oauth/authorize verbunden).';
          toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: meldung, is_error: true });
          debugLog.push({ tool: toolUse.name, input: toolUse.input, error: meldung });
          continue;
        }
        try {
          const ergebnis = await callGoogleTool({ googleConfig, toolName: toolUse.name, input: toolUse.input || {} });
          toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(ergebnis).slice(0, 8000), is_error: false });
          debugLog.push({ tool: toolUse.name, input: toolUse.input, response: ergebnis });
        } catch (err) {
          toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: `Fehler beim Aufruf: ${err.message}`, is_error: true });
          debugLog.push({ tool: toolUse.name, input: toolUse.input, error: err.message });
        }
        continue;
      }
      if (!kiBuerokraftUrl || !kiBuerokraftApiKey) {
        const meldung = 'Die KI-Bürokraft-API ist auf diesem Worker nicht eingerichtet (KI_BUEROKRAFT_URL/KI_BUEROKRAFT_API_KEY fehlen).';
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: meldung, is_error: true });
        debugLog.push({ tool: toolUse.name, input: toolUse.input, error: meldung });
        continue;
      }
      try {
        const path = tool.path(toolUse.input || {});
        const { status, data: ergebnis } = await callKiBuerokraft({ kiBuerokraftUrl, kiBuerokraftApiKey, tool, input: toolUse.input || {} });
        toolResults.push({
          type: 'tool_result', tool_use_id: toolUse.id,
          content: JSON.stringify(ergebnis).slice(0, 8000),
          is_error: status >= 400,
        });
        debugLog.push({ tool: toolUse.name, input: toolUse.input, path, status, response: ergebnis });
      } catch (err) {
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: `Fehler beim Aufruf: ${err.message}`, is_error: true });
        debugLog.push({ tool: toolUse.name, input: toolUse.input, error: err.message, stack: err.stack });
      }
    }
    conversation = [...conversation, { role: 'user', content: toolResults }];
  }

  return { reply: 'Das dauert gerade zu lange oder braucht zu viele Schritte - bitte die Frage eingrenzen oder in Werkora direkt nachsehen.', debugLog };
}

// --- Push-Versand (Firebase Cloud Messaging HTTP v1, Server-Auth per Service Account) ---

function base64UrlEncode(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemPrivateKeyToBinary(pem) {
  const base64 = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Signiert ein Google-OAuth2-Service-Account-JWT und tauscht es gegen einen Access-Token. */
async function getGoogleAccessToken(serviceAccount, scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: serviceAccount.client_email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`;

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pemPrivateKeyToBinary(serviceAccount.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${base64UrlEncode(signature)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google-OAuth-Fehler (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.access_token;
}

/** Sendet eine Push-Nachricht je Geräte-Token; ungültige/abgelaufene Tokens brechen die restlichen nicht ab. */
async function sendFcmMessages({ serviceAccount, tokens, title, body, url }) {
  const accessToken = await getGoogleAccessToken(serviceAccount, 'https://www.googleapis.com/auth/firebase.messaging');
  return Promise.all(tokens.map(async (token) => {
    try {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: title || 'neuverdrahtet Verwaltung', body: body || '' },
            ...(url ? { webpush: { fcm_options: { link: url } } } : {}),
          },
        }),
      });
      return { token, ok: res.ok };
    } catch {
      return { token, ok: false };
    }
  }));
}

// --- Firestore-Lesezugriff per REST (nur für den täglichen Büro-Check nötig,
// um die Geräte-Tokens für die Push-Benachrichtigung zu ermitteln - der
// Worker hat sonst keinen eigenständigen Firestore-Zugriff, das läuft normal
// ausschließlich über den Browser/das Firebase-SDK). Nutzt denselben Service-
// Account wie der Push-Versand. ---

function firestoreValueToJs(value) {
  if (!value || typeof value !== 'object') return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(firestoreValueToJs);
  if ('mapValue' in value) return firestoreFieldsToObject(value.mapValue.fields || {});
  return null;
}

function firestoreFieldsToObject(fields) {
  const obj = {};
  for (const [key, value] of Object.entries(fields)) obj[key] = firestoreValueToJs(value);
  return obj;
}

/** Liest alle Dokumente einer Firestore-Collection per REST (mit Pagination). */
async function firestoreListDocuments({ serviceAccount, collection }) {
  const accessToken = await getGoogleAccessToken(serviceAccount, 'https://www.googleapis.com/auth/datastore');
  const docs = [];
  let pageToken = '';
  do {
    const url = `https://firestore.googleapis.com/v1/projects/${serviceAccount.project_id}/databases/(default)/documents/${collection}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Firestore-Fehler (${res.status}): ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    for (const doc of data.documents || []) {
      docs.push({ id: doc.name.split('/').pop(), ...firestoreFieldsToObject(doc.fields || {}) });
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return docs;
}

function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  if (typeof v === 'object') return { mapValue: { fields: toFirestoreFields(v) } };
  return { stringValue: String(v) };
}
function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, val] of Object.entries(obj)) { if (val !== undefined) fields[k] = toFirestoreValue(val); }
  return fields;
}

/** Liest ein einzelnes Firestore-Dokument per REST (null bei 404). */
async function firestoreGetDoc({ serviceAccount, collection, id }) {
  const accessToken = await getGoogleAccessToken(serviceAccount, 'https://www.googleapis.com/auth/datastore');
  const url = `https://firestore.googleapis.com/v1/projects/${serviceAccount.project_id}/databases/(default)/documents/${collection}/${id}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore-Fehler (${res.status}) bei ${collection}/${id}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  const data = await res.json();
  return { id, ...firestoreFieldsToObject(data.fields || {}) };
}

/** Schreibt (merged, PATCH) ein einzelnes Firestore-Dokument per REST. */
async function firestoreSetDoc({ serviceAccount, collection, id, data }) {
  const accessToken = await getGoogleAccessToken(serviceAccount, 'https://www.googleapis.com/auth/datastore');
  const url = `https://firestore.googleapis.com/v1/projects/${serviceAccount.project_id}/databases/(default)/documents/${collection}/${id}`;
  const res = await fetch(url, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ fields: toFirestoreFields(data) }),
  });
  if (!res.ok) throw new Error(`Firestore-Fehler (${res.status}) beim Schreiben von ${collection}/${id}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
}

// --- Kunden-Upload (externer Upload-Link, siehe /kunde-upload unten) -
// Dateien landen per Service-Account direkt in Firebase Storage, ganz ohne
// Firebase-Auth-Login des Kunden. storage.rules bleibt dadurch bewusst
// unangetastet (siehe Kommentar dort: Storage<->Firestore-Cross-Rules lassen
// sich mit dem lokalen Emulator nicht zuverlässig testen). ---

function uint8ArrayFromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Lädt Rohbytes per Service-Account über die Google-Cloud-Storage-JSON-API
 * hoch (nicht die Firebase-SDK) und setzt anschließend die Firebase-eigene
 * "firebaseStorageDownloadTokens"-Metadata - nur damit funktioniert die
 * normale firebasestorage.googleapis.com-Download-URL, die die Verwaltung
 * (blobstore.js getDownloadURL) überall sonst nutzt.
 */
async function storageUploadFileWithToken({ serviceAccount, bucket, path, contentType, bytes }) {
  const accessToken = await getGoogleAccessToken(serviceAccount, 'https://www.googleapis.com/auth/devstorage.read_write');
  const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(path)}`;
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': contentType },
    body: bytes,
  });
  if (!uploadRes.ok) throw new Error(`Storage-Upload-Fehler (${uploadRes.status}): ${(await uploadRes.text().catch(() => '')).slice(0, 300)}`);

  const downloadToken = crypto.randomUUID();
  const patchUrl = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(path)}`;
  const patchRes = await fetch(patchUrl, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ metadata: { firebaseStorageDownloadTokens: downloadToken } }),
  });
  if (!patchRes.ok) throw new Error(`Storage-Metadata-Fehler (${patchRes.status}): ${(await patchRes.text().catch(() => '')).slice(0, 300)}`);

  return { url: `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=${downloadToken}`, path };
}

// Begrenzt /kunde-upload auf 10 Anfragen je IP und Minute (siehe wrangler.toml
// [[ratelimits]]) - schützt vor einem Skript, das mit einem (z.B. abgelaufenen
// oder erratenen) Token versucht, die Route zu fluten. env.RATE_LIMITER kann
// fehlen (Binding noch nicht deployed) - dann einfach nicht blockieren.
async function unterSchwellenwert(env, ip) {
  if (!env.RATE_LIMITER) return true;
  try {
    const { success } = await env.RATE_LIMITER.limit({ key: ip });
    return success;
  } catch {
    return true;
  }
}

/** Validiert Token+Datei und legt den Upload als normalen dokumente-Eintrag des Kunden an (siehe handler unten). */
async function handleKundenUpload({ env, body }) {
  const { token, dateiname, fileDataUrl, beschreibung } = body || {};
  if (!token || typeof token !== 'string') {
    const err = new Error('Kein gültiger Link (Token fehlt).'); err.status = 400; throw err;
  }
  const match = /^data:(image\/(?:png|jpe?g|webp)|application\/pdf);base64,(.+)$/.exec(fileDataUrl || '');
  if (!match) {
    const err = new Error('Ungültiges Dateiformat (unterstützt: JPEG/PNG/WebP-Fotos oder PDF).'); err.status = 400; throw err;
  }
  const [, contentType, base64Data] = match;
  const bytes = uint8ArrayFromBase64(base64Data);
  if (bytes.length > 25 * 1024 * 1024) {
    const err = new Error('Datei ist zu groß (maximal 25 MB).'); err.status = 400; throw err;
  }
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const err = new Error('Upload ist serverseitig nicht eingerichtet.'); err.status = 500; throw err;
  }
  const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);

  const link = await firestoreGetDoc({ serviceAccount, collection: 'uploadLinks', id: token });
  if (!link) {
    const err = new Error('Dieser Link ist ungültig oder wurde entfernt.'); err.status = 404; throw err;
  }
  const heute = new Date().toISOString().slice(0, 10);
  if (link.ablaufAm && link.ablaufAm < heute) {
    const err = new Error('Dieser Link ist abgelaufen - bitte einen neuen Link anfordern.'); err.status = 410; throw err;
  }

  const bucket = env.FIREBASE_STORAGE_BUCKET || `${serviceAccount.project_id}.firebasestorage.app`;
  const dokId = crypto.randomUUID();
  const sicherDateiname = String(dateiname || 'Datei').replace(/[^a-zA-Z0-9äöüÄÖÜß._ -]/g, '_').slice(0, 120) || 'Datei';
  const path = `dokumente/kunde/${link.kundeId}/${dokId}`;
  const { url } = await storageUploadFileWithToken({ serviceAccount, bucket, path, contentType, bytes });

  await firestoreSetDoc({
    serviceAccount, collection: 'dokumente', id: dokId,
    data: {
      id: dokId, bezugTyp: 'kunde', bezugId: link.kundeId, kategorie: 'sonstiges',
      name: sicherDateiname, mime: contentType, groesse: bytes.length,
      erstelltAm: new Date().toISOString(), url, path,
      vonKundeHochgeladen: true, uploadBeschreibung: String(beschreibung || '').slice(0, 500),
    },
  });
  return { ok: true };
}

// --- Google-Büro (Gmail + Kalender) - läuft bewusst IM Haupt-Worker statt in
// einem eigenen dritten Worker: erspart eine zusätzliche Worker-zu-Worker-
// Verbindung samt eigener URL/API-Key nur für diese zwei Werkzeuge. Nutzt
// denselben Firebase-Service-Account wie Push-Versand/Tagescheck, um den
// einmalig erzeugten Google-Refresh-Token in Firestore
// (Collection google_oauth_tokens) zu lesen/schreiben. ---

const GOOGLE_OAUTH_SCOPES = 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

function base64UrlDecodeToString(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

function buildGoogleAuthUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: GOOGLE_OAUTH_SCOPES,
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state: state || '',
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

async function exchangeGoogleCodeForTokens({ clientId, clientSecret, redirectUri, code }) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri }),
  });
  if (!res.ok) throw new Error(`Google-OAuth-Code-Tausch fehlgeschlagen (${res.status}): ${(await res.text().catch(() => '')).slice(0, 300)}`);
  return res.json();
}

async function refreshGoogleUserAccessToken({ clientId, clientSecret, refreshToken }) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }),
  });
  if (!res.ok) throw new Error(`Google-Zugriffstoken-Erneuerung fehlgeschlagen (${res.status}): ${(await res.text().catch(() => '')).slice(0, 300)}. Eventuell muss die Google-Verbindung erneut über /oauth/authorize hergestellt werden.`);
  return (await res.json()).access_token;
}

/** Liest den gespeicherten Google-Refresh-Token aus Firestore und tauscht ihn gegen ein frisches Zugriffstoken für Gmail/Kalender. */
async function getGoogleUserAccessToken({ serviceAccount, clientId, clientSecret }) {
  const tokenDoc = await firestoreGetDoc({ serviceAccount, collection: 'google_oauth_tokens', id: 'neuverdrahtet' });
  if (!tokenDoc || !tokenDoc.refresh_token) {
    throw new Error('Google-Konto (Gmail/Kalender) ist noch nicht verbunden. Einmalig /oauth/authorize?setup_key=... im Browser aufrufen.');
  }
  return refreshGoogleUserAccessToken({ clientId, clientSecret, refreshToken: tokenDoc.refresh_token });
}

function buildGmailQuery({ q, unread, from, to, subject, after, before }) {
  const parts = [];
  if (q) parts.push(q);
  if (unread) parts.push('is:unread');
  if (from) parts.push(`from:${from}`);
  if (to) parts.push(`to:${to}`);
  if (subject) parts.push(`subject:${subject}`);
  if (after) parts.push(`after:${after.replace(/-/g, '/')}`);
  if (before) parts.push(`before:${before.replace(/-/g, '/')}`);
  return parts.join(' ');
}

function getGmailHeader(payload, name) {
  const h = (payload?.headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

/** Läuft rekursiv durch die MIME-Teile einer Nachricht und liefert reinen Text plus Anhang-Metadaten. */
function extractGmailBody(payload) {
  let text = '';
  let html = '';
  function walk(part) {
    if (!part) return;
    if (part.mimeType === 'text/plain' && part.body?.data) text += base64UrlDecodeToString(part.body.data);
    else if (part.mimeType === 'text/html' && part.body?.data) html += base64UrlDecodeToString(part.body.data);
    for (const child of part.parts || []) walk(child);
  }
  walk(payload);
  if (!text && html) text = html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.trim();
}

function gmailMessageToApi(msg) {
  return {
    message_id: msg.id, thread_id: msg.threadId,
    from: getGmailHeader(msg.payload, 'From'), to: getGmailHeader(msg.payload, 'To'), subject: getGmailHeader(msg.payload, 'Subject'),
    date: getGmailHeader(msg.payload, 'Date'), snippet: msg.snippet || '', body_text: extractGmailBody(msg.payload).slice(0, 2000), labels: msg.labelIds || [],
  };
}

async function gmailFetch(accessToken, path) {
  const res = await fetch(`${GMAIL_API}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Gmail-API-Fehler (${res.status}) bei ${path}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  return res.json();
}

async function calendarFetch(accessToken, path) {
  const res = await fetch(`${CALENDAR_API}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Kalender-API-Fehler (${res.status}) bei ${path}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  return res.json();
}

function calendarEventToApi(ev) {
  return {
    id: ev.id, title: ev.summary || '', description: ev.description || '', location: ev.location || '',
    start: ev.start?.dateTime || ev.start?.date || '', end: ev.end?.dateTime || ev.end?.date || '',
    attendees: (ev.attendees || []).map((a) => a.email), status: ev.status || '',
  };
}

/** Führt searchEmails/searchCalendarEvents direkt aus (kein Worker-zu-Worker-Aufruf nötig). */
async function callGoogleTool({ googleConfig, toolName, input }) {
  const serviceAccount = JSON.parse(googleConfig.firebaseServiceAccountJson);
  const accessToken = await getGoogleUserAccessToken({
    serviceAccount, clientId: googleConfig.clientId, clientSecret: googleConfig.clientSecret,
  });
  if (toolName === 'searchEmails') {
    const gq = buildGmailQuery(input || {});
    const list = await gmailFetch(accessToken, `/messages?maxResults=25${gq ? `&q=${encodeURIComponent(gq)}` : ''}`);
    const details = await Promise.all((list.messages || []).map((m) => gmailFetch(accessToken, `/messages/${m.id}?format=full`)));
    return details.map(gmailMessageToApi);
  }
  if (toolName === 'searchCalendarEvents') {
    const calendarId = googleConfig.calendarId || 'primary';
    const params = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', maxResults: '50' });
    if (input?.date_from) params.set('timeMin', new Date(input.date_from).toISOString());
    if (input?.date_to) params.set('timeMax', new Date(input.date_to).toISOString());
    if (input?.q) params.set('q', input.q);
    const list = await calendarFetch(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`);
    return (list.items || []).map(calendarEventToApi);
  }
  throw new Error(`Unbekanntes Google-Werkzeug: ${toolName}`);
}

/** null, wenn die Google-Anbindung (Gmail/Kalender) nicht eingerichtet ist - dann bleiben nur diese zwei Werkzeuge inaktiv, alles andere läuft normal weiter. */
function buildGoogleConfig(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON || !env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) return null;
  return {
    firebaseServiceAccountJson: env.FIREBASE_SERVICE_ACCOUNT_JSON,
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    calendarId: env.GOOGLE_CALENDAR_ID || 'primary',
  };
}

// --- Täglicher automatischer Büro-Check (Cloudflare Cron Trigger) ---
//
// Läuft ohne Mitarbeiter-Interaktion einmal morgens durch dieselbe
// Tool-Loop wie der interaktive KI-Assistent (siehe callClaudeAssistentChat)
// - mit einem festen Auftrag statt einer Chat-Nachricht. Die KI prüft
// Aufgaben/Rechnungen/Termine/Leads, legt bei Bedarf per createTask neue
// Aufgaben an und schließt IMMER mit einer Tages-Zusammenfassungs-Aufgabe ab.
// Zusätzlich wird eine Push-Benachrichtigung an alle admin/büro-Geräte
// geschickt. Eine E-Mail-Zusammenfassung ist bewusst (noch) nicht
// eingebaut - dafür fehlt aktuell ein serverseitiger E-Mail-Versandweg (das
// bestehende E-Mail-Feature läuft über die Gmail-Anbindung im Browser, die
// bei einem nächtlichen Cron-Lauf ohne offene App nicht zur Verfügung
// steht).
function buildTagescheckPrompt(heute, { googleVerfuegbar = false } = {}) {
  return `Führe jetzt deinen täglichen Büro-Check durch (automatischer Lauf ohne Mitarbeiter - es beantwortet dir gerade niemand Rückfragen, entscheide eigenständig im Rahmen deiner Regeln). Heutiges Datum: ${heute}.

Gehe systematisch vor:
1. getDashboard für den Überblick.
2. searchTasks (status=offen) auf überfällige oder heute fällige Aufgaben prüfen.
3. searchInvoices (status=overdue) auf überfällige Rechnungen prüfen.
4. searchAppointments für die nächsten Tage auf anstehende Termine prüfen, für die ggf. noch etwas vorzubereiten ist.
5. searchLeads auf unbearbeitete Leads ohne next_action prüfen.
6. searchExpenses mit incomplete=true prüfen, ob unvollständige Belege (ohne/mit 0 Euro Betrag) offen sind. Falls ja: räume den Rückstand per bulkFixReceipts (limit=25) ab - wiederhole den Aufruf, solange has_more=true ist, aber höchstens 6 Aufrufe in diesem Lauf (der Rest folgt automatisch beim nächsten täglichen Check). Erfinde dabei nichts - Belege, die bulkFixReceipts als needs_manual_review meldet, bleiben offen und werden nur zusammengefasst, nicht als erledigt gemeldet.
7. Soll-/Ist-Zeitvergleich: prüfe searchProjects für laufende Projekte (Status "in Arbeit"/vergleichbar). Für jedes: kalkulierte Stunden aus den zugehörigen Std.-Positionen im Angebot (searchQuotes) mit der tatsächlich erfassten Zeit (searchTimeEntries, project_id + sum_minutes) vergleichen. Weicht die Istzeit deutlich (z.B. >20%) von der Sollzeit ab, per createTask eine Aufgabe mit Sollzeit/Istzeit/Abweichung anlegen - keine automatische Anpassung von Kalkulationswerten, nur eine Beobachtung/Empfehlung zur Prüfung (siehe deine Regeln zu Kalkulation/Datenpflege).
${googleVerfuegbar ? `8. searchEmails mit unread=true auf ungelesene wichtige E-Mails prüfen (grob überfliegen, nicht jede einzeln bearbeiten) - bei erkennbar dringenden/kundenbezogenen Mails eine Aufgabe anlegen. searchCalendarEvents für die nächsten paar Tage auf Termine prüfen, die nicht schon in Werkora als Termin erfasst sind, und ggf. darauf hinweisen.` : ''}
${googleVerfuegbar ? '9' : '8'}. Recherchiere nur bei erkennbarem konkretem Bedarf zusätzlich im Internet (nach deinen Regeln zu Internetrecherche/Kalkulation) - der heutige Schwerpunkt ist der Überblick, nicht die tiefe Recherche.
${googleVerfuegbar ? '10' : '9'}. Lege per createTask für jede wirklich handlungsbedürftige Sache, für die noch keine passende Aufgabe existiert, eine konkrete Aufgabe an (sprechender Titel, passende Priorität, ggf. Fälligkeitsdatum, Kunden-/Projektbezug).
${googleVerfuegbar ? '11' : '10'}. Schließe den Lauf IMMER mit genau einer weiteren Aufgabe ab: Titel "Tages-Zusammenfassung ${heute}", die knapp auflistet was geprüft wurde und was heute wichtig ist - inkl. wie viele Belege automatisch erledigt wurden, wie viele noch manuell geprüft werden müssen, und auffällige Soll-/Ist-Zeitabweichungen${googleVerfuegbar ? ' sowie relevante E-Mails/Kalendertermine' : ''} (auch wenn sonst nichts Dringendes ansteht - dann das kurz so vermerken).

Antworte danach zusätzlich mit einer kurzen Fließtext-Zusammenfassung (max. 3-4 Sätze, ohne Aufzählungszeichen, geeignet als Text einer Push-Benachrichtigung).`;
}

async function runTagescheck(env) {
  if (!env.ANTHROPIC_API_KEY || !env.KI_BUEROKRAFT_URL || !env.KI_BUEROKRAFT_API_KEY) {
    console.log('Täglicher Büro-Check übersprungen: ANTHROPIC_API_KEY/KI_BUEROKRAFT_URL/KI_BUEROKRAFT_API_KEY fehlt.');
    return;
  }

  const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }); // sv-SE liefert zuverlässig das Format YYYY-MM-DD
  const googleConfig = buildGoogleConfig(env);
  let ergebnis;
  try {
    ergebnis = await callClaudeAssistentChat({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.MODEL_ID || 'claude-opus-4-8',
      messages: [{ role: 'user', content: buildTagescheckPrompt(heute, { googleVerfuegbar: !!googleConfig }) }],
      kiBuerokraftUrl: env.KI_BUEROKRAFT_URL,
      kiBuerokraftApiKey: env.KI_BUEROKRAFT_API_KEY,
      googleConfig,
    });
  } catch (err) {
    console.log('Täglicher Büro-Check fehlgeschlagen:', err.message);
    return;
  }

  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) return; // Aufgabe(n) wurden trotzdem angelegt, nur der Push entfällt

  try {
    const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
    const tokenDocs = await firestoreListDocuments({ serviceAccount, collection: 'pushTokens' });
    const tokens = tokenDocs.filter((t) => ['admin', 'buero'].includes(t.role)).map((t) => t.id);
    if (tokens.length === 0) return;
    await sendFcmMessages({
      serviceAccount,
      tokens,
      title: 'Täglicher Büro-Check',
      body: (ergebnis.reply || 'Der tägliche Check ist fertig - Details in der neuen Aufgabe.').slice(0, 500),
      url: './index.html#/aufgaben',
    });
  } catch (err) {
    console.log('Push nach täglichem Büro-Check fehlgeschlagen:', err.message);
  }
}

// Wie viele Katalog-Einträge je wöchentlichem Lauf geprüft werden - absichtlich
// klein gehalten (Kosten/Laufzeit der Web-Suche), rotiert aber über
// "preisZuletztGeprueft" (älteste/nie geprüfte Einträge zuerst) komplett durch
// den gesamten Katalog, nur eben über mehrere Wochen verteilt.
const KATALOG_AKTUALISIERUNG_BATCH_SIZE = 25;

/**
 * Wöchentlicher automatischer Katalog-Check (Cloudflare Cron Trigger, siehe
 * scheduled() unten): recherchiert für einen rotierenden Ausschnitt des
 * Artikel-/Leistungskatalogs per Web-Search aktuelle Marktpreise und schlägt
 * vereinzelt offensichtlich fehlende Standardpositionen vor. Ändert NIEMALS
 * direkt den Katalog (Preise fließen in echte Angebote/Rechnungen ein) -
 * jedes Ergebnis landet nur als Vorschlag in der Firestore-Collection
 * "katalogVorschlaege" zur menschlichen Prüfung (Verwaltung -> Katalog ->
 * "Preis-Vorschläge"). "paket"-Einträge und mit lexoffice verknüpfte Artikel
 * werden übersprungen (ihr Preis wird an anderer Stelle gepflegt).
 */
async function runKatalogAktualisierung(env) {
  if (!env.ANTHROPIC_API_KEY || !env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    console.log('Wöchentliche Katalog-Aktualisierung übersprungen: ANTHROPIC_API_KEY/FIREBASE_SERVICE_ACCOUNT_JSON fehlt.');
    return;
  }
  const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);

  let katalog;
  try {
    katalog = await firestoreListDocuments({ serviceAccount, collection: 'katalog' });
  } catch (err) {
    console.log('Wöchentliche Katalog-Aktualisierung fehlgeschlagen (Katalog lesen):', err.message);
    return;
  }

  const kandidaten = katalog
    .filter((k) => k.typ !== 'paket' && !k.lexofficeArtikelId && k.bezeichnung)
    .sort((a, b) => (a.preisZuletztGeprueft || '').localeCompare(b.preisZuletztGeprueft || ''))
    .slice(0, KATALOG_AKTUALISIERUNG_BATCH_SIZE);
  if (kandidaten.length === 0) return;

  const gewerke = [...new Set(katalog.map((k) => k.gewerk).filter(Boolean))];
  const items = kandidaten.map((k, index) => ({
    index, katalogId: k.id, bezeichnung: k.bezeichnung, einheit: k.einheit, gewerk: k.gewerk, aktuellerPreis: Number(k.preis) || 0,
  }));

  // Für den Dublikat-Check bei "neue Positionen" (Aufgabe 2, siehe Prompt)
  // UND als Sicherheitsnetz im Code (falls die KI die Liste trotzdem
  // übersieht): sowohl bereits vorhandene Katalog-Bezeichnungen als auch
  // bereits offene "neu"-Vorschläge aus früheren Läufen berücksichtigen,
  // damit dieselbe fehlende Position nicht Woche für Woche erneut
  // vorgeschlagen wird, solange der alte Vorschlag noch unbearbeitet ist.
  const normName = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  let offeneNeuVorschlaege = [];
  try {
    offeneNeuVorschlaege = (await firestoreListDocuments({ serviceAccount, collection: 'katalogVorschlaege' }))
      .filter((v) => v.typ === 'neu' && v.status === 'offen');
  } catch { /* Dublikat-Check ist ein Sicherheitsnetz, darf den Lauf nicht blockieren */ }
  const bekannteNamen = new Set([
    ...katalog.map((k) => normName(k.bezeichnung)),
    ...offeneNeuVorschlaege.map((v) => normName(v.bezeichnung)),
  ]);
  const vorhandeneBezeichnungen = [...new Set(katalog.map((k) => k.bezeichnung).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));

  let ergebnis;
  try {
    ergebnis = await callClaudeKatalogAktualisierung({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.MODEL_ID || 'claude-opus-4-8',
      items,
      gewerke,
      vorhandeneBezeichnungen,
    });
  } catch (err) {
    console.log('Wöchentliche Katalog-Aktualisierung fehlgeschlagen (Recherche):', err.message);
    return;
  }

  const heuteIso = new Date().toISOString();
  let anzahlPreisvorschlaege = 0;
  try {
    for (const p of ergebnis.preise || []) {
      const item = items[p.index];
      if (!item) continue;
      // "preisZuletztGeprueft" wird für JEDEN geprüften Eintrag gesetzt (auch
      // ohne nennenswerte Preisänderung), damit die Rotation beim nächsten
      // Lauf zu den noch nicht geprüften Einträgen weiterwandert. Dafür den
      // Eintrag bewusst FRISCH lesen statt den Stand vom Laufbeginn zu
      // verwenden (firestoreSetDoc schreibt das komplette Dokument neu) -
      // falls der Eintrag zwischenzeitlich (z.B. manuell in der Verwaltung)
      // geändert wurde, würde eine ältere Kopie diese Änderung sonst
      // stillschweigend überschreiben.
      const aktuellerStand = await firestoreGetDoc({ serviceAccount, collection: 'katalog', id: item.katalogId });
      if (!aktuellerStand) continue; // zwischenzeitlich gelöscht
      await firestoreSetDoc({
        serviceAccount, collection: 'katalog', id: item.katalogId,
        data: { ...aktuellerStand, preisZuletztGeprueft: heuteIso },
      });
      if (!p.gefunden) continue;
      const neuerPreis = Math.round(Number(p.neuerPreis) * 100) / 100;
      const differenz = Math.abs(neuerPreis - item.aktuellerPreis);
      const relevant = differenz >= 0.5 && differenz / Math.max(item.aktuellerPreis, 0.01) >= 0.05;
      if (!relevant) continue;
      const vorschlagId = crypto.randomUUID();
      await firestoreSetDoc({
        serviceAccount, collection: 'katalogVorschlaege', id: vorschlagId,
        data: {
          id: vorschlagId, typ: 'preis', katalogId: item.katalogId, bezeichnung: item.bezeichnung, einheit: item.einheit,
          alterPreis: item.aktuellerPreis, neuerPreis, quelle: (p.quelle || '').slice(0, 200), status: 'offen', erstelltAm: heuteIso,
        },
      });
      anzahlPreisvorschlaege++;
    }

    let anzahlNeueVorschlaege = 0;
    for (const n of (ergebnis.neueVorschlaege || []).slice(0, 5)) {
      if (!n.bezeichnung) continue;
      // Sicherheitsnetz gegen Dubletten, falls die KI die mitgelieferte
      // Bezeichnungs-Liste trotzdem übersehen hat (siehe Prompt-Kommentar
      // oben) - exakte/normalisierte Übereinstimmung, keine Fuzzy-Logik.
      if (bekannteNamen.has(normName(n.bezeichnung))) continue;
      bekannteNamen.add(normName(n.bezeichnung)); // verhindert Dublikate auch innerhalb derselben Vorschlagsliste
      const vorschlagId = crypto.randomUUID();
      await firestoreSetDoc({
        serviceAccount, collection: 'katalogVorschlaege', id: vorschlagId,
        data: {
          id: vorschlagId, typ: 'neu', typVorschlag: n.typ === 'leistung' ? 'leistung' : 'artikel', bezeichnung: n.bezeichnung,
          einheit: n.einheit || '', neuerPreis: Math.round((Number(n.preis) || 0) * 100) / 100, gewerk: n.gewerk || '',
          begruendung: (n.begruendung || '').slice(0, 300), quelle: (n.quelle || '').slice(0, 200), status: 'offen', erstelltAm: heuteIso,
        },
      });
      anzahlNeueVorschlaege++;
    }

    if (anzahlPreisvorschlaege > 0 || anzahlNeueVorschlaege > 0) {
      const tokenDocs = await firestoreListDocuments({ serviceAccount, collection: 'pushTokens' });
      const tokens = tokenDocs.filter((t) => ['admin', 'buero'].includes(t.role)).map((t) => t.id);
      if (tokens.length > 0) {
        await sendFcmMessages({
          serviceAccount,
          tokens,
          title: 'Katalog-Vorschläge warten auf Prüfung',
          body: `${anzahlPreisvorschlaege} Preis-Update(s), ${anzahlNeueVorschlaege} neue Position(en) aus der wöchentlichen Katalog-Prüfung.`,
          url: './index.html#/katalog-vorschlaege',
        });
      }
    }
  } catch (err) {
    console.log('Wöchentliche Katalog-Aktualisierung fehlgeschlagen (Vorschläge schreiben):', err.message);
  }
}

export default {
  /** Cloudflare Cron Trigger - siehe Dashboard -> dieser Worker -> Settings -> Triggers -> Cron Triggers. */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runTagescheck(env));
    // Läuft bewusst im selben (einzigen) Cron-Trigger statt mit einem
    // zweiten eigenen Trigger - Cloudflare Workers Free begrenzt Cron-
    // Trigger auf 5 PRO ACCOUNT (nicht pro Worker), ein zweiter Trigger
    // würde den Deploy je nach Kontostand zum Scheitern bringen.
    const heuteWochentag = new Date().toLocaleDateString('en-US', { timeZone: 'Europe/Berlin', weekday: 'long' });
    if (heuteWochentag === 'Monday') {
      ctx.waitUntil(runKatalogAktualisierung(env));
    }
  },

  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    // --- Google-OAuth-Einrichtung (einmalig im Browser aufgerufen, siehe
    // Datei-Kopf) - läuft VOR der normalen POST/APP_SECRET-Prüfung, da das
    // ein normaler Browser-Redirect (GET) ist, kein API-Aufruf aus der App.
    // Geschützt über einen eigenen OAUTH_SETUP_SECRET statt des APP_SECRET,
    // damit niemand sonst versehentlich/böswillig die Google-Verbindung an
    // sich reißen kann.
    {
      const url = new URL(request.url);
      const teile = url.pathname.split('/').filter(Boolean);
      if (teile[0] === 'oauth' && teile[1] === 'authorize') {
        if (!env.OAUTH_SETUP_SECRET || url.searchParams.get('setup_key') !== env.OAUTH_SETUP_SECRET) {
          return new Response('Ungültiger oder fehlender setup_key.', { status: 403 });
        }
        if (!env.GOOGLE_OAUTH_CLIENT_ID) return new Response('GOOGLE_OAUTH_CLIENT_ID fehlt.', { status: 500 });
        const redirectUri = `${url.origin}/oauth/callback`;
        const authUrl = buildGoogleAuthUrl({ clientId: env.GOOGLE_OAUTH_CLIENT_ID, redirectUri, state: env.OAUTH_SETUP_SECRET });
        return Response.redirect(authUrl, 302);
      }
      // Externer Kunden-Upload-Link (siehe kunden.js "Upload-Link erstellen"
      // und upload.html am Repo-Root) - ein Kunde ruft diese Route OHNE
      // jeden Login auf, Autorisierung läuft stattdessen über den Token
      // selbst (geprüft gegen die Firestore-Collection uploadLinks). Läuft
      // deshalb bewusst VOR der generellen APP_SECRET-/Origin-Prüfung unten
      // (ein geteilter Link soll z.B. auch aus WhatsApp/einer E-Mail heraus
      // funktionieren, nicht nur von neuverdrahtet.com aus) - Schutz vor
      // Missbrauch kommt stattdessen vom Token selbst (lang, zufällig,
      // läuft automatisch ab) plus dem Rate-Limit unten.
      if (teile[0] === 'kunde-upload' && request.method === 'POST') {
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        if (!(await unterSchwellenwert(env, ip))) {
          return new Response(JSON.stringify({ error: 'Zu viele Anfragen - bitte kurz warten.' }), {
            status: 429, headers: { ...headers, 'Content-Type': 'application/json' },
          });
        }
        let uploadBody;
        try {
          uploadBody = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: 'Ungültiger Request-Body.' }), {
            status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
          });
        }
        try {
          const result = await handleKundenUpload({ env, body: uploadBody });
          return new Response(JSON.stringify(result), { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message || 'Unbekannter Fehler' }), {
            status: err.status || 500, headers: { ...headers, 'Content-Type': 'application/json' },
          });
        }
      }

      if (teile[0] === 'oauth' && teile[1] === 'callback') {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        if (!code || !env.OAUTH_SETUP_SECRET || state !== env.OAUTH_SETUP_SECRET) {
          return new Response('Ungültige OAuth-Antwort (code/state fehlt oder falsch).', { status: 403 });
        }
        if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) return new Response('FIREBASE_SERVICE_ACCOUNT_JSON fehlt.', { status: 500 });
        try {
          const redirectUri = `${url.origin}/oauth/callback`;
          const tokens = await exchangeGoogleCodeForTokens({ clientId: env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET, redirectUri, code });
          if (!tokens.refresh_token) {
            return new Response('Google hat keinen Refresh-Token geliefert. Bitte die Verbindung beim Google-Konto unter "Apps mit Kontozugriff" entfernen und /oauth/authorize erneut aufrufen.', { status: 400 });
          }
          const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
          await firestoreSetDoc({
            serviceAccount, collection: 'google_oauth_tokens', id: 'neuverdrahtet',
            data: { refresh_token: tokens.refresh_token, scope: tokens.scope || GOOGLE_OAUTH_SCOPES, connected_at: new Date().toISOString() },
          });
          return new Response('Google-Konto erfolgreich mit Werkora verbunden. Dieses Fenster kann geschlossen werden.', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        } catch (err) {
          return new Response(`Fehler beim Verbinden: ${err.message || 'Unbekannter Fehler'}`, { status: 500 });
        }
      }
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers });
    }
    if (!getAllowedOrigins(env).includes(origin)) {
      return new Response(JSON.stringify({ error: 'Origin nicht erlaubt.' }), {
        status: 403, headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }
    if (!env.APP_SECRET || request.headers.get('X-App-Secret') !== env.APP_SECRET) {
      return new Response(JSON.stringify({ error: 'Nicht autorisiert.' }), {
        status: 401, headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Ungültiger Request-Body.' }), {
        status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    // Push-Versand braucht kein ANTHROPIC_API_KEY (anderer Secret-Satz), daher
    // vor der Prüfung darauf abgehandelt.
    if (body.action === 'push-send') {
      if (!Array.isArray(body.tokens) || body.tokens.length === 0) {
        return new Response(JSON.stringify({ error: 'Feld "tokens" fehlt.' }), {
          status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
      if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        return new Response(JSON.stringify({ error: 'Worker ist nicht korrekt eingerichtet (FIREBASE_SERVICE_ACCOUNT_JSON fehlt).' }), {
          status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
      try {
        const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
        const results = await sendFcmMessages({
          serviceAccount, tokens: body.tokens, title: body.title, body: body.body, url: body.url,
        });
        return new Response(JSON.stringify({ results }), {
          status: 200, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message || 'Unbekannter Fehler' }), {
          status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
    }

    if (!env.ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'Worker ist nicht korrekt eingerichtet (ANTHROPIC_API_KEY fehlt).' }), {
        status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    if (body.action === 'beleg-scan') {
      const hatXml = typeof body.xmlText === 'string' && body.xmlText.trim();
      const hatUrl = typeof body.belegUrl === 'string' && body.belegUrl.trim();
      if (!hatXml && !hatUrl && (!body.imageDataUrl || typeof body.imageDataUrl !== 'string')) {
        return new Response(JSON.stringify({ error: 'Feld "imageDataUrl", "xmlText" oder "belegUrl" fehlt.' }), {
          status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
      try {
        const result = await callClaudeBelegScan({
          apiKey: env.ANTHROPIC_API_KEY,
          model: env.MODEL_ID || 'claude-opus-4-8',
          imageDataUrl: body.imageDataUrl,
          xmlText: body.xmlText,
          belegUrl: body.belegUrl,
          kategorien: body.kategorien,
        });
        return new Response(JSON.stringify(result), {
          status: 200, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message || 'Unbekannter Fehler' }), {
          status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
    }

    if (body.action === 'angebot-pdf-import') {
      if (!body.fileDataUrl || typeof body.fileDataUrl !== 'string') {
        return new Response(JSON.stringify({ error: 'Feld "fileDataUrl" fehlt.' }), {
          status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
      try {
        const result = await callClaudeAngebotImport({
          apiKey: env.ANTHROPIC_API_KEY,
          model: env.MODEL_ID || 'claude-opus-4-8',
          fileDataUrl: body.fileDataUrl,
          standardSteuersatz: body.standardSteuersatz,
        });
        return new Response(JSON.stringify(result), {
          status: 200, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message || 'Unbekannter Fehler' }), {
          status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
    }

    if (body.action === 'social-post') {
      if (!body.imageDataUrl || typeof body.imageDataUrl !== 'string') {
        return new Response(JSON.stringify({ error: 'Feld "imageDataUrl" fehlt.' }), {
          status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
      try {
        const result = await callClaudeSocialPost({
          apiKey: env.ANTHROPIC_API_KEY,
          model: env.MODEL_ID || 'claude-opus-4-8',
          imageDataUrl: body.imageDataUrl,
          firmenname: body.firmenname,
          ort: body.ort,
          gewerk: body.gewerk,
          leistung: body.leistung,
          kontext: body.kontext,
        });
        return new Response(JSON.stringify(result), {
          status: 200, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message || 'Unbekannter Fehler' }), {
          status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
    }

    if (body.action === 'email-classify') {
      if (!Array.isArray(body.emails) || body.emails.length === 0) {
        return new Response(JSON.stringify({ error: 'Feld "emails" fehlt.' }), {
          status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
      try {
        const result = await callClaudeEmailClassify({
          apiKey: env.ANTHROPIC_API_KEY,
          model: env.MODEL_ID || 'claude-opus-4-8',
          emails: body.emails,
          heute: body.heute,
        });
        return new Response(JSON.stringify(result), {
          status: 200, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message || 'Unbekannter Fehler' }), {
          status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
    }

    if (body.action === 'gaeb-preise-recherchieren') {
      if (!Array.isArray(body.positionen) || body.positionen.length === 0) {
        return new Response(JSON.stringify({ error: 'Feld "positionen" fehlt.' }), {
          status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
      try {
        const result = await callClaudeGaebPreise({
          apiKey: env.ANTHROPIC_API_KEY,
          model: env.MODEL_ID || 'claude-opus-4-8',
          positionen: body.positionen,
        });
        return new Response(JSON.stringify(result), {
          status: 200, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message || 'Unbekannter Fehler' }), {
          status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
    }

    if (body.action === 'formular-generieren') {
      const stichpunkte = typeof body.stichpunkte === 'string' ? body.stichpunkte.trim() : '';
      if (!stichpunkte && !body.fileDataUrl) {
        return new Response(JSON.stringify({ error: 'Bitte Stichpunkte eingeben oder eine Vorlage hochladen.' }), {
          status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
      try {
        const result = await callClaudeFormularGenerieren({
          apiKey: env.ANTHROPIC_API_KEY,
          model: env.MODEL_ID || 'claude-opus-4-8',
          stichpunkte,
          fileDataUrl: body.fileDataUrl,
        });
        return new Response(JSON.stringify(result), {
          status: 200, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message || 'Unbekannter Fehler' }), {
          status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
    }

    if (body.action === 'entity-stichpunkte') {
      const ENTITY_TYPES = ['kunde', 'projekt', 'termin', 'aufgabe', 'bericht'];
      if (!ENTITY_TYPES.includes(body.entityType)) {
        return new Response(JSON.stringify({ error: 'Feld "entityType" fehlt oder ungültig.' }), {
          status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
      if (!body.stichpunkte || typeof body.stichpunkte !== 'string') {
        return new Response(JSON.stringify({ error: 'Feld "stichpunkte" fehlt.' }), {
          status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
      try {
        const result = await callClaudeEntityStichpunkte({
          apiKey: env.ANTHROPIC_API_KEY,
          model: env.MODEL_ID || 'claude-opus-4-8',
          entityType: body.entityType,
          stichpunkte: body.stichpunkte,
          heute: body.heute || new Date().toISOString().slice(0, 10),
          kontext: body.kontext || {},
        });
        return new Response(JSON.stringify(result), {
          status: 200, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message || 'Unbekannter Fehler' }), {
          status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
    }

    if (body.action === 'assistent-chat') {
      if (!Array.isArray(body.messages) || body.messages.length === 0) {
        return new Response(JSON.stringify({ error: 'Feld "messages" fehlt.' }), {
          status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
      try {
        const result = await callClaudeAssistentChat({
          apiKey: env.ANTHROPIC_API_KEY,
          model: env.MODEL_ID || 'claude-opus-4-8',
          messages: body.messages.map((m) => ({ role: m.role, content: m.content })),
          kiBuerokraftUrl: env.KI_BUEROKRAFT_URL,
          kiBuerokraftApiKey: env.KI_BUEROKRAFT_API_KEY,
          googleConfig: buildGoogleConfig(env),
        });
        return new Response(JSON.stringify(result), {
          status: 200, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message || 'Unbekannter Fehler' }), {
          status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
    }

    if (!body.stichpunkte || typeof body.stichpunkte !== 'string') {
      return new Response(JSON.stringify({ error: 'Feld "stichpunkte" fehlt.' }), {
        status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    try {
      const result = await callClaude({
        apiKey: env.ANTHROPIC_API_KEY,
        model: env.MODEL_ID || 'claude-opus-4-8',
        stichpunkte: body.stichpunkte,
        kundeName: body.kundeName,
        katalog: body.katalog,
        standardSteuersatz: body.standardSteuersatz,
        ort: body.ort,
      });
      return new Response(JSON.stringify(result), {
        status: 200, headers: { ...headers, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message || 'Unbekannter Fehler' }), {
        status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }
  },
};
