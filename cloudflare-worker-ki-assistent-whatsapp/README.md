# neuverdrahtet-ki-assistent-whatsapp (Cloudflare Worker)

Nimmt eingehende WhatsApp-Nachrichten über die **WhatsApp Cloud API von
Meta** (direkt, kein Vermittler wie Twilio dazwischen) entgegen und
beantwortet sie per Claude (Anthropic) - inhaltlich derselbe Assistent wie
das Chat-Widget auf der Website (`cloudflare-worker-ki-assistent/`), nur
über einen anderen Kanal. Kann nach Zustimmung des Gesprächspartners
automatisch einen Lead (Kunde + Projekt) in der Werkora-Lead-Pipeline
anlegen, und kann bei Terminwunsch echte freie Zeiten aus Calendly
vorschlagen (siehe Abschnitt "Termin-Vorschläge über Calendly" unten).

## Wichtig: das musst du selbst einrichten (kein Bestandteil dieses Workers)

Ein Cloudflare Worker kann keine WhatsApp-Telefonnummer bei Meta beantragen
- das geht nur über ein eigenes Meta-Geschäftskonto:

1. **Meta-Geschäftskonto**: falls noch nicht vorhanden, auf
   [business.facebook.com](https://business.facebook.com) kostenlos
   anlegen.
2. **Meta-App mit WhatsApp-Produkt erstellen**:
   [developers.facebook.com](https://developers.facebook.com) → "Meine
   Apps" → "App erstellen" → Typ "Unternehmen" → in der neuen App unter
   "Produkt hinzufügen" das Produkt **WhatsApp** auswählen. Meta legt dabei
   automatisch eine kostenlose **Test-Telefonnummer** an, mit der du sofort
   loslegen kannst (später gegen eure echte Geschäftsnummer austauschbar).
3. **Zugangsdaten einsammeln** (App → WhatsApp → Konfiguration):
   - Die **"Telefonnummer-ID"** (eine lange Zahl, nicht die Telefonnummer
     selbst) → wird `META_PHONE_NUMBER_ID`.
   - Ein **dauerhaftes Zugriffstoken**: App → Einstellungen →
     "Systembenutzer" → einen Systembenutzer mit Rolle "Admin" anlegen →
     Token erzeugen mit Berechtigung `whatsapp_business_messaging`. (Das
     kurzlebige 24-Stunden-Token aus der Schnellstart-Ansicht reicht **nicht**
     für den Dauerbetrieb!) → wird `META_ACCESS_TOKEN`.
   - Den **App-Geheimcode**: App → Einstellungen → Grundlegendes → "App-
     Geheimcode anzeigen" → wird `META_APP_SECRET`.
4. **Webhook eintragen** (App → WhatsApp → Konfiguration → Webhook):
   - Als "Rückruf-URL" die Worker-URL dieses Projekts eintragen.
   - Als "Verifizierungstoken" einen von dir frei erfundenen, langen Code
     eintragen (z.B. per Passwort-Generator) → wird `META_VERIFY_TOKEN`
     (muss in Meta und in Cloudflare identisch sein).
   - Auf "Überprüfen und speichern" klicken - Meta ruft dabei die
     Worker-URL testweise auf; das klappt erst, wenn der Worker mit den
     Secrets (siehe unten) bereits deployt ist.
   - Danach unter "Webhook-Felder" das Feld **"messages"** abonnieren.

Ohne diese Schritte bekommt dieser Worker nie eine Anfrage - er ist nur die
Antwort-Logik, nicht die WhatsApp-Anbindung selbst.

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
   - `META_ACCESS_TOKEN` (Secret, erforderlich) - siehe Schritt 3 oben.
   - `META_PHONE_NUMBER_ID` (Variable, erforderlich) - siehe Schritt 3 oben.
   - `META_VERIFY_TOKEN` (Secret, erforderlich) - dein selbst gewählter Code,
     siehe Schritt 4 oben.
   - `META_APP_SECRET` (Secret, **dringend empfohlen** - siehe
     Sicherheitshinweis unten) - siehe Schritt 3 oben.
5. Die entstandene Worker-URL (z.B.
   `https://neuverdrahtet-ki-assistent-whatsapp.<dein-konto>.workers.dev`)
   bei Meta als Webhook eintragen (siehe Schritt 4 oben) - erst danach lässt
   sich die Webhook-Verifizierung in der Meta-App erfolgreich abschließen.

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

- In der Meta-App unter "WhatsApp → Konfiguration → Von" die kostenlose
  Test-Telefonnummer eintragen und eure eigene Handynummer als Empfänger
  hinzufügen ("Nachricht senden" → eigene Nummer bestätigen per Code).
- Von eurem Handy aus die Test-Nummer per WhatsApp anschreiben, z.B. "Was
  kostet ein E-Check ungefähr?" - die Antwort kommt über diesen Worker.
- Ein Test-Anliegen mit Namen durchspielen und der Weiterleitung zustimmen -
  danach in Werkora unter **Lead-Pipeline** prüfen, ob ein neuer Lead
  erscheint (Telefonnummer sollte automatisch die WhatsApp-Nummer sein).
- Bei Problemen: `npx wrangler tail` zeigt den genauen Fehler; in der
  Meta-App unter "WhatsApp → Konfiguration → Webhook" zeigt ein rotes
  Ausrufezeichen an, wenn der Webhook-Aufruf fehlschlägt.

## Sicherheitshinweis: unbedingt `META_APP_SECRET` setzen

Ohne dieses Secret prüft der Worker nicht, ob eine eingehende Anfrage
wirklich von Meta stammt - jeder, der die Worker-URL kennt, könnte
vorgetäuschte "WhatsApp-Nachrichten" einschicken und damit unnötige
Anthropic-API-Kosten verursachen oder Leads mit Fantasiedaten anlegen. Mit
gesetztem `META_APP_SECRET` prüft der Worker die Signatur
(`X-Hub-Signature-256`-Header) nach dem offiziellen Meta-Verfahren
([developers.facebook.com/docs/graph-api/webhooks/getting-started](https://developers.facebook.com/docs/graph-api/webhooks/getting-started#validate-payloads))
und lehnt gefälschte Anfragen mit HTTP 403 ab.

## Wichtige Design-Entscheidungen

- **Webhook antwortet sofort mit 200, Verarbeitung läuft im Hintergrund**
  (`ctx.waitUntil(...)`) - Meta erwartet eine schnelle Bestätigung und
  wiederholt den Aufruf sonst unnötig; die eigentliche Antwort wird separat
  über die Graph API verschickt, sobald Claude fertig ist.
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
- Unterstützung für eingehende Bilder (`type: "image"` im Meta-Webhook,
  Bild-URL per Graph-API-Aufruf abrufen) - aktuell wird nur reiner Text
  verarbeitet.
- Eskalation an einen echten Mitarbeiter (z.B. Push-Benachrichtigung wie in
  `cloudflare-worker-ki-buerokraft/`), wenn der Assistent selbst nicht
  weiterweiß.
- **Proaktive Erstkontakte per WhatsApp** (der Assistent schreibt Leads von
  sich aus an, statt nur auf eingehende Nachrichten zu antworten): technisch
  nicht möglich, bevor bei Meta ein **genehmigtes WhatsApp-
  Nachrichtenvorlage-Template** vorliegt (Meta-App → WhatsApp → Nachrichten-
  Vorlagen-Verwaltung, oder business.facebook.com) - das ist eine
  Plattform-Regel von WhatsApp selbst, unabhängig vom gewählten Anbieter,
  kein Bestandteil dieses Codes. Sobald ein Template den Status "Genehmigt"
  hat, kann diese Funktion ergänzt werden.
