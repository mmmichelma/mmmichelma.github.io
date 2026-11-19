'use strict';

/* Spieler-Quiz mit Freischalt-Kette: Nur die richtigen Antworten
   (oder ein Joker-Code der Spielleitung) öffnen die nächste Station. */

const R = window.RALLYE;
const { w3wUrl, toB64, fromB64, tryUnseal, answerKey, jokerKey, stationKey } = window.Rallye;
const $ = (sel, el = document) => el.querySelector(sel);
const app = $('#app');
const KEY = 'gaudi:' + R.salt;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* privater Modus */ }
  scheduleSync();
}

/* ---------- Spielstand im Hintergrund speichern (Google-Tabelle der Spielleitung) ---------- */

const API = R.backend || '';
const teamId = name => String(name).trim().toLowerCase().replace(/\s+/g, ' ');
let syncTimer, syncing = false, dirty = false;

function scheduleSync() {
  if (!API || !state) return;
  dirty = true;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(sync, 400);
}
async function sync() {
  if (!API || !dirty || syncing || !state) return;
  syncing = true; dirty = false;
  try {
    const res = await fetch(API, { method: 'POST', body: JSON.stringify({ state, station: Math.min(solved() + 1, R.count), points: points() }) });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error);
    // Ein anderes Handy desselben Teams ist schon weiter: diesen Stand übernehmen
    if (j.state && j.state.keys.length > state.keys.length) await adopt(j.state);
    syncStatus(true);
  } catch {
    dirty = true; syncStatus(false);
    setTimeout(sync, 15000);
  } finally {
    syncing = false;
    if (dirty && navigator.onLine !== false) scheduleSync();
  }
}
let lastSyncOk = null;
function syncStatus(ok) {
  lastSyncOk = ok;
  const el = $('#sync');
  if (el) el.textContent = ok ? '☁️ gespeichert' : '⚠️ offline – wird nachgeholt';
}
async function loadRemote(name) {
  if (!API) return null;
  const res = await fetch(API + '?action=load&id=' + encodeURIComponent(teamId(name)));
  const j = await res.json();
  return j.ok && j.state && Array.isArray(j.state.keys) ? j.state : null;
}
async function adopt(remote) {
  state = remote;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* egal */ }
  await unlockChain();
  main(false);
  toast('Spielstand von eurem anderen Handy übernommen');
}
addEventListener('online', () => sync());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') sync(); });

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
function buzz(p) { try { navigator.vibrate?.(p); } catch { /* egal */ } }
function fmtTime(ms) {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0');
}

function confetti() {
  const c = $('#confetti'), ctx = c.getContext('2d');
  c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  const colors = ['#f28c18', '#ffd23f', '#3ccf7f', '#3a8ee6', '#e64a8c'];
  const parts = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2, y: innerHeight / 3, vx: (Math.random() - .5) * 14, vy: Math.random() * -14 - 4,
    s: 5 + Math.random() * 6, r: Math.random() * 6, vr: (Math.random() - .5) * .4,
    c: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  (function frame(t) {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += .35; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
    }
    if (t - t0 < 2800) requestAnimationFrame(frame); else ctx.clearRect(0, 0, innerWidth, innerHeight);
  })(t0);
}

/* ---------- Spielstand ---------- */

// state.keys[i] = Schlüssel von Station i (Base64), sobald sie gelöst ist.
// state.st[id] = { vals, first, fo (erster Versuch richtig), sec (Feld-Geheimnisse), tries, joker }
let state = load();
let stations = []; // entschlüsselte Stationen bis zur aktuellen

const stState = id => (state.st[id] ||= { vals: {}, first: null, fo: {}, sec: {}, tries: 0, joker: false });
const fieldsOf = p => p.questions.flatMap((q, qi) => q.fields.map((f, fi) => ({ q, qi, f, fi, k: `${qi}-${fi}` })));
const points = () => Object.values(state.st).reduce((a, s) => a + Object.values(s.fo).filter(Boolean).length, 0);
const solved = () => state.keys.length;
const done = () => solved() >= R.count;

async function unlockChain() {
  stations = [R.stations[0]];
  for (let i = 1; i < R.count && i <= state.keys.length; i++) {
    const bytes = await tryUnseal(fromB64(state.keys[i - 1]), R.stations[i]);
    if (!bytes) { state.keys.length = i - 1; save(); break; } // sollte nicht passieren
    stations.push(JSON.parse(new TextDecoder().decode(bytes)));
  }
}

