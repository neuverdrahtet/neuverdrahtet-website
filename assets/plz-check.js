(function () {
  var form = document.getElementById('plz-check-form');
  if (!form) return;

  var input = document.getElementById('plz-check-input');
  var result = document.getElementById('plz-check-result');

  var ranges = [
    [45117, 45359], // Essen
    [45468, 45481],  // Mülheim an der Ruhr
    [45879, 45899],  // Gelsenkirchen
    [46045, 46149],  // Oberhausen
    [46236, 46244],  // Bottrop
    [44787, 44894],  // Bochum
    [47051, 47279]   // Duisburg
  ];

  function isCovered(plz) {
    for (var i = 0; i < ranges.length; i++) {
      if (plz >= ranges[i][0] && plz <= ranges[i][1]) return true;
    }
    return false;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var raw = (input.value || '').trim();
    if (!/^\d{5}$/.test(raw)) {
      result.textContent = 'Bitte eine 5-stellige Postleitzahl eingeben.';
      result.className = 'plz-check-result plz-check-warn';
      return;
    }
    var plz = parseInt(raw, 10);
    if (isCovered(plz)) {
      result.textContent = 'Essen und Ruhrgebiet: ' + raw + ' liegt in unserem Einsatzgebiet.';
      result.className = 'plz-check-result plz-check-ok';
    } else {
      result.textContent = raw + ' liegt außerhalb unseres üblichen Einsatzgebiets — bei Projekten in der Nähe gerne trotzdem anfragen.';
      result.className = 'plz-check-result plz-check-warn';
    }
  });
})();
