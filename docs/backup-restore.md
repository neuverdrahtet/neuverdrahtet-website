# Backup/Restore-Konzept (P0 Phase 1, Maßnahme 3)

Stand: 03.11.2026. Diese Datei beschreibt, was gesichert wird, wie ein
Restore im Ernstfall abläuft, und die einmaligen manuellen Einrichtungs­schritte
in der Google-Cloud-Konsole, die nicht per Code/Deploy gesetzt werden können.

## Ausgangslage (vor dieser Maßnahme)

Es gab keine serverseitige, automatisierte Firestore-Backup-Pipeline - weder
im Repo noch als GCP-Konfiguration. Das Thema wurde in der vorherigen
P0-Sicherheitsarbeit (`docs/p0-security-baseline.md`, `docs/p0-abschlussbericht.md`)
nicht als offener Punkt dokumentiert. Vorhanden war nur:

- **Firestore Point-in-Time-Recovery (PITR)**, von Google separat je Projekt
  aktivierbar (für `neuverdrahtet-verwaltung` bestätigt aktiv): 7-Tage-
  Rückblickfenster, deckt versehentliche Schreib-/Löschfehler kurzfristig ab,
  schützt aber NICHT gegen Verlust/Kompromittierung des gesamten
  Firebase-Projekts/-Kontos.
- **Google-Drive-JSON-Export/-Import** in der Verwaltungs-UI
  (`verwaltung/js/google.js`, `verwaltung/js/views/einstellungen.js`,
  `exportAll()`/`importAll()` in `verwaltung/js/db.js`) - client-seitig,
  standardmäßig deaktiviert (`driveBackupEnabled: false`), abhängig von
  aktiver Google-Verbindung. Bleibt als Zweitweg bestehen, ersetzt aber kein
  vollständiges, GCP-natives Backup.

## Was diese Maßnahme ergänzt

Ein **wöchentlicher nativer Firestore-Export nach Cloud Storage**
(`runFirestoreBackup()` in `cloudflare-worker/worker.js`), läuft sonntags im
bestehenden täglichen 05:00-Cron-Trigger mit (kein zusätzlicher Cron-Trigger -
Cloudflare Workers Free begrenzt auf 5 pro Account, bereits ausgeschöpft).
Nutzt dieselbe Firestore-Admin-Export-API wie `gcloud firestore export`.
Hinter Feature-Flag `BACKUP_EXPORT_AKTIV` (Standard: `false`), siehe
`cloudflare-worker/wrangler.toml`.

Das ist **zusätzlich** zu PITR, nicht ein Ersatz dafür: PITR deckt die letzten
7 Tage für feingranulare Zeitpunkt-Wiederherstellung ab, der wöchentliche
Export liefert eine langfristige, vom Firestore-Projekt unabhängige Kopie in
einem separaten Cloud-Storage-Bucket (schützt auch gegen Szenarien, bei denen
das Firestore-Projekt selbst betroffen ist, z. B. Account-Kompromittierung).

## Einmalige Einrichtung (NICHT per Code/Deploy möglich)

1. **Bucket festlegen**: entweder das ohnehin vorhandene Firebase-Storage-
   Bucket des Projekts weiterverwenden (Firebase-Konsole → Storage → Dateien,
   Bucket-Name dort ablesen) oder einen dedizierten neuen Cloud-Storage-Bucket
   anlegen. Namen in `cloudflare-worker/wrangler.toml` bei `BACKUP_GCS_BUCKET`
   eintragen (ersetzt `<GCS-BUCKET-NAME>`).
2. **IAM-Rolle zuweisen**: dem Service-Account aus dem Secret
   `FIREBASE_SERVICE_ACCOUNT_JSON` (Google-Cloud-Konsole → IAM & Verwaltung →
   IAM) die Rolle **"Cloud Datastore Import Export Admin"**
   (`roles/datastore.importExportAdmin`) auf Projektebene zuweisen. Ohne diese
   Rolle schlägt der Export-API-Aufruf mit einem Berechtigungsfehler fehl
   (landet dann als `status: failed` in der Firestore-Collection
   `jarvisJobs` sowie in `ai_action_log`).
