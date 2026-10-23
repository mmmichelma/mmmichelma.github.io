'use strict';

/* Spieler-Quiz: Fragen aus fragen.js, Lösungen nur als Prüfsumme. */

const R = window.RALLYE;
const { hashAnswer, w3wUrl } = window.Rallye;
const $ = (sel, el = document) => el.querySelector(sel);
const app = $('#app');
const KEY = 'gaudi:' + R.salt;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* privater Modus */ } }

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

let state = load();
const stState = id => (state.st[id] ||= { vals: {}, ok: {}, checked: false });
const allFields = s => s.questions.flatMap((q, qi) => q.fields.map((f, fi) => ({ q, qi, f, fi, k: `${qi}-${fi}` })));
const maxPoints = R.stations.reduce((a, s) => a + allFields(s).filter(x => !x.f.open).length, 0);
const openCount = R.stations.reduce((a, s) => a + allFields(s).filter(x => x.f.open).length, 0);
const points = () => Object.values(state.st).reduce((a, s) => a + Object.values(s.ok).filter(v => v === true).length, 0);
const checkedCount = () => R.stations.filter(s => state.st[s.id]?.checked).length;

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
      <p class="small muted">${R.stations.length} Stationen · ${maxPoints} Punkte${openCount ? ` · ${openCount} Schätzfrage${openCount > 1 ? 'n' : ''} wertet die Spielleitung` : ''}</p>
      <form id="start" class="stack">
        <label>Euer Teamname<input id="team" required maxlength="40" placeholder="z. B. Die Pranger-Profis"></label>
        <button class="primary big">🏁 Los geht's – die Uhr läuft!</button>
      </form>
    </div>
    <a class="orga-link" href="orga.html">🔐 Spielleitung</a>`;
  $('#start').onsubmit = e => {
    e.preventDefault();
    state = { team: $('#team').value.trim(), start: Date.now(), end: null, st: {} };
    save(); main();
  };
}

let openId = null;
let tick;

function main() {
  clearInterval(tick);
  if (openId == null) openId = (R.stations.find(s => !state.st[s.id]?.checked) || {}).id;
  app.innerHTML = `
    <div class="hud"><span class="pill">⏱ <span id="clock">${fmtTime(Date.now() - state.start)}</span></span>
      <span>${esc(state.team)}</span><span class="pill">⭐ <span id="pts">${points()}</span></span></div>
    <div class="progress"><div id="bar" style="width:${checkedCount() / R.stations.length * 100}%"></div></div>
    <div id="stations">${R.stations.map((s, i) => stationHtml(s, i)).join('')}</div>
    <button id="finish" class="big ${checkedCount() === R.stations.length ? 'primary' : ''}">🏆 Rallye beenden</button>
    <a class="orga-link" href="orga.html">🔐 Spielleitung</a>`;
  tick = setInterval(() => { const c = $('#clock'); if (c) c.textContent = fmtTime(Date.now() - state.start); }, 1000);

  app.querySelectorAll('details.station').forEach(d => d.addEventListener('toggle', () => {
    if (d.open) {
      openId = d.dataset.id;
      app.querySelectorAll('details.station[open]').forEach(o => { if (o !== d) o.open = false; });
      d.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }));
  $('#finish').onclick = () => {
    const left = R.stations.length - checkedCount();
    if (left && !confirm(`Noch ${left} Station${left > 1 ? 'en' : ''} nicht geprüft. Trotzdem beenden?`)) return;
    state.end = Date.now(); save(); finish(true);
  };
}

function stationHtml(s, i) {
  const ss = stState(s.id);
  const mark = k => ss.checked ? (ss.ok[k] === true ? '✅' : ss.ok[k] === false ? '❌' : '📝') : '';
  const cls = k => ss.checked ? (ss.ok[k] === true ? 'ok' : ss.ok[k] === false ? 'bad' : '') : '';
  const q = s.questions.map((q, qi) => `
    <div class="question"><p>${esc(q.q)}</p>
      ${q.fields.map((f, fi) => {
        const k = `${qi}-${fi}`, v = ss.vals[k] ?? '';
        if (q.type === 'mc') return `<div class="choices">${q.options.map(o =>
          `<button type="button" class="choice ${v === o ? 'sel' : ''} ${v === o ? cls(k) : ''}" data-k="${k}" data-v="${esc(o)}" ${ss.checked ? 'disabled' : ''}>${esc(o)}</button>`).join('')}</div>
          ${ss.checked ? `<div class="small">${mark(k)} ${ss.ok[k] ? 'Richtig!' : 'Leider falsch.'}</div>` : ''}`;
        return `<div class="field ${cls(k)}">${f.label ? `<span class="lbl">${esc(f.label)}</span>` : ''}
          <input data-k="${k}" value="${esc(v)}" autocomplete="off" ${q.type === 'num' ? 'inputmode="decimal"' : ''} placeholder="${q.type === 'num' ? 'Zahl' : 'Antwort'}" ${ss.checked ? 'disabled' : ''}>
          <span class="mark">${mark(k)}</span></div>`;
      }).join('')}
      ${q.fields.some(f => f.open) ? '<p class="open-note">📝 Diese Frage wertet die Spielleitung.</p>' : ''}
    </div>`).join('');

  const got = Object.values(ss.ok).filter(v => v === true).length;
  const max = allFields(s).filter(x => !x.f.open).length;
  return `
    <details class="card station ${ss.checked ? 'done' : ''}" data-id="${esc(s.id)}" ${openId === s.id ? 'open' : ''}>
      <summary><span class="num">${ss.checked ? '✓' : i + 1}</span>
        <span class="t"><b>${esc(s.title)}</b><small>${esc(s.ort)}${ss.checked ? ` · ${got}/${max} Punkte` : ''}</small></span>
        <span class="chev">›</span></summary>
      <div class="body">
        ${s.w3w.length ? `<div class="w3w">${s.w3w.map(w => `<a class="btn" href="${esc(w3wUrl(w.words))}" target="_blank" rel="noopener">📍 ${esc(w.label)} <b>///</b>${esc(w.words)}</a>`).join('')}</div>` : ''}
        ${s.text ? `<p class="pre">${esc(s.text)}</p>` : ''}
        <form data-station="${esc(s.id)}">${q}
          ${ss.checked ? '' : '<button class="primary big">Antworten prüfen</button>'}
        </form>
      </div>
    </details>`;
}

// Eingaben sofort merken, damit nichts verloren geht
app.addEventListener('input', e => {
  const k = e.target.dataset.k, form = e.target.closest('form[data-station]');
  if (!k || !form) return;
  stState(form.dataset.station).vals[k] = e.target.value; save();
});
app.addEventListener('click', e => {
  const b = e.target.closest('.choice'); if (!b || b.disabled) return;
  const form = b.closest('form[data-station]');
  form.querySelectorAll(`.choice[data-k="${b.dataset.k}"]`).forEach(x => x.classList.toggle('sel', x === b));
  stState(form.dataset.station).vals[b.dataset.k] = b.dataset.v; save();
});
app.addEventListener('submit', async e => {
  const form = e.target.closest('form[data-station]'); if (!form) return;
  e.preventDefault();
  const s = R.stations.find(x => x.id === form.dataset.station), ss = stState(s.id);
  const fields = allFields(s);
  if (fields.some(x => !String(ss.vals[x.k] ?? '').trim())) {
    if (!confirm('Nicht alles ist ausgefüllt. Trotzdem prüfen? (Geht nur einmal!)')) return;
  } else if (!confirm('Antworten jetzt prüfen? Danach kann nichts mehr geändert werden.')) return;

  for (const x of fields) {
    const v = String(ss.vals[x.k] ?? '').trim();
    if (x.f.open) ss.ok[x.k] = null;
    else ss.ok[x.k] = !!v && x.f.h.includes(await hashAnswer(R.salt, `${s.id}|${x.qi}|${x.fi}`, x.q.type, v));
  }
  ss.checked = true; save();
  const got = Object.values(ss.ok).filter(v => v === true).length;
  const max = fields.filter(x => !x.f.open).length;
  if (got === max && max) { confetti(); buzz(120); toast('Alles richtig! 🎉'); }
  else { buzz([80, 60, 80]); toast(`${got} von ${max} richtig`); }
  openId = (R.stations.find(x => !state.st[x.id]?.checked) || {}).id ?? s.id;
  main();
});

/* ---------- Ergebnis ---------- */

function resultText() {
  const lines = [`🏁 ${R.title} – Team „${state.team}“`,
    `⭐ ${points()} von ${maxPoints} Punkten${openCount ? ` (+ ${openCount} offene Frage${openCount > 1 ? 'n' : ''})` : ''} · ⏱ ${fmtTime(state.end - state.start)}`, ''];
  R.stations.forEach((s, i) => {
    const ss = state.st[s.id];
    lines.push(`${i + 1}. ${s.title}${ss?.checked ? '' : ' (nicht geprüft)'}`);
    for (const x of allFields(s)) {
      const v = ss?.vals[x.k] ?? '–';
      const m = !ss?.checked ? '' : x.f.open ? ' 📝' : ss.ok[x.k] ? ' ✅' : ' ❌';
      lines.push(`   ${x.f.label ? x.f.label + ': ' : x.q.q + ' '}${v}${m}`);
    }
  });
  return lines.join('\n');
}

function finish(fresh) {
  clearInterval(tick);
  if (fresh) confetti();
  const text = resultText();
  app.innerHTML = `
    <div class="card center pop">
      <div style="font-size:3rem">🏆</div>
      <h1>Geschafft, ${esc(state.team)}!</h1>
      <p class="score">${points()}</p>
      <p class="muted">von ${maxPoints} Punkten · Zeit ${fmtTime(state.end - state.start)}${openCount ? `<br>${openCount} Schätzfrage${openCount > 1 ? 'n' : ''} wertet noch die Spielleitung` : ''}</p>
      <div class="row" style="justify-content:center">
        <a class="btn primary" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">💬 Per WhatsApp senden</a>
        <button id="copy">📋 Kopieren</button>
      </div>
    </div>
    <div class="card"><pre class="pre small" style="margin:0;font-family:inherit">${esc(text)}</pre></div>
    <button id="reset" class="ghost danger small">Spielstand löschen</button>`;
  $('#copy').onclick = async () => {
    try { await navigator.clipboard.writeText(text); toast('Kopiert – ab in die Gruppe!'); }
    catch { prompt('Ergebnis kopieren:', text); }
  };
  $('#reset').onclick = () => {
    if (!confirm('Wirklich alles löschen und neu anfangen?')) return;
    try { localStorage.removeItem(KEY); } catch { /* egal */ }
    state = null; openId = null; intro();
  };
}

// Display anlassen, solange die Seite offen ist
async function wake() { try { if (document.visibilityState === 'visible') await navigator.wakeLock?.request('screen'); } catch { /* egal */ } }
document.addEventListener('visibilitychange', wake);
wake();

if (!state) intro();
else if (state.end) finish(false);
else main();
