/* =========================================================
   Mobile nav drawer
   ========================================================= */
const navToggle = document.getElementById('navToggle');
const mobileClose = document.getElementById('mobileClose');
const mobileDrawer = document.getElementById('mobileDrawer');

navToggle?.addEventListener('click', () => {
  mobileDrawer.classList.add('is-open');
  navToggle.setAttribute('aria-expanded', 'true');
});
mobileClose?.addEventListener('click', () => {
  mobileDrawer.classList.remove('is-open');
  navToggle?.setAttribute('aria-expanded', 'false');
});
mobileDrawer?.querySelectorAll('a').forEach(a => {
  a.addEventListener('click', () => mobileDrawer.classList.remove('is-open'));
});

/* =========================================================
   Desktop nav dropdowns (click to toggle, close on outside click)
   ========================================================= */
const dropdowns = document.querySelectorAll('.nav-item-dropdown');
dropdowns.forEach(dd => {
  const trigger = dd.querySelector('a');
  trigger?.addEventListener('click', (e) => {
    e.preventDefault();
    const wasOpen = dd.classList.contains('is-open');
    dropdowns.forEach(o => o.classList.remove('is-open'));
    if (!wasOpen) dd.classList.add('is-open');
  });
});
document.addEventListener('click', (e) => {
  dropdowns.forEach(dd => {
    if (!dd.contains(e.target)) dd.classList.remove('is-open');
  });
});

/* =========================================================
   Scroll reveal
   ========================================================= */
const revealEls = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window && revealEls.length) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });
  revealEls.forEach(el => io.observe(el));
} else {
  revealEls.forEach(el => el.classList.add('is-visible'));
}

/* =========================================================
   FAQ accordion
   ========================================================= */
document.querySelectorAll('.faq-item').forEach(item => {
  const q = item.querySelector('.faq-q');
  const a = item.querySelector('.faq-a');
  q?.addEventListener('click', () => {
    const isOpen = item.classList.contains('is-open');
    item.parentElement.querySelectorAll('.faq-item').forEach(other => {
      other.classList.remove('is-open');
      other.querySelector('.faq-a').style.maxHeight = null;
    });
    if (!isOpen) {
      item.classList.add('is-open');
      a.style.maxHeight = a.scrollHeight + 'px';
    }
  });
});

/* =========================================================
   Hero sliders (all instances on the page)
   ========================================================= */
document.querySelectorAll('.hero-slider').forEach(slider => {
  const slides = Array.from(slider.querySelectorAll('.hero-slide'));
  const dots = Array.from(slider.querySelectorAll('.hero-slider-dots .dot'));
  const prevBtn = slider.querySelector('.arrow.prev');
  const nextBtn = slider.querySelector('.arrow.next');
  if (!slides.length) return;

  let index = 0;
  let timer = null;
  const interval = parseInt(slider.dataset.autoplay || '6000', 10);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function show(i) {
    index = (i + slides.length) % slides.length;
    slides.forEach((s, n) => s.classList.toggle('is-active', n === index));
    dots.forEach((d, n) => d.classList.toggle('is-active', n === index));
  }

  function next() { show(index + 1); }
  function prev() { show(index - 1); }

  function startAutoplay() {
    if (reducedMotion || slides.length < 2) return;
    stopAutoplay();
    timer = setInterval(next, interval);
  }
  function stopAutoplay() { if (timer) clearInterval(timer); }

  dots.forEach((dot, n) => dot.addEventListener('click', () => { show(n); startAutoplay(); }));
  nextBtn?.addEventListener('click', () => { next(); startAutoplay(); });
  prevBtn?.addEventListener('click', () => { prev(); startAutoplay(); });

  slider.addEventListener('mouseenter', stopAutoplay);
  slider.addEventListener('mouseleave', startAutoplay);
  slider.addEventListener('focusin', stopAutoplay);
  slider.addEventListener('focusout', startAutoplay);

  show(0);
  startAutoplay();
});

/* =========================================================
   Contact forms — AJAX submit to Formspree with inline status
   (index.html's main form + per-calculator inline lead forms
   all share the .ajax-form/.form-status convention)
   ========================================================= */
