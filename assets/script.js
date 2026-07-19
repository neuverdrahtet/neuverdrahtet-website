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
   Contact form — AJAX submit to Formspree with inline status
   ========================================================= */
const contactForm = document.getElementById('contactForm');
const formStatus = document.getElementById('formStatus');

if (contactForm) {
  contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = contactForm.querySelector('button[type="submit"]');
    const originalLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Wird gesendet …';
    formStatus.textContent = '';
    formStatus.className = 'form-status';

    try {
      const res = await fetch(contactForm.action, {
        method: 'POST',
        body: new FormData(contactForm),
        headers: { 'Accept': 'application/json' }
      });
      if (res.ok) {
        formStatus.textContent = 'Danke — Ihre Anfrage ist angekommen. Rückmeldung folgt in Kürze.';
        formStatus.classList.add('ok');
        trackEvent('generate_lead', { method: 'contact_form' });
        contactForm.reset();
      } else {
        throw new Error('send-failed');
      }
    } catch (err) {
      formStatus.textContent = 'Senden hat nicht geklappt. Bitte per E-Mail an neuverdrahtet@gmail.com.';
      formStatus.classList.add('err');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
  });
}


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

  function activeFloorFactor() {
    const btn = Array.from(floorButtons).find(b => b.classList.contains('is-active'));
    return btn ? parseFloat(btn.dataset.factor) : 1;
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

    grandMinEl.textContent = grandLow > 0 ? fmtEUR(grandLow) : '–';
    grandMaxEl.textContent = grandHigh > 0 ? fmtEUR(grandHigh) : '–';
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

