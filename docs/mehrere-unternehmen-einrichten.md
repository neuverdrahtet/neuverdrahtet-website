# Werkora für mehrere Unternehmen nutzen

Kurze Entscheidungshilfe + Anleitung, ausgelöst durch Dannys Frage (18.11.2026): "können wir die software so bauen das ich diese für mehrere unternehmen nutzen kann" + "und eine einfache einrichtung und installation".

## Die wichtigste Unterscheidung zuerst

Es gibt zwei ganz unterschiedliche Bedeutungen von "mehrere Unternehmen", und der Unterschied entscheidet komplett über Aufwand und Lösungsweg:

| | **Szenario A: Weitere Marke** | **Szenario B: Eigene, getrennte Firma** |
|---|---|---|
| Rechtlich/steuerlich | Bleibt dieselbe UG/GmbH, nur anderer Außenauftritt | Eigene USt-ID, eigenes Finanzamt, eigene Buchhaltungspflicht |
| Rechnungsnummern | Ein gemeinsamer, lückenloser Nummernkreis reicht (so ist es GoBD-konform) | MUSS eigener, lückenloser Nummernkreis sein - gesetzliche Pflicht pro Rechtsträger |
| Kunden/Projekte | Können geteilt werden | Sollten getrennt sein (sonst vermischt sich die Buchhaltung) |
| Aufwand | **Schon fertig, sofort nutzbar** | Eigene, komplett unabhängige Werkora-Installation nötig |

**Wenn du dir noch nicht sicher bist** (wie aktuell): fang mit Szenario A an (kostet nichts, ist in 2 Minuten eingerichtet). Stellt sich später heraus, dass es doch eine eigene Firma mit eigener USt-ID wird, wechselst du einfach zu Szenario B - die Daten aus Szenario A bleiben dabei unberührt in der Hauptinstallation.

---

## Szenario A: Weitere Marke unter derselben neuverdrahtet UG

Bereits vollständig gebaut, keine Entwicklung nötig. So geht's:

1. **Einstellungen → Marken → "+ Neue Marke"**: eigenen Namen, Logo, Adresse, Telefon, E-Mail, Website eintragen (alles optional - leer gelassene Felder übernehmen automatisch die Hauptfirmen-Daten).
2. Beim Anlegen eines **Projekts** die neue Marke auswählen (Feld "Marke"). Alle davon abgeleiteten Dokumente (Angebote, Rechnungen, Auftragsbestätigungen, Mahnungen, Berichte) zeigen dann automatisch Name/Logo/Kontaktdaten der gewählten Marke statt der Hauptfirma.
3. **Mitarbeiter** lassen sich optional auf bestimmte Marken beschränken (Mitarbeiter bearbeiten → "Marken-Freigabe") - wirkt sich auf die Vorauswahl bei der Projektzuweisung aus.
4. **Auswertungen** zeigen Umsatz/Ausgaben zusätzlich nach Marke aufgeschlüsselt.

**Was dabei bewusst gleich bleibt** (weil es sich um dieselbe Firma handelt): USt-ID, Bankverbindung/IBAN, Steuernummer, Rechnungs-/Angebotsnummernkreis, Buchhaltungsexport - all das kommt immer aus den globalen Firmeneinstellungen, unabhängig von der gewählten Marke. Kunden sind ebenfalls nicht pro Marke getrennt.

---

## Szenario B: Eigene, komplett getrennte Firma

Hier reicht die Marken-Funktion NICHT (eigene USt-ID/Nummernkreis/Buchhaltung sind gesetzlich zwingend getrennt zu halten). Die technisch sauberste und am schnellsten umsetzbare Lösung: **eine zweite, komplett unabhängige Werkora-Installation** - nicht ein Umbau der bestehenden Datenbank. Das ist exakt dasselbe, bereits erprobte Muster wie die Staging-Umgebung dieses Projekts (siehe `staging/README.md`), nur dauerhaft für den Produktivbetrieb statt zum Testen.

**Warum das automatisch alle rechtlichen Anforderungen erfüllt, ohne eine Zeile Code zu ändern:** eine zweite Firebase-Projekt-Installation hat eine eigene, komplett unabhängige Firestore-Datenbank. Eigene Kunden, eigene Rechnungsnummernzähler (beginnt bei 1, läuft unabhängig), eigene Einstellungen (eigene USt-ID/IBAN/Steuernummer/Firmenname/Logo), eigene Buchhaltungsauswertung - alles strukturell getrennt, weil es physisch eine andere Datenbank ist. Es gibt keine Möglichkeit, versehentlich Daten zu vermischen.

### Schritt 1: Neues Firebase-Projekt

