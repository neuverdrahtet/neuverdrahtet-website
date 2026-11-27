// Lokale Datei-Speicherung (Fotos/Dokumente) als Ersatz für Firebase Storage -
// speichert einfach auf der Festplatte des einen Servers, ausgeliefert über
// denselben HTTP-Server. "path" entspricht dem path-Feld, das
// uploadBlobToStorage() in blobstore.js bisher von Firebase Storage bekam
// (z.B. "fotos/<id>.jpg", "dokumente/<id>.pdf").
import { mkdir, writeFile, unlink, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';

export function createFileStore(baseDir) {
  function resolveSafe(relPath) {
    // Traversal-Schutz: das aufgelöste Ziel muss innerhalb von baseDir bleiben.
    const target = path.normalize(path.join(baseDir, relPath));
    if (!target.startsWith(path.normalize(baseDir) + path.sep) && target !== path.normalize(baseDir)) {
      throw new Error('Ungültiger Dateipfad');
    }
    return target;
  }

  return {
    async save(relPath, buffer) {
      const target = resolveSafe(relPath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, buffer);
      return { path: relPath, size: buffer.length };
    },
    async remove(relPath) {
      try {
        await unlink(resolveSafe(relPath));
      } catch {
        // Datei existiert evtl. schon nicht mehr - wie bisher bei
        // deleteBlobFromStorage() in blobstore.js kein Fehler.
      }
    },
    async exists(relPath) {
      try {
        await stat(resolveSafe(relPath));
        return true;
      } catch {
        return false;
      }
    },
    streamFor(relPath) {
      return createReadStream(resolveSafe(relPath));
    },
  };
}
