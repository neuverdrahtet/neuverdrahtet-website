/**
 * Minimal ZIP reader for the browser — no external dependency. Parses the
 * End-Of-Central-Directory + Central Directory records to list entries, then
 * inflates each entry's data on demand using the native DecompressionStream
 * (ZIP's "deflate" compression method is raw DEFLATE).
 */
export async function readZipEntries(file) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Dein Browser unterstützt das native Entpacken von ZIP-Dateien nicht (DecompressionStream fehlt). Bitte einen aktuellen Chrome/Edge/Firefox verwenden.');
  }
  const buf = await file.arrayBuffer();
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  let eocdOffset = -1;
  const maxBack = Math.min(bytes.length, 65557);
  for (let i = bytes.length - 22; i >= bytes.length - maxBack && i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break; }
  }
  if (eocdOffset === -1) throw new Error('Keine gültige ZIP-Datei (End-Of-Central-Directory nicht gefunden).');

  const entryCount = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  const rawEntries = [];
  let offset = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x02014b50) break;
    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLen);
    const name = new TextDecoder('utf-8').decode(nameBytes);
    rawEntries.push({ name, compressionMethod, compressedSize, localHeaderOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }

  async function readEntryData(entry) {
    const lh = entry.localHeaderOffset;
    const lhNameLen = view.getUint16(lh + 26, true);
    const lhExtraLen = view.getUint16(lh + 28, true);
    const dataStart = lh + 30 + lhNameLen + lhExtraLen;
    const raw = bytes.subarray(dataStart, dataStart + entry.compressedSize);
    if (entry.compressionMethod === 0) return raw;
    if (entry.compressionMethod === 8) {
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    throw new Error(`Nicht unterstützte ZIP-Kompressionsmethode (${entry.compressionMethod}) bei "${entry.name}".`);
  }

  return rawEntries
    .filter((e) => !e.name.endsWith('/'))
    .map((e) => ({
      name: e.name,
      getBlob: async (mime) => new Blob([await readEntryData(e)], { type: mime || 'application/octet-stream' }),
    }));
}
