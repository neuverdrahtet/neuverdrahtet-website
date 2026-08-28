import { chatMitAssistent } from '../ai.js';
import { escapeHtml } from '../utils.js';

// Verlauf bleibt nur für die Dauer der Sitzung im Tab erhalten (kein
// Cloud-Sync, kein IndexedDB) - ein Neuladen der Seite startet ein neues
// Gespräch. Das ist bewusst so einfach gehalten wie beim Website-Widget.
let verlauf = [];

export async function render(container) {
  container.innerHTML = `
    <div class="view-header">
      <h1>KI-Assistent</h1>
    </div>
    <p class="hint">Fragt live Kunden-, Projekt-, Aufgaben-, Termin- und Angebotsdaten über die KI-Bürokraft-API ab und kann auf Zuruf auch Einträge anlegen (z.B. eine Aufgabe oder einen Termin). Einrichtung/Details: <code>cloudflare-worker/worker.js</code> (Aktion "assistent-chat") + <code>cloudflare-worker-ki-buerokraft/README.md</code>.</p>
    <div class="card">
      <div class="ka-list" id="ka-list"></div>
      <form id="ka-form" class="tc-input-row">
        <textarea id="ka-input" placeholder="Frag den Assistenten, z.B. „Wie viele offene Aufgaben haben wir heute?“" rows="2"></textarea>
        <button type="submit" class="btn btn-primary" id="ka-send">Senden</button>
      </form>
    </div>
  `;

  const listEl = container.querySelector('#ka-list');
  const formEl = container.querySelector('#ka-form');
  const inputEl = container.querySelector('#ka-input');
  const sendBtn = container.querySelector('#ka-send');

  function renderZeile(text) {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  function renderListe() {
    if (verlauf.length === 0) {
      listEl.innerHTML = '<p class="text-mute">Noch kein Gespräch. Stell einfach eine Frage - z.B. zu offenen Aufgaben, Leads oder einem Kunden.</p>';
      return;
    }
    listEl.innerHTML = verlauf.map((m) => `
      <div class="ka-msg ka-msg-${m.role}">
        <div class="tc-msg-head"><strong>${m.role === 'user' ? 'Du' : 'KI-Assistent'}</strong></div>
        <div class="tc-msg-text">${renderZeile(m.content)}</div>
      </div>
    `).join('');
    listEl.scrollTop = listEl.scrollHeight;
  }

  function setDenktNach(an) {
    let el = listEl.querySelector('.ka-thinking');
    if (an) {
      if (el) return;
      el = document.createElement('div');
      el.className = 'ka-msg ka-msg-assistant ka-thinking';
      el.innerHTML = '<div class="tc-msg-text text-mute">Denkt nach …</div>';
      listEl.appendChild(el);
      listEl.scrollTop = listEl.scrollHeight;
    } else if (el) {
      el.remove();
    }
  }

  renderListe();

  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text) return;

    verlauf.push({ role: 'user', content: text });
    renderListe();
    inputEl.value = '';
    inputEl.disabled = true;
    sendBtn.disabled = true;
    setDenktNach(true);

    try {
      const result = await chatMitAssistent({ messages: verlauf });
      setDenktNach(false);
      if (result.error) {
        verlauf.push({ role: 'assistant', content: `Fehler: ${result.error}` });
      } else {
        verlauf.push({ role: 'assistant', content: result.reply || '(keine Antwort)' });
      }
    } catch (err) {
      setDenktNach(false);
      verlauf.push({ role: 'assistant', content: `Fehler: ${err.message}` });
    } finally {
      renderListe();
      inputEl.disabled = false;
      sendBtn.disabled = false;
      inputEl.focus();
    }
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      formEl.requestSubmit();
    }
  });
}
