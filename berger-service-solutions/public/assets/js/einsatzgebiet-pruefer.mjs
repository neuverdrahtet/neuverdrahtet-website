// PLZ-Schnellprüfung (Startseite, Einsatzgebiet). Läuft vollständig lokal.
import { pruefeEinsatzgebiet, ortZuPlz } from './einsatzgebiet-logik.mjs';

document.querySelectorAll('[data-eg-pruefer]').forEach((form) => {
  const ausgabe = form.querySelector('.eg-ergebnis');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const plz = form.plz.value.trim();
    const ort = ortZuPlz(plz)?.name || '';
    const r = pruefeEinsatzgebiet({ plz, ort });
    ausgabe.className = 'eg-ergebnis';
    if (r.status === 'ungueltig') {
      ausgabe.classList.add('eg-fehler');
      ausgabe.textContent = r.hinweise[0];
      form.plz.setAttribute('aria-invalid', 'true');
      return;
    }
    form.plz.removeAttribute('aria-invalid');
    if (r.status === 'im-gebiet') {
      ausgabe.classList.add('eg-ok');
      ausgabe.innerHTML = '';
      ausgabe.append(`✓ ${r.ort} liegt in unserem Einsatzgebiet (${r.zoneLabel}, ca. ${r.fahrzeitMinGeschaetzt} Min. Anfahrt). `);
      const a = document.createElement('a');
      a.href = `buchen.html?plz=${encodeURIComponent(plz)}`;
      a.textContent = 'Jetzt buchen oder anfragen';
      ausgabe.append(a);
    } else {
      ausgabe.classList.add('eg-warn');
      ausgabe.textContent = r.status === 'ausserhalb'
        ? `${r.ort} liegt außerhalb unseres regulären Einsatzgebiets. Größere Projekte prüfen wir gern individuell.`
        : r.hinweise[0];
    }
  });
});
