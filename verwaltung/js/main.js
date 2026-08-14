import { openDB, ensureSeeded, getSettings, hasRouteAccess, purgeOldTrash } from './db.js';
import { initLock, lockNow } from './auth.js';
import { applyDeviceClass } from './device.js';
import { toast } from './utils.js';
import { isBrowserCapable, initForegroundListener } from './push.js';
import { checkPushTriggers } from './pushTriggers.js';
import { openGlobalSearch } from './globalSearch.js';
import { trySyncPendingUploads } from './blobstore.js';
import { preloadGis } from './google.js';

// Views werden erst beim tatsächlichen Aufruf ihrer Route per dynamic
// import() nachgeladen (statt alle 22 Module beim Start zu laden) - spart
// beim ersten Seitenaufruf spürbar Ladezeit, da z.B. Buchhaltung/Auswertungen
// bei den meisten Sitzungen nie geöffnet werden. Nach dem ersten Laden bleibt
// das Modul im Browser-Modul-Cache, ein erneuter Aufruf derselben Route ist
// also genauso schnell wie vorher.
const routeLoaders = {
  dashboard: () => import('./views/dashboard.js'),
  kunden: () => import('./views/kunden.js'),
  leadpipeline: () => import('./views/leadpipeline.js'),
  kanban: () => import('./views/kanban.js'),
  projekte: () => import('./views/projekte.js'),
  auftraege: () => import('./views/auftraege.js'),
  plantafel: () => import('./views/plantafel.js'),
  mitarbeiter: () => import('./views/mitarbeiter.js'),
  subunternehmer: () => import('./views/subunternehmer.js'),
  'ki-freigaben': () => import('./views/ki-freigaben.js'),
  'ki-aktivitaet': () => import('./views/ki-aktivitaet.js'),
  katalog: () => import('./views/katalog.js'),
  lieferanten: () => import('./views/lieferanten.js'),
  inventur: () => import('./views/inventur.js'),
  angebote: () => import('./views/angebote.js'),
  auftragsbestaetigung: () => import('./views/auftragsbestaetigung.js'),
  rechnungen: () => import('./views/rechnungen.js'),
  mahnungen: () => import('./views/mahnungen.js'),
  einstellungen: () => import('./views/einstellungen.js'),
  zeiterfassung: () => import('./views/zeiterfassung.js'),
  vorlagen: () => import('./views/vorlagen.js'),
  ausgaben: () => import('./views/ausgaben.js'),
  postfach: () => import('./views/postfach.js'),
  buchhaltung: () => import('./views/buchhaltung.js'),
  auswertungen: () => import('./views/auswertungen.js'),
  aufgaben: () => import('./views/aufgaben.js'),
  urlaubsantraege: () => import('./views/urlaubsantraege.js'),
  formulare: () => import('./views/formulare.js'),
  geraete: () => import('./views/geraete.js'),
  papierkorb: () => import('./views/papierkorb.js'),
  social: () => import('./views/social.js'),
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

const globalSearchBtn = document.getElementById('btn-global-search');
if (globalSearchBtn) globalSearchBtn.addEventListener('click', () => { closeSidebar(); openGlobalSearch(); });
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !document.getElementById('app').hidden) {
    e.preventDefault();
    openGlobalSearch();
  }
});

// Echtes Vollbild (ohne Adressleiste/Taskleiste) für Handy/Tablet/PC/Laptop
// gleichermaßen über die Standard-Fullscreen-API. Auf iPhone-Safari gibt es
// dafür keine Unterstützung für beliebige Elemente (nur für <video>) - dort
// wird der Button ausgeblendet, da "Zum Home-Bildschirm hinzufügen" (bereits
// als PWA eingerichtet) dort der einzige Weg zu einer vollbildartigen
// Ansicht ist.
const fullscreenBtn = document.getElementById('btn-fullscreen');
if (fullscreenBtn) {
  if (document.fullscreenEnabled) {
    const updateFullscreenBtn = () => {
      fullscreenBtn.textContent = document.fullscreenElement ? '🗗 Vollbild beenden' : '⛶ Vollbild';
    };
    fullscreenBtn.addEventListener('click', () => {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch((err) => toast(`Vollbild beenden fehlgeschlagen: ${err.message || err}`, 'danger'));
      } else {
        document.documentElement.requestFullscreen().catch((err) => {
          toast(`Vollbild wurde vom Browser verweigert: ${err.message || err}`, 'danger');
        });
      }
    });
    document.addEventListener('fullscreenchange', updateFullscreenBtn);
    updateFullscreenBtn();
  } else {
    fullscreenBtn.hidden = true;
  }
}

let routerToken = 0;

