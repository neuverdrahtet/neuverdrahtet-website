// Generischer Datenspeicher über SQLite (node:sqlite, in Node eingebaut - keine
// externe Abhängigkeit, kein nativer Build-Schritt nötig). Eine einzige Tabelle
// für ALLE "Collections" (kunden, angebote, rechnungen, ...), jede Zeile ist
// ein JSON-Dokument - spiegelt bewusst 1:1 das Firestore-Modell, das die App
// bisher nutzt (siehe verwaltung/js/db.js: getAll/get/put/remove), damit der
// Client-seitige Code so gut wie unverändert bleiben kann.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export function openStore(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS store (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (collection, id)
    );
    CREATE INDEX IF NOT EXISTS idx_store_collection ON store(collection);
  `);

  const stmtGetAll = db.prepare('SELECT id, data FROM store WHERE collection = ?');
  const stmtGet = db.prepare('SELECT data FROM store WHERE collection = ? AND id = ?');
  const stmtPut = db.prepare(
    'INSERT INTO store (collection, id, data, updated_at) VALUES (?, ?, ?, ?) ' +
    'ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
  );
  const stmtDelete = db.prepare('DELETE FROM store WHERE collection = ? AND id = ?');
  const stmtClear = db.prepare('DELETE FROM store WHERE collection = ?');

  function rowToValue(row) {
    return JSON.parse(row.data);
  }

  return {
    // Optionaler Filter {feld: wert} - für die paar Stellen, die bisher eine
    // Firestore where()-Abfrage nutzen (z.B. Einladungen/Nutzer nach
    // mitarbeiterId/kundeId suchen, siehe employeeAuth.js).
    getAll(collection, filter) {
      const rows = stmtGetAll.all(collection).map(rowToValue);
      if (!filter) return rows;
      return rows.filter((r) => Object.entries(filter).every(([k, v]) => r[k] === v));
    },
    get(collection, id) {
      const row = stmtGet.get(collection, id);
      return row ? rowToValue(row) : undefined;
    },
    put(collection, value) {
      if (!value || typeof value !== 'object') throw new Error('put() braucht ein Objekt');
      const id = value.id ?? randomUUID();
      const toStore = { ...value, id };
      stmtPut.run(collection, id, JSON.stringify(toStore), new Date().toISOString());
      return toStore;
    },
    remove(collection, id) {
      stmtDelete.run(collection, id);
    },
    clear(collection) {
      stmtClear.run(collection);
    },
    close() {
      db.close();
    },
  };
}
