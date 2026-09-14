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

  const state = {
    gebaeudeart: 'neubau', wohnflaeche: 130, geschosse: '2', ausstattung: 'smart',
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

  function updatePvBlockVisibility() {
    document.getElementById('ek-pv-block').hidden = state.pvGewuenscht !== 'ja';
  }
  updatePvBlockVisibility();

  /* ---------- Preistabellen (siehe Kopfkommentar: aus den Leistungsseiten übernommen) ---------- */
  const AUSSTATTUNG_PRO_M2 = { standard: { low: 70, high: 100 }, smart: { low: 100, high: 140 }, komplett: { low: 140, high: 200 } };
  const GESCHOSS_FAKTOR = { '1': 1.0, '2': 1.08, '3': 1.15 };
  const AUSSTATTUNG_LABEL = { standard: 'Standard', smart: 'Smart', komplett: 'Komplett' };

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

  function anzahlLeuchten() { return Math.max(4, Math.round(state.wohnflaeche / 15)); }
  function anzahlDatenpunkte() { return Math.max(3, Math.round(state.wohnflaeche / 20)); }
  function anzahlRauchwarnmelder() { return Math.max(3, Math.round(state.wohnflaeche / 25)); }
  function geschaetzteKwp() { return Math.round(state.dachflaeche * 0.15 * 10) / 10; }

  /* ---------- Preisberechnung: liefert Positionen (low/high/label) + Summe ---------- */
  function berechnePositionen() {
    const positionen = [];
    const geschossFaktor = GESCHOSS_FAKTOR[state.geschosse] || 1;
    const bestandZuschlag = state.gebaeudeart === 'bestand' ? 1.1 : 1;

    // Elektroinstallation Wohnbereiche
    const ausst = AUSSTATTUNG_PRO_M2[state.ausstattung];
    positionen.push({
      label: 'Elektroinstallation Wohnbereiche',
      low: ausst.low * state.wohnflaeche * geschossFaktor * bestandZuschlag,
      high: ausst.high * state.wohnflaeche * geschossFaktor * bestandZuschlag,
    });

    // Zählerschrank / Hauptverteilung – Grunderneuerung ist bei jedem Projekt realistisch einzuplanen
    positionen.push({ label: 'Zählerschrank / Hauptverteilung erneuern', low: 1200, high: 2200 });

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
      `${state.gebaeudeart === 'neubau' ? 'Neubau' : 'Bestand / Sanierung'}`,
      `${state.wohnflaeche} m² Wohnfläche · ${state.geschosse} Geschoss(e)`,
      `Ausstattung: ${AUSSTATTUNG_LABEL[state.ausstattung]}`,
      `Beleuchtung: ${BELEUCHTUNG_TIER[state.beleuchtung].label}`,
    ];
    if (state.pvGewuenscht === 'ja') annahmen.push(`Photovoltaik (ca. ${geschaetzteKwp()} kWp)${state.speicher !== 'keine' ? ' mit Speicher' : ''}`);
    if (state.waermepumpe !== 'nein') annahmen.push('Wärmepumpen-Anschluss');
    if (state.klima !== 'nein') annahmen.push('Klimaanlagen-Anschluss');
    if (state.wallbox !== 'keine') annahmen.push(`Wallbox: ${state.wallbox === 'vorbereitung' ? 'Vorbereitung' : (state.wallbox === 'eine' ? '1 Stück' : '2 Stück')}`);
    document.getElementById('ekAssumptions').innerHTML = annahmen.map((a) => `<li>${a}</li>`).join('');

    document.getElementById('ekOffenDach').hidden = state.pvGewuenscht !== 'ja';

    // Unsicherheits-Badge/Hinweistext je nach offenen Punkten
    const unsicher = state.gebaeudeart === 'bestand' || (state.pvGewuenscht === 'ja' && state.dachzugang !== 'gut');
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

  showStep(1);
})();
