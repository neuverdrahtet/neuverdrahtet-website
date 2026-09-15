/* =========================================================
   Wallbox-Kostenschätzer — eigenständiger, schlanker Wallbox-Assistent
   Plain JS, kein Modul/Build-Schritt (wie assets/script.js).

   Anders als der große Elektro-Kostenrechner (assets/elektro-konfigurator.js)
   deckt dieser Assistent AUSSCHLIESSLICH Wallbox ab, dafür mit denselben
   Detailfragen (Stellplatz, Entfernung, Anforderungen, Erdungssystem ...)
   in nur 4 statt 8 Schritten - inklusive eines eigenen Foto-Upload-Schritts.
   Die Preistabellen sind bewusst 1:1 aus elektro-konfigurator.js übernommen
   (kein gemeinsames Modul, da dieses Projekt ohne Build-Schritt auskommt),
   damit die Zahlen sitenweit konsistent bleiben.

   Sendet zwei unabhängige, sich nicht gegenseitig blockierende Anfragen:
   1. Die strukturierten Antworten + Kostenspanne als JSON an denselben
      Worker wie der große Rechner (cloudflare-worker-kostenschaetzer) -
      dessen bereits bestehender "alter Wallbox-Fragebogen"-Zweig (kein
      "modul"-Feld) erwartet genau dieses Payload-Format und legt daraus
      Kunde+Projekt in der Werkora-Lead-Pipeline an.
   2. Optional, nur falls Fotos ausgewählt wurden: ein zusätzlicher
      multipart/form-data-Request an Formspree (dasselbe Konto wie alle
      anderen Kontaktformulare der Website) mit den Foto-Anhängen - der
      Worker selbst kann keine Dateien entgegennehmen/speichern.
   ========================================================= */

const WB_WORKER_URL = 'https://neuverdrahtetworkersdevworkersdev.neuverdrahtetworkersdev.workers.dev';
const WB_FORMSPREE_URL = 'https://formspree.io/f/mvzverea';

