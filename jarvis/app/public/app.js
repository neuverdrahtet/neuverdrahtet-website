"use strict";

const $ = (id) => document.getElementById(id);
const els = {
  state: $("state"), caption: $("caption"), log: $("log"), text: $("text"), composer: $("composer"),
  talk: $("talk"), core: $("core"), wave: $("wave"), mute: $("muteBtn"), clear: $("clearBtn"),
  chatToggle: $("chatToggle"), clock: $("clock"),
  chipHermes: $("chipHermes"), chipModel: $("chipModel"), chipVoice: $("chipVoice"),
};

const STATE_LABEL = { idle: "Bereit", listening: "Höre zu", thinking: "Denke nach", speaking: "Spreche" };
const HISTORY_KEY = "jarvis.history";
const MAX_HISTORY = 40;

let state = "idle";
let active = false;          // Gespräch läuft
let muted = false;
let ttsMode = "elevenlabs";  // fällt auf "browser" zurück, wenn der Server keine Stimme hat
let gen = 0;                 // Generationszähler: jede Unterbrechung startet eine neue Generation
let controller = null;
let history = loadHistory();

// ---------------- Hilfen ----------------
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
}
function saveHistory() {
  history = history.slice(-MAX_HISTORY);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch { /* privat/gesperrt */ }
}
function setState(s) {
  state = s;
  document.body.dataset.state = s;
  els.state.textContent = STATE_LABEL[s];
}
function addBubble(role, text) {
  const li = document.createElement("li");
  li.className = role;
  li.textContent = text;
  els.log.appendChild(li);
  els.log.scrollTop = els.log.scrollHeight;
  return li;
}
function normalize(t) {
  return t.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
}
function stripForSpeech(t) {
  return t
    .replace(/```[\s\S]*?```/g, " Codeblock im Chat. ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "Link im Chat")
    .replace(/[*_#`>|~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------- Status & Uhr ----------------
function tickClock() {
  els.clock.textContent = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}
async function refreshStatus() {
  try {
    const r = await fetch("/api/status", { cache: "no-store" });
    if (r.status === 401) return location.assign("/login");
    const s = await r.json();
    els.chipHermes.className = "chip " + (s.hermes ? "ok" : "bad");
    els.chipModel.className = "chip " + (s.model ? "ok" : "");
    els.chipModel.querySelector("span").textContent = s.model || "Modell";
    els.chipVoice.className = "chip ok";
    els.chipVoice.querySelector("span").textContent = s.voice === "elevenlabs" ? "ElevenLabs" : "Browser-Stimme";
    ttsMode = s.voice;
  } catch {
    els.chipHermes.className = "chip bad";
  }
}

// ---------------- Freigaben für ausgehende Aktionen ----------------
const shownApprovals = new Map();
async function pollApprovals() {
  try {
    const r = await fetch("/api/approvals", { cache: "no-store" });
    if (!r.ok) return;
    const { items } = await r.json();
    const live = new Set(items.map((i) => i.id));
    for (const [id, card] of shownApprovals) {
      if (!live.has(id) && !card.dataset.decided) { card.remove(); shownApprovals.delete(id); }
    }
    for (const item of items) if (!shownApprovals.has(item.id)) showApproval(item);
  } catch { /* offline */ }
}
function showApproval(item) {
  const li = document.createElement("li");
  li.className = "approval";
  const title = document.createElement("strong");
  title.textContent = "Freigabe nötig";
  const pre = document.createElement("pre");
  pre.textContent = item.preview;
  const row = document.createElement("div");
  const yes = document.createElement("button");
  yes.type = "button"; yes.className = "approve"; yes.textContent = "Freigeben";
  const no = document.createElement("button");
  no.type = "button"; no.className = "ghost small"; no.textContent = "Ablehnen";
  row.append(yes, no);
  li.append(title, pre, row);
  els.log.appendChild(li);
  els.log.scrollTop = els.log.scrollHeight;
  shownApprovals.set(item.id, li);
  document.body.classList.add("chat-open");
  const decide = async (decision) => {
    yes.disabled = no.disabled = true;
    const r = await fetch(`/api/approvals/${item.id}/${decision}`, { method: "POST", headers: { "X-Jarvis": "1" } });
    if (!r.ok) { title.textContent = "Freigabe abgelaufen – bitte JARVIS erneut fragen"; return; }
    li.dataset.decided = decision;
    title.textContent = decision === "approve" ? "✔ Freigegeben" : "✘ Abgelehnt";
    send(decision === "approve"
      ? `Freigegeben (ID ${item.id}). Führe exakt denselben Aufruf jetzt aus.`
      : `Abgelehnt (ID ${item.id}). Nicht senden.`);
  };
  yes.addEventListener("click", () => decide("approve"));
  no.addEventListener("click", () => decide("reject"));
}

// ---------------- Sprachausgabe (satzweise gestreamt) ----------------
const audioEl = new Audio();
audioEl.preload = "auto";
let queue = [];
let playing = false;
let streamDone = true;
let currentSpoken = "";
let lastSpeechEnd = 0;
let lastReply = "";

function silentWav() {
  const n = 800, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, str) => [...str].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, n * 2, true);
  return new Blob([buf], { type: "audio/wav" });
}

function unlockAudio() {
  // iOS/Safari: Audio muss einmal innerhalb einer Nutzeraktion gestartet werden.
  audioEl.src = URL.createObjectURL(silentWav());
  audioEl.play().catch(() => {});
  if ("speechSynthesis" in window) speechSynthesis.getVoices();
}

async function fetchTts(text, myGen) {
  if (ttsMode !== "elevenlabs") return null;
  try {
    const r = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Jarvis": "1" },
      body: JSON.stringify({ text }),
      signal: controller?.signal,
    });
    if (r.status === 404) { ttsMode = "browser"; return null; }
    if (!r.ok) { console.warn("TTS", r.status, await r.text()); return null; }
    const blob = await r.blob();
    if (myGen !== gen) return null;
    return URL.createObjectURL(blob);
  } catch { return null; }
}

