import { loadXlsx } from './vendorLoader.js';
import { GEWERKE } from './db.js';

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// Deterministische Farbe aus einem Text (z.B. der ID) ableiten - liefert für
// denselben Text immer dieselbe Farbe aus der übergebenen Palette. So bekommt
// jeder Eintrag (Mitarbeiter, Gerät, Kunde, ...) automatisch eine stabile,
// unterscheidbare Farbe, ohne dass von Hand eine ausgewählt werden muss.
export function farbeAusText(text, palette) {
  let hash = 0;
  const str = text || '';
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return palette[hash % palette.length];
}

export function formatCurrency(n) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(n) || 0);
}

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('de-DE').format(d);
}

export function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Liefert den lokalen Kalendertag eines Date-Objekts als "JJJJ-MM-TT". NIE
// d.toISOString().slice(0, 10) für lokale Datumsobjekte verwenden - das
// rechnet erst in UTC um und verschiebt den Tag in Zeitzonen östlich von UTC
// (z.B. Deutschland, UTC+1/+2) um einen Tag zurück.
export function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(iso, days) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(isoA, isoB) {
  const a = new Date(isoA + 'T00:00:00');
  const b = new Date(isoB + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Baut <optgroup>-gruppierte <option>-Elemente für einen Katalog-<select>,
// sortiert nach Gewerk (Reihenfolge wie GEWERKE) und innerhalb jedes Gewerks
// zusätzlich nach Unterkategorie (z.B. "Kabel & Leitungen", "Sicherungs-
// automaten"), jeweils alphabetisch nach Bezeichnung - für ein einheitliches,
// schnell durchsuchbares Material-/Leistungs-Sortiment in Projekt-Akte,
// Angeboten und Rechnungen. Einträge ohne Unterkategorie werden weiterhin
// nur nach Gewerk gruppiert (rückwärtskompatibel).
export function katalogOptionsHtml(katalog, labelFn) {
  const gewerkGruppen = new Map();
  for (const k of katalog) {
    const gid = k.gewerk || '_ohne';
    if (!gewerkGruppen.has(gid)) gewerkGruppen.set(gid, new Map());
    const unterGruppen = gewerkGruppen.get(gid);
    const uid = k.unterkategorie || '_ohne';
    if (!unterGruppen.has(uid)) unterGruppen.set(uid, []);
    unterGruppen.get(uid).push(k);
  }
  const reihenfolge = [...GEWERKE.map((g) => g.id), '_ohne'];
  return reihenfolge
    .filter((gid) => gewerkGruppen.has(gid))
    .map((gid) => {
      const gewerkTitel = gid === '_ohne' ? 'Ohne Gewerk' : (GEWERKE.find((g) => g.id === gid)?.titel || gid);
      const unterGruppen = gewerkGruppen.get(gid);
      const unterkategorien = [...unterGruppen.keys()].sort((a, b) => {
        if (a === '_ohne') return 1;
        if (b === '_ohne') return -1;
        return a.localeCompare(b, 'de');
      });
      return unterkategorien.map((uid) => {
        const items = unterGruppen.get(uid).sort((a, b) => (a.bezeichnung || '').localeCompare(b.bezeichnung || '', 'de'));
        const label = uid === '_ohne' ? gewerkTitel : `${gewerkTitel} – ${uid}`;
        return `<optgroup label="${escapeHtml(label)}">${items.map((k) => `<option value="${k.id}">${labelFn(k)}</option>`).join('')}</optgroup>`;
      }).join('');
    })
    .join('');
}

// Öffnet die Navigations-App des Geräts (Google Maps/Apple Maps je nach
// Betriebssystem) mit der Zieladresse - funktioniert ohne eigenen API-Key,
// da nur das öffentliche "Get Directions"-URL-Schema genutzt wird.
export function navigationUrl(address) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

export function hexToRgb(hex, fallback = [15, 27, 45]) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function qs(root, sel) {
  return root.querySelector(sel);
}

export function qsa(root, sel) {
  return Array.from(root.querySelectorAll(sel));
}

export function toast(msg, type = 'info') {
  const host = document.getElementById('toast-host');
  if (!host) return;
  const node = el(`<div class="toast toast-${type}">${escapeHtml(msg)}</div>`);
  host.appendChild(node);
  requestAnimationFrame(() => node.classList.add('show'));
  setTimeout(() => {
    node.classList.remove('show');
    setTimeout(() => node.remove(), 250);
  }, 3200);
}

export function confirmDialog(msg) {
  return window.confirm(msg);
}

export function calcPosition(pos) {
  const menge = Number(pos.menge) || 0;
  const preis = Number(pos.einzelpreis) || 0;
  const netto = menge * preis;
  const steuersatz = Number(pos.steuersatz) || 0;
  const steuer = netto * (steuersatz / 100);
  return { netto, steuer, brutto: netto + steuer };
}

export function calcTotals(positionen) {
  let netto = 0;
  let steuer = 0;
  const steuerGruppen = {};
  for (const pos of positionen || []) {
    const c = calcPosition(pos);
    netto += c.netto;
    steuer += c.steuer;
    const key = Number(pos.steuersatz) || 0;
    steuerGruppen[key] = (steuerGruppen[key] || 0) + c.netto;
  }
  return { netto, steuer, brutto: netto + steuer, steuerGruppen };
}

/**
 * Nummernschema Jahr+Tag+Monat+laufende Tagesnummer, z.B. 2026180701 für den
 * 18.07.2026, 1. Dokument dieses Tages. Der Tageszähler setzt sich pro Typ
 * fort (state = { datum, zaehler} aus den Einstellungen) und beginnt bei
 * Tageswechsel automatisch wieder bei 01.
 */
export function nextDailyNummer(prefix, state = {}) {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const heute = `${yyyy}-${mm}-${dd}`;
  const zaehler = state.datum === heute ? (Number(state.zaehler) || 0) + 1 : 1;
  const nummer = `${prefix || ''}${yyyy}${dd}${mm}${String(zaehler).padStart(2, '0')}`;
  return { nummer, datum: heute, zaehler };
}

export function compressImage(file, { maxWidth = 1600, quality = 0.8 } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Bild konnte nicht verarbeitet werden.'))), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht gelesen werden.')); };
    img.src = url;
  });
}

