import { openDB, ensureSeeded } from './db.js';
import { initLock } from './auth.js';
import * as dashboard from './views/dashboard.js';
import * as kunden from './views/kunden.js';
import * as kanban from './views/kanban.js';
import * as projekte from './views/projekte.js';
import * as kalender from './views/kalender.js';
import * as mitarbeiter from './views/mitarbeiter.js';
import * as katalog from './views/katalog.js';
import * as angebote from './views/angebote.js';
import * as rechnungen from './views/rechnungen.js';
import * as mahnungen from './views/mahnungen.js';
import * as einstellungen from './views/einstellungen.js';

const routes = {
  dashboard, kunden, kanban, projekte, kalender, mitarbeiter,
  katalog, angebote, rechnungen, mahnungen, einstellungen,
};

const viewEl = document.getElementById('view');
let currentCleanup = null;

async function router() {
  const hash = window.location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [routeName, ...rest] = hash.split('/');
  const routeKey = routes[routeName] ? routeName : 'dashboard';
  const mod = routes[routeKey];

  document.querySelectorAll('.sidebar-nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === routeKey);
  });

  if (typeof currentCleanup === 'function') {
    try { currentCleanup(); } catch (e) { /* ignore cleanup errors */ }
    currentCleanup = null;
  }
  viewEl.innerHTML = '';
  try {
    currentCleanup = await mod.render(viewEl, rest.join('/'));
  } catch (err) {
    console.error(err);
    viewEl.innerHTML = `<div class="empty-state">Fehler beim Laden der Ansicht.<br><small>${err.message || err}</small></div>`;
  }
}

window.addEventListener('hashchange', router);

async function boot() {
  await openDB();
  await ensureSeeded();
  await initLock();
  document.getElementById('app').hidden = false;
  router();
}

boot();