1. In der [Firebase Console](https://console.firebase.google.com) ein neues Projekt anlegen, z.B. `<firmenname>-verwaltung`.
2. Authentication aktivieren (E-Mail/Passwort).
3. Firestore (Native-Modus) + Storage aktivieren.
4. Die bestehenden `firestore.rules`/`storage.rules` aus diesem Repo unverändert deployen: `firebase deploy --only firestore:rules,storage --project <neue-projekt-id>`.
5. Eine eigene Web-App im neuen Projekt anlegen (Projekteinstellungen → "Meine Apps" → Web) - liefert den `firebaseConfig`-Block, der in Schritt 3 gebraucht wird.

### Schritt 2: Firebase Hosting für die zweite Firma

1. Im Repo-Root `firebase.json` hat bereits einen `hosting`-Block (`public: "verwaltung"`, wie für Staging genutzt). Für die zweite Firma reicht ein zusätzlicher Hosting-Alias auf dasselbe neue Projekt: `firebase deploy --only hosting --project <neue-projekt-id>`.
2. Ergebnis: eine eigene `https://<neue-projekt-id>.web.app`-Adresse, auf der exakt dieselbe Werkora-Oberfläche läuft - aber mit eigener Datenbank im Hintergrund.
3. Optional eine eigene Domain (z.B. `verwaltung.<zweite-firma>.de`) per Firebase-Hosting-Custom-Domain verbinden.

### Schritt 3: Firebase-Projekt für die zweite Installation hinterlegen

Die zweite Installation braucht ihre eigene `firebaseConfig` statt der Produktionswerte. Zwei Möglichkeiten:

- **Einfachste Variante (empfohlen für den Start):** einen zweiten, unabhängigen Checkout dieses Repos anlegen (z.B. eigener Git-Branch oder eigenes Deploy-Verzeichnis), darin nur `verwaltung/js/firebase-config.js` auf die neuen Werte der zweiten Firma anpassen, und diesen Checkout separat nach Schritt 2 deployen. Komplett unabhängig von der Hauptinstallation, keinerlei Risiko einer Verwechslung.
- **Alternative (etwas mehr Einrichtungsaufwand, dafür ein gemeinsamer Code-Stand für beide Firmen):** `firebase-config.js` um einen dritten, hostnamen-basierten Eintrag erweitern (nach demselben Muster, das dort schon für Staging existiert) - dann läuft eine einzige Codebasis automatisch mit der richtigen Datenbank, je nachdem unter welcher Domain sie aufgerufen wird. Sauberer für künftige Code-Updates (ein Push aktualisiert beide Firmen), aber etwas fehleranfälliger bei der Einrichtung (Hostname muss exakt stimmen). Sag Bescheid, falls das die bevorzugte Variante werden soll - das baue ich dann konkret.

### Schritt 4: Einmalige Ersteinrichtung in der neuen Installation

1. Auf der neuen URL einmal mit einer E-Mail-Adresse registrieren (erster Login legt automatisch den `admin`-Zugang an, wie bei der Hauptinstallation).
2. **Einstellungen** komplett neu ausfüllen: Firmenname, Adresse, USt-ID, Steuernummer, Bankverbindung, Logo, Rechnungs-/Angebots-Nummernkreis-Präfix (z.B. andere Präfix-Buchstaben als die Hauptfirma, damit auf einen Blick erkennbar ist, aus welcher Installation eine Nummer stammt).
3. Mitarbeiter-Zugänge für die zweite Firma separat einladen (eigene Logins, keine Übernahme aus der Hauptinstallation).

### Was dabei NICHT nötig ist

- Keine Code-Änderung an Rechnungs-/Angebotslogik, Buchhaltung oder Auswertungen - die funktionieren in der zweiten Installation automatisch korrekt, weil sie "ihre eigene", leere Datenbank sehen.
- Keine Migration bestehender Daten (die zweite Firma startet bewusst bei null).
- JARVIS/KI-Bürokraft/Cloudflare-Worker-Funktionen (Beleg-Scan, Mail-Automatisierung) sind für die zweite Installation **optional** - die Kernfunktionen (Kunden, Angebote, Rechnungen, Projekte, Termine, Zeiterfassung) laufen bereits rein über Firestore, ganz ohne die Worker. Werden die KI-Funktionen auch für die zweite Firma gewünscht, bräuchte es zusätzlich eigene Cloudflare-Worker-Deployments (gleiches Muster wie `staging/README.md` Schritt 2-4) - das ist ein separater, bei Bedarf nachrüstbarer Schritt.

### Laufende Kosten/Pflege, die zu bedenken sind

- Ein zweites Firebase-Projekt kann (je nach Nutzungsvolumen) eigene Kosten verursachen, sobald der kostenlose Spark-Tarif überschritten wird - unabhängig von der Hauptfirma abzurechnen.
- Zwei komplett getrennte Logins/URLs bedeuten: kein gemeinsamer Blick auf beide Firmen auf einen Blick (z.B. kein gemeinsames Dashboard über beide Firmen hinweg) - wer beide Firmen im Blick behalten will, muss zwischen den beiden URLs wechseln.
- Software-Updates (neue Werkora-Funktionen) müssen bei der "einfachsten Variante" (separater Checkout) in beiden Ständen nachgezogen werden, falls gewünscht - bei der "Alternative" (ein Code-Stand, hostnamen-basiert) automatisch mit jedem Deploy.

---

## Offene Entscheidung

Dieses Dokument ist als Vorbereitung gedacht, solange noch nicht feststeht, ob die zweite Firma rechtlich getrennt wird. Sobald klar ist:
- **"Es bleibt eine Marke"** → Szenario A sofort nutzbar, dieses Dokument kann ignoriert werden.
- **"Es wird doch eine eigene Firma"** → Schritt 1-4 oben mit dem Firmennamen/der gewünschten Domain konkret durchgehen; die eigentliche Firebase-/Hosting-Einrichtung (Schritt 1-2) erfordert echten Zugriff auf Google-Konto/Domain-Verwaltung, das kann nur Danny selbst (oder mit seiner ausdrücklichen Freigabe) tatsächlich anlegen - genau wie beim bestehenden Staging-Setup.