function enqueueSpeech(raw) {
  if (muted || !active) return;
  const text = stripForSpeech(raw);
  if (!text) return;
  const myGen = gen;
  queue.push({ text, audio: fetchTts(text, myGen), gen: myGen }); // sofort vorladen = kaum Pausen
  if (!playing) playNext();
}

function speakBrowser(text, done) {
  if (!("speechSynthesis" in window)) return done();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "de-DE";
  const de = speechSynthesis.getVoices().find((v) => v.lang?.startsWith("de"));
  if (de) u.voice = de;
  u.onend = u.onerror = done;
  speechSynthesis.speak(u);
}

async function playNext() {
  const item = queue.shift();
  if (!item) {
    playing = false;
    if (streamDone) finishTurn();
    return;
  }
  playing = true;
  setState("speaking");
  currentSpoken = item.text;
  const url = await item.audio;
  if (item.gen !== gen) return;
  const next = () => { if (item.gen === gen) playNext(); };
  if (url) {
    audioEl.onended = () => { URL.revokeObjectURL(url); next(); };
    audioEl.onerror = next;
    audioEl.src = url;
    audioEl.play().catch(next);
  } else {
    speakBrowser(item.text, next);
  }
}

function finishTurn() {
  lastSpeechEnd = Date.now();
  currentSpoken = "";
  if (state !== "idle") setState(active ? "listening" : "idle");
}

function interrupt() {
  gen++;
  controller?.abort();
  controller = null;
  queue = [];
  playing = false;
  streamDone = true;
  audioEl.pause();
  audioEl.removeAttribute("src");
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  setState(active ? "listening" : "idle");
}

