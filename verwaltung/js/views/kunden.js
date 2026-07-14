import { getAll, put, remove } from '../db.js';
import { uid, escapeHtml, el, toast } from '../utils.js';
import { openModal, confirmDelete } from '../ui.js';
import * as google from '../google.js';

export async function render(container) {
  let kunden = await getAll('kunden');
  kunden.sort((a, b) => (a.firma || '').localeCompare(b.firma || ''));
  let filtered = kunden;

  container.innerHTML = `
    <div class="view-header">
      <h1>Kunden</h1>
      <div class="actions">
        <button class="btn btn-primary" id="btn-new">+ Neuer Kunde</button>
      </div>
    </div>
    <div class="search-bar">
      <input type="search" id="search" placeholder="Suche nach Firma, Ansprechpartner, Ort ...">
    </div>
    <div id="table-host"></div>
  `;

  const tableHost = container.querySelector('#table-host');

  function renderTable() {
    if (filtered.length === 0) {
      tableHost.innerHTML = `<div class="empty-state">Keine Kunden gefunden.</div>`;
      return;
    }
    tableHost.innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>Firma / Name</th><th>Ansprechpartner</th><th>Ort</th><th>Telefon</th><th>E-Mail</th>
        </tr></thead>
        <tbody>
          ${filtered.map((k) => `
            <tr data-id="${k.id}">
              <td>${escapeHtml(k.firma)}</td>
              <td>${escapeHtml(k.ansprechpartner || '')}</td>
              <td>${escapeHtml(k.ort || '')}</td>
              <td>${escapeHtml(k.telefon || '')}</td>
              <td>${escapeHtml(k.email || '')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    tableHost.querySelectorAll('tbody tr').forEach((row) => {
      row.addEventListener('click', () => {
        const kunde = kunden.find((k) => k.id === row.dataset.id);
        openForm(kunde);
      });
    });
  }

  container.querySelector('#search').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    filtered = kunden.filter((k) =>
      [k.firma, k.ansprechpartner, k.ort, k.email, k.telefon].filter(Boolean).join(' ').toLowerCase().includes(q)
    );
    renderTable();
  });

  container.querySelector('#btn-new').addEventListener('click', () => openForm());

  function openForm(kunde) {
    const isEdit = !!kunde;
    const data = kunde || { id: uid(), firma: '', ansprechpartner: '', strasse: '', plz: '', ort: '', telefon: '', email: '', notizen: '' };
    const { body, close } = openModal({
      title: isEdit ? 'Kunde bearbeiten' : 'Neuer Kunde',
      bodyHtml: `
        <form id="kunde-form">
          <div class="form-grid">
            <div class="field col-span-2"><label>Firma / Name *</label><input name="firma" required value="${escapeHtml(data.firma)}"></div>
            <div class="field"><label>Ansprechpartner</label><input name="ansprechpartner" value="${escapeHtml(data.ansprechpartner || '')}"></div>
            <div class="field"><label>Telefon</label><input name="telefon" value="${escapeHtml(data.telefon || '')}"></div>
            <div class="field"><label>E-Mail</label><input type="email" name="email" value="${escapeHtml(data.email || '')}"></div>
            <div class="field"><label>Straße & Hausnr.</label><input name="strasse" value="${escapeHtml(data.strasse || '')}"></div>
            <div class="field"><label>PLZ</label><input name="plz" value="${escapeHtml(data.plz || '')}"></div>
            <div class="field"><label>Ort</label><input name="ort" value="${escapeHtml(data.ort || '')}"></div>
            <div class="field col-span-2"><label>Notizen</label><textarea name="notizen">${escapeHtml(data.notizen || '')}</textarea></div>
          </div>
          ${isEdit && data.email ? `
            <div class="divider"></div>
            <div class="flex-row" style="justify-content:space-between;margin-bottom:8px">
              <h2 style="font-size:14px;margin:0">E-Mail-Verlauf (Gmail)</h2>
              <button type="button" class="btn btn-sm" id="btn-load-emails">E-Mails laden</button>
            </div>
            <div id="email-history"><p class="text-mute">Noch nicht geladen.</p></div>
          ` : ''}
          <div class="modal-actions">
            ${isEdit ? '<button type="button" class="btn btn-danger" id="btn-delete">Löschen</button>' : ''}
            <span class="spacer"></span>
            <button type="button" class="btn" id="btn-cancel">Abbrechen</button>
            <button type="submit" class="btn btn-primary">Speichern</button>
          </div>
        </form>
      `,
    });

    body.querySelector('#btn-cancel').addEventListener('click', close);
    if (isEdit) {
      body.querySelector('#btn-delete').addEventListener('click', async () => {
        if (!confirmDelete(`Kunde "${data.firma}" wirklich löschen?`)) return;
        await remove('kunden', data.id);
        toast('Kunde gelöscht');
        close();
        render(container);
      });
      const loadEmailsBtn = body.querySelector('#btn-load-emails');
      if (loadEmailsBtn) {
        loadEmailsBtn.addEventListener('click', async () => {
          const host = body.querySelector('#email-history');
          loadEmailsBtn.disabled = true;
          loadEmailsBtn.textContent = 'Lädt ...';
          host.innerHTML = '<p class="text-mute">Lädt ...</p>';
          try {
            const emails = await google.searchEmailsForAddress(data.email);
            host.innerHTML = emails.length === 0
              ? '<p class="text-mute">Keine E-Mails gefunden.</p>'
              : `<ul class="cal-event-list">${emails.map((m) => `
                  <li>
                    <div>
                      <strong>${escapeHtml(m.subject)}</strong>
                      <div class="text-mute">${escapeHtml(m.from)} · ${escapeHtml(m.date)}</div>
                      <div class="text-mute">${escapeHtml(m.snippet)}</div>
                    </div>
                    <a class="btn btn-sm" href="https://mail.google.com/mail/u/0/#all/${m.threadId}" target="_blank" rel="noopener">Öffnen</a>
                  </li>
                `).join('')}</ul>`;
          } catch (err) {
            host.innerHTML = `<p class="text-mute">Fehler: ${escapeHtml(err.message)}</p>`;
          }
          loadEmailsBtn.disabled = false;
          loadEmailsBtn.textContent = 'E-Mails laden';
        });
      }
    }

    body.querySelector('#kunde-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const updated = { ...data };
      for (const [k, v] of fd.entries()) updated[k] = v.trim ? v.trim() : v;
      if (!updated.firma) return;
      await put('kunden', updated);
      toast(isEdit ? 'Kunde aktualisiert' : 'Kunde angelegt', 'success');
      close();
      render(container);
    });
  }

  renderTable();
}
