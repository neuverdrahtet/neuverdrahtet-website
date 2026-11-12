// Oberfläche der Online-Buchung (mehrstufiges Formular mit Prüfschritt).
import { pruefeEinsatzgebiet, terminvorschlaege, ortZuPlz } from './einsatzgebiet-logik.mjs';
import { validiereSchritt, baueLead, zusatzfelder, beschreibungsHilfe, demoVorgangsnummer } from './buchung-kern.mjs';

const form = document.getElementById('buchung');
const katalog = JSON.parse(document.getElementById('katalog').textContent);
const LEISTUNG = Object.fromEntries(katalog.leistungen.map((l) => [l.slug, l]));
const BEREICH = Object.fromEntries(katalog.bereiche.map((b) => [b.id, b]));
const startZeit = Date.now();
const MAX = 5;
let schritt = 1;
let idempotenzSchluessel = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
let sendetGerade = false;

const $ = (sel, root = form) => root.querySelector(sel);
const $$ = (sel, root = form) => [...root.querySelectorAll(sel)];
const el = (tag, attrs = {}, text) => { const e = document.createElement(tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); if (text !== undefined) e.textContent = text; return e; };

function daten() {
  const fd = new FormData(form);
  const d = Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
  d.rechnungAbweichend = form.rechnungAbweichend.checked;
  d.datenschutz = form.datenschutz.checked;
  d.whatsappEinwilligung = form.whatsappEinwilligung.checked;
  return d;
}
const aktuelleLeistung = () => LEISTUNG[form.leistung.value] || null;
const dateien = () => [...(form.dateien.files || [])];

// --- Schritt 1: Bereich und Leistung ------------------------------------------------
katalog.bereiche.forEach((b) => form.bereich.append(el('option', { value: b.id }, b.name)));
function leistungenFuellen(bereichId) {
  form.leistung.innerHTML = '';
  form.leistung.append(el('option', { value: '' }, bereichId ? 'Bitte wählen' : 'Zuerst Bereich wählen'));
  katalog.leistungen.filter((l) => l.bereich === bereichId).forEach((l) => {
    form.leistung.append(el('option', { value: l.slug }, `${l.name}${l.buchung === 'direkt' ? ' – direkt buchbar' : ''}`));
  });
  form.leistung.disabled = !bereichId;
}
function leistungGeaendert() {
  const l = aktuelleLeistung();
  const box = $('[data-buchungsart]');
  if (!l) { box.hidden = true; return; }
  box.hidden = false;
  box.textContent = l.buchung === 'direkt'
    ? 'Direkt buchbar: Sie wählen im nächsten Schritt einen vorläufigen Termin. Wir bestätigen ihn nach Kalenderabgleich.'
    : 'Individuelles Projekt: Sie senden eine Anfrage mit Wunschtermin für die Besichtigung. Danach erhalten Sie ein schriftliches Angebot.';
  const felder = zusatzfelder(l.slug);
  $$('[data-zusatzfeld]').forEach((f) => { f.hidden = !felder.includes(f.dataset.zusatzfeld); });
  $('[data-beschreibung-hilfe]').textContent = beschreibungsHilfe(l);
  $('[data-termin-direkt]').hidden = l.buchung !== 'direkt';
  $('[data-termin-anfrage]').hidden = l.buchung === 'direkt';
  $('[data-absenden]').textContent = l.buchung === 'direkt' ? 'Termin verbindlich anfragen' : 'Anfrage absenden';
}
form.bereich.addEventListener('change', () => { leistungenFuellen(form.bereich.value); leistungGeaendert(); });
form.leistung.addEventListener('change', leistungGeaendert);

