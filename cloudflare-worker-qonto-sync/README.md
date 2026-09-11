# neuverdrahtet-qonto-sync (Cloudflare Worker)

Ruft eingehende Kontobewegungen von eurem Qonto-Geschäftskonto ab, damit
Werkora offene Rechnungen automatisch mit Zahlungseingängen abgleichen kann
("Zahlungsabgleich"-Ansicht). Dieser Worker liest nur - er bucht nichts bei
Qonto, sendet nichts, ändert nichts. Der eigentliche Abgleich (welche
Zahlung passt zu welcher Rechnung, Bestätigen/Ablehnen) passiert in Werkora
selbst, nicht hier.

**Wichtig zum Automatisierungsgrad:** Eine Zahlung wird NIE automatisch als
"bezahlt" gebucht. Werkora zeigt dir passende Vorschläge, du bestätigst sie
mit einem Klick.

## Einmaliges Setup

1. **Qonto-API-Zugang erstellen**: In der Qonto-App/-Weboberfläche einloggen
   → Einstellungen → **API** (teils auch unter "Integrationen") → **"API-
   Schlüssel erstellen"**. Du bekommst zwei Werte:
   - **Login** (sieht aus wie `firmenname-1234`)
   - **Secret Key** (wird nur einmal angezeigt - sofort kopieren/notieren!)
2. **Deployen**:
   ```bash
   cd cloudflare-worker-qonto-sync
   npx wrangler deploy
   ```
   (oder per Dashboard: neuen Worker anlegen, Inhalt von `worker.js` einfügen).
3. **Secrets setzen** (Cloudflare Dashboard → Worker → Einstellungen →
   Variablen und Geheimnisse):
   - `QONTO_LOGIN` (Secret, erforderlich)
   - `QONTO_SECRET_KEY` (Secret, erforderlich)
   - `APP_SECRET` (Secret, erforderlich) - ein frei erfundenes, langes Passwort
4. In Werkora unter **Einstellungen → Buchhaltung/Zahlungsabgleich** die
   Worker-URL und dasselbe `APP_SECRET` eintragen.

## Bekannte Einschränkungen (erste Version)

- Es werden nur **Gutschriften** (eingehendes Geld) der letzten bis zu 90
  Tage abgerufen, keine Lastschriften/Ausgänge.
- Der Abgleich in Werkora vergleicht aktuell nur auf **exakten Betrag** -
  Teilzahlungen/Skonto-Fälle müssen weiterhin manuell zugeordnet werden.
- Die genauen Feldnamen der Qonto-API (`transaction_id`, `settled_at`,
  `label` usw.) stammen aus der offiziellen Qonto-Business-API-
  Dokumentation zum Zeitpunkt der Erstellung - falls Qonto seine API
  ändert oder ein Feld anders benannt ist als erwartet, meldet der Worker
  einen Fehler statt falscher Daten; dann bitte den tatsächlichen
  Antwort-Text (`npx wrangler tail`) prüfen und die Feldnamen in
  `worker.js` anpassen.
