export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
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

export function nextNummer(prefix, nummer) {
  const year = new Date().getFullYear();
  return `${prefix}${year}-${String(nummer).padStart(4, '0')}`;
}

export function debounce(fn, wait = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}