// --- Schritt 2: Adresse und Einsatzgebiet -----------------------------------------
const datalist = document.getElementById('orte-liste');
katalog.orte.forEach((o) => datalist.append(el('option', { value: o.name })));
function einsatzgebietAnzeigen() {
  const box = $('[data-eg-box]');
  box.className = 'eg-box';
  box.innerHTML = '';
  const plz = form.plz.value.trim();
  if (!/^\d{5}$/.test(plz)) return;
  if (!form.ort.value.trim()) { const o = ortZuPlz(plz); if (o) form.ort.value = o.name; }
  const r = pruefeEinsatzgebiet({ plz, ort: form.ort.value }, katalog.einsatzgebiet);
  if (r.status === 'im-gebiet') {
    box.classList.add('eg-ok');
    box.append(el('p', {}, `✓ ${r.ort} liegt im Einsatzgebiet – ${r.zoneLabel}.`));
    box.append(el('p', {}, `Anfahrt ab Essen ca. ${r.strasseKmGeschaetzt} km bzw. ${r.fahrzeitMinGeschaetzt} Minuten (Schätzung).`));
    box.append(el('p', {}, katalog.preiseFreigegeben && r.pauschaleEuro != null
      ? `Anfahrtspauschale: ${r.pauschaleEuro.toFixed(2).replace('.', ',')} € (zzgl. MwSt.)`
      : 'Die Anfahrtspauschale dieser Zone wird in der Bestätigung bzw. im Angebot ausgewiesen.'));
  } else {
    box.classList.add('eg-warn');
  }
  r.hinweise.forEach((h) => box.append(el('p', {}, h)));
}
// Sofort beim Tippen prüfen (nicht erst beim Verlassen des Felds): sonst
// verschiebt die eingeblendete Box das Layout genau beim nächsten Klick.
form.plz.addEventListener('input', () => { if (/^\d{5}$/.test(form.plz.value.trim())) einsatzgebietAnzeigen(); });
form.ort.addEventListener('change', einsatzgebietAnzeigen);
form.rechnungAbweichend.addEventListener('change', () => { $('[data-rechnungsadresse]').hidden = !form.rechnungAbweichend.checked; });

// --- Schritt 3: Termin und Dateien -------------------------------------------------
function slotsAufbauen() {
  const ziel = $('[data-slot-tage]');
  if (ziel.childElementCount) return;
  const fmt = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
  terminvorschlaege(katalog.buchung).forEach((t) => {
    const tag = el('div', { class: 'slot-tag' });
    tag.append(el('p', {}, fmt.format(new Date(t.datum + 'T00:00:00Z'))));
    const zeiten = el('div', { class: 'slot-zeiten' });
    t.slots.forEach((z) => {
      const label = el('label');
      const input = el('input', { type: 'radio', name: 'slot', value: `${t.datum}T${z}` });
      label.append(input, el('span', {}, `${z} Uhr`));
      zeiten.append(label);
    });
    tag.append(zeiten);
    ziel.append(tag);
  });
}
form.wunschtermin.min = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
form.dateien.addEventListener('change', () => {
  const liste = $('[data-datei-liste]');
  liste.innerHTML = '';
  dateien().forEach((f) => liste.append(el('li', {}, `${f.name} (${(f.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB)`)));
});

// --- Schritt 4: Kontakt ------------------------------------------------------------
form.kundentyp.addEventListener('change', () => { $('[data-firma]').hidden = form.kundentyp.value === 'privat'; });
$$('input[name="kontaktweg"]').forEach((r) => r.addEventListener('change', () => {
  $('[data-whatsapp-einwilligung]').hidden = form.kontaktweg.value !== 'whatsapp';
}));

// --- Fehleranzeige -----------------------------------------------------------------
function fehlerZeigen(fehler) {
  $$('[data-fehler]').forEach((p) => { p.textContent = ''; });
  $$('[aria-invalid]').forEach((i) => i.removeAttribute('aria-invalid'));
  const keys = Object.keys(fehler);
  keys.forEach((k) => {
    const p = $(`[data-fehler="${k}"]`);
    if (p) p.textContent = fehler[k];
    const feld = form.elements[k];
    if (feld && feld.setAttribute) {
      feld.setAttribute('aria-invalid', 'true');
      if (p) { p.id = p.id || `fehler-${k}`; feld.setAttribute('aria-describedby', p.id); }
    }
  });
  if (keys.length) {
    const erstes = form.elements[keys[0]];
    (erstes?.focus ? erstes : $(`[data-fehler="${keys[0]}"]`))?.focus?.();
  }
  return keys.length === 0;
}

