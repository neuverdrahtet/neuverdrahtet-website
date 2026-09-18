# neuverdrahtet-social-publish (Cloudflare Worker)

Ermöglicht das **direkte Veröffentlichen** eines in Werkora erstellten
Social-Media-Posts (Foto + Text) auf der **Facebook-Seite** und dem
verknüpften **Instagram-Business-Konto** von neuverdrahtet - ohne Bild
herunterladen/Text kopieren und manuell in der jeweiligen App hochladen.

Dieser Worker selbst kennt **kein Meta-App-Secret**. Die Anmeldung
(Facebook-Login, Auswahl der Seite/des Instagram-Kontos) läuft komplett im
Browser über das Facebook-JavaScript-SDK, genau wie die bestehende
Google-Verbindung (Kalender/Gmail) in Werkora - der Worker ist nur ein
schlanker Vermittler für die eigentlichen Veröffentlichen-Aufrufe, weil
Meta's Schreib-Endpunkte aus dem Browser heraus nicht zuverlässig per CORS
erreichbar sind, und weil Instagram zusätzlich eine öffentlich erreichbare
Bild-URL braucht (kein direkter Datei-Upload).

## Einmaliges Setup

### 1. Meta-App anlegen (nur einmal nötig)

1. Auf [developers.facebook.com](https://developers.facebook.com/apps) mit
   deinem normalen Facebook-Account einloggen (der auch die neuverdrahtet-
   Firmenseite verwaltet) und **"App erstellen"** klicken.
2. App-Typ **"Sonstiges"** → **"Unternehmen"** wählen, einen Namen vergeben
   (z.B. "neuverdrahtet Werkora").
3. Im App-Dashboard unter **"Produkte hinzufügen"** das Produkt
   **"Facebook-Login"** hinzufügen (Web-Variante reicht, kein iOS/Android).
4. Unter **Facebook-Login → Einstellungen**:
   - **"Gültige OAuth-Weiterleitungs-URIs"**: kann leer bleiben (wir nutzen
     den Popup-Login, keinen Redirect-Flow).
   - Unter **App-Einstellungen → Grundlegendes**: bei **"App-Domains"**
     `neuverdrahtet.com` eintragen, und unter **"Website"** die Plattform
     hinzufügen mit der Seiten-URL `https://neuverdrahtet.com/verwaltung/`.
5. Unter **App-Einstellungen → Grundlegendes** die **App-ID** notieren
   (öffentlich, kein Geheimnis - kommt später in Werkora → Einstellungen).
   Das **App-Secret** wird hier NICHT gebraucht.
6. Unter **Rollen → Rollen** dich selbst (und ggf. Kollegen, die Posts
   veröffentlichen sollen) als **Administrator** oder **Entwickler**
   eintragen. Solange die App im Entwicklungsmodus bleibt (Standard, keine
   Meta-Prüfung nötig), können nur diese Rollen sich damit anmelden - für
   den eigenen Betrieb reicht das völlig aus.
7. Stelle sicher, dass dein **Instagram-Konto** ein **Business- oder
   Creator-Konto** ist und mit der neuverdrahtet-**Facebook-Seite** verknüpft
   ist (Instagram-App → Profil → Kontoeinstellungen → "Verknüpfte Konten").
   Ohne diese Verknüpfung findet Werkora kein Instagram-Ziel zum Posten.

### 2. Diesen Worker deployen (Cloudflare-Dashboard)

1. Im [Cloudflare-Dashboard](https://dash.cloudflare.com) → **Workers &
   Pages** → **"Worker erstellen"** (oder "Create Worker").
2. Einen Namen vergeben (z.B. `neuverdrahtet-social-publish`) und erstellen.
3. Auf **"Edit code"** / **"Quick Edit"** klicken, den kompletten
   Beispielcode im Editor löschen und stattdessen den kompletten Inhalt der
   Datei `worker.js` aus diesem Ordner einfügen.
4. Oben rechts auf **"Deploy"** klicken.
5. Zurück zur Worker-Übersicht → **Settings → Variables**:
   - Als **Secret** (nicht als normale Variable!) `APP_SECRET` anlegen -
     ein selbst ausgedachter langer Zufallswert (z.B. per Passwort-
     generator), am besten ein ANDERER Wert als bei den übrigen Workern.
   - Optional als normale Variable `ALLOWED_ORIGINS` setzen, falls die
     Verwaltung nicht unter `https://neuverdrahtet.com` läuft (Standard
     deckt `https://neuverdrahtet.com` und `https://www.neuverdrahtet.com`
     ab).
6. Die entstandene Worker-URL notieren (z.B.
   `https://neuverdrahtet-social-publish.<dein-account>.workers.dev`).

### 3. In Werkora eintragen

In Werkora → **Einstellungen → Social-Media-Veröffentlichung**:

- **Meta App-ID**: die App-ID aus Schritt 1.5.
- **Worker-URL**: die URL aus Schritt 2.6.
- **App-Secret**: derselbe Wert wie in Schritt 2.5 (`APP_SECRET`).

Danach auf **"Mit Facebook verbinden"** klicken - ein Facebook-Anmeldefenster
öffnet sich, danach zeigt Werkora die verknüpfte Seite und ggf. das
Instagram-Konto an. Die Verbindung gilt (wie bei Google) nur für die
aktuelle Browser-Sitzung - nach einiger Zeit bzw. nach Schließen des
Browsers muss man sich erneut verbinden.

## Danach einmal live testen

- Unter **Social-Media-Post** einen Post aus einem Foto generieren.
- Bei der Instagram- bzw. Facebook-Kachel auf **"🚀 Direkt
  veröffentlichen"** klicken und prüfen, ob der Post tatsächlich auf der
  Seite/dem Instagram-Konto erscheint.
- Schlägt es fehl: die Fehlermeldung wird 1:1 von Meta durchgereicht - meist
  liegt es an fehlenden Berechtigungen (Schritt 1.6) oder daran, dass das
  Instagram-Konto kein Business-Konto ist bzw. nicht mit der Seite verknüpft
  ist (Schritt 1.7).