3. **Erst danach** `BACKUP_EXPORT_AKTIV = "true"` in
   `cloudflare-worker/wrangler.toml` setzen und deployen.
4. **Empfohlen, nicht zwingend** - Lifecycle-Regel auf dem Bucket, damit
   Exporte nicht unbegrenzt Speicher/Kosten anhäufen (z. B. 90 Tage
   aufbewahren):
   ```bash
   cat > /tmp/firestore-backup-lifecycle.json <<'EOF'
   {
     "rule": [
       { "action": {"type": "Delete"}, "condition": {"age": 90, "matchesPrefix": ["firestore-backups/"]} }
     ]
   }
   EOF
   gsutil lifecycle set /tmp/firestore-backup-lifecycle.json gs://<GCS-BUCKET-NAME>
   ```

## Restore-Prozedur (Ernstfall)

Ein Restore ist ein seltener, von einem Menschen bewusst ausgelöster
Eingriff - absichtlich NICHT in der App automatisiert. Vorgehen:

1. **Export-Pfad finden**: im Ziel-Bucket unter `firestore-backups/<DATUM>/`
   nachsehen (`gsutil ls gs://<GCS-BUCKET-NAME>/firestore-backups/`), oder den
   zuletzt erfolgreichen Lauf in der Firestore-Collection `jarvisJobs`
   nachschlagen (Dokument-ID-Muster `firestore-backup-<DATUM>`,
   `ergebnisZusammenfassung` enthält den vollen `outputUriPrefix`).
2. **Umfang entscheiden**:
   - **Vollständiger Restore** (ganze Datenbank überschreiben): nur im
     Katastrophenfall, z. B. Totalverlust/-korruption. Das Firestore-Projekt
     ist währenddessen für Schreibzugriffe gesperrt - Downtime einplanen.
   - **Teilimport** (nur bestimmte Collections): möglich, siehe
     `--collection-ids` unten - weniger riskant, bevorzugen wo möglich.
3. **Import ausführen** (braucht `gcloud`-CLI mit Projektzugriff):
   ```bash
   # Vollständig:
   gcloud firestore import gs://<GCS-BUCKET-NAME>/firestore-backups/<DATUM> \
     --project neuverdrahtet-verwaltung

   # Nur bestimmte Collections (Beispiel):
   gcloud firestore import gs://<GCS-BUCKET-NAME>/firestore-backups/<DATUM> \
     --collection-ids=rechnungen,kunden \
     --project neuverdrahtet-verwaltung
   ```
   Ein Import **fügt Dokumente hinzu/überschreibt sie anhand ihrer ID** - er
   löscht keine zwischenzeitlich neu angelegten Dokumente, die im Export noch
   nicht existierten. Bei einem vollständigen Rückbau auf exakt den
   Export-Zeitpunkt ggf. vorher gezielt neuere Dokumente außerhalb des
   Exports manuell bereinigen.
4. **Alternative für die letzten 7 Tage**: Point-in-Time-Recovery nutzen statt
   eines GCS-Imports, wenn der gewünschte Wiederherstellungszeitpunkt
   innerhalb des 7-Tage-PITR-Fensters liegt (granularer, kein manueller
   Export nötig) - siehe Google-Cloud-Konsole → Firestore → Datenbank →
   "Point-in-time recovery".
5. **Danach verifizieren**: Stichprobenartig einige Datensätze in der
   Verwaltungs-Oberfläche prüfen, insbesondere `rechnungen`/`mahnungen`
   (GoBD-relevant) und `users` (Rollen/Zugriff).

## Nicht Teil dieser Maßnahme

- Kein automatisiertes Restore-Testing (z. B. monatlicher Testimport in eine
  Staging-Umgebung) - manuell nachzuholen, falls gewünscht.
- Keine formalen RTO-/RPO-Ziele festgelegt.
- Storage-Bucket-Zugriffskontrolle (wer darf die Export-Dateien lesen) liegt
  vollständig in der GCP-IAM-Konfiguration, nicht im Repo.