async function router() {
  const hash = window.location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [routeName, ...rest] = hash.split('/');
  const routeKey = routeLoaders[routeName] ? routeName : 'dashboard';

  document.querySelectorAll('.sidebar-nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === routeKey);
  });

  if (typeof currentCleanup === 'function') {
    try { currentCleanup(); } catch (e) { /* ignore cleanup errors */ }
    currentCleanup = null;
  }

  if (!hasRouteAccess(session.role, routeKey)) {
    viewEl.innerHTML = `<div class="empty-state">Kein Zugriff für deine Rolle auf diesen Bereich.</div>`;
    return;
  }

  // routerToken schützt vor Race Conditions, wenn der Nutzer während des
  // Nachladens eines Moduls bereits zur nächsten Route weiterklickt - dann
  // rendert nur noch die zuletzt angeforderte Route ihr Ergebnis.
  const token = ++routerToken;
  viewEl.innerHTML = '';
  try {
    const mod = await routeLoaders[routeKey]();
    if (token !== routerToken) return;
    currentCleanup = await mod.render(viewEl, rest.join('/'));
  } catch (err) {
    if (token !== routerToken) return;
    console.error(err);
    viewEl.innerHTML = `<div class="empty-state">Fehler beim Laden der Ansicht.<br><small>${err.message || err}</small></div>`;
  }
}

function applyRoleToNav() {
  // Läuft in Dokumentreihenfolge über die Sidebar, damit eine .sidebar-nav-label-
  // Überschrift (z.B. "Team & Ressourcen") ausgeblendet wird, sobald für die
  // aktuelle Rolle kein einziger Link der jeweils folgenden Gruppe sichtbar ist.
  let currentLabel = null;
  let groupHasVisibleLink = false;
  const finishGroup = () => { if (currentLabel) currentLabel.hidden = !groupHasVisibleLink; };
  document.querySelectorAll('.sidebar-nav').forEach((nav) => {
    Array.from(nav.children).forEach((el) => {
      if (el.classList.contains('sidebar-nav-label')) {
        finishGroup();
        currentLabel = el;
        groupHasVisibleLink = false;
      } else if (el.dataset && el.dataset.route) {
        el.hidden = !hasRouteAccess(session.role, el.dataset.route);
        if (!el.hidden) groupHasVisibleLink = true;
      }
    });
    finishGroup();
    currentLabel = null;
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
  // initLock() muss vor ensureSeeded()/applyTheme() laufen: im Firebase-Modus
  // verlangen die Security Rules einen eingeloggten Nutzer mit Rolle, bevor
  // überhaupt Einstellungen (Theme, Logo, ...) gelesen werden dürfen. Der
  // Login-Screen selbst braucht dafür keine Einstellungen.
  session = await initLock();
  try {
    // ensureSeeded() legt u.a. fehlende Vorlagen/Textbausteine/Kanban-Spalten
    // an – das dürfen laut Security Rules nur admin/buero. Meldet sich zuerst
    // ein Mitarbeiter an einem frischen Projekt an, schlägt das serverseitig
    // ab; das darf den restlichen Boot-Vorgang (Nav/Rollen) nicht blockieren.
    await ensureSeeded();
  } catch (err) {
    console.warn('ensureSeeded() übersprungen:', err);
  }
  await applyTheme();
  applyRoleToNav();
  document.getElementById('app').hidden = false;
  // Google-Einstellungen + Anmeldeskript (GIS) schon jetzt im Hintergrund
  // vorladen, statt erst beim ersten Klick auf "Mit Google
  // verbinden/synchronisieren" - auf mobilen Browsern kann ein einziger
  // echter Netzwerk-Await zwischen Klick und Popup-Aufruf das kurze
  // Zeitfenster aufbrauchen, in dem ein Klick noch ein Popup öffnen darf,
  // und Google meldet dann "Failed to open popup window".
  preloadGis();
  // Push-Nachrichten, die eintreffen während die App offen/im Vordergrund ist,
  // zeigt der Browser NICHT automatisch als System-Benachrichtigung an (das
  // übernimmt sonst der Service Worker im Hintergrund) - hier stattdessen als
  // Toast, damit der Nutzer trotzdem etwas davon mitbekommt.
  if (isBrowserCapable()) {
    initForegroundListener((title, body) => toast(`${title}${body ? ': ' + body : ''}`, 'info'));
    checkPushTriggers().catch(() => { /* Push ist ein Komfort-Feature, darf den Start nicht stören */ });
  }
  // Offline auf einer Baustelle gespeicherte Fotos/Dokumente/Belege (siehe
  // blobstore.js) nachholen, sobald wieder Netz da ist - einmal jetzt beim
  // Start (falls das Gerät schon wieder online ist) und bei jedem Wechsel
  // von offline zu online während die App offen bleibt.
  trySyncPendingUploads().catch(() => { /* nächster Versuch beim nächsten online-Event */ });
  window.addEventListener('online', () => {
    trySyncPendingUploads().catch(() => { /* erneuter Versuch beim nächsten online-Event */ });
  });
  // Papierkorb: seit über 30 Tagen gelöschte Einträge beim Start endgültig
  // entfernen (siehe db.js purgeOldTrash) - läuft still im Hintergrund.
  purgeOldTrash().catch(() => { /* nächster Versuch beim nächsten Start */ });
  // Auf dem Handy landen Außendienstler meist direkt in der Zeiterfassung
  // statt im Büro-Dashboard – nur beim allerersten Aufruf ohne Hash.
  if (!window.location.hash && deviceType === 'phone' && hasRouteAccess(session.role, 'zeiterfassung')) {
    window.location.hash = '#/zeiterfassung';
  }
  router();
}

boot();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { type: 'module' }).catch(() => { /* Offline-Support optional */ });
  });
}
