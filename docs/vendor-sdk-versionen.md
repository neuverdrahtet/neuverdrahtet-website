# Vendor-SDK-Update-Prozess (Maßnahme 10)

Stand: 03.11.2026. Diese Datei beschreibt, wie mit den Drittanbieter-
Bibliotheken umzugehen ist, die NICHT über npm/`package.json` verwaltet
werden, sondern als fertige Dateien direkt unter `verwaltung/js/vendor/`
liegen und per `<script>`-Tag bzw. `verwaltung/js/vendorLoader.js` geladen
werden. Die `verwaltung/`-App hat bewusst keinen Build-Schritt/Bundler
(siehe `verwaltung/js/vendorLoader.js`-Kommentar) - deshalb sieht
Dependabot (`.github/dependabot.yml`) diese Dateien NICHT, es gibt keinen
Paketmanager-Eintrag, den es prüfen könnte. Das hier ist der Ersatz: eine
feste Liste mit bekannter Version + Quelle + Datum der letzten Prüfung,
und ein kurzer manueller Ablauf fürs Aktualisieren.

## Ausgangslage (vor dieser Maßnahme)

Keine dieser 7 Dateien hatte eine dokumentierte Version oder Quelle im
Repo - ob/wann zuletzt aktualisiert wurde, war nicht nachvollziehbar.
`.github/dependabot.yml` gab es ebenfalls nicht, obwohl es die echten
npm-Abhängigkeiten (Test-/Dev-Werkzeuge in `package.json`) und die in den
CI-Workflows verwendeten GitHub Actions durchaus automatisch hätte
überwachen können.

## 1. Was jetzt automatisch läuft (Dependabot)

`.github/dependabot.yml` lässt GitHub wöchentlich prüfen und bei Bedarf
einen Pull Request öffnen für:
- `npm` (Repo-Root `package.json`): `firebase`, `firebase-admin`,
  `firebase-tools`, `@firebase/rules-unit-testing`, `playwright`, `xhr2` -
  alles reine Test-/Dev-Werkzeuge, nicht Teil der ausgelieferten App.
- `github-actions`: die in `.github/workflows/*.yml` referenzierten
  Actions (z.B. `actions/checkout`).

**Einmaliger Schritt für Danny:** falls Dependabot in den
Repository-Einstellungen (Settings → Code security → Dependabot) noch
nicht aktiviert ist, dort einmal aktivieren - die Konfigurationsdatei
allein reicht bei privaten Repos u.U. nicht.

Jeder Cloudflare-Worker (`cloudflare-worker*/`) hat bewusst kein eigenes
`package.json` (siehe `cloudflare-worker/README.md`) - dort gibt es nichts,
was Dependabot überwachen könnte.

## 2. Was Dependabot NICHT sieht: die 7 vendorten Frontend-Bibliotheken

| Datei | Bibliothek | Bekannte Version | Quelle (zum Herunterladen einer neuen Version) |
|---|---|---|---|
| `verwaltung/js/vendor/firebase/firebase-*.js` | Firebase JS SDK (modular, Auth/Firestore/Storage/Messaging/App) | 11.10.0 | https://www.gstatic.com/firebasejs/\<version\>/firebase-\<modul\>.js |
| `verwaltung/js/vendor/jspdf.umd.min.js` | jsPDF | 2.5.1 | https://github.com/parallax/jsPDF/releases |
| `verwaltung/js/vendor/jspdf.plugin.autotable.min.js` | jsPDF-AutoTable | nicht eindeutig aus der Datei feststellbar | https://github.com/simonbengtsson/jsPDF-AutoTable/releases (Version an die jsPDF-Version anpassen, siehe deren Kompatibilitätshinweise) |
| `verwaltung/js/vendor/xlsx.full.min.js` | SheetJS (xlsx) | nicht eindeutig aus der Datei feststellbar (eingebettete "1.15.0" ist nur die Codepage-Tabellen-Version, NICHT die Bibliotheksversion) | https://cdn.sheetjs.com/ (offizielle Download-Seite, GitHub-Releases nur eingeschränkt aktuell) |
| `verwaltung/js/vendor/leaflet/leaflet.js` + `leaflet.css` | Leaflet | 1.9.4 | https://leafletjs.com/download.html |
| `verwaltung/js/vendor/zxing/zxing.min.js` | ZXing-js (`@zxing/library`, UMD-Build) | nicht eindeutig aus der Datei feststellbar | https://github.com/zxing-js/library/releases bzw. https://cdn.jsdelivr.net/npm/@zxing/library |

Zuletzt geprüft: 03.11.2026 (diese Maßnahme). Bei "nicht eindeutig
feststellbar" wurde die minifizierte Datei nach gängigen Versions-Mustern
durchsucht, ohne Treffer - vor dem nächsten Update am besten direkt beim
Hersteller nachsehen, welche Version aktuell als "stabil" gilt, statt sich
auf die alte Datei zu verlassen.

## 3. Ablauf zum Aktualisieren einer vendorten Bibliothek

1. Aktuelle stabile Version über die Quelle oben herunterladen.
2. Datei unter demselben Pfad/Namen in `verwaltung/js/vendor/` ersetzen.
3. Diese Tabelle (Abschnitt 2) mit der neuen Version + heutigem Datum
   aktualisieren.
4. `npm run test:unit` laufen lassen (deckt u.a. `qrcode.js`/`girocode.js`
   gegen ZXing, PDF-Erzeugung gegen jsPDF ab, soweit per Node testbar).
5. Mindestens einmal die betroffenen Features im Browser durchklicken
   (PDF-Export, Excel-Import/-Export, Kartenansicht, QR-Code-Anzeige,
   Login/Firestore bei einem Firebase-SDK-Update) - diese Bibliotheken
   laufen nur im Browser, nicht in den Node-Unit-Tests.
6. Bei einem Firebase-SDK-Update zusätzlich: Changelog auf
   Breaking Changes in Auth/Firestore-API prüfen (die App nutzt die
   modulare v9+-API direkt, siehe `verwaltung/js/firebase.js`).