/* ---------- Ansichten ---------- */

document.title = R.title;
$('#brand').textContent = R.title;

function intro() {
  app.innerHTML = `
    <section class="hero">
      <p class="muted" style="margin:0">${esc(R.subtitle)}</p>
      <h1>${esc(R.title)}</h1>
    </section>
    <div class="card">
      <p class="pre">${esc(R.intro)}</p>
      <p class="small muted">${R.count} Stationen</p>
      <form id="start" class="stack">
        <label>Name eures Autos<input id="team" required maxlength="30" autocomplete="off" placeholder="z. B. Roter Blitz"></label>
        <button class="primary big" id="startbtn">🚗 Anmelden & losfahren</button>
        <p class="small muted center" style="margin:0">Browser geschlossen oder Handy gewechselt? Einfach denselben Autonamen eingeben – ihr macht an derselben Stelle weiter.</p>
      </form>
    </div>
    <a class="orga-link" href="orga.html">🔐 Spielleitung</a>`;
  $('#start').onsubmit = async e => {
    e.preventDefault();
    const name = $('#team').value.trim().replace(/\s+/g, ' ');
    const btn = $('#startbtn');
    btn.disabled = true; btn.textContent = 'Suche Spielstand…';
    let remote = null;
    try { remote = await loadRemote(name); } catch { toast('Keine Verbindung – der Spielstand wird erst mal nur auf diesem Handy gespeichert'); }
    const local = load();
    const candidates = [remote, local && local.keys && teamId(local.team) === teamId(name) ? local : null].filter(Boolean);
    const existing = candidates.sort((a, b) => b.keys.length - a.keys.length)[0];
    if (existing) {
      const where = existing.end ? 'schon im Ziel' : `an Station ${existing.keys.length + 1} von ${R.count}`;
      if (!confirm(`„${existing.team}“ ist schon unterwegs (${where}).\n\nSeid ihr das? Dann geht es genau an dieser Stelle weiter.\n\nAbbrechen = anderen Namen wählen`)) {
        btn.disabled = false; btn.textContent = '🚗 Anmelden & losfahren';
        return;
      }
      state = existing;
      toast('Willkommen zurück! 🚗');
    } else {
      state = { team: name, start: Date.now(), end: null, keys: [], st: {} };
    }
    save(); await unlockChain(); main(false);
  };
}

let tick;
function locationHtml(p) {
  return `${p.w3w.length ? `<div class="w3w">${p.w3w.map(w => `<a class="btn" href="${esc(w3wUrl(w.words))}" target="_blank" rel="noopener"><span>📍 ${esc(w.label)}</span><span class="code"><b>///</b>${esc(w.words)}</span></a>`).join('')}</div>` : ''}
    <p class="ort">📍 ${esc(p.ort)}</p>`;
}

