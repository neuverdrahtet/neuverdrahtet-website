import { el, escapeHtml, debounce } from './utils.js';
import { searchAddress } from './geocode.js';

// Seitliches Ausblenden (Mask-Gradient) für horizontal scrollbare Container
// (Tabellen, Positionstabellen, Plantafel-Gantt, Tag-Kalender, Kanban) - macht
// auf schmalen Bildschirmen (Handy/Tablet) sichtbar, dass noch mehr Inhalt
// links/rechts liegt, statt dass der Inhalt einfach kommentarlos am
// Bildschirmrand abgeschnitten wirkt.
const SCROLL_FADE_SELECTOR = '#table-host, .tag-cal, #pos-host, .plantafel-grid, .kanban-board';

function updateScrollFade(elem) {
  const canLeft = elem.scrollLeft > 4;
  const canRight = elem.scrollLeft < elem.scrollWidth - elem.clientWidth - 4;
  elem.classList.toggle('can-scroll-left', canLeft);
  elem.classList.toggle('can-scroll-right', canRight);
}

function wireOne(elem) {
  if (elem.dataset.scrollFadeWired) { updateScrollFade(elem); return; }
  elem.dataset.scrollFadeWired = '1';
  elem.classList.add('scroll-x-fade');
  updateScrollFade(elem);
  elem.addEventListener('scroll', () => updateScrollFade(elem), { passive: true });
}

let scrollFadeObserver = null;

/**
 * Verdrahtet alle aktuell vorhandenen Treffer UND beobachtet den Container
 * dauerhaft weiter (MutationObserver) - viele Ansichten (Plantafel-Woche,
 * Kanban, Positionstabelle) ersetzen ihren Inhalt bei Filter-/Navigations-
 * Interaktionen per innerHTML, ohne dass die Route wechselt; ein einmaliges
 * Verdrahten würde solche neu eingefügten Elemente sonst verpassen. Wird
 * einmalig beim App-Start auf document.body aufgerufen (main.js boot()) -
 * nicht pro Routenwechsel, da Modals (z.B. die Positionstabelle im Angebots-
 * /Rechnungsformular) außerhalb des Routen-Containers direkt an <body>
 * hängen und so sonst nicht erfasst würden.
 */
export function wireScrollFades(root = document) {
  if (scrollFadeObserver) scrollFadeObserver.disconnect();
  const wireAll = () => root.querySelectorAll(SCROLL_FADE_SELECTOR).forEach(wireOne);
  wireAll();
  scrollFadeObserver = new MutationObserver(wireAll);
  // attributes/attributeFilter zusätzlich zu childList: fängt auch den Fall
  // ab, dass ein Container (z.B. die Tag-Ansicht der Plantafel) erst per
  // hidden/class-Wechsel sichtbar wird, ohne dass dabei Kindknoten neu
  // eingefügt werden - sonst bliebe die Breite beim ersten Verdrahten auf 0
  // hängen (Element war zu dem Zeitpunkt noch unsichtbar).
  scrollFadeObserver.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'style', 'class'] });
}

/**
 * Hängt eine Adress-Autovervollständigung an ein Text-Input: bei Eingabe
 * (ab 3 Zeichen, debounced) werden Vorschläge über die freie Nominatim-Suche
 * geladen und als Dropdown darunter angezeigt. Klick auf einen Vorschlag ruft
 * onSelect({ label, strasse, plz, ort, lat, lng }) auf.
 */
export function attachAddressSearch(inputEl, onSelect) {
  const parent = inputEl.parentElement;
  if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
  const dropdown = el('<div class="address-search-dropdown" hidden></div>');
  parent.appendChild(dropdown);

  const runSearch = debounce(async () => {
    const q = inputEl.value.trim();
    if (q.length < 3) { dropdown.hidden = true; return; }
    let results = [];
    try {
      results = await searchAddress(q);
    } catch {
      dropdown.hidden = true;
      return;
    }
    if (!results.length) { dropdown.hidden = true; return; }
    dropdown.innerHTML = results.map((r, i) => `<div class="address-search-item" data-i="${i}">${escapeHtml(r.label)}</div>`).join('');
    dropdown.hidden = false;
    dropdown.querySelectorAll('.address-search-item').forEach((item) => {
      // mousedown statt click, damit der Vorschlag ausgewählt wird, bevor
      // der "blur"-Handler des Inputs das Dropdown schon wieder versteckt.
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        onSelect(results[Number(item.dataset.i)]);
        dropdown.hidden = true;
      });
    });
  }, 500);

  inputEl.addEventListener('input', runSearch);
  inputEl.addEventListener('blur', () => { setTimeout(() => { dropdown.hidden = true; }, 150); });
}

// Alle aktuell offenen Modals (Stack statt reinem Zähler, damit closeAllModals()
// unten jedes einzeln sauber über seine eigene close()/onClose()-Logik schließen
// kann, statt nur den Backdrop pauschal aus dem DOM zu reißen).
let openModals = [];

export function openModal({ title, bodyHtml, wide = false, onClose } = {}) {
  const backdrop = el(`<div class="modal-backdrop"></div>`);
  const modal = el(`<div class="modal ${wide ? 'modal-wide' : ''}">
    <div class="modal-header">
      <h2>${title}</h2>
      <button type="button" class="modal-close" aria-label="Schließen">&times;</button>
    </div>
    <div class="modal-body"></div>
  </div>`);
  modal.querySelector('.modal-body').innerHTML = bodyHtml;
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  // Ohne diese Sperre bleibt die Hintergrundseite hinter dem Modal weiter
  // scrollbar - auf iOS Safari kann das dazu führen, dass beim Scrollen im
  // Modal (oder mit dem Finger knapp daneben) die Hintergrundseite sichtbar
  // "durchscheint" (gemeldeter Bug: Formular + darunterliegende Liste
  // gleichzeitig lesbar). Stack statt einfachem Flag, da Modals
  // verschachtelt geöffnet werden (z.B. der Kalkulator im Katalog-Formular).
  if (openModals.length === 0) document.body.classList.add('modal-open');

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    openModals = openModals.filter((c) => c !== close);
    if (openModals.length === 0) document.body.classList.remove('modal-open');
    if (onClose) onClose();
  }
  openModals.push(close);
  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  modal.querySelector('.modal-close').addEventListener('click', close);

  return { backdrop, modal, body: modal.querySelector('.modal-body'), close };
}

// Schließt alle offenen Modals (inkl. verschachtelter) über ihre jeweils
// eigene close()-Funktion - vom Router bei jedem Routenwechsel aufgerufen,
// damit ein offen gebliebenes Formular nicht als Karteileiche über der
// nächsten Ansicht hängen bleibt, wenn man während der Bearbeitung z.B.
// über die Seitenleiste wegnavigiert.
export function closeAllModals() {
  [...openModals].forEach((close) => close());
}

export function confirmDelete(msg = 'Wirklich löschen?') {
  return window.confirm(msg);
}

export function optionList(items, { value = 'id', label = 'name', selected = '', placeholder = '' } = {}) {
  const labelFn = typeof label === 'function' ? label : (item) => escapeHtml(item[label] ?? '');
  let html = placeholder !== null ? `<option value="">${placeholder}</option>` : '';
  for (const item of items) {
    const v = item[value];
    const sel = String(v) === String(selected) ? 'selected' : '';
    html += `<option value="${v}" ${sel}>${labelFn(item)}</option>`;
  }
  return html;
}
