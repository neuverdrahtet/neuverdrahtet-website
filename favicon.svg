/**
 * neuverdrahtet — KI-Check Unterverteilung
 * Cloudflare Worker, der als sicherer Proxy zur Anthropic API dient.
 *
 * WARUM DIESER WORKER NÖTIG IST:
 * Die Website liegt auf GitHub Pages (rein statisch, kein eigener Server).
 * Ein API-Key darf niemals im Frontend-Code (script.js) stehen — jeder
 * Website-Besucher könnte ihn sonst auslesen und auf eigene Kosten nutzen.
 * Dieser Worker läuft stattdessen bei Cloudflare, hält den Key sicher als
 * "Secret" und nimmt nur Bild-Uploads entgegen, um sie an Claude weiterzugeben.
 *
 * EINRICHTUNG (einmalig, ca. 5 Minuten):
 * 1. Kostenlosen Account auf https://dash.cloudflare.com anlegen (falls noch nicht vorhanden)
 * 2. Im Dashboard: Workers & Pages → Create → "Create Worker"
 * 3. Diesen Code komplett in den Editor einfügen, "Deploy" klicken
 * 4. Unter Settings → Variables → "Add secret":
 *      Name:  ANTHROPIC_API_KEY
 *      Wert:  dein Anthropic API-Key (console.anthropic.com → API Keys)
 * 5. Unter Settings → Domains & Routes die zugewiesene *.workers.dev-URL kopieren
 * 6. Diese URL in assets/script.js bei KI_CHECK_ENDPOINT eintragen
 *
 * Kosten: Cloudflare Workers Free-Tier reicht für diesen Zweck üblicherweise aus.
 * Die Anthropic-API-Nutzung wird separat nach Verbrauch abgerechnet
 * (aktuelle Preise: https://docs.claude.com).
 */

const ALLOWED_ORIGIN = "https://neuverdrahtet.com"; // ggf. auf eigene Domain anpassen

const SYSTEM_PROMPT = `Du bist ein Assistenzsystem für einen Elektro-Fachbetrieb (neuverdrahtet, Essen).
Du bekommst ein Foto einer Unterverteilung/eines Sicherungskastens und gibst eine ERSTE,
LAIENVERSTÄNDLICHE Einschätzung — keine Diagnose, keine Prüfung, kein Ersatz für eine Elektrofachkraft.

Gehe auf Folgendes ein, sofern auf dem Foto erkennbar:
- Wirkt die Verteilung modern oder veraltet (z. B. Schmelzsicherungen statt Leitungsschutzschaltern)?
- Sind FI-Schutzschalter (RCD) erkennbar vorhanden?
- Wirkt die Verteilung übersichtlich/beschriftet oder eher unübersichtlich?
- Ist noch Platz für Erweiterungen (Wallbox, PV, Wärmepumpe) erkennbar?

Antworte auf Deutsch, in 4-6 kurzen Sätzen, klar und ohne Fachjargon-Overkill.
Schließe IMMER mit dem Hinweis, dass dies keine Prüfung ersetzt und für eine verbindliche
Einschätzung ein Vor-Ort-Termin empfohlen wird.
Wenn auf dem Bild keine Unterverteilung erkennbar ist, sage das ehrlich und bitte um ein
klareres Foto, statt etwas zu erfinden.`;

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const { image, mediaType } = body;
    if (!image || !mediaType) {
      return json({ error: "Missing image or mediaType" }, 400);
    }
    if (!["image/jpeg", "image/png"].includes(mediaType)) {
      return json({ error: "Unsupported image type" }, 400);
    }
    // Rough size guard (base64 is ~1.37x binary size) — keep under ~10MB original
    if (image.length > 14_000_000) {
      return json({ error: "Image too large" }, 413);
    }

    try {
      const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 500,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
                { type: "text", text: "Bitte gib deine erste Einschätzung zu dieser Unterverteilung." },
              ],
            },
          ],
        }),
      });

      if (!anthropicRes.ok) {
        const errText = await anthropicRes.text();
        console.error("Anthropic API error:", errText);
        return json({ error: "Analysis failed" }, 502);
      }

      const data = await anthropicRes.json();
      const textBlock = (data.content || []).find((b) => b.type === "text");
      const result = textBlock?.text || "Keine Einschätzung erhalten.";

      return json({ result });
    } catch (err) {
      console.error("Worker error:", err);
      return json({ error: "Internal error" }, 500);
    }
  },
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders() },
  });
}