(() => {
  const form = document.getElementById('wbForm');
  if (!form) return; // Script wird nur auf dieser Seite eingebunden

  const steps = Array.from(form.querySelectorAll('.wizard-step'));
  const progressEl = document.getElementById('wbProgress');
  const btnBack = document.getElementById('wbBtnBack');
  const btnNext = document.getElementById('wbBtnNext');
  const btnSubmit = document.getElementById('wbBtnSubmit');
  const pageLoadedAt = Date.now();

  let current = 1;
  const totalSteps = steps.length;

  const state = {
    nutzung: 'privat', objektart: 'efh', anzahlLadepunkte: 1,
    stellplatz: 'garage', entfernungM: 10, entfernungUnbekannt: false,
    leistung: '11kw', erdarbeiten: 'unbekannt', leitungVorhanden: 'unbekannt',
    zaehlerschrankAlter: 'unbekannt', freierPlatz: 'unbekannt', photovoltaikVorhanden: 'nein',
    wallboxAnforderungen: [], erdungssystem: 'unbekannt', zeitraum: '3monate',
  };

  /* ---------- Fortschrittsanzeige + Schritt-Navigation (1:1 wie elektro-konfigurator.js) ---------- */
  function renderProgress() {
    progressEl.innerHTML = Array.from({ length: totalSteps }, (_, i) => {
      const n = i + 1;
      const cls = n === current ? 'is-active' : (n < current ? 'is-done' : '');
      return `<span class="wizard-dot ${cls}"></span>`;
    }).join('');
  }

  function showStep(n) {
    current = n;
    steps.forEach((step) => { step.hidden = Number(step.dataset.step) !== current; });
    btnBack.hidden = current === 1;
    const isLast = current === totalSteps;
    btnNext.hidden = isLast;
    btnSubmit.hidden = !isLast;
    if (current === 3) updatePreis();
    renderProgress();
    form.closest('.wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function stepIsValid(n) {
    if (n === totalSteps - 1) return document.getElementById('wb-hinweis-bestaetigt').checked;
    return true;
  }

  function toastHinweis(msg) {
    const status = document.getElementById('wbFormStatus');
    if (status) { status.textContent = msg; status.className = 'form-status err'; }
  }

  btnNext.addEventListener('click', () => {
    if (!stepIsValid(current)) {
      toastHinweis('Bitte bestätigen Sie den Hinweis, bevor Sie fortfahren.');
      return;
    }
    if (current < totalSteps) showStep(current + 1);
  });
  btnBack.addEventListener('click', () => { if (current > 1) showStep(current - 1); });

  /* ---------- Eingaben verdrahten (1:1 Muster aus elektro-konfigurator.js) ---------- */
  form.querySelectorAll('.calc-toggle[data-field]').forEach((group) => {
    const field = group.dataset.field;
    group.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        group.querySelectorAll('button').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        state[field] = btn.dataset.value;
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

  function wireSlider(inputId, valId, stateKey, suffixFn) {
    const input = document.getElementById(inputId);
    const val = document.getElementById(valId);
    input.addEventListener('input', () => {
      state[stateKey] = Number(input.value);
      val.textContent = suffixFn(state[stateKey]);
      updatePreis();
    });
  }
  wireSlider('wb-anzahl', 'wb-anzahl-val', 'anzahlLadepunkte', (n) => `${n} Ladepunkt${n > 1 ? 'e' : ''}`);
  wireSlider('wb-entfernung', 'wb-entfernung-val', 'entfernungM', (n) => `${n} m`);

  const entfernungUnbekanntCb = document.getElementById('wb-entfernung-unbekannt');
  entfernungUnbekanntCb.addEventListener('change', () => {
    state.entfernungUnbekannt = entfernungUnbekanntCb.checked;
    document.getElementById('wb-entfernung').disabled = state.entfernungUnbekannt;
    updatePreis();
  });

  /* ---------- Foto-Upload: mehrere unabhängige Dropzones mit Vorschau ---------- */
  // assets/script.js' Dropzone-Logik greift nur je EINEN Dropzone pro
  // .calc-panel (für die einzelnen Leistungsseiten-Rechner ausreichend) -
  // diese Seite hat aber fünf Upload-Felder in einem einzigen Formular,
  // daher hier eine eigene, auf alle .dropzone-Elemente angewandte Wiring.
  form.querySelectorAll('.dropzone').forEach((dropzone) => {
    const fileInput = dropzone.querySelector('input[type="file"]');
    const field = dropzone.closest('.calc-field');
    const previewGrid = field?.querySelector('.preview-grid');
    const previewWrap = field?.querySelector('.preview-wrap');
    if (!fileInput) return;

    function renderPreviews() {
      if (!previewGrid) return;
      previewGrid.innerHTML = '';
      const files = Array.from(fileInput.files || []);
      files.slice(0, 12).forEach((file) => {
        if (!file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = () => {
          const img = document.createElement('img');
          img.src = reader.result;
          img.alt = file.name;
          previewGrid.appendChild(img);
        };
        reader.readAsDataURL(file);
      });
      if (previewWrap) previewWrap.classList.toggle('is-visible', files.length > 0);
    }

    ['dragenter', 'dragover'].forEach((evt) => dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add('is-drag');
    }));
    ['dragleave', 'drop'].forEach((evt) => dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove('is-drag');
    }));
    dropzone.addEventListener('drop', (e) => {
      if (e.dataTransfer?.files?.length) {
        fileInput.files = e.dataTransfer.files;
        renderPreviews();
      }
    });
    fileInput.addEventListener('change', renderPreviews);
  });

  /* ---------- Preistabellen (1:1 aus assets/elektro-konfigurator.js übernommen) ---------- */
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

  function fmtEUR(n) {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
  }

  function berechnePositionen() {
    const positionen = [{
      label: `Wallbox (${state.anzahlLadepunkte} Ladepunkt${state.anzahlLadepunkte > 1 ? 'e' : ''})`,
      low: WALLBOX_EINZEL.low * state.anzahlLadepunkte,
      high: WALLBOX_EINZEL.high * state.anzahlLadepunkte,
    }];
    const anforderungen = new Set(state.wallboxAnforderungen);
    // Bei mehreren Ladepunkten an einem Hausanschluss ist Lastmanagement in
    // der Praxis so gut wie immer vorgeschrieben (Anschlussleistung).
    if (state.anzahlLadepunkte >= 2) anforderungen.add('lastmanagement');
    anforderungen.forEach((key) => {
      const addon = WALLBOX_ADDON[key];
      if (addon) positionen.push({ label: addon.label, low: addon.low, high: addon.high });
    });
    if (state.erdarbeiten === 'ja') {
      positionen.push({ label: 'Tiefbauarbeiten', low: WALLBOX_ERDARBEITEN.low, high: WALLBOX_ERDARBEITEN.high });
    }
    if (!state.entfernungUnbekannt) {
      const mehr = Math.max(0, state.entfernungM - WALLBOX_ENTFERNUNG_FREI_M);
      if (mehr > 0) {
        positionen.push({
          label: `Zusätzlicher Kabelweg (${mehr} m über ${WALLBOX_ENTFERNUNG_FREI_M} m hinaus)`,
          low: mehr * WALLBOX_ENTFERNUNG_PRO_M.low,
          high: mehr * WALLBOX_ENTFERNUNG_PRO_M.high,
        });
      }
    }
    return positionen;
  }

  const LABELS = {
    stellplatz: { garage: 'Garage', carport: 'Carport', aussen: 'Außenstellplatz', tiefgarage: 'Tiefgarage', mfh: 'Mehrfamilienhaus' },
    leistung: { '11kw': '11 kW', '22kw': '22 kW', offen: 'Noch offen' },
  };

  function updatePreis() {
    const positionen = berechnePositionen();
    const grandLow = positionen.reduce((s, p) => s + p.low, 0);
    const grandHigh = positionen.reduce((s, p) => s + p.high, 0);
    document.getElementById('wbRangeMin').textContent = fmtEUR(grandLow);
    document.getElementById('wbRangeMax').textContent = fmtEUR(grandHigh);
    document.getElementById('wbBreakdown').innerHTML = positionen
      .map((p) => `<li><span>${p.label}</span><span>${fmtEUR(p.low)} – ${fmtEUR(p.high)}</span></li>`)
      .join('');

    const annahmen = [
      `${state.anzahlLadepunkte} Ladepunkt${state.anzahlLadepunkte > 1 ? 'e' : ''} · ${LABELS.stellplatz[state.stellplatz]}`,
      `Ladeleistung: ${LABELS.leistung[state.leistung]}`,
      `Entfernung zum Zählerschrank: ${state.entfernungUnbekannt ? 'noch unbekannt' : state.entfernungM + ' m'}`,
    ];
    if (state.wallboxAnforderungen.length) {
      annahmen.push(`Zusatzanforderungen: ${state.wallboxAnforderungen.map((k) => WALLBOX_ADDON[k]?.label).filter(Boolean).join(', ')}`);
    }
    document.getElementById('wbAssumptions').innerHTML = annahmen.map((a) => `<li>${a}</li>`).join('');

    const unklar = state.entfernungUnbekannt || state.erdarbeiten === 'unbekannt' || state.zaehlerschrankAlter === 'unbekannt' || state.freierPlatz === 'unbekannt';
    const noteEl = document.getElementById('wbAmpelNote');
    noteEl.textContent = unklar
      ? 'Grober Richtwert mit größerer Spanne, da einige Angaben (z.B. Entfernung oder Zählerschrank-Zustand) erst vor Ort final geklärt werden können.'
      : 'Grober Richtwert — kein verbindliches Angebot. Die finale Kalkulation erfolgt nach Besichtigung vor Ort.';

    return { grandLow, grandHigh, positionen, unklar };
  }
  updatePreis();

  /* ---------- Absenden: JSON-Lead (immer) + Formspree mit Fotos (nur falls vorhanden) ---------- */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!stepIsValid(totalSteps - 1)) {
      toastHinweis('Bitte bestätigen Sie den Hinweis auf der vorherigen Seite.');
      return;
    }
    const status = document.getElementById('wbFormStatus');
    const submitBtn = btnSubmit;
    const originalLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Wird gesendet …';
    status.textContent = '';
    status.className = 'form-status';

    const { grandLow, grandHigh, unklar } = updatePreis();
    const vorname = document.getElementById('wb-vorname').value.trim();
    const nachname = document.getElementById('wb-nachname').value.trim();
    const email = document.getElementById('wb-email').value.trim();
    const telefon = document.getElementById('wb-telefon').value.trim();
    const plz = document.getElementById('wb-plz').value.trim();
    const ort = document.getElementById('wb-ort').value.trim();
    const nachricht = document.getElementById('wb-nachricht').value.trim();

    const anforderungen = new Set(state.wallboxAnforderungen);
    if (state.anzahlLadepunkte >= 2) anforderungen.add('lastmanagement');

    const payload = {
      kontakt: { vorname, nachname, email, telefon, plz, ort, nachricht },
      antworten: {
        ...state,
        lastmanagement: anforderungen.has('lastmanagement'),
        pvUeberschuss: anforderungen.has('pv_ueberschuss'),
        // photovoltaikVorhanden ist im state ein Toggle-String ("ja"/"nein") wie
        // alle anderen Felder, buildBeschreibung() im Worker erwartet dafür aber
        // einen echten Boolean (sonst wäre auch der String "nein" wahr).
        photovoltaikVorhanden: state.photovoltaikVorhanden === 'ja',
        leitungVorhanden: state.leitungVorhanden,
        erdungssystem: state.erdungssystem,
        wallboxWunschmodell: document.getElementById('wb-wunsch').value.trim(),
      },
      kostenspanne: { von: grandLow, bis: grandHigh, ampel: unklar ? 'gelb' : 'gruen' },
      datenschutzEinwilligung: document.getElementById('wb-datenschutz').checked,
      website: document.getElementById('wb-website').value,
      ladezeitMs: Date.now() - pageLoadedAt,
    };

    try {
      const res = await fetch(WB_WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('send-failed');

      status.textContent = 'Danke — Ihre Anfrage ist angekommen. Rückmeldung folgt in Kürze.';
      status.classList.add('ok');
      if (typeof trackEvent === 'function') trackEvent('generate_lead', { method: 'wallbox_kostenschaetzer' });

      // Fotos sind optional und laufen bewusst über einen zweiten,
      // unabhängigen Request an Formspree - der Worker oben speichert
      // keine Dateien. Ein Fehlschlag hier lässt die bereits erfolgreich
      // angelegte Werkora-Lead-Anfrage unangetastet (additive Best-Effort-
      // Philosophie, wie überall sonst auf der Website).
      const dateiFelder = Array.from(form.querySelectorAll('input[type="file"]')).filter((i) => i.files.length);
      if (dateiFelder.length) {
        try {
          const fd = new FormData();
          fd.append('name', `${vorname} ${nachname}`.trim());
          fd.append('email', email);
          fd.append('phone', telefon);
          fd.append('service', 'Wallbox-Kostenschätzer (mit Fotos)');
          fd.append('message', `${nachricht}\n\n--- Technische Angaben ---\n${JSON.stringify(payload.antworten, null, 2)}`);
          dateiFelder.forEach((input) => {
            Array.from(input.files).forEach((file) => fd.append(input.name || input.id, file));
          });
          await fetch(WB_FORMSPREE_URL, { method: 'POST', body: fd, headers: { Accept: 'application/json' } });
        } catch (err) {
          console.warn('neuverdrahtet: Foto-Versand an Formspree fehlgeschlagen (Lead-Anlage ist davon unabhängig):', err);
        }
      }

      form.reset();
      state.wallboxAnforderungen = [];
      state.entfernungUnbekannt = false;
      form.querySelectorAll('.preview-grid').forEach((g) => { g.innerHTML = ''; });
      form.querySelectorAll('.preview-wrap').forEach((w) => w.classList.remove('is-visible'));
      showStep(1);
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
