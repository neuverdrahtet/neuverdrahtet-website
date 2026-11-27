#!/usr/bin/env node
// Einmaliges Migrationsskript: überträgt die bestehenden Firestore-Daten in
// die neue SQLite-Datenbank des Selfhost-Servers (siehe README.md). Rein
// LESEND gegenüber Firestore - schreibt/löscht dort nichts.
//
// Verwendung:
//   GOOGLE_APPLICATION_CREDENTIALS=/pfad/zum/service-account.json \
//     node selfhost-server/migrate-from-firebase.mjs --project neuverdrahtet-verwaltung [--dry-run] [--force]
//
// Voraussetzung: ein Service-Account-Schlüssel (JSON) aus der Firebase
// Console (Projekteinstellungen -> Dienstkonten -> Neuen privaten Schlüssel
// generieren) - NIE in dieses Repo einchecken, nur lokal/temporär verwenden.
//
// --project muss exakt mit der project_id in der Credential-Datei
// übereinstimmen (gleiches Sicherheitsmuster wie in
// staging/seed-synthetic-data.mjs) - verhindert ein Vertippen/Verwechseln
// von Produktions- und Staging-Projekt.
//
// --dry-run: zeigt nur an, was übertragen würde, schreibt nichts.
// --force: nötig, falls die Ziel-Datenbank (DATA_DIR/werkora.db) bereits
//          Daten enthält - sonst bricht das Skript sicherheitshalber ab,
//          um nicht versehentlich eine schon genutzte Selfhost-Installation
//          zu vermischen.
//
// Login-Konten (Firestore-Collection "users") lassen sich NICHT mit
// Passwort übertragen - Firebase gibt Passwort-Hashes grundsätzlich nicht
// heraus, auch nicht an das Admin SDK. Für jedes bestehende Konto wird
// stattdessen automatisch eine neue Einladung angelegt (gleicher
// Mechanismus wie "Mitarbeiter einladen" in der App) - die betroffene Person
// registriert sich danach einmalig mit einem neuen Passwort. Am Ende zeigt
// das Skript eine Liste aller betroffenen E-Mail-Adressen.
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openStore } from './lib/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Gleiche Liste wie STORES in verwaltung/js/db.js (bewusst hier dupliziert
// statt importiert - db.js ist ein Browser-Modul mit Abhängigkeiten, die in
// einem reinen Node-Skript nicht laufen, siehe google.js-Hinweis in diesem
// Projekt zu genau diesem Fallstrick). Bei neuen Collections in db.js auch
// hier ergänzen.
const DATENCOLLECTIONS = [
  'kunden', 'mitarbeiter', 'projekte', 'kanbanSpalten', 'termine', 'katalog', 'angebote',
  'auftragsbestaetigungen', 'rechnungen', 'gutschriften', 'lieferscheine', 'mahnungen',
  'zeiterfassung', 'fotos', 'vorlagen', 'ausgaben', 'belegVorschlaege', 'aufgaben', 'dokumente',
  'kategorien', 'nachrichten', 'geraete', 'flotten', 'teams', 'terminStatus', 'textbausteine',
  'aufgabenStatus', 'lagerbewegungen', 'verwendungen', 'emails', 'pushTokens', 'fahrten', 'anlagen',
  'marken', 'konten', 'buchungen', 'bankbuchungen', 'anlagegueter', 'kundenStatus', 'subunternehmer',
  'ai_action_log', 'ki_freigaben', 'socialPosts', 'lieferanten', 'inventuren', 'urlaubsantraege',
  'formulare', 'formularEintraege', 'aufmasse', 'zahlungsabgleich', 'katalogVorschlaege',
  'uploadLinks', 'jarvisGespraeche', 'jarvisAktionen', 'jarvisJobs', 'jarvisKosten',
  'jarvisEmailVerarbeitung', 'jarvisRechnungsEntwuerfe', 'jarvisMahnEntwuerfe',
  'jarvisTerminVorschlaege', 'jarvisAngebotsPruefung', 'jarvisKennzahlenVerlauf',
  'jarvisTechAnalysen', 'jarvisPruefprotokolle', 'pruefnormenGrenzwerte', 'siriGeraeteTokens',
  'serviceauftraege', 'reisekostensaetze', 'reisekostenabrechnungen', 'bonusreferenzwerte',
  'mitarbeiterBenefits', 'benefitSteuerregeln',
];

// Firestore-spezifische Werte (Timestamp, GeoPoint, DocumentReference) lassen
// sich nicht direkt als JSON in SQLite ablegen - werden hier in einfache,
// vom Rest der App bereits erwartete Formen umgewandelt (die App schreibt
// Datumswerte ohnehin durchgängig als ISO-Strings, siehe z.B. todayISO() in
// utils.js, nie als Firestore-Timestamp).
function sanitize(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value?.toDate === 'function') return value.toDate().toISOString(); // Timestamp
  if (typeof value?.latitude === 'number' && typeof value?.longitude === 'number') {
    return { lat: value.latitude, lng: value.longitude }; // GeoPoint
  }
  if (typeof value?.path === 'string' && typeof value?.id === 'string' && value.firestore) {
    return value.path; // DocumentReference
  }
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v)]));
  }
  return value;
}

