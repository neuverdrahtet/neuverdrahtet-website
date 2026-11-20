# 12 – Veröffentlichung bei IONOS

## Empfehlung: statische Dateien hochladen, nicht in WordPress umbauen

Die Website besteht aus fertigen HTML-Seiten. Sie braucht keine Datenbank und kein WordPress und läuft auf jedem IONOS-Webhosting-Paket, auch auf einem Paket, in dem schon WordPress installiert ist.

| | Statischer Upload (empfohlen) | Umbau zu WordPress |
|---|---|---|
| Aufwand | Paket hochladen, fertig | Theme bauen, 65 Seiten übertragen, Buchung als Plugin |
| Geschwindigkeit | sehr schnell (kein PHP, keine Datenbank) | langsamer, Caching-Plugin nötig |
| Sicherheit | kaum Angriffsfläche | regelmäßige Updates von WordPress und Plugins nötig |
| Texte selbst ändern | über Claude bzw. die Datendateien in `src/daten/` | im WordPress-Editor |
| SEO-Technik | vollständig erhalten (getestet) | muss mit Plugins nachgebaut werden |

WordPress lohnt sich nur, wenn Texte regelmäßig ohne Hilfe selbst im Browser geändert werden sollen. Alternative mit wenig Aufwand: statische Website für die Hauptseiten, WordPress nur für einen Ratgeber/Blog unter `/ratgeber/`.

## Paket erzeugen

```bash
npm run paket:bss
```

Ergebnis: `berger-service-solutions/dist/berger-service-solutions-website.zip` (alle Seiten, Fotos, Skripte und eine `.htaccess` für IONOS).

## Hochladen (IONOS Webhosting oder Managed WordPress)

1. **IONOS-Konto → Hosting → SFTP & SSH**: SFTP-Zugang anlegen bzw. ablesen (Server, Benutzer, Passwort).
2. Programm **FileZilla** (kostenlos) oder den **Webspace-Explorer** im IONOS-Konto öffnen.
3. Einen **neuen, leeren Ordner** anlegen, z. B. `berger-website`. Nicht in den Ordner einer bestehenden WordPress-Installation hochladen – die `index.html` würde dort die WordPress-Startseite ersetzen.
4. ZIP-Datei auf dem eigenen Rechner entpacken und den **Inhalt** (nicht den Ordner selbst) in `berger-website` hochladen. Die Datei `.htaccess` ist versteckt – in FileZilla über *Server → Anzeigen versteckter Dateien erzwingen* sichtbar machen und mit hochladen.
5. **IONOS-Konto → Domains & SSL → Domain → Verwendung anpassen → Webspace**: als Zielverzeichnis `berger-website` wählen.
6. **SSL-Zertifikat** für die Domain aktivieren (bei IONOS inklusive). Die `.htaccess` leitet danach automatisch auf `https://` um.
7. Seite im Browser öffnen und prüfen: Menü, eine Leistungsseite, Online-Buchung bis zur Bestätigung, eine nicht existierende Adresse (muss die 404-Seite zeigen).

Falls die Website in einem **Unterordner** einer Domain liegt (z. B. `domain.de/neu/`), in der `.htaccess` die Zeile `ErrorDocument 404 /404.html` zu `ErrorDocument 404 /neu/404.html` ändern.

## Vor dem echten Go-live

1. In `src/config.mjs` Domain, Kontaktdaten und Impressumsangaben eintragen.
2. Impressum und Datenschutz rechtlich prüfen lassen.
3. Einverständnis für Fotos aus Kundenobjekten einholen.
4. Erst dann `website.indexierbar: true` setzen und `npm run paket:bss` erneut ausführen und hochladen. Bis dahin sperrt die Website Suchmaschinen (robots.txt, Meta-Tag und `X-Robots-Tag`-Header).
5. Google Search Console und Bing Webmaster Tools einrichten (siehe 02).

## Sonderfall: IONOS Managed WordPress

Bei „Managed WordPress“ ist WordPress bereits installiert. Die statische Website wird einfach daneben in denselben Ordner gelegt:

1. Die WordPress-Installation ist noch leer („Hello world!“), es geht also nichts verloren. Optional vorher im IONOS-Konto ein Backup anlegen.
2. Im IONOS-Konto bei der WordPress-Website die **SFTP-Zugangsdaten** aufrufen.
3. Mit FileZilla verbinden. Im Hauptordner liegen `wp-admin`, `wp-content`, `index.php`, `.htaccess` …
4. Den Inhalt des ZIP-Pakets in diesen Hauptordner hochladen und die vorhandene `.htaccess` **überschreiben** (vorher eine Kopie auf den eigenen Rechner laden).
5. Ergebnis: Die Domain zeigt die neue Website (`index.html` hat Vorrang). Die WordPress-Verwaltung bleibt unter `/wp-admin/` bzw. `/wp-login.php` erreichbar, wird aber nicht mehr gebraucht.
6. Testen: Startseite, Menü, eine Unterseite, Online-Buchung, eine falsche Adresse (404-Seite).

Wenn IONOS die `.htaccess` später wieder durch die WordPress-Version ersetzt, erneut hochladen.

## Online-Buchung auf IONOS

Ohne Endpunkt läuft die Buchung im Demo-Modus und überträgt nichts. Zwei Wege:

- **E-Mail (✅ implementiert und getestet, 🟡 auf IONOS noch nicht live geprüft):** `api/anfrage.php` prüft jede Anfrage serverseitig erneut (Pflichtfelder, Dateityp per Inhalt, Größe, Herkunft, Rate-Limit, Bot-Schutz, doppeltes Absenden) und sendet eine E-Mail ans Büro – mit Fotos und `lead.json` für den späteren Werkora-Import – sowie eine Eingangsbestätigung an den Kunden. Auf dem Webspace werden keine Anfragen gespeichert.
  Aktivieren: in `src/config.mjs` unter `buchung.email` `empfaenger` (wohin) und `absender` (ein IONOS-Postfach Ihrer Domain) eintragen, `npm run paket:bss`, neu hochladen. Danach eine Testanfrage mit Foto senden und prüfen, ob beide E-Mails ankommen (auch Spam-Ordner).
- **Zielbild (📝):** Übertragung direkt nach Werkora (siehe 05).
