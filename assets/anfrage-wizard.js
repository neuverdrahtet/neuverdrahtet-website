/* Mehrstufiger Anfrage-Assistent (Leistung → Einsatzort → Details & Termin →
   Kontakt → Prüfen). Baut auf der bestehenden .ajax-form-Logik in script.js auf:
   dieses Skript steuert nur die Schritt-Anzeige/Validierung, das eigentliche
   Absenden (Formspree + Werkora-Lead) übernimmt weiterhin script.js unverändert. */
(function () {
  var PLZ_RANGES = [[45117,45359],[45468,45481],[45879,45899],[46045,46149],[46236,46244],[44787,44894],[47051,47279]];
  function plzCovered(plz) {
    for (var i = 0; i < PLZ_RANGES.length; i++) { if (plz >= PLZ_RANGES[i][0] && plz <= PLZ_RANGES[i][1]) return true; }
    return false;
  }

  // Welche Zusatzfelder-Gruppe (data-service-group) zu welchem service-Wert gehört.
  var SERVICE_GROUPS = {
    'DGUV / Prüftechnik': 'pruefung',
    'Wärmepumpe': 'waermepumpe',
    'Klimaanlage': 'waermepumpe',
    'Wallbox': 'wallbox',
  };

  document.querySelectorAll('.wizard').forEach(function (form) {
    var steps = Array.prototype.slice.call(form.querySelectorAll('.wizard-step'));
    if (!steps.length) return;
    var total = steps.length;
    var current = 1;
    var progress = form.closest('section')?.querySelector('.wizard-progress') || form.querySelector('.wizard-progress');
    var btnBack = form.querySelector('[data-wizard-back]');
    var btnNext = form.querySelector('[data-wizard-next]');
    var btnSubmit = form.querySelector('button[type="submit"]');
    var serviceSelect = form.querySelector('select[name="service"]');
    var summaryBox = form.querySelector('[data-wizard-summary]');

    function buildProgress() {
      if (!progress) return;
      progress.innerHTML = '';
      for (var i = 1; i <= total; i++) {
        var dot = document.createElement('span');
        dot.className = 'wizard-dot';
        progress.appendChild(dot);
      }
    }

    function updateProgress() {
      if (!progress) return;
      var dots = progress.querySelectorAll('.wizard-dot');
      dots.forEach(function (dot, idx) {
        dot.classList.toggle('is-active', idx + 1 === current);
        dot.classList.toggle('is-done', idx + 1 < current);
      });
    }

    function showStep(n) {
      current = n;
      steps.forEach(function (step) {
        step.hidden = parseInt(step.dataset.step, 10) !== current;
      });
      updateProgress();
      if (btnBack) btnBack.hidden = current === 1;
      if (btnNext) btnNext.hidden = current === total;
      if (btnSubmit) btnSubmit.hidden = current !== total;
      if (current === total) renderSummary();
      form.closest('section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function currentStepEl() {
      return steps.filter(function (s) { return parseInt(s.dataset.step, 10) === current; })[0];
    }

    function validateCurrentStep() {
      var step = currentStepEl();
      if (!step) return true;
      var fields = step.querySelectorAll('input, select, textarea');
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        if (f.offsetParent === null) continue; // ausgeblendete (data-service-group) Felder nicht prüfen
        if (!f.checkValidity()) { f.reportValidity(); return false; }
      }
      return true;
    }

    function updateServiceGroups() {
      if (!serviceSelect) return;
      var group = SERVICE_GROUPS[serviceSelect.value] || '';
      form.querySelectorAll('[data-service-group]').forEach(function (el) {
        el.hidden = el.dataset.serviceGroup !== group;
      });
    }

    function updatePlzHint() {
      var plzInput = form.querySelector('input[name="plz"]');
      var hint = form.querySelector('[data-plz-hint]');
      if (!plzInput || !hint) return;
      var raw = (plzInput.value || '').trim();
      if (!/^\d{5}$/.test(raw)) { hint.textContent = ''; return; }
      var plz = parseInt(raw, 10);
      if (plzCovered(plz)) {
        hint.textContent = raw + ' liegt in unserem Einsatzgebiet.';
        hint.className = 'plz-check-result plz-check-ok';
      } else {
        hint.textContent = raw + ' liegt außerhalb unseres üblichen Gebiets — gerne trotzdem anfragen.';
        hint.className = 'plz-check-result plz-check-warn';
      }
    }

    function renderSummary() {
      if (!summaryBox) return;
      var data = new FormData(form);
      var rows = [
        ['Leistung', data.get('service')],
        ['Adresse', [data.get('strasse'), data.get('plz'), data.get('ort')].filter(Boolean).join(', ')],
        ['Wunschtermin', data.get('termin')],
        ['Beschreibung', data.get('message')],
        ['Firma', data.get('firma')],
        ['Ansprechpartner', data.get('name')],
        ['Telefon', data.get('phone')],
        ['E-Mail', data.get('email')],
      ];
      var fileInput = form.querySelector('input[name="attachment"]');
      if (fileInput && fileInput.files && fileInput.files.length) {
        rows.push(['Dateien', fileInput.files.length + ' Datei(en) ausgewählt']);
      }
      summaryBox.innerHTML = rows.filter(function (r) { return r[1]; }).map(function (r) {
        return '<div class="wizard-summary-row"><span>' + r[0] + '</span><strong></strong></div>'
          .replace('<strong></strong>', '<strong>' + String(r[1]).replace(/</g, '&lt;') + '</strong>');
      }).join('');
    }

    buildProgress();
    showStep(1);
    updateServiceGroups();

    if (serviceSelect) serviceSelect.addEventListener('change', updateServiceGroups);
    var plzInput = form.querySelector('input[name="plz"]');
    if (plzInput) plzInput.addEventListener('input', updatePlzHint);

    if (btnNext) btnNext.addEventListener('click', function () {
      if (!validateCurrentStep()) return;
      if (current < total) showStep(current + 1);
    });
    if (btnBack) btnBack.addEventListener('click', function () {
      if (current > 1) showStep(current - 1);
    });

    form.addEventListener('submit', function (e) {
      if (!validateCurrentStep()) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
  });
})();