function main(fresh) {
  clearInterval(tick);
  if (done()) return finish(fresh);
  const i = solved(), p = stations[i], ss = stState(p.id);
  const wrongTries = ss.tries;

  app.innerHTML = `
    <div class="hud"><span class="pill">⏱ <span id="clock">${fmtTime(Date.now() - state.start)}</span></span>
      <span>${esc(state.team)}</span><span class="pill">⭐ ${points()}</span></div>
    ${API ? `<p class="small muted center" id="sync" style="margin:-4px 0 6px">${lastSyncOk === false ? '⚠️ offline – wird nachgeholt' : '☁️ gespeichert'}</p>` : ''}
    <div class="progress"><div style="width:${i / R.count * 100}%"></div></div>

    ${stations.slice(0, i).map((s, j) => {
      const x = state.st[s.id];
      const got = Object.values(x.fo).filter(Boolean).length;
      return `<div class="card done-row"><span class="num">✓</span><span><b>${j + 1}. ${esc(s.title)}</b>
        <small>${x.joker ? '🃏 Joker' : `${got} Punkt${got === 1 ? '' : 'e'}`}</small></span></div>`;
    }).join('')}

    <div class="card current ${fresh && i > 0 ? 'pop' : ''}">
      ${fresh && i > 0 ? '<p class="unlocked">🎉 Richtig! Euer nächstes Ziel ist freigeschaltet:</p>' : ''}
      <p class="small muted" style="margin:0">Station ${i + 1} von ${R.count}</p>
      <h2>${esc(p.title)}</h2>
      ${locationHtml(p)}
      ${p.text ? `<p class="pre">${esc(p.text)}</p>` : ''}
      <form id="answer">
        ${p.questions.map((q, qi) => `
          <div class="question"><p>${esc(q.q)}</p>
            ${q.fields.map((f, fi) => {
              const k = `${qi}-${fi}`, v = ss.vals[k] ?? '', ok = ss.sec[k] || (f.open && ss.first);
              const bad = !ok && ss.first && !f.open;
              if (q.type === 'mc') return `<div class="choices">${q.options.map(o =>
                `<button type="button" class="choice ${v === o ? 'sel' : ''} ${v === o && ok ? 'ok' : v === o && bad ? 'bad' : ''}" data-k="${k}" data-v="${esc(o)}" ${ok ? 'disabled' : ''}>${esc(o)}</button>`).join('')}</div>`;
              return `<div class="field ${ok ? 'ok' : bad ? 'bad' : ''}">${f.label ? `<span class="lbl">${esc(f.label)}</span>` : ''}
                <input data-k="${k}" value="${esc(v)}" autocomplete="off" ${q.type === 'num' ? 'inputmode="decimal"' : ''} placeholder="${q.type === 'num' ? 'Zahl' : 'Antwort'}" ${ok ? 'disabled' : ''}>
                <span class="mark">${ok ? (f.open ? '📝' : '✅') : bad ? '❌' : ''}</span></div>`;
            }).join('')}
            ${q.fields.some(f => f.open) ? '<p class="open-note">📝 Schätzfrage – die Spielleitung wertet sie später. Jede Antwort bringt euch weiter.</p>' : ''}
          </div>`).join('')}
        <button class="primary big" id="check">🔓 Antworten prüfen & weiter</button>
      </form>
      ${wrongTries ? `<p class="small muted center" style="margin:10px 0 0">${wrongTries === 1 ? 'Punkte zählen nur für den ersten Versuch – aber probiert weiter, bis alles stimmt!' : `${wrongTries} Versuche`}</p>` : ''}
      ${wrongTries >= 2 ? `<details class="joker"><summary>🃏 Ihr kommt nicht weiter?</summary>
        <p class="small">Ruft die Spielleitung an und lasst euch den Joker-Code für diese Station geben. Mit Joker gibt es für die Station keine Punkte.</p>
        <form id="jokerform" class="row"><input id="jokercode" inputmode="numeric" autocomplete="off" placeholder="Joker-Code" style="flex:1;margin:0"><button class="primary">Einlösen</button></form>
      </details>` : ''}
    </div>

    ${Array.from({ length: R.count - i - 1 }, (_, j) => `<div class="card locked"><span class="num">🔒</span><span>Station ${i + j + 2}</span></div>`).join('')}
    <a class="orga-link" href="orga.html">🔐 Spielleitung</a>`;

  tick = setInterval(() => { const c = $('#clock'); if (c) c.textContent = fmtTime(Date.now() - state.start); }, 1000);
  if (fresh && i > 0) { confetti(); buzz(120); $('.current').scrollIntoView({ behavior: 'smooth', block: 'start' }); }

  const form = $('#answer');
  form.oninput = e => { const k = e.target.dataset.k; if (k) { ss.vals[k] = e.target.value; save(); } };
  form.onclick = e => {
    const b = e.target.closest('.choice'); if (!b || b.disabled) return;
    form.querySelectorAll(`.choice[data-k="${b.dataset.k}"]`).forEach(x => x.classList.toggle('sel', x === b));
    ss.vals[b.dataset.k] = b.dataset.v; save();
  };
  form.onsubmit = async e => {
    e.preventDefault();
    const btn = $('#check');
    const fields = fieldsOf(p);
    if (fields.some(x => !String(ss.vals[x.k] ?? '').trim())) return toast('Bitte erst alle Fragen beantworten');
    btn.disabled = true; btn.textContent = 'Prüfe…';

    const firstTry = !ss.first;
    if (firstTry) ss.first = { ...ss.vals };
    for (const x of fields) {
      if (x.f.open || ss.sec[x.k]) continue;
      const key = await answerKey(R.salt, `${p.id}|${x.qi}|${x.fi}`, x.q.type, ss.vals[x.k]);
      for (const w of x.f.wraps) {
        const secret = await tryUnseal(key, w);
        if (secret) { ss.sec[x.k] = toB64(secret); break; }
      }
      if (firstTry) ss.fo[x.k] = !!ss.sec[x.k];
    }
    const gated = fields.filter(x => !x.f.open);
    if (gated.every(x => ss.sec[x.k])) {
      const key = gated.length ? await stationKey(gated.map(x => fromB64(ss.sec[x.k]))) : fromB64(p.free);
      await advance(key);
    } else {
      ss.tries++; save(); buzz([80, 60, 80]);
      const wrong = gated.filter(x => !ss.sec[x.k]).length;
      toast(wrong === 1 ? 'Eine Antwort stimmt noch nicht' : `${wrong} Antworten stimmen noch nicht`);
      main(false);
      const c = $('.current'); c.classList.add('shake');
    }
  };
  $('#jokerform')?.addEventListener('submit', async e => {
    e.preventDefault();
    const key = await tryUnseal(await jokerKey(R.salt, p.id, $('#jokercode').value), p.joker);
    if (!key) return toast('Falscher Joker-Code');
    if (!ss.first) ss.first = { ...ss.vals };
    ss.joker = true;
    await advance(key);
  });
}

