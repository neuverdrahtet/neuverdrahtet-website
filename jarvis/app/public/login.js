const e = new URLSearchParams(location.search).get("e");
if (e) {
  const el = document.getElementById("err");
  el.textContent = e === "gesperrt"
    ? "Zu viele Fehlversuche. Bitte 15 Minuten warten."
    : "Passwort falsch.";
  el.hidden = false;
}
