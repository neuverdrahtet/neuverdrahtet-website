// Navigation: mobiles Menü und Leistungs-Megamenü (ohne Abhängigkeiten).
(function () {
  var html = document.documentElement;
  var schalter = document.querySelector('.nav-schalter');
  var mega = document.querySelector('.mega-schalter');
  var nav = document.getElementById('hauptnav');

  function menueSetzen(offen) {
    // Menü beginnt genau unter der Kopfzeile (Statusband darüber ist variabel hoch).
    var kopf = document.getElementById('kopf');
    if (offen && kopf) html.style.setProperty('--kopf-unten', Math.round(kopf.getBoundingClientRect().bottom) + 'px');
    html.classList.toggle('nav-offen', offen);
    if (schalter) {
      schalter.setAttribute('aria-expanded', String(offen));
      var sr = schalter.querySelector('.nur-sr');
      if (sr) sr.textContent = offen ? 'Menü schließen' : 'Menü öffnen';
    }
    document.body.style.overflow = offen && window.innerWidth < 1080 ? 'hidden' : '';
  }
  function megaSetzen(offen) { if (mega) mega.setAttribute('aria-expanded', String(offen)); }

  if (schalter) schalter.addEventListener('click', function () { menueSetzen(!html.classList.contains('nav-offen')); });
  if (mega) mega.addEventListener('click', function () { megaSetzen(mega.getAttribute('aria-expanded') !== 'true'); });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (mega && mega.getAttribute('aria-expanded') === 'true') { megaSetzen(false); mega.focus(); }
    else if (html.classList.contains('nav-offen')) { menueSetzen(false); if (schalter) schalter.focus(); }
  });
  document.addEventListener('click', function (e) {
    if (window.innerWidth >= 1080 && mega && nav && !nav.contains(e.target)) megaSetzen(false);
  });
  window.addEventListener('resize', function () { if (window.innerWidth >= 1080) menueSetzen(false); });
})();
