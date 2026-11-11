// The /voice screen: one big button. Speech is recognised and spoken on the
// phone itself; only the recognised sentence is sent to the server.
import type { Express } from "express";

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#24483E">
<link rel="manifest" href="/manifest.webmanifest">
<title>Steadier Voice</title>
<style>
  :root { color-scheme: light dark; --bg:#f7f8f3; --text:#1d1f1c; --muted:#5f655d; --accent:#24483e; --accent-on:#fff; --listen:#c2410c; --card:#fff; --line:#d9dcd2; }
  @media (prefers-color-scheme: dark) { :root { --bg:#121513; --text:#e9ece7; --muted:#a0a79e; --accent:#7cc4ad; --accent-on:#0f201b; --listen:#fb923c; --card:#1b1f1c; --line:#323832; } }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin:0; background:var(--bg); color:var(--text); font:18px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
         display:flex; flex-direction:column; padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); }
  header { display:flex; justify-content:space-between; align-items:center; }
  header a { color:var(--accent); font-weight:600; text-decoration:none; font-size:16px; }
  main { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:22px; text-align:center; }
  #mic { width:min(62vw, 260px); aspect-ratio:1; border-radius:50%; border:0; background:var(--accent); color:var(--accent-on);
         font:700 22px/1.2 inherit; cursor:pointer; box-shadow:0 10px 30px rgb(0 0 0 / .18); touch-action:manipulation; }
  #mic:focus-visible { outline:4px solid var(--text); outline-offset:4px; }
  #mic.listening { background:var(--listen); animation:pulse 1.3s ease-in-out infinite; }
  #mic.busy { opacity:.7; }
  @keyframes pulse { 50% { transform:scale(1.05); } }
  @media (prefers-reduced-motion: reduce) { #mic.listening { animation:none; } }
  #heard { min-height:1.5em; color:var(--muted); font-style:italic; max-width:32ch; }
  #reply { min-height:3em; font-size:22px; font-weight:600; max-width:30ch; }
  .row { display:flex; gap:12px; }
  .row button { font:600 18px inherit; padding:14px 26px; border-radius:12px; border:1px solid var(--line); background:var(--card); color:var(--text); cursor:pointer; }
  .row button.yes { background:var(--accent); color:var(--accent-on); border-color:transparent; }
  .hint { color:var(--muted); font-size:15px; max-width:34ch; }
</style>
</head>
<body>
<header><strong>Steadier Voice</strong><a href="/">Open Steadier</a></header>
<main>
  <button id="mic" type="button" aria-live="polite">Tap and speak</button>
  <p id="heard"></p>
  <p id="reply" role="status"></p>
  <div class="row" id="choices" hidden>
    <button class="yes" id="yes" type="button">Yes, save</button>
    <button id="no" type="button">No</button>
  </div>
  <p class="hint" id="hint">Try: "Remind me to call the mechanic tomorrow at 10", "Uber shift Friday 4 till 8", or "What's next?"</p>
</main>
<script>
(() => {
  const mic = document.getElementById("mic");
  const heardEl = document.getElementById("heard");
  const replyEl = document.getElementById("reply");
  const choices = document.getElementById("choices");
  const hint = document.getElementById("hint");
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let draft = null;        // proposal waiting for yes/no
  let listening = false;
  let rec = null;

  if (!Recognition) {
    mic.disabled = true;
    mic.textContent = "Voice not supported here";
    hint.textContent = "Open this page in Chrome on your phone.";
    return;
  }

  function setState(state) {
    mic.classList.toggle("listening", state === "listening");
    mic.classList.toggle("busy", state === "busy");
    mic.textContent = state === "listening" ? "Listening…" : state === "busy" ? "Thinking…" : draft ? "Tap to answer" : "Tap and speak";
  }

  function say(text, then) {
    replyEl.textContent = text;
    if (!("speechSynthesis" in window)) { then && then(); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-AU";
    u.onend = () => then && then();
    u.onerror = () => then && then();
    speechSynthesis.speak(u);
  }

  function showChoices(show) { choices.hidden = !show; hint.hidden = show; }

  async function post(path, body) {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
    let data = {};
    try { data = await res.json(); } catch {}
    if (res.status === 401) { location.href = "/login"; throw new Error("signed out"); }
    return data;
  }

  const YES = /^(yes|yeah|yep|yup|sure|ok(ay)?|correct|save( it)?|do it|go ahead|that's right|right)\\b/i;
  const NO = /^(no|nope|nah|cancel|stop|don't|forget it|never mind)\\b/i;

  async function confirm() {
    const proposal = draft;
    draft = null; showChoices(false); setState("busy");
    try {
      const data = await post("/api/voice/confirm", { proposal });
      say(data.speech || "Saved.");
    } catch { say("I couldn't save that. Check your connection."); }
    setState("idle");
  }

  function cancel() {
    draft = null; showChoices(false);
    say("Okay, not saved."); setState("idle");
  }

  async function handle(text) {
    heardEl.textContent = "“" + text + "”";
    if (draft && YES.test(text)) return confirm();
    if (draft && NO.test(text)) return cancel();
    setState("busy");
    try {
      const data = await post("/api/voice/interpret", { text, draft });
      if (data.kind === "confirm") {
        draft = data.proposal; showChoices(true); setState("idle");
        say(data.speech, () => listen());   // listen for yes / no / a correction
      } else {
        draft = null; showChoices(false); setState("idle");
        say(data.speech || "Sorry, something went wrong.");
      }
    } catch (e) {
      setState("idle");
      if (String(e && e.message) !== "signed out") say("I couldn't reach Steadier. Check your connection.");
    }
  }

  function listen() {
    if (listening) { rec && rec.stop(); return; }
    speechSynthesis && speechSynthesis.cancel();
    rec = new Recognition();
    rec.lang = "en-AU";
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    let finalText = "";
    rec.onstart = () => { listening = true; setState("listening"); heardEl.textContent = ""; };
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t; else interim += t;
      }
      heardEl.textContent = (finalText + interim).trim();
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") say("Steadier needs microphone permission. Allow it and try again.");
    };
    rec.onend = () => {
      listening = false; setState("idle");
      const text = finalText.trim();
      if (text) handle(text);
    };
    try { rec.start(); } catch { listening = false; setState("idle"); }
  }

  mic.addEventListener("click", listen);
  document.getElementById("yes").addEventListener("click", confirm);
  document.getElementById("no").addEventListener("click", cancel);
})();
</script>
</body>
</html>`;

export function registerVoicePage(app: Express) {
  app.get("/voice", (_req, res) => {
    res.set("Cache-Control", "no-cache").set("X-Frame-Options", "DENY").type("html").send(PAGE);
  });
}
