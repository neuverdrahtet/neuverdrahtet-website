/**
 * neuverdrahtet Verwaltung – KI-Angebotserstellung + Beleg-Scan + Push-Versand + GAEB-Preisrecherche + Social-Media-Post (Cloudflare Worker)
 *
 * Nimmt Stichpunkte entgegen und lässt Claude daraus strukturierte
 * Angebotspositionen erzeugen, analysiert ein fotografiertes Beleg-Bild und
 * liefert Händler/Datum/Betrag/Kategorie zurück, recherchiert für
 * unbepreiste GAEB-Positionen per Web-Search-Tool marktübliche Preise,
 * erzeugt aus einem Baustellen-/Projektfoto passende Social-Media-Texte je
 * Kanal (Instagram/Facebook/LinkedIn/Google Unternehmensprofil), oder löst
 * eine Firebase-Cloud-Messaging-Push-Benachrichtigung an einzelne
 * Geräte-Tokens aus. Die Geheimnisse (Anthropic-API-Key, Firebase-Service-
 * Account) bleiben ausschließlich hier im Worker (als Secrets) – sie werden
 * NIE an den Browser geschickt.
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
 *   FIREBASE_SERVICE_ACCOUNT_JSON (Secret, nur für Push-Benachrichtigungen
 *                        nötig) – kompletter Inhalt einer Firebase-Service-
 *                        Account-JSON-Datei (Firebase-Konsole -> Projekt-
 *                        einstellungen -> Dienstkonten -> Neuen privaten
 *                        Schlüssel generieren), als einzeiliger String.
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
        },
        required: ['bezeichnung', 'beschreibung', 'einheit', 'menge', 'einzelpreis', 'steuersatz'],
        additionalProperties: false,
      },
    },
  },
  required: ['betreff', 'einleitung', 'positionen'],
  additionalProperties: false,
};

function buildSystemPrompt(standardSteuersatz) {
  return `Du hilfst einem deutschen Elektro-Handwerksbetrieb (neuverdrahtet), aus kurzen Stichpunkten eines Mitarbeiters ein vollständiges, realistisches Angebot bzw. eine Rechnung mit Positionen zu erstellen. Diese Positionen werden sowohl für Angebote als auch für Rechnungen verwendet.

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

Weitere Regeln:
- Antworte ausschließlich auf Deutsch.
- Nutze, wenn im mitgelieferten Katalog ein passender Artikel/eine passende Leistung existiert, dessen Bezeichnung, Einheit und Preis unverändert.
- "einheit" ist z.B. "Std.", "Stk.", "m", "pauschal".
- "steuersatz" ist in der Regel ${standardSteuersatz} (Prozent, als Zahl ohne %-Zeichen), außer es gibt einen klaren fachlichen Grund für einen anderen Satz.
- "betreff" ist eine kurze, prägnante Überschrift (max. ca. 80 Zeichen).
- "einleitung" ist ein kurzer, freundlicher Einleitungssatz für das Anschreiben (1-2 Sätze).
- Wenn Mengenangaben fehlen, nimm eine plausible Menge anhand der Beschreibung (z.B. Kabellänge nach typischer Raumgröße), sonst eine sinnvolle Standardmenge (z.B. 1).`;
}

async function callClaude({ apiKey, model, stichpunkte, kundeName, katalog, standardSteuersatz }) {
  const katalogText = (katalog || [])
    .slice(0, 200)
    .map((k) => `- ${k.bezeichnung} | Einheit: ${k.einheit || ''} | Preis netto: ${k.preis} EUR | USt: ${k.steuersatz}%`)
    .join('\n');

  const userText = [
    kundeName ? `Kunde: ${kundeName}` : null,
    'Stichpunkte des Mitarbeiters:',
    stichpunkte,
    katalogText ? `\nVerfügbarer Katalog (Artikel/Leistungen):\n${katalogText}` : null,
  ].filter(Boolean).join('\n\n');

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
      system: buildSystemPrompt(standardSteuersatz || 19),
      messages: [{ role: 'user', content: userText }],
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
  required: ['haendler', 'datum', 'betragNetto', 'betragBrutto', 'steuersatz', 'kategorie', 'kategorieSicher', 'beschreibung', 'lesbar'],
  additionalProperties: false,
};

function buildBelegSystemPrompt(kategorien) {
  const liste = (kategorien && kategorien.length ? kategorien : ['Material', 'Werkzeug/Maschinen', 'Fahrzeug/Sprit', 'Miete', 'Versicherung', 'Büro/Verwaltung', 'Personal', 'Sonstiges']).join(', ');
  return `Du liest einen fotografierten Kassenbon oder eine Rechnung für einen deutschen Handwerksbetrieb aus und extrahierst die Daten für die Ausgaben-Erfassung.

Regeln:
- Antworte ausschließlich auf Deutsch.
- "haendler": Name des Geschäfts/Lieferanten, so wie auf dem Beleg erkennbar (z.B. "Hornbach", "Esso").
- "datum": Belegdatum im Format JJJJ-MM-TT. Wenn nicht lesbar, leer lassen.
- "betragBrutto": Gesamtbetrag (inkl. USt.) als Zahl, ohne Währungssymbol.
- "steuersatz": erkannter USt.-Satz in Prozent als Zahl (meist 19 oder 7). Wenn nicht erkennbar, 19 annehmen.
- "betragNetto": betragBrutto / (1 + steuersatz/100), gerundet auf 2 Nachkommastellen.
- "kategorie": wähle GENAU einen Eintrag aus dieser Liste, der am besten passt: ${liste}.
- "kategorieSicher": true nur wenn du dir bei Händler UND Kategorie wirklich sicher bist. Bei Unsicherheit, schlechter Bildqualität oder einem für die Kategorie untypischen Beleg: false.
- "beschreibung": sehr kurze Zusammenfassung, was gekauft/bezahlt wurde (max. ca. 60 Zeichen).
- "lesbar": false, wenn das Bild kein auswertbarer Beleg ist oder die wichtigsten Felder (Betrag, Händler) nicht erkennbar sind. In diesem Fall die übrigen Felder so gut wie möglich schätzen bzw. leer/0 lassen.
- Erfinde keine Beträge - wenn ein Betrag nicht lesbar ist, setze ihn auf 0 und "lesbar" auf false.`;
}

async function callClaudeBelegScan({ apiKey, model, imageDataUrl, kategorien }) {
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
      max_tokens: 1024,
      system: buildBelegSystemPrompt(kategorien),
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
          { type: 'text', text: 'Lies diesen Beleg aus und liefere die strukturierten Daten.' },
        ],
      }],
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

const GAEB_PREISE_SYSTEM_PROMPT = `Du recherchierst für einen deutschen Elektro-/Handwerksbetrieb aktuelle, marktübliche Netto-Verkaufspreise für Positionen aus einem Leistungsverzeichnis (GAEB-Import), indem du gezielt im Internet suchst - bei Herstellern (z.B. Hager, Gira, Busch-Jaeger, ABB, Siemens, OBO Bettermann, Jung), Elektro-Fachgroßhändlern (z.B. Sonepar, Rexel, Elektroshop24, Voltimum) und einschlägigen Baumärkten/Online-Händlern (z.B. Bauhaus, Hornbach, Amazon, Conrad).

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

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
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
      if (!body.imageDataUrl || typeof body.imageDataUrl !== 'string') {
        return new Response(JSON.stringify({ error: 'Feld "imageDataUrl" fehlt.' }), {
          status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
      try {
        const result = await callClaudeBelegScan({
          apiKey: env.ANTHROPIC_API_KEY,
          model: env.MODEL_ID || 'claude-opus-4-8',
          imageDataUrl: body.imageDataUrl,
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
