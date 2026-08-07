/* =========================================================
   Wallbox-Kostenschätzer — mehrstufiger Assistent
   Plain JS, kein Modul/Build-Schritt (wie assets/script.js).
   ========================================================= */

const KS_WORKER_URL = 'https://neuverdrahtetworkersdevworkersdev.neuverdrahtetworkersdev.workers.dev';

(() => {
  const form = document.getElementById('ksForm');
  if (!form) return; // Script wird nur auf der Kostenschätzer-Seite eingebunden

  const steps = Array.from(form.querySelectorAll('.wizard-step'));
  const progressEl = document.getElementById('wizardProgress');
  const btnBack = document.getElementById('ksBtnBack');
  const btnNext = document.getElementById('ksBtnNext');
  const btnSubmit = document.getElementById('ksBtnSubmit');
  const pageLoadedAt = Date.now();

  let current = 1;
  const totalSteps = steps.length;

  const state = {
    nutzung: 'privat', anzahlLadepunkte: 1,
    stellplatz: 'garage', entfernungM: null, entfernungUnbekannt: false, erdarbeiten: 'nein',
    leistung: '11kw', lastmanagement: false, pvUeberschuss: false,
    zaehlerschrankAlter: 'neu', freierPlatz: 'ja', photovoltaikVorhanden: false,
    objektart: 'efh', zeitraum: 'sofort', plz: '', ort: '',
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
    if (current === totalSteps - 1) updatePreis(); // Zusammenfassungs-Schritt: Preis aktualisieren
    renderProgress();
    form.closest('.wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function stepIsValid(n) {
    if (n === totalSteps - 1) return document.getElementById('ks-hinweis-bestaetigt').checked;
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
    const status = document.getElementById('ksFormStatus');
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
      });
    });
  });

  const ladepunkteInput = document.getElementById('ks-ladepunkte');
  const ladepunkteVal = document.getElementById('ks-ladepunkte-val');
  ladepunkteInput.addEventListener('input', () => {
    state.anzahlLadepunkte = Number(ladepunkteInput.value);
    ladepunkteVal.textContent = `${state.anzahlLadepunkte} Ladepunkt${state.anzahlLadepunkte === 1 ? '' : 'e'}`;
  });

  const entfernungInput = document.getElementById('ks-entfernung');
  const entfernungUnbekannt = document.getElementById('ks-entfernung-unbekannt');
  entfernungInput.addEventListener('input', () => { state.entfernungM = entfernungInput.value ? Number(entfernungInput.value) : null; });
  entfernungUnbekannt.addEventListener('change', () => {
    state.entfernungUnbekannt = entfernungUnbekannt.checked;
    entfernungInput.disabled = entfernungUnbekannt.checked;
    if (entfernungUnbekannt.checked) { entfernungInput.value = ''; state.entfernungM = null; }
  });

  document.getElementById('ks-lastmanagement').addEventListener('change', (e) => { state.lastmanagement = e.target.checked; });
  document.getElementById('ks-pv').addEventListener('change', (e) => { state.pvUeberschuss = e.target.checked; });
  document.getElementById('ks-pv-vorhanden').addEventListener('change', (e) => { state.photovoltaikVorhanden = e.target.checked; });
  document.getElementById('ks-plz').addEventListener('input', (e) => { state.plz = e.target.value.trim(); });
  document.getElementById('ks-ort').addEventListener('input', (e) => { state.ort = e.target.value.trim(); });

  /* ---------- Preisberechnung ---------- */
  const BASIS_PRO_LADEPUNKT = {
    '11kw': { low: 1200, high: 2200 },
    '22kw': { low: 1600, high: 2600 },
    offen: { low: 1200, high: 2600 },
  };
  const LEITUNGSWEG_FREI_M = 10;
  const LEITUNGSWEG_ZUSCHLAG = { low: 15, high: 25 }; // € pro Meter über dem Freibetrag

  function berechneKostenspanne() {
    const basis = BASIS_PRO_LADEPUNKT[state.leistung] || BASIS_PRO_LADEPUNKT.offen;
    let low = basis.low * state.anzahlLadepunkte;
    let high = basis.high * state.anzahlLadepunkte;

    if (state.lastmanagement || state.anzahlLadepunkte >= 2) { low += 400; high += 900; }
    if (state.pvUeberschuss) { low += 600; high += 1200; }
    if (state.erdarbeiten === 'ja') { low += 300; high += 800; }
    if (state.stellplatz === 'tiefgarage' || state.stellplatz === 'mfh') { low += 200; high += 500; }

    if (!state.entfernungUnbekannt && state.entfernungM != null && state.entfernungM > LEITUNGSWEG_FREI_M) {
      const meterUeber = state.entfernungM - LEITUNGSWEG_FREI_M;
      low += meterUeber * LEITUNGSWEG_ZUSCHLAG.low;
      high += meterUeber * LEITUNGSWEG_ZUSCHLAG.high;
    }

    const zaehlerschrankUnklar = state.zaehlerschrankAlter === 'alt' || state.zaehlerschrankAlter === 'unbekannt' || state.freierPlatz !== 'ja';
    if (zaehlerschrankUnklar) { low += 300; high += 900; }

    if (state.nutzung === 'gewerblich') { low *= 1.1; high *= 1.1; }

    const unsicher = state.entfernungUnbekannt || state.erdarbeiten === 'unbekannt' || zaehlerschrankUnklar;
    const ampel = unsicher ? 'gelb' : 'gruen';
    const spannenFaktor = unsicher ? 0.2 : 0.1;
    low = Math.round((low * (1 - spannenFaktor)) / 50) * 50;
    high = Math.round((high * (1 + spannenFaktor)) / 50) * 50;

    return { low, high, ampel };
  }

  function fmtEUR(n) {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
  }

  function updatePreis() {
    const { low, high, ampel } = berechneKostenspanne();
    document.getElementById('ksRangeMin').textContent = fmtEUR(low);
    document.getElementById('ksRangeMax').textContent = fmtEUR(high);
    const labelEl = document.getElementById('ksAmpelLabel');
    const noteEl = document.getElementById('ksAmpelNote');
    const box = document.getElementById('ksResultBox');
    box.classList.remove('is-ampel-gruen', 'is-ampel-gelb');
    box.classList.add(ampel === 'gruen' ? 'is-ampel-gruen' : 'is-ampel-gelb');
    labelEl.textContent = ampel === 'gruen' ? 'Kostenspanne · gute Datenlage' : 'Kostenspanne · noch offene Punkte';
    noteEl.textContent = ampel === 'gruen'
      ? 'Grober Richtwert — kein verbindliches Angebot.'
      : 'Grober Richtwert mit größerer Spanne, da einige Angaben noch unklar sind (z.B. Zählerschrank oder Leitungsweg) — vor Ort lässt sich das genauer bestimmen.';
  }

  /* ---------- Absenden ---------- */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }

    const submitBtn = btnSubmit;
    const originalLabel = submitBtn.textContent;
    const status = document.getElementById('ksFormStatus');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Wird gesendet …';
    status.textContent = '';
    status.className = 'form-status';

    const { low, high, ampel } = berechneKostenspanne();
    const payload = {
      modul: 'wallbox',
      antworten: { ...state },
      kostenspanne: { von: low, bis: high, ampel },
      kontakt: {
        vorname: document.getElementById('ks-vorname').value.trim(),
        nachname: document.getElementById('ks-nachname').value.trim(),
        email: document.getElementById('ks-email').value.trim(),
        telefon: document.getElementById('ks-telefon').value.trim(),
        nachricht: document.getElementById('ks-nachricht').value.trim(),
      },
      datenschutzEinwilligung: document.getElementById('ks-datenschutz').checked,
      // Anti-Spam: Honeypot muss leer bleiben, echte Menschen brauchen länger als ein paar Sekunden
      website: document.getElementById('ks-website').value,
      ladezeitMs: Date.now() - pageLoadedAt,
    };

    try {
      const res = await fetch(KS_WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        status.textContent = 'Danke — Ihre Anfrage ist angekommen. Rückmeldung folgt in Kürze.';
        status.classList.add('ok');
        if (typeof trackEvent === 'function') trackEvent('generate_lead', { method: 'kostenschaetzer_wallbox' });
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
