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
   Kosten-Konfigurator (generisch, pro Gewerke-Seite)
   ========================================================= */
function fmtEUR(n) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}

document.querySelectorAll('.calc-embedded').forEach(panel => {
  const areaInput = panel.querySelector('.calc-area');
  const areaVal = panel.querySelector('.calc-area-val');
  const tierButtons = panel.querySelectorAll('.calc-tier button');
  const minEl = panel.querySelector('.calc-min');
  const maxEl = panel.querySelector('.calc-max');
  const suffix = panel.dataset.unitSuffix || '';
  const period = panel.dataset.period || '';

  function activeTier() {
    return Array.from(tierButtons).find(b => b.classList.contains('is-active')) || tierButtons[0];
  }

  function recalc() {
    const units = parseFloat(areaInput.value);
    areaVal.textContent = units + ' ' + suffix;
    const tier = activeTier();
    if (!tier) return;
    const low = parseFloat(tier.dataset.low) * units;
    const high = parseFloat(tier.dataset.high) * units;
    minEl.textContent = fmtEUR(low);
    maxEl.textContent = fmtEUR(high) + (period || '');
  }

  tierButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tierButtons.forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      recalc();
    });
  });
  areaInput.addEventListener('input', recalc);

  recalc();
});
