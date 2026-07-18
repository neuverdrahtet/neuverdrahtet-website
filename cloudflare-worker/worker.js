/**
 * neuverdrahtet Verwaltung – KI-Angebotserstellung + Beleg-Scan (Cloudflare Worker)
 *
 * Nimmt Stichpunkte entgegen und lässt Claude daraus strukturierte
 * Angebotspositionen erzeugen, oder analysiert ein fotografiertes Beleg-Bild
 * und liefert Händler/Datum/Betrag/Kategorie zurück. Der Anthropic-API-Key
 * bleibt ausschließlich hier im Worker (als Secret) – er wird NIE an den
 * Browser geschickt.
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
  return `Du hilfst einem deutschen Elektro-Handwerksbetrieb (neuverdrahtet), aus kurzen Stichpunkten eines Mitarbeiters professionelle Angebotspositionen zu erstellen.

Regeln:
- Antworte ausschließlich auf Deutsch.
- Nutze, wenn im mitgelieferten Katalog ein passender Artikel/eine passende Leistung existiert, dessen Bezeichnung, Einheit und Preis unverändert.
- Für Positionen ohne Katalogtreffer: schätze realistische, marktübliche Preise für Elektroinstallationsarbeiten in Deutschland (netto, in Euro). Nenne im Zweifel lieber eine vorsichtige, plausible Schätzung als eine runde Zahl ohne Bezug.
- "einheit" ist z.B. "Std.", "Stk.", "m", "pauschal".
- "steuersatz" ist in der Regel ${standardSteuersatz} (Prozent, als Zahl ohne %-Zeichen), außer es gibt einen klaren fachlichen Grund für einen anderen Satz.
- "betreff" ist eine kurze, prägnante Überschrift für das Angebot (max. ca. 80 Zeichen).
- "einleitung" ist ein kurzer, freundlicher Einleitungssatz für das Angebotsschreiben (1-2 Sätze).
- Erfinde keine Positionen, die nicht sinnvoll aus den Stichpunkten hervorgehen. Wenn Mengenangaben fehlen, nimm eine plausible Standardmenge (z.B. 1).`;
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
    if (!env.ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'Worker ist nicht korrekt eingerichtet (ANTHROPIC_API_KEY fehlt).' }), {
        status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
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