const CURRENT_MA_KEY = 'nv-verwaltung-aktueller-mitarbeiter';

export function getCurrentMitarbeiterId() {
  return localStorage.getItem(CURRENT_MA_KEY) || '';
}

export function setCurrentMitarbeiterId(id) {
  localStorage.setItem(CURRENT_MA_KEY, id || '');
}

// Übergibt Vorbelegungsdaten (Kunde/Projekt/Ort/Titel) an die Plantafel und
// springt dorthin - so muss der Nutzer das Termin-Formular nicht von Hand
// aus der Projekt-Akte/Kanban-Karte heraus neu befüllen. sessionStorage statt
// Query-Parameter, da der Router die Hash-Route sonst als Store-ID interpretiert.
const PLANTAFEL_PREFILL_KEY = 'nv-plantafel-prefill';

export function openTerminMitVorbelegung(prefill) {
  try { sessionStorage.setItem(PLANTAFEL_PREFILL_KEY, JSON.stringify(prefill)); } catch { /* ignore */ }
  window.location.hash = '#/plantafel';
}

export function nimmPlantafelVorbelegung() {
  try {
    const raw = sessionStorage.getItem(PLANTAFEL_PREFILL_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PLANTAFEL_PREFILL_KEY);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Gleiches Prinzip wie oben, aber routenunabhängig - für die "+ Angebot" /
// "+ Rechnung" / "+ Auftragsbestätigung"-Schnellknöpfe aus der Projekt-Akte.
const DOKUMENT_PREFILL_KEY = 'nv-dokument-prefill';

export function openDokumentMitVorbelegung(route, prefill) {
  try { sessionStorage.setItem(DOKUMENT_PREFILL_KEY, JSON.stringify(prefill)); } catch { /* ignore */ }
  window.location.hash = `#/${route}`;
}

export function nimmDokumentVorbelegung() {
  try {
    const raw = sessionStorage.getItem(DOKUMENT_PREFILL_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(DOKUMENT_PREFILL_KEY);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function debounce(fn, wait = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function csvCellToText(cell) {
  if (cell == null) return '';
  if (typeof cell === 'number') return String(cell).replace('.', ',');
  return String(cell).trim();
}

export async function excelFileToCsvText(file) {
  await loadXlsx();
  if (!window.XLSX) throw new Error('Excel-Bibliothek konnte nicht geladen werden.');
  const buf = await file.arrayBuffer();
  const wb = window.XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  return rows.map((row) => row.map(csvCellToText).join(';')).join('\n');
}

/**
 * Reads a text file, auto-detecting UTF-8 vs. Windows-1252/ISO-8859-1 (common
 * for CSV exports from Windows business software like lexoffice/DATEV, which
 * would otherwise show up as mojibake for German umlauts/ß).
 */
export async function readTextAutoEncoding(file) {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(buf);
  if (utf8.includes('�')) {
    return new TextDecoder('windows-1252').decode(buf);
  }
  return utf8;
}

function csvEscapeField(v) {
  const s = String(v ?? '');
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows) {
  return rows.map((row) => row.map(csvEscapeField).join(';')).join('\n');
}

export function downloadTextFile(filename, text, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿' + text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
