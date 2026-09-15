import { uid, toast } from './utils.js';
import { openModal } from './ui.js';

/**
 * Angebotsrechner — interner Projekt-Konfigurator für Angebote.
 *
 * Dasselbe Berechnungsprinzip wie der öffentliche Elektro-Kostenrechner der
 * Website (assets/elektro-konfigurator.js: Elektroinstallation nach Räumen,
 * Beleuchtung, Energie & Technik, E-Mobilität, Netzwerk/Sicherheit/Außen),
 * hier aber als EIN scrollbares Formular statt Mehrschritt-Assistent (passt
 * zu den übrigen Werkora-Dialogen) und mit direkter Übernahme als fertige
 * Angebots-Positionen statt nur einer Anzeige-Kostenspanne. Preistabellen
 * sind 1:1 aus dem Website-Rechner übernommen (kein gemeinsames Modul, da
 * beide Projekte ohne Build-Schritt auskommen), damit die Zahlen mit den
 * öffentlich kommunizierten Preisen konsistent bleiben.
 */

const ROOM_TYPES = [
  { id: 'wohnzimmer', label: 'Wohnzimmer', avgM2: 28, defaultCount: 1 },
  { id: 'kueche', label: 'Küche', avgM2: 14, defaultCount: 1 },
  { id: 'essbereich', label: 'Essbereich', avgM2: 12, defaultCount: 0 },
  { id: 'schlafzimmer', label: 'Schlafzimmer', avgM2: 16, defaultCount: 1 },
  { id: 'kinderzimmer', label: 'Kinderzimmer', avgM2: 13, defaultCount: 0 },
  { id: 'arbeitszimmer', label: 'Arbeitszimmer', avgM2: 12, defaultCount: 0 },
  { id: 'bad', label: 'Badezimmer', avgM2: 8, defaultCount: 1 },
  { id: 'gaeste_wc', label: 'Gäste-WC', avgM2: 3, defaultCount: 0 },
  { id: 'flur', label: 'Flur / Diele', avgM2: 10, defaultCount: 1 },
  { id: 'hwr', label: 'HWR / Tech', avgM2: 8, defaultCount: 0 },
  { id: 'keller', label: 'Kellerraum', avgM2: 20, defaultCount: 0 },
];
const CUSTOM_ROOM_AVG_M2 = 15;
const TIER_LABEL = { standard: 'Standard', smart: 'Smart', komplett: 'Komplett' };

const PROJEKTART_LABEL = { neubau: 'Neubau', kernsanierung: 'Kernsanierung', teilsanierung: 'Teilsanierung', anbau: 'Anbau & Aufstockung', einzelne: 'Einzelne Bereiche' };
const GEBAEUDEART_LABEL = { efh: 'Einfamilienhaus', dhh: 'Doppelhaushälfte', rh: 'Reihenhaus', mfh: 'Mehrfamilienhaus', wohnung: 'Wohnung', gewerbe: 'Gewerbeeinheit' };
const KELLER_LABEL = { keiner: 'Kein Keller', lager: 'Keller (Lager)', technik: 'Mit Technik (HWR)', wohnraum: 'Wohn-/Hobbyräume' };
const GARAGE_LABEL = { keine: 'Keine', 'garage-haus': 'Garage am Haus', 'garage-separat': 'Separate Garage', 'carport-haus': 'Carport am Haus', 'carport-separat': 'Separater Carport' };
const BELEUCHTUNG_LABEL = { klassisch: 'Klassische Deckenanschlüsse', zusatz: 'Decke + einzelne Zusatzleuchten', spots: 'LED-Spots in ausgewählten Räumen', konzept: 'Umfangreiches Lichtkonzept' };
const STELLPLATZ_LABEL = { garage: 'Garage', carport: 'Carport', aussen: 'Außenstellplatz', tiefgarage: 'Tiefgarage', mfh: 'Mehrfamilienhaus' };