// --- Zusammenfassung ---------------------------------------------------------------
function zusammenfassung() {
  const d = daten();
  const l = aktuelleLeistung();
  const eg = pruefeEinsatzgebiet({ plz: d.plz, ort: d.ort }, katalog.einsatzgebiet);
  const ziel = $('[data-zusammenfassung]');
  ziel.innerHTML = '';
  const block = (titel, zurSchritt, zeilen) => {
    const h = el('h3');
    h.append(el('span', {}, titel));
    const b = el('button', { type: 'button' }, 'ändern');
    b.addEventListener('click', () => geheZu(zurSchritt));
    h.append(b);
    const dl = el('dl');
    zeilen.filter(([, v]) => v).forEach(([k, v]) => { dl.append(el('dt', {}, k), el('dd', {}, v)); });
    ziel.append(h, dl);
  };
  const [sd, sz] = String(d.slot || '').split('T');
  const termin = l.buchung === 'direkt'
    ? (sd ? `${new Date(sd + 'T00:00:00Z').toLocaleDateString('de-DE', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}, ${sz} Uhr (vorläufig)` : '')
    : (d.wunschtermin ? `${new Date(d.wunschtermin + 'T00:00:00Z').toLocaleDateString('de-DE', { timeZone: 'UTC' })} (${d.zeitfenster})` : 'kein Wunschtermin');
  block('Leistung', 1, [['Bereich', BEREICH[l.bereich].name], ['Leistung', l.name], ['Art', l.buchung === 'direkt' ? 'Direktbuchung' : 'Anfrage mit Besichtigung']]);
  block('Einsatzort', 2, [
    ['Adresse', `${d.strasse} ${d.hausnummer}, ${d.plz} ${d.ort}${d.adresszusatz ? ' (' + d.adresszusatz + ')' : ''}`],
    ['Einsatzgebiet', eg.status === 'im-gebiet' ? eg.zoneLabel : (eg.status === 'ausserhalb' ? 'außerhalb – individuelle Prüfung' : 'wird manuell geprüft')],
    ['Rechnungsadresse', d.rechnungAbweichend ? `${d.rName}, ${d.rStrasse} ${d.rHausnummer}, ${d.rPlz} ${d.rOrt}` : 'wie Einsatzadresse'],
  ]);
  block('Details und Termin', 3, [
    ['Beschreibung', d.beschreibung], ['Geräte', d.anzahlGeraete], ['Anlage', d.anlage], ['Fläche', d.flaecheM2 ? `${d.flaecheM2} m²` : ''],
    ['Termin', termin], ['Dateien', dateien().map((f) => f.name).join(', ') || 'keine'],
  ]);
  block('Kontakt', 4, [
    ['Name', `${d.vorname} ${d.nachname}`], ['Firma', d.firma], ['Telefon', d.telefon], ['E-Mail', d.email],
    ['Kontaktweg', { telefon: 'Telefon', email: 'E-Mail', whatsapp: 'WhatsApp' }[d.kontaktweg]],
  ]);
}

