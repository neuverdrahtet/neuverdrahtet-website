/**
 * neuverdrahtet KI-Check Unterverteilung (Cloudflare Worker)
 *
 * Nimmt ein von einem Website-Besucher hochgeladenes Foto einer
 * Unterverteilung/eines Zählerschranks entgegen und liefert über die
 * Claude-Vision-API eine laienverständliche, unverbindliche Ersteinschätzung
 * zurück (keine Prüfung nach DIN VDE 0100-600, kein Ersatz für eine
 * Elektrofachkraft vor Ort - siehe SYSTEM_PROMPT unten).
 *
 * Eigener, dedizierter Worker - getrennt vom internen Admin-Worker
 * (cloudflare-worker/), der mit X-App-Secret gesichert ist und den
 * eigentlichen Anthropic-Schlüssel für die interne Verwaltungs-Software
 * hält. Dieser hier ist absichtlich öffentlich ohne Secret erreichbar, da
 * er direkt von unauthentifizierten Website-Besuchern aufgerufen wird -
 * hat aber seinen EIGENEN ANTHROPIC_API_KEY (nicht denselben wie der
 * interne Worker), damit ein Missbrauchsfall hier nicht das interne
 * KI-Budget mit belastet und beide unabhängig voneinander begrenzt/
 * deaktiviert werden können.
 *
 * Benötigte Secrets/Variablen (Cloudflare Dashboard -> Worker -> Settings -> Variables):
 *   ANTHROPIC_API_KEY  (Secret, erforderlich) - eigener Anthropic-API-Schlüssel.
 *   MODEL_ID           (Variable, optional) - Standard: claude-opus-4-8.
 *   ALLOWED_ORIGINS    (Variable, optional) - Komma-getrennte Liste erlaubter
 *                      Herkünfte, Standard: https://neuverdrahtet.com,https://www.neuverdrahtet.com
 *
 * Deployment: siehe README.md in diesem Ordner.
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
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function jsonResponse(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

const UNTERVERTEILUNG_SCHEMA = {
  type: 'object',
  properties: {
    lesbar: { type: 'boolean' },
    einschaetzung: { type: 'string', enum: ['unauffaellig', 'pruefenswert', 'dringend_pruefen'] },
    beobachtungen: { type: 'array', items: { type: 'string' } },
    alterEindruck: { type: 'string' },
    empfehlung: { type: 'string' },
  },
  required: ['lesbar', 'einschaetzung', 'beobachtungen', 'alterEindruck', 'empfehlung'],
  additionalProperties: false,
};

// Bewusst sehr zurückhaltend formuliert: das Tool darf niemals wie eine
// echte Prüfung/Zertifizierung wirken, sondern nur beschreiben, was auf dem
// Foto sichtbar ist - eine KI-Ersteinschätzung aus einem Foto kann weder
// Spannungsführung/Isolationswerte messen noch eine DIN-VDE-Prüfung
// ersetzen. Das muss in JEDER Antwort erkennbar bleiben (siehe "empfehlung").
const SYSTEM_PROMPT = `Du gibst anhand eines Fotos einer Unterverteilung/eines Zählerschranks eine laienverständliche, unverbindliche ERSTEINSCHÄTZUNG für einen Elektro-Fachbetrieb (neuverdrahtet). Das ist KEINE Prüfung nach DIN VDE 0100-600 und KEIN Ersatz für eine Begutachtung durch eine Elektrofachkraft vor Ort - das muss in "empfehlung" immer deutlich werden.

Regeln:
- Antworte ausschließlich auf Deutsch.
- Beschreibe NUR, was auf dem Foto tatsächlich sichtbar ist. Erfinde nichts, spekuliere nicht über nicht sichtbare Dinge (z.B. Verkabelung hinter der Abdeckung, Zustand von Isolationen, tatsächliche Spannungswerte).
- "lesbar": false, wenn das Bild keine auswertbare Unterverteilung/kein Zählerschrank zeigt oder die Bildqualität keine sinnvolle Einschätzung erlaubt. In diesem Fall die übrigen Felder entsprechend zurückhaltend füllen.
- "einschaetzung": wähle genau einen Wert:
  - "unauffaellig": nichts sichtbar Auffälliges (ordentlicher Zustand, moderne Sicherungsautomaten, klare Beschriftung, kein Anschein von Überfüllung/Beschädigung).
  - "pruefenswert": einzelne Punkte fallen auf (z.B. fehlende/unklare Beschriftung, sichtbarer Staub/leichte Verschmutzung, wenig sichtbare Reserveplätze, älter wirkende Komponenten), aber nichts akut Gefährliches erkennbar.
  - "dringend_pruefen": deutlich sichtbare Sicherheitsauffälligkeiten (z.B. sichtbar lose/offen liegende Leitungen, Schmorspuren/Verfärbungen, sichtbar beschädigte Gehäuseteile, alte Porzellan-Sicherungen/Diazed statt Sicherungsautomaten, freiliegende spannungsführende Teile).
- "beobachtungen": 2-5 kurze, konkrete Stichpunkte zu dem, was auf dem Foto zu sehen ist (positiv wie negativ) - keine allgemeinen Floskeln.
- "alterEindruck": grobe, vorsichtige Einschätzung des optischen Alters/Zustands in einem kurzen Satz (z.B. "wirkt neuwertig", "wirkt mehrere Jahrzehnte alt", "nicht sicher einschätzbar").
- "empfehlung": 1-2 Sätze, die IMMER klarstellen, dass eine echte Beurteilung nur durch eine Elektrofachkraft vor Ort möglich ist, und (falls "pruefenswert" oder "dringend_pruefen") zu einer zeitnahen Vor-Ort-Prüfung raten.`;

async function callClaudeUnterverteilungCheck({ apiKey, model, imageDataUrl }) {
  const match = /^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/.exec(imageDataUrl || '');
  if (!match) {
    throw new Error('Ungültiges Bildformat (unterstützt: JPEG/PNG/WebP-Fotos).');
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
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
          { type: 'text', text: 'Gib eine unverbindliche Ersteinschätzung zu diesem Foto einer Unterverteilung/eines Zählerschranks.' },
        ],
      }],
      output_config: {
        format: { type: 'json_schema', schema: UNTERVERTEILUNG_SCHEMA },
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

// Grober Payload-Deckel gegen versehentlich riesige Bilder (Kosten- und
// Anthropic-Request-Limit-Schutz) - das Frontend verkleinert Fotos ohnehin
// vor dem Absenden (siehe assets/ki-check.js), das hier ist nur ein
// serverseitiges Sicherheitsnetz.
const MAX_IMAGE_DATA_URL_LENGTH = 8_000_000; // ca. 6 MB Bilddaten (Base64-Overhead eingerechnet)

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers });
    if (!getAllowedOrigins(env).includes(origin)) {
      return jsonResponse({ error: 'Origin nicht erlaubt.' }, 403, headers);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Ungültiger Request-Body.' }, 400, headers);
    }

    // Anti-Spam: verdächtig schnell abgesendet (ein Mensch braucht realistisch
    // ein paar Sekunden, um ein Foto auszuwählen) - gleiches Muster wie
    // cloudflare-worker-kostenschaetzer.
    const ladezeitMs = typeof body.ladezeitMs === 'number' ? body.ladezeitMs : 0;
    const zuSchnell = ladezeitMs < 1500;
    if (zuSchnell || (body.website && ladezeitMs < 10000)) {
      return jsonResponse({ error: 'Bitte versuchen Sie es erneut.' }, 400, headers);
    }

    if (!body.imageDataUrl || typeof body.imageDataUrl !== 'string') {
      return jsonResponse({ error: 'Kein Bild übermittelt.' }, 400, headers);
    }
    if (body.imageDataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
      return jsonResponse({ error: 'Bild ist zu groß. Bitte ein kleineres Foto verwenden.' }, 400, headers);
    }

    if (!env.ANTHROPIC_API_KEY) {
      return jsonResponse({ error: 'Worker ist nicht korrekt eingerichtet (ANTHROPIC_API_KEY fehlt).' }, 500, headers);
    }

    try {
      const result = await callClaudeUnterverteilungCheck({
        apiKey: env.ANTHROPIC_API_KEY,
        model: env.MODEL_ID || 'claude-opus-4-8',
        imageDataUrl: body.imageDataUrl,
      });
      return jsonResponse(result, 200, headers);
    } catch (err) {
      return jsonResponse({ error: err.message || 'Unbekannter Fehler' }, 500, headers);
    }
  },
};
