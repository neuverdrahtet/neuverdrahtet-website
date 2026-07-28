import { getAll, hasRouteAccess } from './db.js';
import { getSession } from './auth.js';
import { openModal } from './ui.js';
import { escapeHtml } from './utils.js';

// Reihenfolge bestimmt auch die Anzeigereihenfolge der Ergebnisgruppen.
// "filterValue" wird nach dem Navigieren in das jeweilige Suchfeld der
// Zielseite (dort überall id="search") eingetragen, damit man nicht nur
// zur richtigen Seite kommt, sondern der Treffer auch schon dort gefiltert
// angezeigt wird - ohne dass jede View einzeln angepasst werden musste.
const CATEGORIES = [
  {
    store: 'kunden', route: 'kunden', label: 'Kunden', icon: '👥',
    query: (k) => [k.firma, k.ansprechpartner, k.ort].filter(Boolean).join(' '),
    title: (k) => k.firma || '(ohne Namen)', sub: (k) => k.ort || '',
    filterValue: (k) => k.firma || '',
  },
  {
    store: 'projekte', route: 'projekte', label: 'Projekte', icon: '📁',
    query: (p) => p.titel || '', title: (p) => p.titel || '(ohne Titel)', sub: () => '',
    filterValue: (p) => p.titel || '',
  },
  {
    store: 'angebote', route: 'angebote', label: 'Angebote', icon: '📄',
    query: (a) => [a.nummer, a.betreff].filter(Boolean).join(' '),
    title: (a) => a.nummer || '(ohne Nummer)', sub: (a) => a.betreff || '',
    filterValue: (a) => a.nummer || '',
  },
  {
    store: 'rechnungen', route: 'rechnungen', label: 'Rechnungen', icon: '💶',
    query: (r) => [r.nummer, r.betreff].filter(Boolean).join(' '),
    title: (r) => r.nummer || '(ohne Nummer)', sub: (r) => r.betreff || '',
    filterValue: (r) => r.nummer || '',
  },
  {
    store: 'katalog', route: 'katalog', label: 'Artikel & Leistungen', icon: '🧾',
    query: (k) => k.bezeichnung || '', title: (k) => k.bezeichnung || '(ohne Bezeichnung)', sub: (k) => k.einheit || '',
    filterValue: (k) => k.bezeichnung || '',
  },
];

async function runSearch(q, host, session) {
  const ql = q.trim().toLowerCase();
  if (!ql) {
    host.innerHTML = '<p class="text-mute">Tippe, um in Kunden, Projekten, Angeboten, Rechnungen und Artikeln/Leistungen zu suchen.</p>';
    return;
  }
  const groups = [];
  for (const cat of CATEGORIES) {
    if (!hasRouteAccess(session.role, cat.route)) continue;
    const items = await getAll(cat.store);
    const matches = items.filter((it) => cat.query(it).toLowerCase().includes(ql)).slice(0, 6);
    if (matches.length) groups.push({ cat, matches });
  }
  if (groups.length === 0) {
    host.innerHTML = '<p class="text-mute">Keine Treffer.</p>';
    return;
  }
  host.innerHTML = groups.map(({ cat, matches }) => `
    <div class="gs-group">
      <h3 class="gs-group-title">${cat.icon} ${escapeHtml(cat.label)}</h3>
      ${matches.map((it) => `
        <button type="button" class="gs-result" data-route="${escapeHtml(cat.route)}" data-filter="${escapeHtml(cat.filterValue(it))}">
          <strong>${escapeHtml(cat.title(it))}</strong>${cat.sub(it) ? ` <span class="text-mute">– ${escapeHtml(cat.sub(it))}</span>` : ''}
        </button>
      `).join('')}
    </div>
  `).join('');

  host.querySelectorAll('.gs-result').forEach((btn) => {
    btn.addEventListener('click', () => {
      const route = btn.dataset.route;
      const filterValue = btn.dataset.filter;
      document.querySelector('.modal-backdrop')?.remove();
      window.location.hash = `#/${route}`;
      setTimeout(() => {
        const target = document.querySelector('#view #search');
        if (target) {
          target.value = filterValue;
          target.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, 150);
    });
  });
}

export function openGlobalSearch() {
  const session = getSession() || {};
  const { body } = openModal({
    title: 'Suche',
    wide: true,
    bodyHtml: `
      <input type="search" id="gs-input" placeholder="Kunde, Projekt, Angebot, Rechnung, Artikel/Leistung ..." style="width:100%;margin-bottom:12px">
      <div id="gs-results">${''}</div>
    `,
  });
  const input = body.querySelector('#gs-input');
  const resultsHost = body.querySelector('#gs-results');
  runSearch('', resultsHost, session);
  input.focus();

  let debounceTimer = null;
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runSearch(input.value, resultsHost, session), 150);
  });
}
