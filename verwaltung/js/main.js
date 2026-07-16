import { openDB, ensureSeeded, getSettings, hasRouteAccess } from './db.js';
import { initLock, lockNow } from './auth.js';
import { applyDeviceClass } from './device.js';
import * as dashboard from './views/dashboard.js';
import * as kunden from './views/kunden.js';
import * as kanban from './views/kanban.js';
import * as projekte from './views/projekte.js';
import * as kalender from './views/kalender.js';
import * as plantafel from './views/plantafel.js';
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
import * as aufgaben from './views/aufgaben.js';
import * as geraete from './views/geraete.js';
import * as lohn from './views/lohn.js';

const routes = {
  dashboard, kunden, kanban, projekte, kalender, plantafel, mitarbeiter,
  katalog, angebote, rechnungen, mahnungen, einstellungen, zeiterfassung, vorlagen,
  ausgaben, buchhaltung, aufgaben, geraete, lohn,
};

const viewEl = document.getElementById('view');
const sidebarEl = document.getElementById('sidebar');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');
const menuBtn = document.getElementById('mobile-menu-btn');
let currentCleanup = null;
let session = { role: 'admin', mitarbeiterId: null };

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

  if (!hasRouteAccess(session.role, routeKey)) {
    viewEl.innerHTML = `<div class="empty-state">Kein Zugriff für deine Rolle auf diesen Bereich.</div>`;
    return;
  }

  try {
    currentCleanup = await mod.render(viewEl, rest.join('/'));
  } catch (err) {
    console.error(err);
    viewEl.innerHTML = `<div class="empty-state">Fehler beim Laden der Ansicht.<br><small>${err.message || err}</small></div>`;
  }
}

function applyRoleToNav() {
  document.querySelectorAll('.sidebar-nav a[data-route]').forEach((a) => {
    a.hidden = !hasRouteAccess(session.role, a.dataset.route);
  });
  const footer = document.querySelector('.sidebar-footer');
  if (footer && !footer.querySelector('#btn-lock')) {
    const info = document.createElement('div');
    info.className = 'sidebar-user';
    info.innerHTML = `<span>${session.name ? session.name : (session.role === 'admin' ? 'Administrator' : session.role)}</span>` +
      (sessionStorage.getItem('nv-unlocked-session') ? '<button type="button" id="btn-lock" class="btn btn-sm btn-ghost">🔒 Sperren</button>' : '');
    footer.prepend(info);
    const lockBtn = footer.querySelector('#btn-lock');
    if (lockBtn) lockBtn.addEventListener('click', lockNow);
  }
}

window.addEventListener('hashchange', router);

export async function applyTheme() {
  const settings = await getSettings();
  document.documentElement.dataset.theme = settings.theme === 'light' ? 'light' : 'dark';
}

async function boot() {
  const deviceType = applyDeviceClass();
  await openDB();
  await ensureSeeded();
  await applyTheme();
  session = await initLock();
  applyRoleToNav();
  document.getElementById('app').hidden = false;
  // Auf dem Handy landen Außendienstler meist direkt in der Zeiterfassung
  // statt im Büro-Dashboard – nur beim allerersten Aufruf ohne Hash.
  if (!window.location.hash && deviceType === 'phone' && hasRouteAccess(session.role, 'zeiterfassung')) {
    window.location.hash = '#/zeiterfassung';
  }
  router();
}

boot();