// --- Navigation zwischen den Schritten ----------------------------------------------
function anzeigen(fokus = true) {
  $$('[data-schritt]').forEach((fs) => { fs.hidden = Number(fs.dataset.schritt) !== schritt; });
  $$('[data-schritt-anzeige]').forEach((li) => {
    const n = Number(li.dataset.schrittAnzeige);
    li.classList.toggle('erledigt', n < schritt);
    if (n === schritt) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });
  $('[data-zurueck]').hidden = schritt === 1;
  $('[data-weiter]').hidden = schritt === MAX;
  $('[data-absenden]').hidden = schritt !== MAX;
  if (schritt === 3) slotsAufbauen();
  if (schritt === MAX) zusammenfassung();
  if (!fokus) return;
  const legend = $(`[data-schritt="${schritt}"] legend`);
  if (legend) { legend.tabIndex = -1; legend.focus({ preventScroll: true }); }
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function ctx() {
  return { leistung: aktuelleLeistung(), einsatzgebiet: katalog.einsatzgebiet, dateien: dateien(), buchungKonfig: katalog.buchung };
}
function geheZu(n) { schritt = n; anzeigen(); }
$('[data-weiter]').addEventListener('click', () => {
  if (!fehlerZeigen(validiereSchritt(schritt, daten(), ctx()))) return;
  if (schritt === 2) einsatzgebietAnzeigen();
  geheZu(Math.min(MAX, schritt + 1));
});
$('[data-zurueck]').addEventListener('click', () => geheZu(Math.max(1, schritt - 1)));

// --- Absenden ----------------------------------------------------------------------
function meldung(text) { const m = $('.status-meldung'); m.hidden = !text; m.textContent = text || ''; }

function bestaetigungZeigen(vorgangsnummer, demo, l) {
  const box = el('div', { class: 'bestaetigung', tabindex: '-1' });
  box.innerHTML = '<svg class="icon icon-gross" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12l5 5 9-11"/></svg>';
  box.append(el('h2', {}, l.buchung === 'direkt' ? 'Vielen Dank – Ihre Terminanfrage ist eingegangen.' : 'Vielen Dank – Ihre Anfrage ist eingegangen.'));
  const p = el('p', {}, 'Ihre Vorgangsnummer: ');
  p.append(el('span', { class: 'vorgang' }, vorgangsnummer));
  box.append(p);
  box.append(el('p', {}, l.buchung === 'direkt'
    ? 'Wir gleichen Ihren Wunschtermin mit unserem Kalender ab und bestätigen ihn per E-Mail. Erst mit dieser Bestätigung ist der Termin verbindlich.'
    : 'Wir prüfen Ihre Angaben und melden uns zur Vereinbarung einer Besichtigung. Danach erhalten Sie ein schriftliches Angebot.'));
  if (demo) box.append(el('p', { class: 'hinweis' }, 'Demo-Modus: Die Schnittstelle zu Werkora ist noch nicht freigeschaltet. Diese Anfrage wurde nicht übertragen.'));
  form.replaceChildren(box);
  box.focus();
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (sendetGerade) return;
  for (let n = 1; n <= MAX; n++) {
    const f = validiereSchritt(n, daten(), ctx());
    if (Object.keys(f).length) { geheZu(n); fehlerZeigen(f); return; }
  }
  const l = aktuelleLeistung();
  const knopf = $('[data-absenden]');
  sendetGerade = true; knopf.disabled = true; knopf.textContent = 'Wird gesendet …'; meldung('');
  try {
    const params = new URLSearchParams(location.search);
    const kampagne = ['utm_source', 'utm_medium', 'utm_campaign'].some((k) => params.get(k))
      ? { source: params.get('utm_source'), medium: params.get('utm_medium'), campaign: params.get('utm_campaign') } : null;
    const lead = await baueLead(daten(), { ...ctx(), leistung: l, idempotenzSchluessel, kampagne, ausfuellzeitMs: Date.now() - startZeit });

    // Doppelte Absendung derselben Anfrage im selben Browser verhindern.
    const fingerabdruck = `${lead.dubletten.person}|${lead.leistung.slug}|${lead.einsatzort.plz}|${lead.details.beschreibung.length}`;
    let vorher = null;
    try { vorher = JSON.parse(sessionStorage.getItem('bss-letzte-anfrage') || 'null'); } catch { /* Speicher nicht verfügbar */ }
    if (vorher && vorher.fingerabdruck === fingerabdruck) { bestaetigungZeigen(vorher.vorgangsnummer, vorher.demo, l); return; }

    let vorgangsnummer; let demo = false;
    if (!katalog.buchung.endpunkt) {
      demo = true;
      vorgangsnummer = demoVorgangsnummer();
      console.info('[Demo-Modus] Lead-Payload (nicht übertragen):', lead);
    } else {
      const body = new FormData();
      body.append('lead', new Blob([JSON.stringify(lead)], { type: 'application/json' }));
      dateien().forEach((f) => body.append('dateien', f, f.name));
      const res = await fetch(katalog.buchung.endpunkt, { method: 'POST', body, headers: { 'Idempotency-Key': idempotenzSchluessel } });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const antwort = await res.json();
      vorgangsnummer = antwort.vorgangsnummer;
    }
    try { sessionStorage.setItem('bss-letzte-anfrage', JSON.stringify({ fingerabdruck, vorgangsnummer, demo })); } catch { /* ignorieren */ }
    window.dispatchEvent(new CustomEvent('bss:lead', { detail: { leistung: l.slug, art: lead.vorgangsart, zone: lead.einsatzort.einsatzgebiet.zone } }));
    bestaetigungZeigen(vorgangsnummer, demo, l);
  } catch (err) {
    console.error(err);
    meldung('Die Anfrage konnte nicht gesendet werden. Bitte versuchen Sie es erneut – Ihre Eingaben bleiben erhalten.');
    sendetGerade = false; knopf.disabled = false; knopf.textContent = l.buchung === 'direkt' ? 'Termin verbindlich anfragen' : 'Anfrage absenden';
  }
});

// --- Vorbelegung über URL-Parameter --------------------------------------------------
(function vorbelegen() {
  const p = new URLSearchParams(location.search);
  const l = LEISTUNG[p.get('leistung')];
  const bereich = l?.bereich || (BEREICH[p.get('bereich')] ? p.get('bereich') : '');
  if (bereich) { form.bereich.value = bereich; leistungenFuellen(bereich); }
  if (l) { form.leistung.value = l.slug; }
  leistungGeaendert();
  const plz = p.get('plz');
  if (plz && /^\d{5}$/.test(plz)) { form.plz.value = plz; const o = ortZuPlz(plz); if (o) form.ort.value = o.name; }
  const ort = katalog.orte.find((o) => o.slug === p.get('ort'));
  if (ort) form.ort.value = ort.name;
  anzeigen(false);
})();
