import { buildZipBlob } from './zipwriter.js';

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(v) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

export function downloadCsv(rows, filename) {
  const csv = rows.map((row) => row.map(csvCell).join(';')).join('\r\n');
  downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), filename);
}

/**
 * Baut für jedes Dokument ein PDF (buildPdfBlob) und lädt es herunter - bei
 * genau einem Dokument direkt als PDF, bei mehreren als ZIP-Sammeldatei
 * (Browser können nicht mehrere Downloads ohne Rückfrage-Dialog anstoßen).
 */
export async function exportDokumenteAlsPdf(items, { buildPdfBlob, filenameFor, zipFilename, onProgress }) {
  if (items.length === 0) return;
  if (items.length === 1) {
    const blob = await buildPdfBlob(items[0]);
    downloadBlob(blob, filenameFor(items[0]));
    return;
  }
  const usedNames = new Set();
  const files = [];
  for (let i = 0; i < items.length; i++) {
    if (onProgress) onProgress(i + 1, items.length);
    const blob = await buildPdfBlob(items[i]);
    let name = filenameFor(items[i]);
    if (usedNames.has(name)) {
      const dot = name.lastIndexOf('.');
      name = dot === -1 ? `${name}-${i + 1}` : `${name.slice(0, dot)}-${i + 1}${name.slice(dot)}`;
    }
    usedNames.add(name);
    files.push({ name, blob });
  }
  downloadBlob(await buildZipBlob(files), zipFilename);
}
