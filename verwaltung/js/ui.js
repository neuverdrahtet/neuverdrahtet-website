import { el, escapeHtml, debounce, uid, toast, farbeAusText } from './utils.js';
import { searchAddress } from './geocode.js';
import { put } from './db.js';

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

export function openModal({ title, bodyHtml, wide = false, fullscreen = false, onClose, headerExtra = '' } = {}) {
  const backdrop = el(`<div class="modal-backdrop ${fullscreen ? 'modal-backdrop-fullscreen' : ''}"></div>`);
  const modal = el(`<div class="modal ${wide ? 'modal-wide' : ''} ${fullscreen ? 'modal-fullscreen' : ''}">
    <div class="modal-header">
      <h2>${title}</h2>
      ${headerExtra}
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
  // verschachtelt geöffnet werden (z.B. der Kalkulator im Katalog-Formular,
  // oder der Angebotsrechner im Angebot-Formular).
  if (openModals.length === 0) document.body.classList.add('modal-open');

  // Zwei gestapelte position:fixed-Backdrops mit jeweils eigenem Scroll
  // (overflow-y:auto) können sich sonst beim Scrollen im obersten Modal
  // sichtbar überlagern/durchmischen (derselbe Effekt wie oben, hier
  // zwischen zwei Modals statt Modal+Basisseite) - das vorherige Backdrop
  // deshalb ausblenden, solange dieses hier offen ist.
  const previous = openModals[openModals.length - 1];
  if (previous) previous.backdrop.style.display = 'none';

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    openModals = openModals.filter((m) => m.close !== close);
    if (previous) previous.backdrop.style.display = '';
    if (openModals.length === 0) document.body.classList.remove('modal-open');
    if (onClose) onClose();
  }
  openModals.push({ close, backdrop });
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
  [...openModals].forEach((m) => m.close());
}

export function confirmDelete(msg = 'Wirklich löschen?') {
  return window.confirm(msg);
}

/**
 * Ladebalken für Datei-Uploads (Fotos/Dokumente/Berichte/Material) - macht
 * sichtbar, dass ein Vorgang noch läuft, statt dass der Nutzer bei einer
 * langsamen Verbindung nur eine reglose Seite sieht und ggf. mehrfach
 * klickt. `setProgress(pct)` für echten Fortschritt (z.B. "Datei X von Y"
 * bei mehreren Dateien in einer Schleife); ohne bekannten Fortschritt
 * `indeterminate: true` übergeben - zeigt eine wandernde Animation statt
 * einer festen Prozentzahl.
 */
export function mountProgressBar(host, { indeterminate = false, label = '' } = {}) {
  const wrap = el(`
    <div class="progress-wrap">
      ${label ? `<div class="progress-label">${escapeHtml(label)}</div>` : ''}
      <div class="progress-bar ${indeterminate ? 'is-indeterminate' : ''}"><div class="progress-bar-fill" style="width:${indeterminate ? '40' : '0'}%"></div></div>
    </div>
  `);
  host.appendChild(wrap);
  return {
    setProgress: (pct) => {
      wrap.querySelector('.progress-bar').classList.remove('is-indeterminate');
      wrap.querySelector('.progress-bar-fill').style.width = `${Math.max(0, Math.min(100, pct))}%`;
    },
    setLabel: (text) => {
      let labelEl = wrap.querySelector('.progress-label');
      if (!labelEl) {
        labelEl = el('<div class="progress-label"></div>');
        wrap.insertBefore(labelEl, wrap.firstChild);
      }
      labelEl.textContent = text;
    },
    remove: () => wrap.remove(),
  };
}

/**
 * Chip-Auswahl (ToolTime-Stil) als Ersatz für ein natives <select>: zeigt den
 * gewählten Eintrag als Chip (Icon + fett + X zum Entfernen) bzw. einen
 * leeren "+ Platzhalter"-Button, wenn nichts gewählt ist. Klick auf den Chip
 * (außerhalb des X) öffnet ein Modal mit Suchfeld zum Auswählen. Rendert
 * zusätzlich ein verstecktes <input type="hidden" name="..."> ins host-Element,
 * damit FormData(form) und bestehende `[name="..."]`-Selektoren unverändert
 * funktionieren - inkl. eines synthetischen 'change'-Events bei jeder
 * Änderung, damit vorhandene change-Listener (z.B. Abschlags-Neuberechnung)
 * weiterlaufen, ohne dass Aufrufer wissen müssen, dass hier kein <select> mehr
 * steckt.
 */
export function mountChipPicker(host, { name, icon = '📄', title = 'Auswählen', placeholder = '– wählen –', items = [], selectedId = '', itemLabel, itemSub, onChange, disabled = false, onCreateNew, createNewLabel = '+ Neu anlegen' } = {}) {
  let list = items;
  let currentId = selectedId || '';

  host.innerHTML = '';
  const hidden = document.createElement('input');
  hidden.type = 'hidden';
  hidden.name = name;
  hidden.value = currentId;
  host.appendChild(hidden);

  const box = el(`<div class="chip-picker ${disabled ? 'chip-picker-disabled' : ''}"></div>`);
  host.appendChild(box);

  function findItem(id) { return list.find((it) => String(it.id) === String(id)); }

  function renderBox() {
    const it = currentId ? findItem(currentId) : null;
    if (it) {
      box.innerHTML = `
        <span class="chip-picker-icon">${icon}</span>
        <span class="chip-picker-label">${escapeHtml(itemLabel(it))}</span>
        ${!disabled ? '<button type="button" class="chip-picker-clear" aria-label="Entfernen">&times;</button>' : ''}
      `;
    } else {
      box.innerHTML = `
        <span class="chip-picker-icon chip-picker-icon-empty">${icon}</span>
        <span class="chip-picker-placeholder">${escapeHtml(placeholder)}</span>
      `;
    }
  }
  renderBox();

  function setValue(id, { silent = false } = {}) {
    currentId = id || '';
    hidden.value = currentId;
    renderBox();
    if (!silent) {
      hidden.dispatchEvent(new Event('change', { bubbles: true }));
      if (onChange) onChange(currentId);
    }
  }

  function openPicker() {
    const modal = openModal({
      title,
      bodyHtml: `
        <input type="text" class="chip-picker-search" placeholder="Suchen…" autocomplete="off">
        ${onCreateNew ? `<button type="button" class="btn btn-sm" id="chip-picker-create" style="margin-top:8px">${escapeHtml(createNewLabel)}</button>` : ''}
        <div class="chip-picker-results"></div>
      `,
    });
    const searchInput = modal.body.querySelector('.chip-picker-search');
    const results = modal.body.querySelector('.chip-picker-results');
    if (onCreateNew) {
      modal.body.querySelector('#chip-picker-create').addEventListener('click', async () => {
        const neu = await onCreateNew();
        if (neu) {
          list = [...list, neu];
          setValue(neu.id);
          modal.close();
        }
      });
    }
    function renderResults() {
      const q = searchInput.value.trim().toLowerCase();
      const filtered = q ? list.filter((it) => itemLabel(it).toLowerCase().includes(q) || (itemSub && itemSub(it) || '').toLowerCase().includes(q)) : list;
      if (!filtered.length) {
        results.innerHTML = '<div class="chip-picker-empty">Keine Treffer</div>';
        return;
      }
      results.innerHTML = filtered.map((it) => `
        <div class="chip-picker-result ${String(it.id) === String(currentId) ? 'is-selected' : ''}" data-id="${it.id}">
          <span class="chip-picker-result-label">${escapeHtml(itemLabel(it))}</span>
          ${itemSub ? `<span class="chip-picker-result-sub">${escapeHtml(itemSub(it) || '')}</span>` : ''}
        </div>
      `).join('');
      results.querySelectorAll('.chip-picker-result').forEach((row) => {
        row.addEventListener('click', () => {
          setValue(row.dataset.id);
          modal.close();
        });
      });
    }
    renderResults();
    searchInput.addEventListener('input', renderResults);
    searchInput.focus();
  }

  box.addEventListener('click', (e) => {
    if (disabled) return;
    if (e.target.closest('.chip-picker-clear')) {
      e.stopPropagation();
      setValue('');
      return;
    }
    openPicker();
  });

  return {
    getValue: () => currentId,
    setValue,
    setItems: (newItems) => { list = newItems; renderBox(); },
  };
}

const KUNDE_SCHNELL_FARBEN = ['#6b7280', '#2b7fd6', '#1f8a4c', '#f0a020', '#8e44ad', '#c0392b', '#14b8a6', '#e91e8c'];

/**
 * Schlankes "Neuer Kunde"-Formular für die Schnellanlage aus anderen
 * Dialogen heraus (Kanban/Projekt-Formular, Kunde-Auswahl bei Angebot/
 * Rechnung/Auftragsbestätigung) - damit man dafür nicht erst zur
 * Kunden-Ansicht wechseln muss. Legt nur die Kernfelder an; alles Weitere
 * (Notizen, Kundennummer usw.) lässt sich danach wie gewohnt in der
 * Kunden-Ansicht ergänzen. `onCreated(neuerKunde)` wird nach dem Anlegen
 * aufgerufen - der Aufrufer ist dafür zuständig, den neuen Kunden in seine
 * eigenen lokalen Listen (kunden/kundenById) einzutragen, da diese pro
 * Ansicht unterschiedlich gehalten werden.
 */
export function openKundeSchnellanlage({ onCreated } = {}) {
  const { body, close } = openModal({
    title: 'Neuer Kunde',
    bodyHtml: `
      <form id="kunde-schnell-form">
        <div class="form-grid">
          <div class="field col-span-2"><label>Firma / Name *</label><input name="firma" required></div>
          <div class="field"><label>Ansprechpartner</label><input name="ansprechpartner"></div>
          <div class="field"><label>Telefon</label><input name="telefon"></div>
          <div class="field col-span-2"><label>E-Mail</label><input type="email" name="email"></div>
          <div class="field col-span-2"><label>Straße, Nr.</label><input name="strasse" autocomplete="off"></div>
          <div class="field"><label>PLZ</label><input name="plz"></div>
          <div class="field"><label>Ort</label><input name="ort"></div>
        </div>
        <div class="modal-actions">
          <span class="spacer"></span>
          <button type="button" class="btn" id="ks-cancel">Abbrechen</button>
          <button type="submit" class="btn btn-primary">Anlegen</button>
        </div>
      </form>
    `,
  });
  attachAddressSearch(body.querySelector('input[name="strasse"]'), (r) => {
    const form = body.querySelector('#kunde-schnell-form');
    form.strasse.value = r.strasse || form.strasse.value;
    if (r.plz) form.plz.value = r.plz;
    if (r.ort) form.ort.value = r.ort;
  });
  body.querySelector('#ks-cancel').addEventListener('click', close);
  body.querySelector('#kunde-schnell-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const firma = (fd.get('firma') || '').toString().trim();
    if (!firma) return;
    const submitBtn = body.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    const neuerKunde = {
      id: uid(), firma,
      ansprechpartner: (fd.get('ansprechpartner') || '').toString().trim(),
      telefon: (fd.get('telefon') || '').toString().trim(),
      email: (fd.get('email') || '').toString().trim(),
      strasse: (fd.get('strasse') || '').toString().trim(),
      plz: (fd.get('plz') || '').toString().trim(),
      ort: (fd.get('ort') || '').toString().trim(),
      notizen: '', kundennummer: '', farbe: farbeAusText(firma, KUNDE_SCHNELL_FARBEN), status: 'kunde',
    };
    try {
      await put('kunden', neuerKunde);
    } catch (err) {
      toast(`Kunde anlegen fehlgeschlagen: ${err.message}`, 'danger');
      submitBtn.disabled = false;
      return;
    }
    toast('Kunde angelegt', 'success');
    close();
    if (onCreated) onCreated(neuerKunde);
  });
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
