// Rollenbasierte Zugriffskontrolle für die generische Collection-API -
// rudimentärer Ersatz für das, was zuvor firestore.rules je Rolle
// übernahm (siehe Review nach dem Bau des Servers: ohne das konnte JEDE
// angemeldete Person, auch ein Kundenportal-Konto, über die generische API
// alle Daten aller anderen Kunden/Mitarbeiter/Finanzvorgänge lesen UND
// schreiben).
//
// KEINE vollständige Nachbildung der feingranularen Firestore-Regeln (die
// unterscheiden zusätzlich nach Feldern und behandeln "buero"/"mitarbeiter"/
// "techniker" jeweils einzeln sehr eng) - deckt bewusst nur die zwei
// eindeutigsten, sicherheitskritischsten Fälle ab:
//   1. Rolle "kunde" (Kundenportal): rein lesend, nur eine begrenzte Liste
//      an Collections, und darin nur die eigenen Datensätze (kundeId bzw.
//      die eigene id bei "kunden" selbst).
//   2. Rollen "mitarbeiter"/"techniker": kein Zugriff auf eindeutig
//      sensible Collections (Personaldaten, Einkaufspreise, Finanzbuchhaltung).
// Rollen "admin"/"buero": voller Zugriff wie bisher (keine Änderung).
//
// WICHTIG: das ist eine BEWUSST UNVOLLSTÄNDIGE Übergangslösung - siehe
// README.md "Bekannte Lücken". Mitarbeiter/Techniker haben hier spürbar
// mehr Zugriff, als ihnen die bisherigen firestore.rules einräumen würden
// (z.B. sehen sie auch Kundendaten/Projekte anderer Kollegen, nicht nur
// die eigenen Aufgaben/Serviceaufträge).

const KUNDE_LESBARE_COLLECTIONS = new Set([
  'angebote', 'rechnungen', 'auftragsbestaetigungen', 'lieferscheine', 'gutschriften', 'mahnungen', 'termine',
]);

const MITARBEITER_GESPERRTE_COLLECTIONS = new Set([
  'mitarbeiter', 'katalog', 'konten', 'buchungen', 'bankbuchungen', 'anlagegueter',
  'reisekostensaetze', 'reisekostenabrechnungen', 'mitarbeiterBenefits', 'benefitSteuerregeln', 'bonusreferenzwerte',
  // passwordResets enthält Tokens, mit denen sich JEDES Passwort (auch das
  // von admin) setzen lässt, solange sie gültig sind - über die generische
  // API dürfen die niemand außer admin/büro sehen oder anlegen können.
  'passwordResets',
]);

function gehoertZuKunde(collection, row, kundeId) {
  if (!kundeId) return false;
  if (collection === 'kunden') return row.id === kundeId;
  return row.kundeId === kundeId;
}

// Grobe Vorprüfung anhand von Rolle + Collection + HTTP-Methode (ohne die
// einzelne Zeile zu kennen) - entscheidet, ob die Anfrage überhaupt in
// Frage kommt, bevor store.getAll()/store.get() aufgerufen wird.
export function pruefeCollectionZugriff(session, collection, method) {
  if (session.role === 'admin' || session.role === 'buero') return { ok: true };

  if (session.role === 'kunde') {
    if (method !== 'GET') return { ok: false, status: 403, error: 'Das Kundenportal kann hier nur lesen.' };
    if (collection !== 'kunden' && !KUNDE_LESBARE_COLLECTIONS.has(collection)) {
      return { ok: false, status: 403, error: 'Kein Zugriff auf diese Daten.' };
    }
    return { ok: true };
  }

  if (session.role === 'mitarbeiter' || session.role === 'techniker') {
    if (MITARBEITER_GESPERRTE_COLLECTIONS.has(collection)) {
      return { ok: false, status: 403, error: 'Kein Zugriff auf diese Daten mit dieser Rolle.' };
    }
    return { ok: true };
  }

  // Unbekannte/zukünftige Rolle: sicherheitshalber nichts erlauben, statt
  // standardmäßig vollen Zugriff zu geben.
  return { ok: false, status: 403, error: 'Unbekannte Rolle.' };
}

// Zeilen-Filter für getAll() - blendet bei Rolle "kunde" alle Datensätze
// aus, die nicht dem eigenen Kunden gehören.
export function filtereZeilenFuerRolle(session, collection, rows) {
  if (session.role === 'kunde') return rows.filter((r) => gehoertZuKunde(collection, r, session.kundeId));
  return rows;
}

// Einzeldatensatz-Prüfung für get() - verhindert, dass ein Kundenportal-
// Konto über eine erratene/bekannte ID einen fremden Datensatz einzeln
// abruft, obwohl er in der Listenansicht korrekt herausgefiltert würde.
export function istZeileErlaubt(session, collection, row) {
  if (!row) return false;
  if (session.role === 'kunde') return gehoertZuKunde(collection, row, session.kundeId);
  return true;
}