async function advance(key) {
  state.keys.push(toB64(key));
  if (done()) state.end = Date.now();
  save();
  await unlockChain();
  main(true);
}

/* ---------- Ergebnis ---------- */

// Kompakter Ergebnis-Code für die Rangliste der Spielleitung (dort wird neu gewertet)
function resultLink() {
  const st = {};
  for (const p of stations) {
    const x = state.st[p.id];
    if (x?.first) st[p.id] = { f: x.first, v: x.vals, j: x.joker, n: x.tries };
  }
  const payload = { v: 2, t: state.team, s: state.start, e: state.end, st };
  const code = toB64(new TextEncoder().encode(JSON.stringify(payload))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return new URL('orga.html#e=' + code, location.href).href;
}

function finish(fresh) {
  clearInterval(tick);
  if (fresh) confetti();
  const jokers = Object.values(state.st).filter(x => x.joker).length;
  const msg = `🏁 ${R.title} – Auto „${state.team}“\n✅ Alle ${R.count} Stationen geschafft · ⏱ ${fmtTime(state.end - state.start)}\n⭐ ${points()} Punkte im ersten Versuch${jokers ? ` · 🃏 ${jokers} Joker` : ''}\n\n👉 Für die Wertung (Spielleitung antippen):\n${resultLink()}`;
  app.innerHTML = `
    <div class="card center pop">
      <div style="font-size:3rem">🏆</div>
      <h1>Ziel erreicht, ${esc(state.team)}!</h1>
      <p class="score">${points()}</p>
      <p class="muted">Punkte · Zeit ${fmtTime(state.end - state.start)}${jokers ? ` · ${jokers} Joker` : ''}</p>
      <p class="small"><b>Wichtig:</b> Schickt jetzt euer Ergebnis an die Spielleitung, sonst landet ihr nicht in der Rangliste.</p>
      <div class="row" style="justify-content:center">
        <a class="btn primary" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">💬 Ergebnis an Spielleitung senden</a>
        <button id="copy">📋 Kopieren</button>
      </div>
    </div>
    <div class="card"><table class="results">${stations.map((s, i) => {
      const x = state.st[s.id], got = Object.values(x.fo).filter(Boolean).length;
      return `<tr><td>${i + 1}. ${esc(s.title)}</td><td>${x.joker ? '🃏' : `${got} P.`}</td></tr>`;
    }).join('')}</table></div>
    <button id="reset" class="ghost danger small">Spielstand löschen</button>`;
  $('#copy').onclick = async () => {
    try { await navigator.clipboard.writeText(msg); toast('Kopiert – ab in die Gruppe!'); }
    catch { prompt('Ergebnis kopieren:', msg); }
  };
  $('#reset').onclick = () => {
    if (!confirm('Wirklich alles löschen? Dann müsst ihr die ganze Rallye neu fahren.')) return;
    try { localStorage.removeItem(KEY); } catch { /* egal */ }
    state = null; intro();
  };
}

// Display anlassen, solange die Seite offen ist
async function wake() { try { if (document.visibilityState === 'visible') await navigator.wakeLock?.request('screen'); } catch { /* egal */ } }
document.addEventListener('visibilitychange', wake);
wake();

(async () => {
  if (!state || !Array.isArray(state.keys)) return intro();
  await unlockChain();
  main(false);
  // Vielleicht war das Team inzwischen auf einem anderen Handy weiter
  try {
    const remote = await loadRemote(state.team);
    if (remote && remote.keys.length > state.keys.length) await adopt(remote);
    else if (API) { dirty = true; sync(); }
  } catch { /* offline: lokal weiterspielen */ }
})();
