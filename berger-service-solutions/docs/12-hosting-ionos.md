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

Ergebnis in `berger-service-solutions/dist/`:
- `berger-service-solutions-website.zip` – für normales Webhosting (Inhalt in den Web-Hauptordner, inklusive `.htaccess`),
- `berger-service-solutions-wordpress.zip` – für IONOS Managed WordPress (siehe unten).

## Hochladen bei normalem Webhosting

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

## IONOS Managed WordPress (Ihr Tarif)

Bei Managed WordPress erlaubt der SFTP-Zugang nur den Ordner `/public/wp-content`. Dafür gibt es ein eigenes Paket: **`berger-service-solutions-wordpress.zip`**. Es enthält

- `bss-website/` – die komplette Website,
- `mu-plugins/bss-website.php` – ein kleines „Must-Use“-Modul, das die Website unter der Domain ausliefert. WordPress lädt es automatisch; es muss nicht aktiviert werden und kann im Backend nicht versehentlich ausgeschaltet werden.

Schritte:

1. **IONOS → SFTP-Konto anlegen:** Passwort vergeben (nur für sich notieren), Typ **SFTP**, Verzeichnis `/public/wp-content` lassen, *Speichern*. Danach den automatisch erstellten **Benutzernamen** und den **Server** notieren.
2. **FileZilla** öffnen: Server `sftp://<Server>`, Benutzername, Passwort, Port `22` → *Verbinden*.
3. Rechts erscheint der Ordner `wp-content` mit `plugins`, `themes`, `uploads` … Unter *Server → Anzeigen versteckter Dateien erzwingen* einschalten.
4. Das ZIP auf dem eigenen Rechner entpacken. Links die beiden Ordner **`bss-website`** und **`mu-plugins`** markieren und nach rechts in `wp-content` ziehen. Gibt es `mu-plugins` schon, zusammenführen.
5. Domain bzw. Testadresse im Browser öffnen: Statt „Hello world!“ erscheint die neue Website. Die WordPress-Verwaltung bleibt unter `/wp-admin/` erreichbar.
6. Testen: Menü, Unterseite, Fotos, Online-Buchung, falsche Adresse (404-Seite).

Zurück zu WordPress: die Datei `wp-content/mu-plugins/bss-website.php` löschen.
Aktualisieren: neues Paket hochladen und die beiden Ordner überschreiben.

Bilder, CSS und Skripte werden in diesem Paket direkt aus `/wp-content/bss-website/assets/` geladen, nur die Seiten laufen über das Modul. So funktioniert es auch, wenn der Hoster Dateianfragen nicht an WordPress weiterreicht.

## Online-Buchung auf IONOS

Ohne Endpunkt läuft die Buchung im Demo-Modus und überträgt nichts. Zwei Wege:

- **E-Mail (✅ implementiert und getestet, 🟡 auf IONOS noch nicht live geprüft):** `api/anfrage.php` prüft jede Anfrage serverseitig erneut (Pflichtfelder, Dateityp per Inhalt, Größe, Herkunft, Rate-Limit, Bot-Schutz, doppeltes Absenden) und sendet eine E-Mail ans Büro – mit Fotos und `lead.json` für den späteren Werkora-Import – sowie eine Eingangsbestätigung an den Kunden. Auf dem Webspace werden keine Anfragen gespeichert.
  Aktivieren: in `src/config.mjs` unter `buchung.email` `empfaenger` (wohin) und `absender` (ein IONOS-Postfach Ihrer Domain) eintragen, `npm run paket:bss`, neu hochladen. Danach eine Testanfrage mit Foto senden und prüfen, ob beide E-Mails ankommen (auch Spam-Ordner).
- **Zielbild (📝):** Übertragung direkt nach Werkora (siehe 05).