document.querySelectorAll('.ajax-form').forEach(form => {
  const fileInput = form.querySelector('input[type="file"]');

  function postFormData(fd) {
    return fetch(form.action, {
      method: 'POST',
      body: fd,
      headers: { 'Accept': 'application/json' }
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    const statusEl = form.querySelector('.form-status');
    const originalLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Wird gesendet …';
    if (statusEl) { statusEl.textContent = ''; statusEl.className = 'form-status'; }

    const hasFiles = !!(fileInput && fileInput.files && fileInput.files.length);

    try {
      let res = await postFormData(new FormData(form));

      // Ein Foto-Anhang kann die gesamte Übertragung blockieren (z.B. wegen
      // Formspree-Plan-Limits) — dann lieber die Anfrage ohne Fotos erneut
      // senden, statt den ganzen Lead zu verlieren.
      if (!res.ok && hasFiles) {
        console.warn('neuverdrahtet: Übertragung mit Anhang fehlgeschlagen (Status ' + res.status + '), erneuter Versuch ohne Anhang.');
        const fdWithoutFile = new FormData(form);
        fdWithoutFile.delete(fileInput.name);
        res = await postFormData(fdWithoutFile);
        if (res.ok) {
          if (statusEl) {
            statusEl.textContent = 'Danke — Ihre Anfrage ist angekommen. Die Fotos konnten leider nicht übertragen werden, bitte reichen Sie diese per E-Mail an neuverdrahtet@gmail.com nach.';
            statusEl.classList.add('ok');
          }
          trackEvent('generate_lead', { method: form.dataset.leadSource || 'contact_form', attachment: 'failed' });
          form.reset();
          return;
        }
      }

      if (res.ok) {
        if (statusEl) {
          statusEl.textContent = 'Danke — Ihre Anfrage ist angekommen. Rückmeldung folgt in Kürze.';
          statusEl.classList.add('ok');
        }
        trackEvent('generate_lead', { method: form.dataset.leadSource || 'contact_form' });
        form.reset();
      } else {
        console.error('neuverdrahtet: Formspree-Übertragung fehlgeschlagen, Status ' + res.status);
        throw new Error('send-failed');
      }
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = 'Senden hat nicht geklappt. Bitte per E-Mail an neuverdrahtet@gmail.com.';
        statusEl.classList.add('err');
      }
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
  });
});


/* =========================================================
   Kosten-Konfigurator (Mehrfachauswahl, Raumauswahl, Etagen-Zuschlag)
   ========================================================= */
function fmtEUR(n) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}

