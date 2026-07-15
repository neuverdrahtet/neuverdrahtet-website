/* =========================================================
   Config
   ========================================================= */
// TODO(Danny): Nach dem Deploy des Cloudflare Workers (siehe assets/cloudflare-worker.js)
// hier die echte Worker-URL eintragen, z.B. "https://neuverdrahtet-ki-check.DEIN-SUBDOMAIN.workers.dev"
const KI_CHECK_ENDPOINT = "https://YOUR-WORKER-SUBDOMAIN.workers.dev";

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
      formStatus.textContent = 'Senden hat nicht geklappt. Bitte per E-Mail an info@neuverdrahtet.com.';
      formStatus.classList.add('err');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
  });
}

/* =========================================================
   Kosten-Konfigurator
   ========================================================= */
const calcProjectType = document.getElementById('calcProjectType');
const calcTier = document.getElementById('calcTier');
const calcExtras = document.getElementById('calcExtras');
const calcArea = document.getElementById('calcArea');
const calcAreaVal = document.getElementById('calcAreaVal');
const calcMin = document.getElementById('calcMin');
const calcMax = document.getElementById('calcMax');

if (calcProjectType && calcTier && calcArea) {
  // price per m², [low, high] band, by project type + tier
  const PRICE_PER_M2 = {
    neubau:    { standard: [80, 110], premium: [110, 150], exklusiv: [160, 210] },
    sanierung: { standard: [100, 130], premium: [130, 180], exklusiv: [185, 245] },
  };
  const EXTRAS = {
    wallbox:      [1200, 2200],
    pv:           [3500, 7000],
    waermepumpe:  [1800, 3200],
  };

  function fmt(n) {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
  }

  function setActiveSingle(container, target) {
    container.querySelectorAll('button').forEach(b => b.classList.toggle('is-active', b === target));
  }
  function toggleMulti(container, target) {
    target.classList.toggle('is-active');
  }

  function currentSelection(container, multi) {
    const active = Array.from(container.querySelectorAll('button.is-active'));
    return multi ? active.map(b => b.dataset.value) : (active[0]?.dataset.value || null);
  }

  function recalc() {
    const projectType = currentSelection(calcProjectType, false) || 'neubau';
    const tier = currentSelection(calcTier, false) || 'premium';
    const extras = calcExtras ? currentSelection(calcExtras, true) : [];
    const area = parseInt(calcArea.value, 10);

    calcAreaVal.textContent = area + ' m²';

    const [lowM2, highM2] = PRICE_PER_M2[projectType][tier];
    let low = area * lowM2;
    let high = area * highM2;

    extras.forEach(ex => {
      const [exLow, exHigh] = EXTRAS[ex] || [0, 0];
      low += exLow;
      high += exHigh;
    });

    calcMin.textContent = fmt(low);
    calcMax.textContent = fmt(high);
  }

  calcProjectType.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => { setActiveSingle(calcProjectType, btn); recalc(); });
  });
  calcTier.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => { setActiveSingle(calcTier, btn); recalc(); });
  });
  calcExtras?.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => { toggleMulti(calcExtras, btn); recalc(); });
  });
  calcArea.addEventListener('input', recalc);

  recalc();
}

/* =========================================================
   KI-Check Unterverteilung — upload, preview, analyze
   ========================================================= */
const dropzone = document.getElementById('dropzone');
const kiFile = document.getElementById('kiFile');
const previewWrap = document.getElementById('previewWrap');
const previewImg = document.getElementById('previewImg');
const kiForm = document.getElementById('kiForm');
const kiSubmit = document.getElementById('kiSubmit');
const aiResult = document.getElementById('aiResult');
const aiStatusText = document.getElementById('aiStatusText');
const aiResultBody = document.getElementById('aiResultBody');

let selectedFile = null;

function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  selectedFile = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    previewImg.src = e.target.result;
    previewWrap.classList.add('is-visible');
    kiSubmit.disabled = false;
  };
  reader.readAsDataURL(file);
}

kiFile?.addEventListener('change', (e) => handleFile(e.target.files[0]));

['dragover', 'dragenter'].forEach(evt => {
  dropzone?.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add('is-drag'); });
});
['dragleave', 'drop'].forEach(evt => {
  dropzone?.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove('is-drag'); });
});
dropzone?.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

kiForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!selectedFile) return;

  aiResult.classList.add('is-visible');
  aiResult.classList.remove('ai-error');
  aiStatusText.textContent = 'Analyse läuft …';
  aiResultBody.innerHTML = '';
  kiSubmit.disabled = true;

  const endpointConfigured = KI_CHECK_ENDPOINT && !KI_CHECK_ENDPOINT.includes('YOUR-WORKER-SUBDOMAIN');

  if (!endpointConfigured) {
    aiStatusText.textContent = 'KI-Check noch nicht eingerichtet';
    aiResultBody.innerHTML =
      '<p>Der KI-Check braucht eine kleine Server-Komponente, die den API-Zugriff sicher übernimmt ' +
      '(siehe <code>assets/cloudflare-worker.js</code>). Sobald die Worker-URL in ' +
      '<code>assets/script.js</code> hinterlegt ist, funktioniert der Check automatisch.</p>' +
      '<p>In der Zwischenzeit gerne direkt <a href="index.html#kontakt">das Foto per Kontaktformular</a> schicken.</p>';
    kiSubmit.disabled = false;
    return;
  }

  try {
    const base64 = await fileToBase64(selectedFile);
    const res = await fetch(KI_CHECK_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64, mediaType: selectedFile.type })
    });
    if (!res.ok) throw new Error('analysis-failed');
    const data = await res.json();

    aiStatusText.textContent = 'Analyse abgeschlossen';
    aiResultBody.innerHTML = `<p>${(data.result || 'Keine Einschätzung erhalten.').replace(/\\n/g, '<br>')}</p>`;
  } catch (err) {
    aiResult.classList.add('ai-error');
    aiStatusText.textContent = 'Analyse fehlgeschlagen';
    aiResultBody.innerHTML = '<p>Die Analyse konnte nicht durchgeführt werden. Bitte später erneut versuchen oder das Foto per Kontaktformular schicken.</p>';
  } finally {
    kiSubmit.disabled = false;
  }
});