const AUSSTATTUNG_PRO_M2 = { standard: { low: 70, high: 100 }, smart: { low: 100, high: 140 }, komplett: { low: 140, high: 200 } };
const GARAGE_ADDON = { low: 250, high: 500 };
const POOL_ADDON = { low: 300, high: 700 };
const SAUNA_ADDON = { low: 300, high: 600 };
// Preis an marktübliche Zählerschrank-Erneuerungskosten 2026 angepasst
// (vorher 1.200-2.200 € - lag unter dem üblichen Marktrahmen für eine
// Standard-Erneuerung im EFH), synchron mit assets/elektro-konfigurator.js.
const ZAEHLERSCHRANK = { low: 1800, high: 3500 };
const BELEUCHTUNG_TIER = {
  klassisch: { low: 45, high: 70, label: 'Beleuchtung – klassische Deckenanschlüsse' },
  zusatz: { low: 70, high: 100, label: 'Beleuchtung – Decke + Zusatzleuchten' },
  spots: { low: 90, high: 160, label: 'Beleuchtung – LED-Spots' },
  konzept: { low: 160, high: 260, label: 'Beleuchtung – Lichtkonzept' },
};
const PV_TIER = { low: 150, high: 250 };
const PV_SPEICHER_TIER = { low: 250, high: 400 };
const PV_NOTSTROM_TIER = { low: 350, high: 550 };
const WAERMEPUMPE_KW_ANNAHME = 10;
const WAERMEPUMPE_TIER = { low: 80, high: 140 };
const KLIMA_TIER = {
  ein: { low: 400, high: 700, label: 'Klimaanlage – ein Innengerät' },
  mehrere: { low: 800, high: 1500, label: 'Klimaanlage – mehrere Innengeräte' },
  haus: { low: 1800, high: 3000, label: 'Klimaanlage – ganzes Haus' },
};
const WALLBOX_VORBEREITUNG = { low: 400, high: 800 };
const WALLBOX_EINZEL = { low: 1200, high: 2200 };
const WALLBOX_ADDON = {
  lastmanagement: { low: 500, high: 800, label: 'Lastmanagement' },
  pv_ueberschuss: { low: 500, high: 900, label: 'PV-Überschussladen' },
  zugriffskontrolle: { low: 150, high: 300, label: 'Zugriffskontrolle (RFID/App)' },
  mid_zaehler: { low: 150, high: 300, label: 'MID-Zähler' },
  energiemanagement: { low: 400, high: 800, label: 'Energiemanagement-Integration' },
};
const WALLBOX_ERDARBEITEN = { low: 400, high: 900 };
const WALLBOX_ENTFERNUNG_FREI_M = 10;
const WALLBOX_ENTFERNUNG_PRO_M = { low: 15, high: 25 };
const NETZWERK_TIER = {
  basis: { low: 300, high: 600, label: 'Netzwerk / Datenverkabelung – Basis' },
  komfort: { low: 600, high: 1000, label: 'Netzwerk / Datenverkabelung – Komfort' },
  smarthome: { low: 1000, high: 1800, label: 'Netzwerk / Datenverkabelung – Smart-Home vorbereitet' },
};
const TUERKOMM_TIER = {
  audio: { low: 300, high: 600, label: 'Türkommunikation – Audio-Sprechanlage' },
  video: { low: 600, high: 1200, label: 'Türkommunikation – Video-Sprechanlage' },
  videoapp: { low: 900, high: 1800, label: 'Türkommunikation – Video + App' },
  mfh: { low: 1500, high: 3500, label: 'Türkommunikation – MFH-Anlage' },
};
const SICHERHEIT_ITEMS = {
  tueroeffner: { low: 150, high: 300, label: 'Elektr. Türöffner' },
  kamera: { low: 300, high: 600, label: 'Kamera Eingang/Einfahrt' },
  alarm: { low: 400, high: 900, label: 'Alarmanlage (Vorbereitung)' },
  rauchwarnmelder: { low: 80, high: 150, proRaum: true, label: 'Rauchwarnmelder vernetzt' },
};
const AUSSEN_ITEMS = {
  steckdosen: { low: 150, high: 350, label: 'Außensteckdosen' },
  beleuchtung: { low: 300, high: 700, label: 'Außenbeleuchtung' },
  wegebeleuchtung: { low: 400, high: 900, label: 'Wegebeleuchtung' },
  einfahrt: { low: 300, high: 700, label: 'Beleuchtete Einfahrt' },
  tor: { low: 800, high: 1800, label: 'Elektrisches Tor' },
  gartenhaus: { low: 400, high: 900, label: 'Gartenhaus-Strom' },
  bewaesserung: { low: 200, high: 500, label: 'Bewässerung (Steuerung)' },
  kameravorb: { low: 150, high: 350, label: 'Kamera-Vorbereitung' },
};

