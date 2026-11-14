// Gemeinsame Reiter-Logik für zusammengefasste Navigationsbereiche (14.11.2026,
// auf Dannys Wunsch, analog zum bereits bestehenden Leads/Pipeline/Projekte-
// Muster in leadpipeline.js - dort weiterhin eigenständig implementiert,
// nicht nachträglich auf diesen Helfer umgestellt, um dort nichts an einer
// bereits funktionierenden Ansicht zu riskieren). Jeder Reiter rendert einen
// bereits bestehenden, UNVERÄNDERTEN View in einen eigenen Host-Container -
// lazy (erst beim ersten Anklicken geladen), danach nur noch ein-/
// ausgeblendet statt neu gerendert.
//
// Jeder Reiter braucht ein "id" - das ist zugleich der ORIGINALE
// Einzel-Routenname (z.B. "buchhaltung"), gegen den per hasRouteAccess()
// geprüft wird: eine Rolle ohne Zugriff auf diese Einzel-Route (siehe
// ROUTE_ROLLEN in db.js) sieht den Reiter erst gar nicht - WICHTIG, weil
// sonst z.B. eine Büro-Rolle über einen zusammengefassten Reiter Zugriff auf
// einen eigentlich admin-only Reiter (Buchhaltung/Auswertungen) bekommen
// würde. Die Einzel-Routen selbst bleiben in main.js zusätzlich bestehen
// (nicht entfernt) - bestehende Querverweise (Schnellanlage-Buttons,
// Dashboard-Kacheln, "→ X erstellen") funktionieren dadurch unverändert
// weiter, auch wenn die Sidebar jetzt nur noch den zusammengefassten Link zeigt.
import { hasRouteAccess } from './db.js';
import { getSession } from './auth.js';

export async function renderTabbedView(container, route, { titel, tabs }) {
  const session = getSession() || {};
  const sichtbareTabs = tabs.filter((t) => hasRouteAccess(session.role, t.id));
  if (!sichtbareTabs.length) {
    container.innerHTML = '<div class="empty-state">Kein Zugriff.</div>';
    return;
  }
  const startTab = sichtbareTabs.some((t) => t.id === route) ? route : sichtbareTabs[0].id;
  container.innerHTML = `
    <div class="view-header"><h1>${titel}</h1></div>
    <div class="tabs" id="tv-tabs">
      ${sichtbareTabs.map((t) => `<button type="button" class="tab-item${t.id === startTab ? ' active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
    </div>
    ${sichtbareTabs.map((t) => `<div id="tv-tab-${t.id}"${t.id === startTab ? '' : ' hidden'}></div>`).join('')}
  `;
  const tabsEl = container.querySelector('#tv-tabs');
  const hosts = Object.fromEntries(sichtbareTabs.map((t) => [t.id, container.querySelector(`#tv-tab-${t.id}`)]));
  const geladen = new Set();
  await sichtbareTabs.find((t) => t.id === startTab).render(hosts[startTab]);
  geladen.add(startTab);
  tabsEl.querySelectorAll('.tab-item').forEach((btn) => {
    btn.addEventListener('click', async () => {
      tabsEl.querySelectorAll('.tab-item').forEach((b) => b.classList.toggle('active', b === btn));
      const aktivTab = btn.dataset.tab;
      Object.entries(hosts).forEach(([id, host]) => { host.hidden = id !== aktivTab; });
      if (!geladen.has(aktivTab)) {
        geladen.add(aktivTab);
        await sichtbareTabs.find((t) => t.id === aktivTab).render(hosts[aktivTab]);
      }
    });
  });
}
