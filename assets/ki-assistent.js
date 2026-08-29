/* =========================================================
   KI-Assistent — Chat-Widget für Website-Besucher
   Plain JS, kein Modul/Build-Schritt (wie assets/script.js).
   Backend: cloudflare-worker-ki-assistent/ (siehe README dort).
   ========================================================= */

const KI_ASSISTENT_WORKER_URL = 'https://neuverdrahtet-ki-assistent.neuverdrahtetworkersdev.workers.dev';

(() => {
  const fabHost = document.querySelector('.contact-fab');
  if (!fabHost) return; // Widget wird nur auf Seiten mit den Kontakt-Buttons eingebunden

  const VERLAUF_KEY = 'kiAssistentVerlauf';
  const MAX_GESPEICHERTE_NACHRICHTEN = 30;

  let verlauf = ladeVerlauf();
  let wirdGesendet = false;
  let geoeffnet = false;

  /* ---------- Verlauf (sessionStorage, pro Browser-Tab) ---------- */
  function ladeVerlauf() {
    try {
      const roh = sessionStorage.getItem(VERLAUF_KEY);
      const daten = roh ? JSON.parse(roh) : [];
      return Array.isArray(daten) ? daten : [];
    } catch {
      return [];
    }
  }

  function speichereVerlauf() {
    try {
      sessionStorage.setItem(VERLAUF_KEY, JSON.stringify(verlauf.slice(-MAX_GESPEICHERTE_NACHRICHTEN)));
    } catch { /* privater Modus o.ä. - Verlauf geht dann beim Neuladen verloren, nicht kritisch */ }
  }

  /* ---------- Toggle-Button (reiht sich in die bestehenden Kontakt-Buttons ein) ---------- */
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'fab fab-chat';
  toggleBtn.setAttribute('aria-label', 'KI-Assistent öffnen');
  toggleBtn.setAttribute('aria-expanded', 'false');
  toggleBtn.title = 'KI-Assistent';
  toggleBtn.innerHTML = '<svg width="21" height="21" viewBox="0 0 24 24" fill="none"><path d="M4 5.5h16v10.5H9.2L5 20V16H4V5.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="8.5" cy="10.5" r="1" fill="currentColor"/><circle cx="12" cy="10.5" r="1" fill="currentColor"/><circle cx="15.5" cy="10.5" r="1" fill="currentColor"/></svg>';
  fabHost.prepend(toggleBtn);

  /* ---------- Chat-Panel ---------- */
  const panel = document.createElement('div');
  panel.className = 'ki-assistent-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="ki-assistent-header">
      <div>
        <strong>KI-Assistent</strong>
        <span class="ki-assistent-subtitle">neuverdrahtet</span>
      </div>
      <button type="button" class="ki-assistent-close" aria-label="Chat schließen">✕</button>
    </div>
    <div class="ki-assistent-messages" role="log" aria-live="polite"></div>
    <form class="ki-assistent-form">
      <textarea class="ki-assistent-input" placeholder="Ihre Nachricht…" rows="1" maxlength="4000" required></textarea>
      <button type="submit" class="ki-assistent-send" aria-label="Nachricht senden">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 12l16-8-6 16-2.5-6.5L4 12Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
      </button>
    </form>
    <p class="ki-assistent-footnote">Antworten werden von einer KI erzeugt und können Fehler enthalten. Mit der Nutzung akzeptieren Sie unsere <a href="datenschutz.html" target="_blank">Datenschutzerklärung</a>.</p>
  `;
  document.body.appendChild(panel);

  // Nur auf Handy/Tablet sichtbar (siehe CSS) - dort füllt das Panel als
  // Bottom-Sheet fast den ganzen Bildschirm, daher ein abgedunkelter
  // Hintergrund wie bei einem nativen Sheet statt der freien Restfläche.
  const backdrop = document.createElement('div');
  backdrop.className = 'ki-assistent-backdrop';
  document.body.appendChild(backdrop);

  const messagesEl = panel.querySelector('.ki-assistent-messages');
  const formEl = panel.querySelector('.ki-assistent-form');
  const inputEl = panel.querySelector('.ki-assistent-input');
  const closeBtn = panel.querySelector('.ki-assistent-close');

  /* ---------- Rendering (bewusst ohne innerHTML für Nachrichtentexte - kein XSS-Risiko) ---------- */
  function renderMessageText(container, text) {
    const zeilen = String(text || '').split('\n');
    zeilen.forEach((zeile, i) => {
      if (i > 0) container.appendChild(document.createElement('br'));
      container.appendChild(document.createTextNode(zeile));
    });
  }

  function addBubble(role, text) {
    const bubble = document.createElement('div');
    bubble.className = `ki-assistent-bubble ki-assistent-bubble-${role}`;
    renderMessageText(bubble, text);
    messagesEl.appendChild(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return bubble;
  }

  function renderVerlauf() {
    messagesEl.innerHTML = '';
    if (verlauf.length === 0) {
      addBubble('assistant', 'Hallo! Ich bin der KI-Assistent von neuverdrahtet. Wie kann ich Ihnen zu unseren Elektro-Leistungen weiterhelfen?');
      return;
    }
    verlauf.forEach((m) => addBubble(m.role, m.content));
  }

  function setTyping(an) {
    let indikator = messagesEl.querySelector('.ki-assistent-typing');
    if (an) {
      if (indikator) return;
      indikator = document.createElement('div');
      indikator.className = 'ki-assistent-bubble ki-assistent-bubble-assistant ki-assistent-typing';
      indikator.innerHTML = '<span></span><span></span><span></span>';
      messagesEl.appendChild(indikator);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    } else if (indikator) {
      indikator.remove();
    }
  }

  /* ---------- Öffnen/Schließen ---------- */
  function oeffnePanel() {
    geoeffnet = true;
    panel.hidden = false;
    backdrop.classList.add('is-visible');
    toggleBtn.setAttribute('aria-expanded', 'true');
    toggleBtn.classList.add('is-active');
    if (messagesEl.children.length === 0) renderVerlauf();
    setTimeout(() => inputEl.focus(), 50);
  }
  function schliessePanel() {
    geoeffnet = false;
    panel.hidden = true;
    backdrop.classList.remove('is-visible');
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleBtn.classList.remove('is-active');
  }
  toggleBtn.addEventListener('click', () => (geoeffnet ? schliessePanel() : oeffnePanel()));
  closeBtn.addEventListener('click', schliessePanel);

  // Klick außerhalb des Panels und Escape schließen den Chat ebenfalls -
  // der Kunde soll ihn jederzeit unaufdringlich wieder loswerden können,
  // nicht nur über den kleinen X-Button.
  document.addEventListener('click', (e) => {
    if (!geoeffnet) return;
    if (panel.contains(e.target) || toggleBtn.contains(e.target)) return;
    schliessePanel();
  });
  document.addEventListener('keydown', (e) => {
    if (geoeffnet && e.key === 'Escape') schliessePanel();
  });

  /* ---------- Eingabe: Enter sendet, Shift+Enter neue Zeile; Textarea wächst automatisch ---------- */
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  });
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      formEl.requestSubmit();
    }
  });

  /* ---------- Absenden ---------- */
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text || wirdGesendet) return;

    verlauf.push({ role: 'user', content: text });
    addBubble('user', text);
    speichereVerlauf();
    inputEl.value = '';
    inputEl.style.height = 'auto';
    wirdGesendet = true;
    setTyping(true);

    if (KI_ASSISTENT_WORKER_URL.includes('PLATZHALTER-KONTO')) {
      // Worker noch nicht deployt/URL noch nicht eingetragen (siehe
      // cloudflare-worker-ki-assistent/README.md) - erst gar nicht gegen
      // eine garantiert nicht existierende Domain anfragen (unnötiger
      // Netzwerk-Fehler in der Konsole, sinnlose Wartezeit für den
      // Besucher). Gleiche Fallback-Nachricht wie bei echtem Fetch-Fehler.
      setTyping(false);
      addBubble('assistant', 'Der Assistent ist gerade nicht erreichbar. Sie erreichen uns auch direkt unter 01706398575 oder neuverdrahtet@gmail.com.');
      wirdGesendet = false;
      return;
    }

    try {
      const res = await fetch(KI_ASSISTENT_WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: verlauf }),
      });
      const data = await res.json().catch(() => ({}));
      setTyping(false);
      if (!res.ok || data.error) {
        addBubble('assistant', `${data.error || 'Es ist ein Fehler aufgetreten.'} Sie erreichen uns auch direkt unter 01706398575 oder neuverdrahtet@gmail.com.`);
        return;
      }
      verlauf.push({ role: 'assistant', content: data.reply });
      addBubble('assistant', data.reply);
      speichereVerlauf();
    } catch {
      setTyping(false);
      addBubble('assistant', 'Der Assistent ist gerade nicht erreichbar. Sie erreichen uns auch direkt unter 01706398575 oder neuverdrahtet@gmail.com.');
    } finally {
      wirdGesendet = false;
    }
  });
})();
