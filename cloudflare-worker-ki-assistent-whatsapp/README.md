# neuverdrahtet-ki-assistent-whatsapp (Cloudflare Worker)

Nimmt eingehende WhatsApp-Nachrichten über Twilio entgegen und beantwortet
sie per Claude (Anthropic) - inhaltlich derselbe Assistent wie das
Chat-Widget auf der Website (`cloudflare-worker-ki-assistent/`), nur über
einen anderen Kanal. Kann nach Zustimmung des Gesprächspartners automatisch
einen Lead (Kunde + Projekt) in der Werkora-Lead-Pipeline anlegen, und kann
bei Terminwunsch echte freie Zeiten aus Calendly vorschlagen (siehe Abschnitt
"Termin-Vorschläge über Calendly" unten).

## Wichtig: das musst du selbst einrichten (kein Bestandteil dieses Workers)

Ein Cloudflare Worker kann keine WhatsApp-Telefonnummer bei Meta beantragen
oder Nachrichten direkt an WhatsApp senden - dafür braucht es einen
zugelassenen Vermittler. Dieses Projekt ist auf **Twilio** ausgelegt (der
gängigste Anbieter dafür), das musst du zusätzlich einrichten:

1. **Twilio-Konto erstellen**: [twilio.com](https://www.twilio.com) -
   Registrierung kostenlos, Nutzung ist kostenpflichtig (pro gesendeter/
   empfangener WhatsApp-Nachricht, siehe [twilio.com/pricing](https://www.twilio.com/pricing)).
2. **Für den Einstieg: die kostenlose WhatsApp-Sandbox** nutzen (Twilio
   Console → Messaging → Try it out → Send a WhatsApp message). Du bekommst
   eine Sandbox-Nummer und einen Beitrittscode, den Testnutzer per WhatsApp
   an diese Nummer schicken müssen, um im Sandbox-Modus mit dir chatten zu
   können - gut zum Ausprobieren, aber nicht für echte Kunden gedacht (die
   müssten erst selbst dem Sandbox-Code beitreten).
3. **Für den echten Einsatz: einen eigenen WhatsApp-Business-Absender**
   beantragen (Twilio Console → Messaging → Senders → WhatsApp senders).
   Das durchläuft eine Prüfung durch Meta und kann mehrere Tage dauern.
   Danach läuft eure eigene Geschäfts-Telefonnummer über WhatsApp, ohne
   Beitrittscode für Kunden.
4. **Webhook eintragen**: beim jeweiligen Absender (Sandbox oder eigene
   Nummer) das Feld **"WHEN A MESSAGE COMES IN"** auf die Worker-URL dieses
   Projekts setzen, Methode `HTTP POST`.

Ohne diese vier Schritte bekommt dieser Worker nie eine Anfrage - er ist nur
die Antwort-Logik, nicht die WhatsApp-Anbindung selbst.

## Einmaliges Setup (dieser Worker)

1. **Anthropic-API-Schlüssel**: siehe README von
   `cloudflare-worker-ki-assistent/` - kann derselbe Schlüssel sein.
2. **Firebase-Service-Account**: derselbe wie bei den anderen Workern
   (Firebase-Konsole → Projekteinstellungen → Dienstkonten), als einzeiliger
   JSON-String.
3. **Deployen**:
   ```bash
   cd cloudflare-worker-ki-assistent-whatsapp
   npx wrangler deploy
   ```
   (oder per Dashboard: neuen Worker anlegen, Inhalt von `worker.js` einfügen).
4. **Secrets setzen** (Cloudflare Dashboard → Worker → Einstellungen →
   Variablen und Geheimnisse):
   - `ANTHROPIC_API_KEY` (Secret, erforderlich)
   - `FIREBASE_SERVICE_ACCOUNT_JSON` (Secret, erforderlich)
   - `TWILIO_AUTH_TOKEN` (Secret, **dringend empfohlen** - siehe
     Sicherheitshinweis unten) - findest du in der Twilio Console auf der
     Account-Übersichtsseite ("Auth Token", auf Klick sichtbar).
5. Die entstandene Worker-URL (z.B.
   `https://neuverdrahtet-ki-assistent-whatsapp.<dein-konto>.workers.dev`)
   bei Twilio als Webhook eintragen (siehe Schritt 4 oben).

## Termin-Vorschläge über Calendly (optional)

Wenn ein Gesprächspartner per WhatsApp einen Termin möchte, kann der
Assistent echte freie Uhrzeiten aus Calendly nennen und den Buchungslink
mitschicken. **Wichtig:** Calendly kann Termine über die API nicht
automatisch fest buchen (das ist eine Plattform-Grenze, kein Bug hier) - der
Kunde muss den vorgeschlagenen Termin am Ende immer selbst über den Link
bestätigen. Der Assistent ist im System-Prompt entsprechend angewiesen, so
etwas nie als "fest gebucht" darzustellen.

Setup (optional - ohne das folgende nennt der Assistent bei Terminwunsch nur
den Buchungslink, ohne konkrete Uhrzeiten):

1. In Calendly einloggen → oben rechts auf das Profilbild → **Integrations**
   → **API and Webhooks** → **"Get a token now"** (Personal Access Token
   erzeugen).
2. Diesen Token als Secret `CALENDLY_API_TOKEN` im Cloudflare-Dashboard
   dieses Workers eintragen (Einstellungen → Variablen und Geheimnisse →
   Verschlüsselt).
3. Optional: `CALENDLY_EVENT_TYPE_URI` (Variable, nicht verschlüsselt) und
   `CALENDLY_SCHEDULING_URL` (Variable) setzen, falls ein anderer
   Termin-Typ als der Standard-Typ des Kontos `calendly.com/neuverdrahtet`
   verwendet werden soll. Ohne diese beiden Variablen wird automatisch der
   vorhandene Termin-Typ "30 Minute Meeting"
   (`calendly.com/neuverdrahtet/30min`) verwendet.

## Danach einmal live testen

- Der WhatsApp-Sandbox beitreten (Code an die Sandbox-Nummer schicken) und
  eine Testfrage schreiben, z.B. "Was kostet ein E-Check ungefähr?".
- Ein Test-Anliegen mit Namen durchspielen und der Weiterleitung zustimmen -
  danach in Werkora unter **Lead-Pipeline** prüfen, ob ein neuer Lead
  erscheint (Telefonnummer sollte automatisch die WhatsApp-Nummer sein).
- Bei Problemen: `npx wrangler tail` zeigt den genauen Fehler; Twilio zeigt
  in der Console unter **Monitor → Logs → Errors** ebenfalls an, wenn der
  Webhook-Aufruf fehlschlägt (z.B. Timeout, falsche URL).

## Sicherheitshinweis: unbedingt `TWILIO_AUTH_TOKEN` setzen

Ohne dieses Secret prüft der Worker nicht, ob eine eingehende Anfrage
wirklich von Twilio stammt - jeder, der die Worker-URL kennt, könnte
vorgetäuschte "WhatsApp-Nachrichten" einschicken und damit unnötige
Anthropic-API-Kosten verursachen oder Leads mit Fantasiedaten anlegen. Mit
gesetztem `TWILIO_AUTH_TOKEN` prüft der Worker die Twilio-Signatur
(`X-Twilio-Signature`-Header) nach dem offiziellen Twilio-Verfahren
([twilio.com/docs/usage/security](https://www.twilio.com/docs/usage/security#validating-requests))
und lehnt gefälschte Anfragen mit HTTP 403 ab.

## Wichtige Design-Entscheidungen

- **Gesprächsverlauf wird serverseitig gespeichert** (Collection
  `whatsapp_chats` in Firestore, Dokument-ID = WhatsApp-Nummer), anders als
  beim Website-Widget - ein Webhook pro Nachricht ist zustandslos, der
  Verlauf muss also zwischengespeichert werden, um mehrere Nachrichten
  hintereinander sinnvoll zu beantworten. Es werden nur die letzten 20
  Nachrichten pro Nummer aufgehoben.
- **Telefonnummer wird nicht vom Sprachmodell erfragt**, sondern automatisch
  aus dem WhatsApp-Absender übernommen - zuverlässiger, als das Modell danach
  fragen zu lassen.
- **Antworten werden auf ca. 1500 Zeichen gekürzt** (grobe Lesbarkeits-/
  Sicherheitsgrenze für WhatsApp-Nachrichten), Markdown-Formatierung wird im
  System-Prompt bewusst unterbunden, da WhatsApp `**fett**` &c. nicht
  darstellt.

## Spätere Ausbaustufen (nicht Teil dieser ersten Version)

- Automatisches Aufräumen alter `whatsapp_chats`-Dokumente (z.B. per
  täglichem Cron-Job, ähnlich dem in `cloudflare-worker-ki-buerokraft/`),
  falls die Sammlung mit der Zeit sehr groß wird.
- Unterstützung für eingehende Bilder (`NumMedia`/`MediaUrl0` aus dem
  Twilio-Webhook) - aktuell wird nur reiner Text verarbeitet.
- Eskalation an einen echten Mitarbeiter (z.B. Push-Benachrichtigung wie in
  `cloudflare-worker-ki-buerokraft/`), wenn der Assistent selbst nicht
  weiterweiß.
- **Proaktive Erstkontakte per WhatsApp** (der Assistent schreibt Leads von
  sich aus an, statt nur auf eingehende Nachrichten zu antworten): technisch
  nicht möglich, bevor bei Twilio/Meta ein **genehmigtes WhatsApp-
  Nachrichtenvorlage-Template** vorliegt (Twilio Console → Messaging →
  Content Editor/Content Template Builder) - das ist eine Plattform-Regel
  von WhatsApp, kein Bestandteil dieses Codes. Sobald ein Template den
  Status "Approved" hat, kann diese Funktion ergänzt werden.