// firestore: ein Objekt mit .collection(name).get() (wie admin.firestore()),
// austauschbar gegen ein Test-Double - siehe migrate-from-firebase.test.mjs.
export async function runMigration({ firestore, store, dryRun = false, log = console.log }) {
  const ergebnis = { collections: {}, einladungenErstellt: [], fehler: [] };

  for (const name of DATENCOLLECTIONS) {
    try {
      const snap = await firestore.collection(name).get();
      ergebnis.collections[name] = snap.docs.length;
      if (dryRun) continue;
      for (const doc of snap.docs) {
        store.put(name, { ...sanitize(doc.data()), id: doc.id });
      }
    } catch (err) {
      ergebnis.fehler.push(`${name}: ${err.message}`);
    }
  }

  // Sonderfall "einstellungen": in Firestore EIN Dokument mit allen Settings
  // als Feldern (siehe EINSTELLUNGEN_DOC in db.js), im Selfhost-Server aber
  // eine normale Collection mit einer Zeile je Settings-Schlüssel.
  try {
    const einstellungenDoc = await firestore.collection('einstellungen').doc('global').get();
    const daten = einstellungenDoc.exists ? sanitize(einstellungenDoc.data()) : {};
    const keys = Object.keys(daten);
    ergebnis.collections.einstellungen = keys.length;
    if (!dryRun) {
      for (const key of keys) store.put('einstellungen', { id: key, key, value: daten[key] });
    }
  } catch (err) {
    ergebnis.fehler.push(`einstellungen: ${err.message}`);
  }

  // "invites" (noch nicht eingelöste Einladungen) 1:1 übernehmen.
  try {
    const snap = await firestore.collection('invites').get();
    ergebnis.collections.invites = snap.docs.length;
    if (!dryRun) {
      for (const doc of snap.docs) store.put('invites', { ...sanitize(doc.data()), id: doc.id });
    }
  } catch (err) {
    ergebnis.fehler.push(`invites: ${err.message}`);
  }

  // "users" (bereits registrierte Mitarbeiter-/Kundenportal-Konten): Passwort
  // lässt sich nicht übertragen (siehe Kopf-Kommentar) - stattdessen für
  // jedes bestehende Konto eine neue Einladung anlegen, falls noch keine für
  // dieselbe E-Mail existiert.
  try {
    const snap = await firestore.collection('users').get();
    ergebnis.collections.users = snap.docs.length;
    for (const doc of snap.docs) {
      const u = sanitize(doc.data());
      if (!u?.email) continue;
      ergebnis.einladungenErstellt.push(u.email);
      if (dryRun) continue;
      const vorhandeneEinladung = store.get('invites', u.email);
      if (!vorhandeneEinladung) {
        store.put('invites', {
          id: u.email, role: u.role || 'mitarbeiter', mitarbeiterId: u.mitarbeiterId || null,
          kundeId: u.kundeId || null, name: u.name || u.email, createdAt: new Date().toISOString(),
        });
      }
    }
  } catch (err) {
    ergebnis.fehler.push(`users: ${err.message}`);
  }

  log('');
  log(dryRun ? '=== Vorschau (--dry-run, nichts wurde geschrieben) ===' : '=== Übertragen ===');
  for (const [name, count] of Object.entries(ergebnis.collections)) {
    if (count > 0) log(`  ${name}: ${count}`);
  }
  if (ergebnis.einladungenErstellt.length) {
    log('');
    log('Diese Konten können sich auf dem neuen Server einmalig neu registrieren (Einladung wurde angelegt):');
    for (const email of ergebnis.einladungenErstellt) log(`  - ${email}`);
  }
  if (ergebnis.fehler.length) {
    log('');
    log('Fehler (diese Collections konnten nicht gelesen werden - meist fehlende Berechtigung im Service-Account):');
    for (const f of ergebnis.fehler) log(`  - ${f}`);
  }
  return ergebnis;
}

// --- CLI-Einstiegspunkt -----------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');
  const projectArgIdx = args.indexOf('--project');
  const project = projectArgIdx !== -1 ? args[projectArgIdx + 1] : null;

  if (!project) {
    console.error('Fehlt: --project <firebase-projekt-id> (siehe Kopf-Kommentar dieser Datei für die genaue Verwendung).');
    process.exit(1);
  }
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) {
    console.error('Fehlt: Umgebungsvariable GOOGLE_APPLICATION_CREDENTIALS (Pfad zur Service-Account-JSON-Datei aus der Firebase Console).');
    process.exit(1);
  }
  const serviceAccount = JSON.parse(readFileSync(credPath, 'utf8'));
  if (serviceAccount.project_id !== project) {
    console.error(
      `ABGEBROCHEN: --project "${project}" passt nicht zur project_id "${serviceAccount.project_id}" in der Credential-Datei. ` +
      'Das soll genau ein Vertippen/Verwechseln von Produktions- und Staging-Projekt verhindern - bitte beide Werte prüfen.'
    );
    process.exit(1);
  }

  const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
  const dbPath = path.join(dataDir, 'werkora.db');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dataDir, { recursive: true });

  const store = openStore(dbPath);
  if (!dryRun && !force) {
    const vorhandeneKunden = store.getAll('kunden');
    if (vorhandeneKunden.length > 0) {
      console.error(
        `ABGEBROCHEN: ${dbPath} enthält bereits Daten (${vorhandeneKunden.length} Kunde(n)). ` +
        'Mit --force erzwingen, falls das wirklich gewollt ist (bestehende Zeilen werden dabei überschrieben, nichts Zusätzliches gelöscht).'
      );
      process.exit(1);
    }
  }

  const admin = await import('firebase-admin');
  admin.default.initializeApp({ credential: admin.default.credential.cert(serviceAccount), projectId: project });
  const firestore = admin.default.firestore();

  console.log(`Migriere von Firestore-Projekt "${project}" nach ${dbPath}${dryRun ? ' (Vorschau, --dry-run)' : ''} ...`);
  await runMigration({ firestore, store, dryRun });
  store.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Migration fehlgeschlagen:', err);
    process.exit(1);
  });
}