document.querySelectorAll('.calc-multi').forEach(calc => {
  const items = calc.querySelectorAll('.calc-service-item');
  const floorButtons = calc.querySelectorAll('.calc-floors button');
  const grandMinEl = calc.querySelector('.calc-grand-min');
  const grandMaxEl = calc.querySelector('.calc-grand-max');
  const riskToggleButtons = calc.querySelectorAll('.calc-risk-toggle button');
  const riskCheckboxes = calc.querySelectorAll('.calc-risk-check');
  const riskBadgeEl = calc.querySelector('.calc-risk-badge');
  const riskNotesEl = calc.querySelector('.calc-risk-notes');
  const resultNormalEl = calc.querySelector('.calc-result');
  const resultBlockedEl = calc.querySelector('.calc-result-blocked');

  function activeFloorFactor() {
    const btn = Array.from(floorButtons).find(b => b.classList.contains('is-active'));
    return btn ? parseFloat(btn.dataset.factor) : 1;
  }

  // Risk factors widen the price range and drive the Grün/Gelb/Rot badge.
  // Weighted 0.05–0.10 per open/unknown answer, capped at ±35%.
  // Risk fields inside a currently-hidden .calc-conditional block (e.g. a
  // "Sanierung"-only question while "Neubau" is selected) don't count.
  function isInsideHiddenConditional(el) {
    const block = el.closest('.calc-conditional');
    return block ? block.hidden : false;
  }
  function activeRiskEls() {
    const activeToggles = Array.from(riskToggleButtons).filter(b => b.classList.contains('is-active') && !isInsideHiddenConditional(b));
    const checkedBoxes = Array.from(riskCheckboxes).filter(c => c.checked && !isInsideHiddenConditional(c));
    return activeToggles.concat(checkedBoxes);
  }
  function activeRiskScore() {
    const sum = activeRiskEls().reduce((s, el) => s + (parseFloat(el.dataset.riskWeight) || 0), 0);
    return Math.min(sum, 0.35);
  }
  function activeRiskNotes() {
    return activeRiskEls().map(el => el.dataset.riskNote).filter(Boolean);
  }
  function blockerActive() {
    return !!calc.querySelector('[data-risk-blocker="true"]:checked');
  }

  function itemArea(item) {
    const mode = item.dataset.mode;
    if (mode === 'rooms') {
      const checks = item.querySelectorAll('.room-check');
      let total = 0;
      checks.forEach(chk => {
        if (chk.checked) {
          const sizeInput = chk.closest('.room-row').querySelector('.room-size');
          total += parseFloat(sizeInput.value) || 0;
        }
      });
      const totalEl = item.querySelector('.rooms-total-val');
      if (totalEl) totalEl.textContent = total + ' ' + (item.dataset.unitSuffix || 'm²');
      return total;
    }
    const areaInput = item.querySelector('.calc-area');
    const areaVal = item.querySelector('.calc-area-val');
    const units = areaInput ? parseFloat(areaInput.value) : 0;
    if (areaVal) areaVal.textContent = units + ' ' + (item.dataset.unitSuffix || '');
    return units;
  }

  function itemActiveTier(item) {
    const tierButtons = item.querySelectorAll('.calc-tier button');
    return Array.from(tierButtons).find(b => b.classList.contains('is-active')) || tierButtons[0];
  }

  function recalcAll() {
    const floorFactor = activeFloorFactor();
    let grandLow = 0, grandHigh = 0;

    items.forEach(item => {
      const checkbox = item.querySelector('.calc-service-check');
      const subtotalEl = item.querySelector('.calc-service-subtotal');
      const area = itemArea(item);
      const tier = itemActiveTier(item);
      let low = 0, high = 0;
      if (tier && area > 0) {
        low = parseFloat(tier.dataset.low) * area * floorFactor;
        high = parseFloat(tier.dataset.high) * area * floorFactor;
      }
      if (checkbox.checked) {
        subtotalEl.textContent = area > 0 ? `${fmtEUR(low)} – ${fmtEUR(high)}` : 'Fläche wählen';
        grandLow += low;
        grandHigh += high;
      } else {
        subtotalEl.textContent = '–';
      }
    });

    if (blockerActive()) {
      if (resultNormalEl) resultNormalEl.hidden = true;
      if (resultBlockedEl) resultBlockedEl.hidden = false;
      if (riskBadgeEl) riskBadgeEl.hidden = true;
      if (riskNotesEl) riskNotesEl.innerHTML = '';
      return;
    }
    if (resultNormalEl) resultNormalEl.hidden = false;
    if (resultBlockedEl) resultBlockedEl.hidden = true;

    const riskScore = activeRiskScore();
    const finalLow = grandLow * (1 - riskScore);
    const finalHigh = grandHigh * (1 + riskScore);
    grandMinEl.textContent = grandLow > 0 ? fmtEUR(finalLow) : '–';
    grandMaxEl.textContent = grandHigh > 0 ? fmtEUR(finalHigh) : '–';

    const hasTotal = grandHigh > 0;
    if (riskBadgeEl) {
      riskBadgeEl.hidden = !hasTotal;
      if (hasTotal) {
        riskBadgeEl.classList.remove('is-green', 'is-yellow', 'is-red');
        let level, label;
        if (riskScore <= 0.10) { level = 'is-green'; label = 'Grün — gute Datenlage'; }
        else if (riskScore <= 0.25) { level = 'is-yellow'; label = 'Gelb — Vor-Ort-Prüfung empfohlen'; }
        else { level = 'is-red'; label = 'Rot — hohe Unsicherheit, Vor-Ort-Termin sinnvoll'; }
        riskBadgeEl.classList.add(level);
        riskBadgeEl.textContent = label;
      }
    }
    if (riskNotesEl) {
      const notes = hasTotal ? activeRiskNotes() : [];
      riskNotesEl.innerHTML = notes.length ? '<li>' + notes.join('</li><li>') + '</li>' : '';
    }
  }

  items.forEach(item => {
    const checkbox = item.querySelector('.calc-service-check');
    const body = item.querySelector('.calc-service-body');
    const head = item.querySelector('.calc-service-head');

    checkbox.addEventListener('change', () => {
      item.classList.toggle('is-checked', checkbox.checked);
      body.style.display = checkbox.checked ? '' : 'none';
      recalcAll();
    });
    // clicking the head label toggles the checkbox naturally (label wraps input),
    // but stop clicks inside the body from bubbling up and re-toggling
    body.addEventListener('click', e => e.stopPropagation());

    item.querySelectorAll('.calc-tier button').forEach(btn => {
      btn.addEventListener('click', () => {
        item.querySelectorAll('.calc-tier button').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        recalcAll();
      });
    });
    item.querySelectorAll('.calc-area').forEach(input => input.addEventListener('input', recalcAll));
    item.querySelectorAll('.room-check').forEach(chk => chk.addEventListener('change', recalcAll));
    item.querySelectorAll('.room-size').forEach(inp => inp.addEventListener('input', recalcAll));
  });

  floorButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      floorButtons.forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      recalcAll();
    });
  });

  riskToggleButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const group = btn.closest('.calc-risk-toggle');
      group.querySelectorAll('button').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      recalcAll();
    });
  });
  riskCheckboxes.forEach(chk => chk.addEventListener('change', recalcAll));

  /* --- Bauart-Umschalter (z.B. Neubau/Sanierung): blendet passende
     .calc-conditional-Blöcke ein/aus, deren Risikofelder dann mitzählen --- */
  const modeToggleButtons = calc.querySelectorAll('.calc-mode-toggle button');
  const conditionalBlocks = calc.querySelectorAll('.calc-conditional');
  modeToggleButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      modeToggleButtons.forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      const reveal = btn.dataset.reveals;
      conditionalBlocks.forEach(block => { block.hidden = block.dataset.showWhen !== reveal; });
      recalcAll();
    });
  });

  /* --- Anfrage senden: inline Kontakt-Reveal mit Auto-Zusammenfassung --- */
  const contactToggleBtn = calc.querySelector('.calc-contact-toggle');
  const contactReveal = calc.querySelector('.calc-contact-reveal');
  const contactMessage = calc.querySelector('.calc-contact-message');

  function buildSummaryText() {
    const pageTitle = document.querySelector('h1')?.textContent.trim() || 'Kosten-Konfigurator';
    const lines = [`Kosten-Konfigurator (${pageTitle}):`];
    items.forEach(item => {
      const checkbox = item.querySelector('.calc-service-check');
      if (!checkbox.checked) return;
      const label = item.querySelector('.calc-service-label')?.textContent.trim() || '';
      const tier = itemActiveTier(item);
      const tierLabel = tier ? (tier.childNodes[0].textContent || '').trim() : '';
      const areaEl = item.querySelector('.calc-area-val') || item.querySelector('.rooms-total-val');
      const areaText = areaEl ? areaEl.textContent : '';
      lines.push(`- ${label}: ${areaText}${tierLabel ? ', ' + tierLabel : ''}`);
    });
    const floorBtn = Array.from(floorButtons).find(b => b.classList.contains('is-active'));
    if (floorBtn) lines.push(`- Etage: ${floorBtn.textContent.trim()}`);
    calc.querySelectorAll('.calc-info-field').forEach(field => {
      const val = (field.value || '').trim();
      if (val) lines.push(`- ${field.dataset.summaryLabel || field.name}: ${val}`);
    });
    lines.push(`- Geschätzte Kosten: ${grandMinEl.textContent} – ${grandMaxEl.textContent}`);
    const notes = activeRiskNotes();
    if (notes.length) lines.push(`- Offene Punkte: ${notes.join(', ')}`);
    return lines.join('\n');
  }

  if (contactToggleBtn && contactReveal) {
    contactToggleBtn.addEventListener('click', () => {
      const wasOpen = !contactReveal.hidden;
      contactReveal.hidden = wasOpen;
      contactToggleBtn.setAttribute('aria-expanded', String(!wasOpen));
      if (!wasOpen) {
        if (contactMessage && !contactMessage.value.trim()) {
          contactMessage.value = buildSummaryText() + '\n\n';
        }
        contactReveal.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const firstField = contactReveal.querySelector('input:not([type="hidden"]), textarea');
        firstField?.focus();
        if (contactMessage) {
          const end = contactMessage.value.length;
          contactMessage.setSelectionRange(end, end);
        }
      }
    });
  }

  /* --- Foto-/Dokument-Upload: Drag&Drop-Vorschau, keine Pflicht --- */
  const dropzone = calc.querySelector('.dropzone');
  const fileInput = calc.querySelector('.dropzone input[type="file"]');
  const previewGrid = calc.querySelector('.preview-grid');
  const previewWrap = calc.querySelector('.preview-wrap');
  const uploadHint = calc.querySelector('.upload-hint');

  if (dropzone && fileInput) {
    function renderPreviews() {
      if (!previewGrid) return;
      previewGrid.innerHTML = '';
      const files = Array.from(fileInput.files || []);
      if (uploadHint) {
        uploadHint.hidden = files.length <= 5;
      }
      files.slice(0, 12).forEach(file => {
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

    ['dragenter', 'dragover'].forEach(evt => dropzone.addEventListener(evt, e => {
      e.preventDefault();
      dropzone.classList.add('is-drag');
    }));
    ['dragleave', 'drop'].forEach(evt => dropzone.addEventListener(evt, e => {
      e.preventDefault();
      dropzone.classList.remove('is-drag');
    }));
    dropzone.addEventListener('drop', e => {
      if (e.dataTransfer?.files?.length) {
        fileInput.files = e.dataTransfer.files;
        renderPreviews();
      }
    });
    fileInput.addEventListener('change', renderPreviews);
  }

  recalcAll();
});

/* =========================================================
   Cookie-Consent (Google Consent Mode v2)
   ========================================================= */
(() => {
  const CONSENT_KEY = 'nv-cookie-consent';
  const stored = localStorage.getItem(CONSENT_KEY);

  const updateConsent = (granted) => {
    if (typeof gtag !== 'function') return;
    gtag('consent', 'update', { analytics_storage: granted ? 'granted' : 'denied' });
  };

  if (stored === 'granted') {
    updateConsent(true);
  } else if (stored !== 'denied') {
    const banner = document.createElement('div');
    banner.className = 'cookie-banner';
    banner.innerHTML = `
      <div class="cookie-banner-inner">
        <p>Wir nutzen Google Analytics, um die Website zu verbessern. Cookies werden erst nach Ihrer Zustimmung gesetzt. Mehr dazu in unserer <a href="datenschutz.html">Datenschutzerklärung</a>.</p>
        <div class="cookie-banner-actions">
          <button type="button" class="btn btn-outline btn-sm" id="cookieDecline">Ablehnen</button>
          <button type="button" class="btn btn-primary btn-sm" id="cookieAccept">Akzeptieren</button>
        </div>
      </div>`;
    document.body.appendChild(banner);

    banner.querySelector('#cookieAccept').addEventListener('click', () => {
      localStorage.setItem(CONSENT_KEY, 'granted');
      updateConsent(true);
      banner.remove();
    });
    banner.querySelector('#cookieDecline').addEventListener('click', () => {
      localStorage.setItem(CONSENT_KEY, 'denied');
      updateConsent(false);
      banner.remove();
    });
  }
})();

/* =========================================================
   GA4 Conversion-Tracking (Anruf, WhatsApp, Formular)
   ========================================================= */
function trackEvent(name, params) {
  if (typeof gtag === 'function') gtag('event', name, params || {});
}

document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href]');
  if (!link) return;
  const href = link.getAttribute('href');
  if (href.startsWith('tel:')) {
    trackEvent('contact_click', { method: 'phone', link_url: href });
  } else if (href.includes('wa.me')) {
    trackEvent('contact_click', { method: 'whatsapp', link_url: href });
  } else if (href.includes('maps.app.goo.gl') || href.includes('google.com/maps')) {
    trackEvent('contact_click', { method: 'google_maps', link_url: href });
  }
});

