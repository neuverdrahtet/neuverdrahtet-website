/* =========================================================
   Elektro-Kostenrechner — großer Projekt-Konfigurator
   Plain JS, kein Modul/Build-Schritt (wie assets/script.js).
   Deckt Elektroinstallation, Beleuchtung, Energie & Technik
   (PV/Speicher/Wärmepumpe/Klima), E-Mobilität (Wallbox) sowie
   Netzwerk/Sicherheit/Außenanlagen in einem Assistenten ab.
   Preise pro Kategorie orientieren sich an den bereits auf den
   jeweiligen Leistungsseiten veröffentlichten €/Einheit-Spannen
   (elektroinstallation.html, beleuchtungstechnik.html,
   photovoltaik.html, waermepumpe.html, wallbox.html,
   smart-home.html), damit die Zahlen sitenweit konsistent bleiben.
   ========================================================= */

const EK_WORKER_URL = 'https://neuverdrahtetworkersdevworkersdev.neuverdrahtetworkersdev.workers.dev';

(() => {
  const form = document.getElementById('ekForm');
  if (!form) return; // Script wird nur auf der Kostenrechner-Seite eingebunden

  const steps = Array.from(form.querySelectorAll('.wizard-step'));
  const progressEl = document.getElementById('wizardProgress');
  const btnBack = document.getElementById('ekBtnBack');
  const btnNext = document.getElementById('ekBtnNext');
  const btnSubmit = document.getElementById('ekBtnSubmit');
  const pageLoadedAt = Date.now();

  let current = 1;
  const totalSteps = steps.length;

  // Feste Raumtypen (siehe Schritt 2) mit angenommener Durchschnittsfläche -
  // ersetzt eine reine Wohnflächen-Schätzung durch eine echte Raumliste wie
  // bei vergleichbaren Konfiguratoren, ohne dass der Nutzer selbst m² pro
  // Raum eintragen muss.
  const ROOM_TYPES = [
    { id: 'wohnzimmer', label: 'Wohnzimmer', avgM2: 28, defaultCount: 1 },
    { id: 'kueche', label: 'Küche', avgM2: 14, defaultCount: 1 },
    { id: 'essbereich', label: 'Essbereich', avgM2: 12, defaultCount: 1 },
    { id: 'schlafzimmer', label: 'Schlafzimmer', avgM2: 16, defaultCount: 1 },
    { id: 'kinderzimmer', label: 'Kinderzimmer', avgM2: 13, defaultCount: 2 },
    { id: 'arbeitszimmer', label: 'Arbeitszimmer', avgM2: 12, defaultCount: 1 },
    { id: 'bad', label: 'Badezimmer', avgM2: 8, defaultCount: 1 },
    { id: 'gaeste_wc', label: 'Gäste-WC', avgM2: 3, defaultCount: 1 },
    { id: 'flur', label: 'Flur / Diele', avgM2: 10, defaultCount: 1 },
    { id: 'hwr', label: 'HWR / Tech', avgM2: 8, defaultCount: 1 },
    { id: 'keller', label: 'Kellerraum', avgM2: 20, defaultCount: 0 },
  ];
  const CUSTOM_ROOM_AVG_M2 = 15;
  const ROOM_TIER_OPTIONS = [
    { value: 'standard', label: 'Standard' },
    { value: 'smart', label: 'Smart' },
    { value: 'komplett', label: 'Komplett' },
  ];

  const state = {
    projektart: 'neubau', gebaeudeart: 'efh', wohnflaeche: 130,
    geschosseListe: ['eg', 'og1'], keller: 'keiner', garage: 'keine', aussenflaechen: [],
    rooms: Object.fromEntries(ROOM_TYPES.map((rt) => [rt.id, { count: rt.defaultCount, tier: 'smart' }])),
    customRooms: [], // { id, name, count, tier }
    beleuchtung: 'klassisch',
    pvGewuenscht: 'ja', dachflaeche: 45, dachausrichtung: 'sued', dachzugang: 'gut', speicher: 'keine', notstrom: 'nein',
    waermepumpe: 'nein', klima: 'nein',
    wallbox: 'keine',
    netzwerk: 'basis', tuerkommunikation: 'keine', sicherheit: [], aussen: [],
  };

  /* ---------- Fortschrittsanzeige ---------- */
  function renderProgress() {
    progressEl.innerHTML = Array.from({ length: totalSteps }, (_, i) => {
      const n = i + 1;
      const cls = n === current ? 'is-active' : (n < current ? 'is-done' : '');
      return `<span class="wizard-dot ${cls}"></span>`;
    }).join('');
  }

  /* ---------- Schritt-Navigation ---------- */
  function showStep(n) {
    current = n;
    steps.forEach((step) => { step.hidden = Number(step.dataset.step) !== current; });
    btnBack.hidden = current === 1;
    const isLast = current === totalSteps;
    btnNext.hidden = isLast;
    btnSubmit.hidden = !isLast;
    if (current >= 2) updatePreis(); // ab Schritt 2 wird die laufende Summe sichtbar/relevant
    renderProgress();
    form.closest('.wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function stepIsValid(n) {
    if (n === totalSteps - 1) return document.getElementById('ek-hinweis-bestaetigt').checked;
    return true;
  }

  btnNext.addEventListener('click', () => {
    if (!stepIsValid(current)) {
      toastHinweis('Bitte bestätigen Sie den Hinweis, bevor Sie fortfahren.');
      return;
    }
    if (current < totalSteps) showStep(current + 1);
  });
  btnBack.addEventListener('click', () => { if (current > 1) showStep(current - 1); });

  /** Erlaubt Einzel-Leistungsseiten (z.B. wallbox.html), direkt beim
   *  passenden Schritt zu starten statt immer bei Schritt 1, per
   *  ?schritt=N in der verlinkten URL (siehe href in den jeweiligen
   *  "Jetzt kostenlos kalkulieren"-CTAs). "Zurück" bleibt trotzdem
   *  nutzbar, um vorherige Schritte alle mit sinnvollen Standardwerten
   *  zu sehen/anzupassen. */
  function initialStepFromUrl() {
    const n = Number(new URLSearchParams(location.search).get('schritt'));
    return Number.isInteger(n) && n >= 1 && n <= totalSteps ? n : 1;
  }

  function toastHinweis(msg) {
    const status = document.getElementById('ekFormStatus');
    if (status) { status.textContent = msg; status.className = 'form-status err'; }
  }

  /* ---------- Eingaben verdrahten ---------- */
  form.querySelectorAll('.calc-toggle[data-field]').forEach((group) => {
    const field = group.dataset.field;
    group.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        group.querySelectorAll('button').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        state[field] = btn.dataset.value;
        if (field === 'pvGewuenscht') updatePvBlockVisibility();
        updatePreis();
      });
    });
  });

  form.querySelectorAll('.calc-checkgrid[data-checkgroup]').forEach((group) => {
    const field = group.dataset.checkgroup;
    group.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', () => {
        state[field] = Array.from(group.querySelectorAll('input:checked')).map((c) => c.value);
        updatePreis();
      });
    });
  });

  function wireSlider(inputId, valId, stateKey, suffix) {
    const input = document.getElementById(inputId);
    const val = document.getElementById(valId);
    input.addEventListener('input', () => {
      state[stateKey] = Number(input.value);
      val.textContent = `${state[stateKey]} ${suffix}`;
      updatePreis();
    });
  }
  wireSlider('ek-wohnflaeche', 'ek-wohnflaeche-val', 'wohnflaeche', 'm²');
  wireSlider('ek-dachflaeche', 'ek-dachflaeche-val', 'dachflaeche', 'm²');

  /* ---------- Räume & Ausstattung (Schritt 2): dynamische Raumliste ---------- */
  function escHtml(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function escAttr(s) { return escHtml(s).replace(/"/g, '&quot;'); }

  function roomDataFor(id) {
    return state.rooms[id] || state.customRooms.find((c) => c.id === id);
  }

  function roomRowHtml(id, label, data, isCustom) {
    const nameHtml = isCustom
      ? `<div class="calc-room-name"><input type="text" data-room-name="${id}" value="${escAttr(label)}" placeholder="Raumname"></div>`
      : `<div class="calc-room-name">${escHtml(label)}</div>`;
    return `
      <div class="calc-room-row ${data.count > 0 ? 'has-count' : ''}" data-room-row="${id}">
        <div class="calc-room-head">
          ${nameHtml}
          <div class="calc-stepper">
            <button type="button" data-room-dec="${id}" aria-label="Weniger">−</button>
            <span class="count">${data.count}</span>
            <button type="button" data-room-inc="${id}" aria-label="Mehr">+</button>
          </div>
          ${isCustom ? `<button type="button" class="calc-room-remove" data-room-remove="${id}" aria-label="Raum entfernen">✕</button>` : ''}
        </div>
        ${data.count > 0 ? `<div class="calc-room-tier" data-room-tier-group="${id}">
          ${ROOM_TIER_OPTIONS.map((t) => `<button type="button" data-value="${t.value}" class="${data.tier === t.value ? 'is-active' : ''}">${t.label}</button>`).join('')}
        </div>` : ''}
      </div>
    `;
  }

  function renderRoomList() {
    const host = document.getElementById('ek-room-list');
    const rows = ROOM_TYPES.map((rt) => roomRowHtml(rt.id, rt.label, state.rooms[rt.id], false))
      .concat(state.customRooms.map((cr) => roomRowHtml(cr.id, cr.name, cr, true)));
    host.innerHTML = rows.join('');
    wireRoomRows();
  }

  function wireRoomRows() {
    const host = document.getElementById('ek-room-list');
    host.querySelectorAll('[data-room-inc]').forEach((btn) => btn.addEventListener('click', () => {
      roomDataFor(btn.dataset.roomInc).count++;
      renderRoomList(); updatePreis();
    }));
    host.querySelectorAll('[data-room-dec]').forEach((btn) => btn.addEventListener('click', () => {
      const d = roomDataFor(btn.dataset.roomDec);
      d.count = Math.max(0, d.count - 1);
      renderRoomList(); updatePreis();
    }));
    host.querySelectorAll('[data-room-remove]').forEach((btn) => btn.addEventListener('click', () => {
      state.customRooms = state.customRooms.filter((c) => c.id !== btn.dataset.roomRemove);
      renderRoomList(); updatePreis();
    }));
    host.querySelectorAll('[data-room-name]').forEach((input) => input.addEventListener('input', () => {
      const c = state.customRooms.find((c) => c.id === input.dataset.roomName);
      if (c) c.name = input.value;
      updatePreis(); // kein renderRoomList() hier - würde Cursor/Fokus im Textfeld unterbrechen
    }));
    host.querySelectorAll('[data-room-tier-group]').forEach((group) => {
      const id = group.dataset.roomTierGroup;
      group.querySelectorAll('button').forEach((btn) => btn.addEventListener('click', () => {
        roomDataFor(id).tier = btn.dataset.value;
        group.querySelectorAll('button').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        updatePreis();
      }));
    });
  }

  document.getElementById('ekBtnAddRoom').addEventListener('click', () => {
    state.customRooms.push({ id: `custom-${Date.now()}`, name: 'Eigener Raum', count: 1, tier: 'smart' });
    renderRoomList(); updatePreis();
  });

  renderRoomList();

  function updatePvBlockVisibility() {
    document.getElementById('ek-pv-block').hidden = state.pvGewuenscht !== 'ja';
  }
  updatePvBlockVisibility();

  /* ---------- Preistabellen (siehe Kopfkommentar: aus den Leistungsseiten übernommen) ---------- */
  const AUSSTATTUNG_PRO_M2 = { standard: { low: 70, high: 100 }, smart: { low: 100, high: 140 }, komplett: { low: 140, high: 200 } };
  const AUSSTATTUNG_LABEL = { standard: 'Standard', smart: 'Smart', komplett: 'Komplett' };
  const PROJEKTART_LABEL = { neubau: 'Neubau', kernsanierung: 'Kernsanierung', teilsanierung: 'Teilsanierung', anbau: 'Anbau & Aufstockung', einzelne: 'Einzelne Bereiche' };
  const GEBAEUDEART_LABEL = { efh: 'Einfamilienhaus', dhh: 'Doppelhaushälfte', rh: 'Reihenhaus', mfh: 'Mehrfamilienhaus', wohnung: 'Wohnung', gewerbe: 'Gewerbeeinheit' };
  const GARAGE_ADDON = { low: 250, high: 500, label: 'Garage / Carport – Elektroanschluss' };
  const POOL_ADDON = { low: 300, high: 700, label: 'Pool – Potentialausgleich & Absicherung' };
  const SAUNA_ADDON = { low: 300, high: 600, label: 'Sauna – eigener Stromkreis' };

  const BELEUCHTUNG_TIER = {
    klassisch: { low: 45, high: 90, menge: 0.7, label: 'Klassische Deckenanschlüsse' },
    zusatz: { low: 45, high: 90, menge: 1, label: 'Decke + einzelne Zusatzleuchten' },
    spots: { low: 90, high: 160, menge: 1, label: 'LED-Spots in ausgewählten Räumen' },
    konzept: { low: 160, high: 260, menge: 1.2, label: 'Umfangreiches Lichtkonzept' },
  };

  const PV_TIER = { standard: { low: 150, high: 250 }, speicher: { low: 250, high: 400 }, notstrom: { low: 350, high: 550 } };
  const WAERMEPUMPE_KW_ANNAHME = 10;
  const WAERMEPUMPE_TIER = { low: 140, high: 220 }; // "Zähler"-Tier von waermepumpe.html, sinnvoller Standard-Fall
  const KLIMA_TIER = {
    ein: { low: 400, high: 700, label: 'Klimaanlage – ein Innengerät' },
    mehrere: { low: 800, high: 1500, label: 'Klimaanlage – mehrere Innengeräte' },
    haus: { low: 1800, high: 3000, label: 'Klimaanlage – ganzes Haus' },
  };

  const WALLBOX_VORBEREITUNG = { low: 400, high: 800 };
  const WALLBOX_TIER = { einzel: { low: 1200, high: 2200 }, last: { low: 1800, high: 2800 }, pv: { low: 2500, high: 4000 } };

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

  // Gesamtzahl erfasster Räume (feste Typen + eigene) - Grundlage für
  // Beleuchtung/Netzwerk/Rauchwarnmelder-Mengen statt einer groben
  // Wohnflächen-Faustformel, da jetzt eine echte Raumliste vorliegt.
  function gesamtRaumAnzahl() {
    let n = 0;
    ROOM_TYPES.forEach((rt) => { n += state.rooms[rt.id].count; });
    state.customRooms.forEach((c) => { n += c.count; });
    return Math.max(1, n);
  }
  function anzahlLeuchten() { return gesamtRaumAnzahl(); }
  function anzahlDatenpunkte() { return gesamtRaumAnzahl(); }
  function anzahlRauchwarnmelder() { return gesamtRaumAnzahl(); }
  function geschaetzteKwp() { return Math.round(state.dachflaeche * 0.15 * 10) / 10; }
  // Mehr Vollgeschosse bedeuten mehr Steigleitungen/Verteiler-Strecken -
  // kleiner Aufschlag pro zusätzlichem Geschoss über dem ersten, gedeckelt.
  function geschossFaktor() {
    const n = Math.max(1, state.geschosseListe.length);
    return 1 + Math.min(n - 1, 3) * 0.08;
  }

  // Kosten der eigentlichen Elektroinstallation: Summe über alle erfassten
  // Räume (feste Typen + eigene), je Raum mit individuell wählbarem Niveau
  // (Standard/Smart/Komplett) und einer angenommenen Durchschnittsfläche -
  // ersetzt eine pauschale "Wohnfläche × ein Niveau fürs ganze Haus"-Rechnung.
  function berechneRaumKosten() {
    let low = 0, high = 0;
    ROOM_TYPES.forEach((rt) => {
      const d = state.rooms[rt.id];
      if (d.count <= 0) return;
      const tier = AUSSTATTUNG_PRO_M2[d.tier];
      const m2 = rt.avgM2 * d.count;
      low += tier.low * m2; high += tier.high * m2;
    });
    state.customRooms.forEach((c) => {
      if (c.count <= 0) return;
      const tier = AUSSTATTUNG_PRO_M2[c.tier];
      const m2 = CUSTOM_ROOM_AVG_M2 * c.count;
      low += tier.low * m2; high += tier.high * m2;
    });
    return { low, high };
  }

  /* ---------- Preisberechnung: liefert Positionen (low/high/label) + Summe ---------- */
  function berechnePositionen() {
    const positionen = [];
    const bestandZuschlag = ['kernsanierung', 'teilsanierung', 'einzelne'].includes(state.projektart) ? 1.1 : 1;

    // Elektroinstallation Wohnbereiche (Summe aus der Raumliste, siehe Schritt 2)
    const raum = berechneRaumKosten();
    positionen.push({
      label: 'Elektroinstallation Wohnbereiche',
      low: raum.low * geschossFaktor() * bestandZuschlag,
      high: raum.high * geschossFaktor() * bestandZuschlag,
    });

    // Zählerschrank / Hauptverteilung – Grunderneuerung ist bei jedem Projekt realistisch einzuplanen
    positionen.push({ label: 'Zählerschrank / Hauptverteilung erneuern', low: 1200, high: 2200 });

    // Garage / Carport
    if (state.garage !== 'keine') {
      positionen.push({ label: GARAGE_ADDON.label, low: GARAGE_ADDON.low, high: GARAGE_ADDON.high });
    }
    // Pool / Sauna (aus den zusätzlichen Außenflächen in Schritt 1)
    if (state.aussenflaechen.includes('pool')) positionen.push({ label: POOL_ADDON.label, low: POOL_ADDON.low, high: POOL_ADDON.high });
    if (state.aussenflaechen.includes('sauna')) positionen.push({ label: SAUNA_ADDON.label, low: SAUNA_ADDON.low, high: SAUNA_ADDON.high });

    // Beleuchtung
    const bel = BELEUCHTUNG_TIER[state.beleuchtung];
    const leuchten = anzahlLeuchten() * bel.menge;
    positionen.push({ label: `Beleuchtung – ${bel.label}`, low: bel.low * leuchten, high: bel.high * leuchten });

    // Photovoltaik
    if (state.pvGewuenscht === 'ja') {
      const kwp = geschaetzteKwp();
      const tierKey = state.notstrom !== 'nein' ? 'notstrom' : (state.speicher !== 'keine' ? 'speicher' : 'standard');
      const tier = PV_TIER[tierKey];
      positionen.push({ label: `Photovoltaik-Anlage (ca. ${kwp} kWp)`, low: tier.low * kwp, high: tier.high * kwp });
    }

    // Wärmepumpe
    if (state.waermepumpe !== 'nein') {
      positionen.push({
        label: 'Wärmepumpe – elektro-seitiger Anschluss',
        low: WAERMEPUMPE_TIER.low * WAERMEPUMPE_KW_ANNAHME, high: WAERMEPUMPE_TIER.high * WAERMEPUMPE_KW_ANNAHME,
      });
    }

    // Klimaanlage
    if (state.klima !== 'nein') {
      const k = KLIMA_TIER[state.klima];
      positionen.push({ label: k.label, low: k.low, high: k.high });
    }

    // Wallbox
    if (state.wallbox === 'vorbereitung') {
      positionen.push({ label: 'Wallbox – Vorbereitung (Leerrohr)', low: WALLBOX_VORBEREITUNG.low, high: WALLBOX_VORBEREITUNG.high });
    } else if (state.wallbox === 'eine') {
      const tier = WALLBOX_TIER[state.pvGewuenscht === 'ja' ? 'pv' : 'einzel'];
      positionen.push({ label: 'Wallbox (1 Stück)', low: tier.low, high: tier.high });
    } else if (state.wallbox === 'zwei') {
      const tier = WALLBOX_TIER[state.pvGewuenscht === 'ja' ? 'pv' : 'last'];
      positionen.push({ label: 'Wallbox (2 Stück, mit Lastmanagement)', low: tier.low * 2, high: tier.high * 2 });
    }

    // Netzwerk / Datenverkabelung
    const netz = NETZWERK_TIER[state.netzwerk];
    const datenpunkte = anzahlDatenpunkte();
    positionen.push({ label: netz.label, low: netz.low * datenpunkte, high: netz.high * datenpunkte });

    // Türkommunikation
    if (state.tuerkommunikation !== 'keine') {
      const t = TUERKOMM_TIER[state.tuerkommunikation];
      positionen.push({ label: t.label, low: t.low, high: t.high });
    }

    // Sicherheit & Zusatz (zu einer Sammelposition zusammengefasst)
    if (state.sicherheit.length > 0) {
      let low = 0, high = 0;
      state.sicherheit.forEach((key) => {
        const item = SICHERHEIT_ITEMS[key];
        if (!item) return;
        const menge = item.proRaum ? anzahlRauchwarnmelder() : 1;
        low += item.low * menge; high += item.high * menge;
      });
      positionen.push({ label: 'Sicherheit & Zusatz', low, high });
    }

    // Außenanlagen (zu einer Sammelposition zusammengefasst)
    if (state.aussen.length > 0) {
      let low = 0, high = 0;
      state.aussen.forEach((key) => {
        const item = AUSSEN_ITEMS[key];
        if (!item) return;
        low += item.low; high += item.high;
      });
      positionen.push({ label: 'Außenanlagen', low, high });
    }

    // Abnahme, Messung & Prüfprotokoll (DIN VDE) – bei jedem Projekt
    positionen.push({ label: 'Abnahme, Messung & Prüfprotokoll (DIN VDE)', low: 250, high: 350 });

    return positionen;
  }

  function fmtEUR(n) {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
  }

  function updatePreis() {
    const positionen = berechnePositionen();
    const grandLow = positionen.reduce((s, p) => s + p.low, 0);
    const grandHigh = positionen.reduce((s, p) => s + p.high, 0);
    document.getElementById('ekRangeMin').textContent = fmtEUR(grandLow);
    document.getElementById('ekRangeMax').textContent = fmtEUR(grandHigh);

    // Wichtigste Kostentreiber: die 5 größten Positionen (nach Mittelwert), Rest zusammengefasst
    const sortiert = [...positionen].sort((a, b) => (b.low + b.high) - (a.low + a.high));
    const top = sortiert.slice(0, 5);
    const rest = sortiert.slice(5);
    const breakdownEl = document.getElementById('ekBreakdown');
    breakdownEl.innerHTML = top.map((p) => `<li><span>${p.label}</span><span>${fmtEUR(p.low)} – ${fmtEUR(p.high)}</span></li>`).join('')
      + (rest.length ? `<li><span>Weitere Positionen (${rest.length})</span><span>${fmtEUR(rest.reduce((s, p) => s + p.low, 0))} – ${fmtEUR(rest.reduce((s, p) => s + p.high, 0))}</span></li>` : '');

    // "Bereits berücksichtigt"
    const annahmen = [
      `${PROJEKTART_LABEL[state.projektart]} · ${GEBAEUDEART_LABEL[state.gebaeudeart]}`,
      `${state.wohnflaeche} m² Wohnfläche · ${state.geschosseListe.length} Vollgeschoss(e)`,
      `${gesamtRaumAnzahl()} Räume erfasst`,
      `Beleuchtung: ${BELEUCHTUNG_TIER[state.beleuchtung].label}`,
    ];
    if (state.pvGewuenscht === 'ja') annahmen.push(`Photovoltaik (ca. ${geschaetzteKwp()} kWp)${state.speicher !== 'keine' ? ' mit Speicher' : ''}`);
    if (state.waermepumpe !== 'nein') annahmen.push('Wärmepumpen-Anschluss');
    if (state.klima !== 'nein') annahmen.push('Klimaanlagen-Anschluss');
    if (state.wallbox !== 'keine') annahmen.push(`Wallbox: ${state.wallbox === 'vorbereitung' ? 'Vorbereitung' : (state.wallbox === 'eine' ? '1 Stück' : '2 Stück')}`);
    if (state.garage !== 'keine') annahmen.push('Garage/Carport-Anschluss');
    document.getElementById('ekAssumptions').innerHTML = annahmen.map((a) => `<li>${a}</li>`).join('');

    document.getElementById('ekOffenDach').hidden = state.pvGewuenscht !== 'ja';

    // Unsicherheits-Badge/Hinweistext je nach offenen Punkten
    const unsicher = state.projektart !== 'neubau' || (state.pvGewuenscht === 'ja' && state.dachzugang !== 'gut');
    const noteEl = document.getElementById('ekAmpelNote');
    noteEl.textContent = unsicher
      ? 'Grober Richtwert mit größerer Spanne, da einige Angaben (z.B. Bestandsinstallation oder Dachzugang) erst vor Ort final geklärt werden können.'
      : 'Grober Richtwert — kein verbindliches Angebot. Die finale Kalkulation erfolgt nach Besichtigung vor Ort.';

    return { grandLow, grandHigh, positionen };
  }

  /* ---------- Absenden ---------- */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }

    const submitBtn = btnSubmit;
    const originalLabel = submitBtn.textContent;
    const status = document.getElementById('ekFormStatus');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Wird gesendet …';
    status.textContent = '';
    status.className = 'form-status';

    const { grandLow, grandHigh, positionen } = updatePreis();
    const payload = {
      modul: 'elektro-komplett',
      antworten: { ...state, geschaetzteKwp: state.pvGewuenscht === 'ja' ? geschaetzteKwp() : null },
      positionen: positionen.map((p) => ({ label: p.label, von: Math.round(p.low), bis: Math.round(p.high) })),
      kostenspanne: { von: Math.round(grandLow), bis: Math.round(grandHigh) },
      kontakt: {
        vorname: document.getElementById('ek-vorname').value.trim(),
        nachname: document.getElementById('ek-nachname').value.trim(),
        email: document.getElementById('ek-email').value.trim(),
        telefon: document.getElementById('ek-telefon').value.trim(),
        plz: document.getElementById('ek-plz').value.trim(),
        ort: document.getElementById('ek-ort').value.trim(),
        nachricht: document.getElementById('ek-nachricht').value.trim(),
      },
      datenschutzEinwilligung: document.getElementById('ek-datenschutz').checked,
      // Anti-Spam: Honeypot muss leer bleiben, echte Menschen brauchen länger als ein paar Sekunden
      website: document.getElementById('ek-website').value,
      ladezeitMs: Date.now() - pageLoadedAt,
    };

    try {
      const res = await fetch(EK_WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        status.textContent = 'Danke — Ihre Anfrage ist angekommen. Rückmeldung folgt in Kürze.';
        status.classList.add('ok');
        if (typeof trackEvent === 'function') trackEvent('generate_lead', { method: 'kostenrechner_elektro_komplett' });
        form.reset();
        showStep(1);
      } else {
        throw new Error('send-failed');
      }
    } catch (err) {
      status.textContent = 'Senden hat nicht geklappt. Bitte per E-Mail an neuverdrahtet@gmail.com oder telefonisch.';
      status.classList.add('err');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
  });

  showStep(initialStepFromUrl());
})();