// ---------------- Chat mit Hermes (SSE-Streaming) ----------------
async function send(text) {
  text = text.trim();
  if (!text) return;
  if (state === "thinking" || state === "speaking") interrupt();
  history.push({ role: "user", content: text });
  saveHistory();
  addBubble("user", text);

  const myGen = ++gen;
  controller = new AbortController();
  streamDone = false;
  setState("thinking");
  const bubble = addBubble("assistant pending", "");
  let reply = "";
  let buf = "";

  const flushSentences = (final) => {
    for (;;) {
      const m = buf.match(/[.!?…](?=\s)|\n/);
      const min = queue.length || playing ? 60 : 18; // erster Satz früh, danach größere Stücke
      if (!m || (m.index + 1 < min && !final)) break;
      enqueueSpeech(buf.slice(0, m.index + 1));
      buf = buf.slice(m.index + 1);
    }
    if (final && buf.trim()) { enqueueSpeech(buf); buf = ""; }
  };

  try {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Jarvis": "1" },
      body: JSON.stringify({ messages: history }),
      signal: controller.signal,
    });
    if (r.status === 401) return location.assign("/login");
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error((e.error || r.status) + (e.detail ? ": " + e.detail.slice(0, 200) : ""));
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let sse = "";
    let event = "message";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      sse += dec.decode(value, { stream: true });
      let nl;
      while ((nl = sse.indexOf("\n")) >= 0) {
        const line = sse.slice(0, nl).replace(/\r$/, "");
        sse = sse.slice(nl + 1);
        if (line === "") { event = "message"; continue; }
        if (line.startsWith(":")) continue;
        if (line.startsWith("event:")) { event = line.slice(6).trim(); continue; }
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        let obj;
        try { obj = JSON.parse(data); } catch { continue; }
        if (event === "hermes.tool.progress") {
          els.caption.textContent = "⚙ " + (obj.label || obj.tool || obj.name || "Werkzeug läuft …");
          continue;
        }
        const delta = obj.choices?.[0]?.delta?.content;
        if (delta && myGen === gen) {
          reply += delta;
          bubble.textContent = reply;
          els.caption.textContent = reply.slice(-160);
          els.log.scrollTop = els.log.scrollHeight;
          buf += delta;
          flushSentences(false);
        }
      }
    }
    if (myGen !== gen) return;
    flushSentences(true);
    streamDone = true;
    bubble.classList.remove("pending");
    if (!reply) bubble.textContent = "(keine Antwort)";
    history.push({ role: "assistant", content: reply });
    lastReply = reply;
    saveHistory();
    if (!playing && !queue.length) finishTurn();
  } catch (err) {
    bubble.classList.remove("pending");
    if (err.name === "AbortError") {
      if (reply) {
        bubble.textContent = reply + " …";
        history.push({ role: "assistant", content: reply + " … (unterbrochen)" });
        saveHistory();
      } else bubble.remove();
      return;
    }
    bubble.remove();
    addBubble("system", "Fehler: " + err.message);
    streamDone = true;
    setState(active ? "listening" : "idle");
  }
}

// ---------------- Spracheingabe (Browser-Mikrofon) ----------------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
let finalBuf = "";
let sendTimer = null;
const PAUSE_MS = 900; // Sprechpause, nach der automatisch gesendet wird

function isEcho(text) {
  // Mikrofon hört die eigene Sprachausgabe? -> nicht als Nutzer werten
  const recent = state === "speaking" || Date.now() - lastSpeechEnd < 1500;
  if (!recent) return false;
  const words = normalize(text);
  const spoken = new Set(normalize(currentSpoken + " " + lastReply));
  if (!words.length) return true;
  const hits = words.filter((w) => spoken.has(w)).length;
  return hits / words.length > 0.6;
}

function startRecognition() {
  if (!SR) {
    addBubble("system", "Dieser Browser unterstützt keine Spracheingabe. Bitte Chrome, Edge oder Safari nutzen – oder im Chat tippen.");
    return false;
  }
  rec = new SR();
  rec.lang = "de-DE";
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) {
        if (!isEcho(t)) finalBuf += " " + t;
      } else interim += t;
    }
    const heard = (finalBuf + " " + interim).trim();
    if (interim && !isEcho(interim)) {
      // Unterbrechen: Nutzer spricht, während JARVIS denkt oder spricht
      if ((state === "speaking" || state === "thinking") && normalize(interim).length >= 2) interrupt();
      clearTimeout(sendTimer);
      els.caption.textContent = "„" + heard + "“";
    }
    if (finalBuf.trim()) {
      clearTimeout(sendTimer);
      sendTimer = setTimeout(() => {
        const text = finalBuf.trim();
        finalBuf = "";
        if (text) send(text);
      }, PAUSE_MS);
    }
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      addBubble("system", "Mikrofon blockiert. Bitte in den Browser-Einstellungen den Mikrofonzugriff für diese Seite erlauben.");
      stopConversation();
    }
  };
  rec.onend = () => {
    if (active) setTimeout(() => { try { rec.start(); } catch { /* läuft schon */ } }, 250);
  };
  try { rec.start(); } catch { /* läuft schon */ }
  return true;
}

