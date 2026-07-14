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
import * as zeiterfassung from './views/zeiterfassung.js';
import * as vorlagen from './views/vorlagen.js';
import * as ausgaben from './views/ausgaben.js';
import * as buchhaltung from './views/buchhaltung.js';

const routes = {
  dashboard, kunden, kanban, projekte, kalender, mitarbeiter,
  katalog, angebote, rechnungen, mahnungen, einstellungen, zeiterfassung, vorlagen,
  ausgaben, buchhaltung,
};

const viewEl = document.getElementById('view');
const sidebarEl = document.getElementById('sidebar');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');
const menuBtn = document.getElementById('mobile-menu-btn');
let currentCleanup = null;

function closeSidebar() {
  sidebarEl.classList.remove('open');
  sidebarBackdrop.hidden = true;
}
function openSidebar() {
  sidebarEl.classList.add('open');
  sidebarBackdrop.hidden = false;
}
menuBtn.addEventListener('click', () => {
  if (sidebarEl.classList.contains('open')) closeSidebar();
  else openSidebar();
});
sidebarBackdrop.addEventListener('click', closeSidebar);
document.querySelectorAll('.sidebar-nav a').forEach((a) => a.addEventListener('click', closeSidebar));

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