function fmtEUR(n) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
}
function escHtml(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

/**
 * Öffnet den Angebotsrechner. onUebernehmen(positionen) wird mit fertigen
 * Positions-Objekten (Format wie positions.js sie erwartet) aufgerufen, wenn
 * der Nutzer die berechneten Positionen ins Angebot übernimmt.
 */
export function openAngebotsrechner({ defaultSteuersatz = 19, onUebernehmen }) {
  const state = {
    projektart: 'neubau', gebaeudeart: 'efh', wohnflaeche: 130,
    geschosseListe: ['eg', 'og1'], keller: 'keiner', garage: 'keine', aussenflaechen: [],
    rooms: Object.fromEntries(ROOM_TYPES.map((rt) => [rt.id, { count: rt.defaultCount, tier: 'smart' }])),
    customRooms: [],
    beleuchtung: 'klassisch',
    pvGewuenscht: false, dachflaeche: 45, speicher: false, notstrom: false,
    waermepumpe: false, klima: 'nein',
    wallbox: 'keine', stellplatz: 'garage', wallboxEntfernungM: 10, wallboxLeistung: '11kw',
    wallboxErdarbeiten: 'unbekannt', wallboxLeitungVorhanden: 'unbekannt',
    wallboxAnforderungen: [], erdungssystem: 'unbekannt',
    netzwerk: 'basis', tuerkommunikation: 'keine', sicherheit: [], aussen: [],
  };

  function gesamtRaumAnzahl() {
    const feste = ROOM_TYPES.reduce((s, rt) => s + (state.rooms[rt.id]?.count || 0), 0);
    const eigene = state.customRooms.reduce((s, r) => s + (r.count || 0), 0);
    return Math.max(1, feste + eigene);
  }

  function berechneRaumKosten() {
    let low = 0; let high = 0;
    for (const rt of ROOM_TYPES) {
      const data = state.rooms[rt.id];
      if (!data || data.count <= 0) continue;
      const tier = AUSSTATTUNG_PRO_M2[data.tier];
      low += rt.avgM2 * data.count * tier.low;
      high += rt.avgM2 * data.count * tier.high;
    }
    for (const r of state.customRooms) {
      if (r.count <= 0) continue;
      const tier = AUSSTATTUNG_PRO_M2[r.tier];
      low += CUSTOM_ROOM_AVG_M2 * r.count * tier.low;
      high += CUSTOM_ROOM_AVG_M2 * r.count * tier.high;
    }
    return { low, high };
  }

  function berechnePositionen() {
    const positionen = [];
    const geschossFaktor = 1 + Math.min(state.geschosseListe.length - 1, 3) * 0.08;
    const bestandZuschlag = ['kernsanierung', 'teilsanierung', 'einzelne'].includes(state.projektart) ? 1.1 : 1;
    const raum = berechneRaumKosten();
    positionen.push({
      label: `Elektroinstallation Wohnbereiche (${gesamtRaumAnzahl()} Räume)`,
      low: Math.round(raum.low * geschossFaktor * bestandZuschlag),
      high: Math.round(raum.high * geschossFaktor * bestandZuschlag),
    });
    positionen.push({ label: 'Zählerschrank / Hauptverteilung erneuern', low: ZAEHLERSCHRANK.low, high: ZAEHLERSCHRANK.high });
    if (state.garage !== 'keine') positionen.push({ label: `Elektro ${GARAGE_LABEL[state.garage]}`, low: GARAGE_ADDON.low, high: GARAGE_ADDON.high });
    if (state.aussenflaechen.includes('pool')) positionen.push({ label: 'Pool-Elektroanschluss', low: POOL_ADDON.low, high: POOL_ADDON.high });
    if (state.aussenflaechen.includes('sauna')) positionen.push({ label: 'Sauna-Elektroanschluss', low: SAUNA_ADDON.low, high: SAUNA_ADDON.high });

    const bel = BELEUCHTUNG_TIER[state.beleuchtung];
    const raeume = gesamtRaumAnzahl();
    positionen.push({ label: bel.label, low: bel.low * raeume, high: bel.high * raeume });

    if (state.pvGewuenscht) {
      const kwp = Math.round(state.dachflaeche * 0.15 * 10) / 10;
      let tier = PV_TIER;
      if (state.notstrom) tier = PV_NOTSTROM_TIER; else if (state.speicher) tier = PV_SPEICHER_TIER;
      positionen.push({ label: `Photovoltaik – Elektro-Anschluss (ca. ${kwp} kWp)`, low: Math.round(tier.low * kwp), high: Math.round(tier.high * kwp) });
    }
    if (state.waermepumpe) {
      positionen.push({ label: 'Wärmepumpen-Elektroanschluss', low: WAERMEPUMPE_TIER.low * WAERMEPUMPE_KW_ANNAHME, high: WAERMEPUMPE_TIER.high * WAERMEPUMPE_KW_ANNAHME });
    }
    if (state.klima !== 'nein') {
      const k = KLIMA_TIER[state.klima];
      positionen.push({ label: k.label, low: k.low, high: k.high });
    }

    if (state.wallbox === 'vorbereitung') {
      positionen.push({ label: 'Wallbox – Vorbereitung (Leerrohr)', low: WALLBOX_VORBEREITUNG.low, high: WALLBOX_VORBEREITUNG.high });
    } else if (state.wallbox === 'eine' || state.wallbox === 'zwei') {
      const anzahl = state.wallbox === 'zwei' ? 2 : 1;
      let low = WALLBOX_EINZEL.low * anzahl;
      let high = WALLBOX_EINZEL.high * anzahl;
      const anforderungen = new Set(state.wallboxAnforderungen);
      if (anzahl === 2) anforderungen.add('lastmanagement');
      if (state.pvGewuenscht) anforderungen.add('pv_ueberschuss');
      anforderungen.forEach((key) => {
        const addon = WALLBOX_ADDON[key];
        if (addon) { low += addon.low; high += addon.high; }
      });
      if (state.wallboxErdarbeiten === 'ja') { low += WALLBOX_ERDARBEITEN.low; high += WALLBOX_ERDARBEITEN.high; }
      const mehrDistanz = Math.max(0, state.wallboxEntfernungM - WALLBOX_ENTFERNUNG_FREI_M);
      if (mehrDistanz > 0) { low += mehrDistanz * WALLBOX_ENTFERNUNG_PRO_M.low; high += mehrDistanz * WALLBOX_ENTFERNUNG_PRO_M.high; }
      positionen.push({ label: `Wallbox (${anzahl} Stück)`, low, high });
    }

    const netz = NETZWERK_TIER[state.netzwerk];
    positionen.push({ label: netz.label, low: netz.low * raeume, high: netz.high * raeume });

    if (state.tuerkommunikation !== 'keine') {
      const t = TUERKOMM_TIER[state.tuerkommunikation];
      positionen.push({ label: t.label, low: t.low, high: t.high });
    }
    for (const key of state.sicherheit) {
      const item = SICHERHEIT_ITEMS[key];
      if (!item) continue;
      const faktor = item.proRaum ? raeume : 1;
      positionen.push({ label: item.label, low: item.low * faktor, high: item.high * faktor });
    }
    for (const key of state.aussen) {
      const item = AUSSEN_ITEMS[key];
      if (!item) continue;
      positionen.push({ label: item.label, low: item.low, high: item.high });
    }
    positionen.push({ label: 'Abnahme, Messung & Prüfprotokoll (DIN VDE)', low: 250, high: 350 });
    return positionen;
  }

  function roomRowHtml(id, label, data, isCustom) {
    return `
      <tr data-room-row="${id}">
        <td>${isCustom ? `<input type="text" data-room-name="${id}" value="${escHtml(label)}" placeholder="Raumname" style="width:100%">` : escHtml(label)}</td>
        <td><input type="number" min="0" max="20" data-room-count="${id}" value="${data.count}" style="width:64px"></td>
        <td>
          <select data-room-tier="${id}">
            ${Object.entries(TIER_LABEL).map(([v, l]) => `<option value="${v}" ${data.tier === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </td>
        ${isCustom ? `<td><button type="button" class="btn btn-sm" data-room-remove="${id}" title="Entfernen">✕</button></td>` : '<td></td>'}
      </tr>
    `;
  }
  function renderRoomTable() {
    return `
      <table class="data-table" id="ar-room-table">
        <thead><tr><th>Raum</th><th>Anzahl</th><th>Ausstattung</th><th></th></tr></thead>
        <tbody>
          ${ROOM_TYPES.map((rt) => roomRowHtml(rt.id, rt.label, state.rooms[rt.id], false)).join('')}
          ${state.customRooms.map((r) => roomRowHtml(r.id, r.name, r, true)).join('')}
        </tbody>
      </table>
      <button type="button" class="btn btn-sm" id="ar-btn-add-room" style="margin-top:8px">+ Eigenen Raum hinzufügen</button>
    `;
  }

  function checkboxTags(field, items, selected) {
    return `<div class="tag-list" data-checkgroup="${field}">
      ${Object.entries(items).map(([id, label]) => `
        <label class="field-checkbox" style="border:1px solid var(--border);border-radius:8px;padding:5px 10px">
          <input type="checkbox" value="${id}" ${selected.includes(id) ? 'checked' : ''}> ${escHtml(label)}
        </label>
      `).join('')}
    </div>`;
  }

  function toggleGroup(field, options, current) {
    return `<div class="toggle-group" data-field="${field}">
      ${options.map(([val, label]) => `<button type="button" data-val="${val}" class="${current === val ? 'active' : ''}">${escHtml(label)}</button>`).join('')}
    </div>`;
  }

  const { body, close } = openModal({
    title: '🧮 Angebotsrechner',
    wide: true,
    bodyHtml: `
      <p class="hint">Projekt strukturiert nach Bausteinen erfassen - die berechneten Positionen können am Ende direkt ins Angebot übernommen werden. Grobe Richtwerte, orientiert an den auf der Website veröffentlichten Preisen (Marktdaten 2026).</p>

      <div class="calc-result" id="ar-result" style="background:var(--card-2);border:1px solid var(--border);border-radius:var(--radius);padding:16px;text-align:center;margin-bottom:16px">
        <div style="font-size:11px;letter-spacing:0.05em;text-transform:uppercase;color:var(--text-mute);margin-bottom:6px">Geschätzte Gesamtsumme</div>
        <div style="font-size:26px;font-weight:700" id="ar-range">–</div>
      </div>

      <h2 style="font-size:14px;margin:0 0 8px">Projekt &amp; Gebäude</h2>
      <div class="form-grid">
        <div class="field col-span-2"><label>Projektart</label>${toggleGroup('projektart', Object.entries(PROJEKTART_LABEL).map(([v, l]) => [v, l]), state.projektart)}</div>
        <div class="field col-span-2"><label>Gebäudeart</label>${toggleGroup('gebaeudeart', Object.entries(GEBAEUDEART_LABEL).map(([v, l]) => [v, l]), state.gebaeudeart)}</div>
        <div class="field"><label>Wohnfläche (m²)</label><input type="number" id="ar-wohnflaeche" min="30" max="600" value="${state.wohnflaeche}"></div>
        <div class="field"><label>Keller</label>
          <select data-field-select="keller">${Object.entries(KELLER_LABEL).map(([v, l]) => `<option value="${v}" ${state.keller === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        </div>
        <div class="field col-span-2"><label>Vollgeschosse (alle zutreffenden wählen)</label>
          ${checkboxTags('geschosseListe', { eg: 'Erdgeschoss', og1: 'Obergeschoss', og2: 'Weiteres OG', dgausgebaut: 'Dachgeschoss ausgebaut', dgroh: 'Dachgeschoss roh' }, state.geschosseListe)}
        </div>
        <div class="field col-span-2"><label>Garage / Carport</label>
          <select data-field-select="garage">${Object.entries(GARAGE_LABEL).map(([v, l]) => `<option value="${v}" ${state.garage === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        </div>
        <div class="field col-span-2"><label>Zusätzliche Außenflächen</label>
          ${checkboxTags('aussenflaechen', { terrasse: 'Terrasse', balkon: 'Balkon', garten: 'Garten', einfahrt: 'Einfahrt', pool: 'Pool', sauna: 'Sauna', werkstatt: 'Werkstatt', gartenhaus: 'Gartenhaus' }, state.aussenflaechen)}
        </div>
      </div>

      <div class="divider"></div>
      <h2 style="font-size:14px;margin:0 0 8px">Räume &amp; Ausstattung</h2>
      <div id="ar-room-host">${renderRoomTable()}</div>

      <div class="divider"></div>
      <h2 style="font-size:14px;margin:0 0 8px">Beleuchtung</h2>
      <div class="field">${toggleGroup('beleuchtung', Object.entries(BELEUCHTUNG_LABEL).map(([v, l]) => [v, l]), state.beleuchtung)}</div>

      <div class="divider"></div>
      <h2 style="font-size:14px;margin:0 0 8px">Energie &amp; Technik</h2>
      <div class="form-grid">
        <div class="field"><label class="field-checkbox"><input type="checkbox" id="ar-pv" ${state.pvGewuenscht ? 'checked' : ''}> Photovoltaik gewünscht</label></div>
        <div class="field"><label class="field-checkbox"><input type="checkbox" id="ar-waermepumpe" ${state.waermepumpe ? 'checked' : ''}> Wärmepumpe</label></div>
        <div id="ar-pv-block" class="col-span-2" ${state.pvGewuenscht ? '' : 'hidden'}>
          <div class="form-grid">
            <div class="field"><label>Nutzbare Dachfläche (m²)</label><input type="number" id="ar-dachflaeche" min="10" max="300" value="${state.dachflaeche}"></div>
            <div class="field"><label class="field-checkbox"><input type="checkbox" id="ar-speicher" ${state.speicher ? 'checked' : ''}> Batteriespeicher</label></div>
            <div class="field"><label class="field-checkbox"><input type="checkbox" id="ar-notstrom" ${state.notstrom ? 'checked' : ''}> Notstrom/Ersatzstrom</label></div>
          </div>
        </div>
        <div class="field col-span-2"><label>Klimaanlage</label>
          <select data-field-select="klima">
            <option value="nein" ${state.klima === 'nein' ? 'selected' : ''}>Keine</option>
            <option value="ein" ${state.klima === 'ein' ? 'selected' : ''}>Ein Innengerät</option>
            <option value="mehrere" ${state.klima === 'mehrere' ? 'selected' : ''}>Mehrere Innengeräte</option>
            <option value="haus" ${state.klima === 'haus' ? 'selected' : ''}>Ganzes Haus</option>
          </select>
        </div>
      </div>

      <div class="divider"></div>
      <h2 style="font-size:14px;margin:0 0 8px">E-Mobilität</h2>
      <div class="field">${toggleGroup('wallbox', [['keine', 'Keine'], ['vorbereitung', 'Vorbereitung (Leerrohr)'], ['eine', 'Eine Wallbox'], ['zwei', 'Zwei Wallboxen']], state.wallbox)}</div>
      <div id="ar-wallbox-block" ${state.wallbox === 'keine' || state.wallbox === 'vorbereitung' ? 'hidden' : ''}>
        <div class="form-grid" style="margin-top:10px">
          <div class="field"><label>Stellplatz</label>
            <select data-field-select="stellplatz">${Object.entries(STELLPLATZ_LABEL).map(([v, l]) => `<option value="${v}" ${state.stellplatz === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
          </div>
          <div class="field"><label>Entfernung zum Zählerschrank (m)</label><input type="number" id="ar-wallbox-entfernung" min="1" max="100" value="${state.wallboxEntfernungM}"></div>
          <div class="field"><label>Ladeleistung</label>
            <select data-field-select="wallboxLeistung">
              <option value="11kw" ${state.wallboxLeistung === '11kw' ? 'selected' : ''}>11 kW</option>
              <option value="22kw" ${state.wallboxLeistung === '22kw' ? 'selected' : ''}>22 kW</option>
              <option value="offen" ${state.wallboxLeistung === 'offen' ? 'selected' : ''}>Noch offen</option>
            </select>
          </div>
          <div class="field"><label>Tiefbauarbeiten nötig?</label>
            <select data-field-select="wallboxErdarbeiten">
              <option value="unbekannt" ${state.wallboxErdarbeiten === 'unbekannt' ? 'selected' : ''}>Weiß nicht</option>
              <option value="ja" ${state.wallboxErdarbeiten === 'ja' ? 'selected' : ''}>Ja</option>
              <option value="nein" ${state.wallboxErdarbeiten === 'nein' ? 'selected' : ''}>Nein</option>
            </select>
          </div>
          <div class="field"><label>Leitung bereits vorhanden?</label>
            <select data-field-select="wallboxLeitungVorhanden">
              <option value="unbekannt" ${state.wallboxLeitungVorhanden === 'unbekannt' ? 'selected' : ''}>Weiß nicht</option>
              <option value="ja" ${state.wallboxLeitungVorhanden === 'ja' ? 'selected' : ''}>Ja</option>
              <option value="nein" ${state.wallboxLeitungVorhanden === 'nein' ? 'selected' : ''}>Nein</option>
            </select>
          </div>
          <div class="field"><label>Erdungssystem</label>
            <select data-field-select="erdungssystem">
              <option value="unbekannt" ${state.erdungssystem === 'unbekannt' ? 'selected' : ''}>Weiß nicht</option>
              <option value="tn-c-s" ${state.erdungssystem === 'tn-c-s' ? 'selected' : ''}>TN-C-S</option>
              <option value="tn-s" ${state.erdungssystem === 'tn-s' ? 'selected' : ''}>TN-S</option>
              <option value="tt" ${state.erdungssystem === 'tt' ? 'selected' : ''}>TT</option>
            </select>
          </div>
          <div class="field col-span-2"><label>Zusätzliche Anforderungen</label>
            ${checkboxTags('wallboxAnforderungen', Object.fromEntries(Object.entries(WALLBOX_ADDON).map(([k, v]) => [k, v.label])), state.wallboxAnforderungen)}
          </div>
        </div>
      </div>

      <div class="divider"></div>
      <h2 style="font-size:14px;margin:0 0 8px">Netzwerk, Sicherheit &amp; Außen</h2>
      <div class="form-grid">
        <div class="field col-span-2"><label>Netzwerk / Datenverkabelung</label>
          <select data-field-select="netzwerk">
            <option value="basis" ${state.netzwerk === 'basis' ? 'selected' : ''}>Basis</option>
            <option value="komfort" ${state.netzwerk === 'komfort' ? 'selected' : ''}>Komfort</option>
            <option value="smarthome" ${state.netzwerk === 'smarthome' ? 'selected' : ''}>Smart-Home vorbereitet</option>
          </select>
        </div>
        <div class="field col-span-2"><label>Türkommunikation</label>
          <select data-field-select="tuerkommunikation">
            <option value="keine" ${state.tuerkommunikation === 'keine' ? 'selected' : ''}>Keine</option>
            <option value="audio" ${state.tuerkommunikation === 'audio' ? 'selected' : ''}>Audio-Sprechanlage</option>
            <option value="video" ${state.tuerkommunikation === 'video' ? 'selected' : ''}>Video-Sprechanlage</option>
            <option value="videoapp" ${state.tuerkommunikation === 'videoapp' ? 'selected' : ''}>Video + App</option>
            <option value="mfh" ${state.tuerkommunikation === 'mfh' ? 'selected' : ''}>MFH-Anlage</option>
          </select>
        </div>
        <div class="field col-span-2"><label>Sicherheit &amp; Zusatz</label>
          ${checkboxTags('sicherheit', Object.fromEntries(Object.entries(SICHERHEIT_ITEMS).map(([k, v]) => [k, v.label])), state.sicherheit)}
        </div>
        <div class="field col-span-2"><label>Außenanlagen</label>
          ${checkboxTags('aussen', Object.fromEntries(Object.entries(AUSSEN_ITEMS).map(([k, v]) => [k, v.label])), state.aussen)}
        </div>
      </div>

      <div id="ar-breakdown-host" style="margin-top:16px"></div>

      <div class="modal-actions">
        <span class="spacer"></span>
        <button type="button" class="btn" id="ar-btn-cancel">Abbrechen</button>
        <button type="button" class="btn btn-primary" id="ar-btn-uebernehmen">Als Positionen übernehmen</button>
      </div>
    `,
  });

  function updatePreis() {
    const positionen = berechnePositionen();
    const low = positionen.reduce((s, p) => s + p.low, 0);
    const high = positionen.reduce((s, p) => s + p.high, 0);
    body.querySelector('#ar-range').textContent = `${fmtEUR(low)} – ${fmtEUR(high)}`;
    body.querySelector('#ar-breakdown-host').innerHTML = `
      <h2 style="font-size:14px;margin:0 0 8px">Positionen (Vorschau)</h2>
      <ul class="feature-list">
        ${positionen.map((p) => `<li style="display:flex;justify-content:space-between;gap:12px"><span>${escHtml(p.label)}</span><span>${fmtEUR(p.low)} – ${fmtEUR(p.high)}</span></li>`).join('')}
      </ul>
    `;
    return positionen;
  }

  // Generische Toggle-/Checkbox-/Select-Verdrahtung
  function wireToggleGroups() {
    body.querySelectorAll('.toggle-group[data-field]').forEach((group) => {
      const field = group.dataset.field;
      group.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => {
          group.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          state[field] = btn.dataset.val;
          if (field === 'wallbox') updateWallboxBlockVisibility();
          updatePreis();
        });
      });
    });
  }
  function wireCheckgroups() {
    body.querySelectorAll('.tag-list[data-checkgroup]').forEach((group) => {
      const field = group.dataset.checkgroup;
      group.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        cb.addEventListener('change', () => {
          state[field] = Array.from(group.querySelectorAll('input:checked')).map((c) => c.value);
          updatePreis();
        });
      });
    });
  }
  function wireSelects() {
    body.querySelectorAll('select[data-field-select]').forEach((sel) => {
      sel.addEventListener('change', () => {
        state[sel.dataset.fieldSelect] = sel.value;
        updatePreis();
      });
    });
  }
  function updateWallboxBlockVisibility() {
    body.querySelector('#ar-wallbox-block').hidden = state.wallbox === 'keine' || state.wallbox === 'vorbereitung';
  }

  body.querySelector('#ar-wohnflaeche').addEventListener('input', (e) => { state.wohnflaeche = Number(e.target.value) || 0; updatePreis(); });
  body.querySelector('#ar-dachflaeche').addEventListener('input', (e) => { state.dachflaeche = Number(e.target.value) || 0; updatePreis(); });
  body.querySelector('#ar-wallbox-entfernung').addEventListener('input', (e) => { state.wallboxEntfernungM = Number(e.target.value) || 0; updatePreis(); });
  body.querySelector('#ar-pv').addEventListener('change', (e) => { state.pvGewuenscht = e.target.checked; body.querySelector('#ar-pv-block').hidden = !state.pvGewuenscht; updatePreis(); });
  body.querySelector('#ar-speicher').addEventListener('change', (e) => { state.speicher = e.target.checked; updatePreis(); });
  body.querySelector('#ar-notstrom').addEventListener('change', (e) => { state.notstrom = e.target.checked; updatePreis(); });
  body.querySelector('#ar-waermepumpe').addEventListener('change', (e) => { state.waermepumpe = e.target.checked; updatePreis(); });

  function wireRoomTable() {
    const host = body.querySelector('#ar-room-host');
    host.querySelectorAll('[data-room-count]').forEach((input) => {
      input.addEventListener('input', () => {
        const id = input.dataset.roomCount;
        const target = state.rooms[id] || state.customRooms.find((r) => r.id === id);
        if (target) target.count = Math.max(0, Number(input.value) || 0);
        updatePreis();
      });
    });
    host.querySelectorAll('[data-room-tier]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const id = sel.dataset.roomTier;
        const target = state.rooms[id] || state.customRooms.find((r) => r.id === id);
        if (target) target.tier = sel.value;
        updatePreis();
      });
    });
    host.querySelectorAll('[data-room-name]').forEach((input) => {
      input.addEventListener('input', () => {
        const r = state.customRooms.find((r) => r.id === input.dataset.roomName);
        if (r) r.name = input.value;
      });
    });
    host.querySelectorAll('[data-room-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.customRooms = state.customRooms.filter((r) => r.id !== btn.dataset.roomRemove);
        rerenderRooms();
      });
    });
  }
  function rerenderRooms() {
    body.querySelector('#ar-room-host').innerHTML = renderRoomTable();
    wireRoomTable();
    body.querySelector('#ar-btn-add-room').addEventListener('click', () => {
      state.customRooms.push({ id: `custom-${Date.now()}`, name: 'Eigener Raum', count: 1, tier: 'smart' });
      rerenderRooms();
      updatePreis();
    });
    updatePreis();
  }

  wireToggleGroups();
  wireCheckgroups();
  wireSelects();
  wireRoomTable();
  body.querySelector('#ar-btn-add-room').addEventListener('click', () => {
    state.customRooms.push({ id: `custom-${Date.now()}`, name: 'Eigener Raum', count: 1, tier: 'smart' });
    rerenderRooms();
  });
  updatePreis();

  body.querySelector('#ar-btn-cancel').addEventListener('click', close);
  body.querySelector('#ar-btn-uebernehmen').addEventListener('click', () => {
    const positionen = berechnePositionen();
    if (positionen.length === 0) { toast('Keine Positionen berechnet.', 'info'); return; }
    const neuePositionen = positionen.map((p) => ({
      id: uid(),
      bezeichnung: p.label,
      beschreibung: `Automatisch berechnet: ${fmtEUR(p.low)} – ${fmtEUR(p.high)} (Richtwert, bitte prüfen)`,
      einheit: 'Psch.',
      menge: 1,
      einzelpreis: Math.round((p.low + p.high) / 2),
      steuersatz: defaultSteuersatz,
    }));
    onUebernehmen(neuePositionen);
    close();
    toast(`${neuePositionen.length} Positionen aus dem Angebotsrechner übernommen - Preise bitte prüfen.`, 'success');
  });
}