function startConversation() {
  unlockAudio();
  active = true;
  els.talk.textContent = "Gespräch beenden";
  els.talk.classList.add("active");
  setState("listening");
  els.caption.textContent = "Ich höre zu …";
  if (!startRecognition()) stopConversation();
}

function stopConversation() {
  active = false;
  clearTimeout(sendTimer);
  finalBuf = "";
  try { rec?.abort(); } catch { /* egal */ }
  rec = null;
  interrupt();
  els.talk.textContent = "Gespräch beginnen";
  els.talk.classList.remove("active");
  els.caption.textContent = "";
  setState("idle");
}

// ---------------- Energie-Welle um den Kern ----------------
const ctx = els.wave.getContext("2d");
let level = 0;
function resizeCanvas() {
  const r = els.wave.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  els.wave.width = r.width * dpr;
  els.wave.height = r.height * dpr;
}
function draw(t) {
  const target = { idle: 0.08, listening: 0.25, thinking: 0.45, speaking: 0.75 }[state];
  const wobble = state === "speaking" ? Math.abs(Math.sin(t / 110) * Math.sin(t / 47)) * 0.6 : 0;
  level += (target + wobble - level) * 0.12;
  document.documentElement.style.setProperty("--level", (level * 0.6).toFixed(3));

  const w = els.wave.width, h = els.wave.height, cx = w / 2, cy = h / 2;
  const base = Math.min(w, h) * 0.3;
  ctx.clearRect(0, 0, w, h);
  ctx.globalCompositeOperation = "lighter";
  for (let layer = 0; layer < 3; layer++) {
    ctx.beginPath();
    const n = 160;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const amp = base * 0.09 * level * (1 + layer * 0.5);
      const r = base * (1 + layer * 0.06) +
        amp * Math.sin(a * (5 + layer * 2) + t / (420 - layer * 90)) +
        amp * 0.6 * Math.sin(a * (11 + layer) - t / 260);
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.strokeStyle = ["rgba(255,210,122,.75)", "rgba(255,160,40,.45)", "rgba(255,110,0,.3)"][layer];
    ctx.lineWidth = (2.2 - layer * 0.5) * (window.devicePixelRatio || 1);
    ctx.shadowColor = "rgba(255,140,0,.9)";
    ctx.shadowBlur = 18 + 30 * level;
    ctx.stroke();
  }
  requestAnimationFrame(draw);
}

// ---------------- Verdrahtung ----------------
els.talk.addEventListener("click", () => (active ? stopConversation() : startConversation()));
els.core.addEventListener("click", () => {
  if (state === "speaking" || state === "thinking") interrupt();
  else if (!active) startConversation();
});
els.composer.addEventListener("submit", (e) => {
  e.preventDefault();
  const t = els.text.value;
  els.text.value = "";
  send(t);
});
els.mute.addEventListener("click", () => {
  muted = !muted;
  els.mute.textContent = muted ? "Ton aus" : "Ton an";
  els.mute.setAttribute("aria-pressed", String(muted));
  if (muted) { queue = []; audioEl.pause(); if ("speechSynthesis" in window) speechSynthesis.cancel(); }
});
els.clear.addEventListener("click", () => {
  history = [];
  saveHistory();
  els.log.innerHTML = "";
});
els.chatToggle.addEventListener("click", () => {
  const open = document.body.classList.toggle("chat-open");
  els.chatToggle.setAttribute("aria-expanded", String(open));
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && (state === "speaking" || state === "thinking")) interrupt();
});
window.addEventListener("resize", resizeCanvas);

for (const m of history) addBubble(m.role, m.content);
setState("idle");
tickClock();
setInterval(tickClock, 10000);
refreshStatus();
setInterval(refreshStatus, 30000);
pollApprovals();
setInterval(pollApprovals, 2500);
resizeCanvas();
requestAnimationFrame(draw);
