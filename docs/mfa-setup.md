# Zwei-Faktor-Authentifizierung (MFA) - Einrichtung (Maßnahme 8)

Stand: 03.11.2026. Diese Datei beschreibt den einen manuellen Schritt in der
Firebase-Konsole, der für Zwei-Faktor-Authentifizierung (TOTP, Authenticator-
App) nötig ist, und was passiert, solange er noch nicht erledigt ist.

## Ausgangslage (vor dieser Maßnahme)

Es gab überhaupt keine Zwei-Faktor-Authentifizierung und keine "Passwort
vergessen"-Funktion - jedes Konto war ausschließlich durch E-Mail+Passwort
geschützt. Beides ist jetzt gebaut:

- **Passwort vergessen**: Link auf dem Login-Bildschirm, versendet über
  Firebase (`sendPasswordResetEmail`). Funktioniert sofort, ohne weitere
  Einrichtung.
- **Zwei-Faktor-Authentifizierung (TOTP, z.B. Google Authenticator)**:
  freiwillig (opt-in), jeder richtet es für sein eigenes Konto selbst unter
  **🔐 Sicherheit** (Link im Sidebar-Footer neben "Sperren") ein. Dafür ist
  **ein einmaliger Schritt in der Firebase-Konsole nötig** (siehe unten) -
  ohne ihn schlägt die Einrichtung mit einem Firebase-Fehler fehl, den die
  Seite dem Nutzer direkt anzeigt.

## Einmaliger Schritt: TOTP-MFA im Firebase-Projekt aktivieren

1. [console.firebase.google.com](https://console.firebase.google.com) öffnen,
   Projekt `neuverdrahtet-verwaltung` wählen.
2. **Authentication → Sign-in method** → ganz unten **Multi-factor
   authentication** → **TOTP** aktivieren (keine Telefonnummer/SMS-Kosten
   nötig - das ist ein eigener, kostenloser Faktor-Typ).
3. Fertig - ab sofort funktioniert "🔐 Sicherheit → Aktivieren" für jeden
   Nutzer.

**Zusätzliche Firebase-Voraussetzung (gilt immer, nicht nur hier):**
Firebase verlangt eine **bestätigte E-Mail-Adresse**, bevor ein zweiter
Faktor eingeschrieben werden darf. Die Sicherheitsseite zeigt dafür selbst
einen "Bestätigungs-E-Mail senden"-Schritt an, falls die E-Mail-Adresse noch
nicht bestätigt ist - das ist kein Fehler, sondern Firebase-Standardverhalten.

## Bekannte Testgrenze (Firebase Local Emulator Suite)

Beim Bauen dieser Maßnahme wurde versucht, den kompletten Einschreibungs-/
Login-Ablauf gegen die lokale Firebase-Emulator-Suite Ende-zu-Ende zu testen
(wie bei früheren Maßnahmen in diesem Repo üblich). Dabei zeigte sich: der
**Auth-Emulator unterstützt TOTP-MFA nicht** (nur Telefon-MFA) - ein
Einschreibungsversuch dort schlägt mit einem internen Emulator-Fehler
("Missing phoneEnrollmentInfo") fehl, der bei einem echten Firebase-Projekt
so nicht auftritt. Passwort-Reset und die E-Mail-Bestätigung wurden
erfolgreich Ende-zu-Ende gegen den Emulator getestet (inkl. echtem
Registrierungs-/Login-Ablauf); der eigentliche TOTP-Einschreibungs-/
Login-Challenge-Code folgt exakt der offiziellen Firebase-Web-SDK-API
(`TotpMultiFactorGenerator`, `getMultiFactorResolver`) und wurde durch Lesen
gegen diese API verifiziert, konnte aber nicht live durchgespielt werden.

**Empfehlung:** nach Schritt 1-3 oben einmal selbst mit einem eigenen Konto
(nicht dem einzigen Admin-Konto, falls vorhanden) durchklicken: Sicherheit
öffnen, E-Mail bestätigen, Zwei-Faktor aktivieren (echte Authenticator-App
scannen), ausloggen, mit Code wieder einloggen, danach wieder deaktivieren.
