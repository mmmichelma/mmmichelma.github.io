'use strict';

/* ============================================================
   Rallye-Baukasten
   Rallyes werden komplett im Link gespeichert (komprimiert),
   Lösungen nur als Hash – kein Server nötig.
   ============================================================ */

const $ = (sel, el = document) => el.querySelector(sel);
const app = $('#app');

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* privater Modus */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* egal */ } },
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function safeUrl(u) { return /^https?:\/\//i.test(u || '') ? u : ''; }
function uid() { return Math.random().toString(36).slice(2, 10); }

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
function buzz(p) { try { navigator.vibrate?.(p); } catch { /* egal */ } }

function loadScript(src) {
  return new Promise((ok, fail) => {
    if (document.querySelector(`script[src="${src}"]`)) return ok();
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = fail;
    document.head.appendChild(s);
  });
}
function loadCss(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = href;
  document.head.appendChild(l);
}

/* ---------- Kodierung (Link) ---------- */

function b64u(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64u(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}
async function encode(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  if ('CompressionStream' in window) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return 'z' + b64u(new Uint8Array(await new Response(stream).arrayBuffer()));
  }
  return 'j' + b64u(bytes);
}
async function decode(str) {
  let bytes = unb64u(str.slice(1));
  if (str[0] === 'z') {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/* ---------- Antworten prüfen ---------- */

// Tolerant vergleichen: Groß/klein, Umlaute, Satzzeichen und Leerzeichen egal.
function normText(s) {
  return String(s).toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}
function normNum(s) {
  const n = parseFloat(String(s).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? normText(s) : String(n);
}
function normAnswer(type, s) { return type === 'num' ? normNum(s) : normText(s); }

async function hashAnswer(rallyId, value) {
  const data = new TextEncoder().encode(rallyId + '|' + value);
  const buf = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(buf.slice(0, 6), b => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- Geo ---------- */

const toRad = d => d * Math.PI / 180;
function distance(a, b) {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function bearing(a, b) {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 0 : 1).replace('.', ',') + ' km' : Math.round(m) + ' m'; }
function compassWord(deg) { return ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8]; }
function temperature(m) {
  if (m > 2000) return '🥶 Eiskalt';
  if (m > 700) return '❄️ Kalt';
  if (m > 250) return '🌤️ Lauwarm';
  if (m > 80) return '☀️ Warm';
  if (m > 30) return '🔥 Heiß';
  return '🌋 Glühend heiß!';
}
function parseCoords(str) {
  const m = String(str).match(/(-?\d+(?:[.,]\d+)?)\s*[,; ]\s*(-?\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const lat = parseFloat(m[1].replace(',', '.')), lng = parseFloat(m[2].replace(',', '.'));
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}
function getPosition() {
  return new Promise((ok, fail) => {
    if (!navigator.geolocation) return fail(new Error('Kein GPS verfügbar'));
    navigator.geolocation.getCurrentPosition(p => ok({ lat: p.coords.latitude, lng: p.coords.longitude }), fail,
      { enableHighAccuracy: true, timeout: 15000 });
  });
}

/* ---------- Konfetti ---------- */

function confetti() {
  const c = $('#confetti'), ctx = c.getContext('2d');
  c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  const colors = ['#f28c18', '#ffd23f', '#3ccf7f', '#3a8ee6', '#e64a8c'];
  const parts = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2, y: innerHeight / 3,
    vx: (Math.random() - .5) * 14, vy: Math.random() * -14 - 4,
    s: 5 + Math.random() * 6, r: Math.random() * 6, vr: (Math.random() - .5) * .4,
    c: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  (function frame(t) {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += .35; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      ctx.restore();
    }
    if (t - t0 < 2800) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, innerWidth, innerHeight);
  })(t0);
}

/* ---------- Entwürfe ---------- */

const NAV_MODES = { arrow: 'Pfeil & Entfernung', dist: 'Nur Entfernung', hot: 'Nur heiß/kalt' };
const TYPES = { text: 'Text-Antwort', num: 'Zahl', mc: 'Auswahl (Multiple Choice)', none: 'Aktion (selbst bestätigen)' };

function newStation() {
  return { n: '', q: '', img: '', type: 'text', a: '', o: '', p: 10, hint: '', lat: null, lng: null, r: 30, nav: 'arrow', lock: true };
}
function newDraft() {
  return { id: uid(), t: '', d: '', s: [newStation()], u: Date.now() };
}
const drafts = {
  all() { return store.get('drafts', {}); },
  get(id) { return this.all()[id]; },
  save(d) { const a = this.all(); d.u = Date.now(); a[d.id] = d; store.set('drafts', a); },
  remove(id) { const a = this.all(); delete a[id]; store.set('drafts', a); },
};

async function publish(draft) {
  const rally = { v: 1, id: draft.id, u: draft.u, t: draft.t.trim() || 'Rallye', d: draft.d, s: [] };
  for (const s of draft.s) {
    const out = { n: s.n, q: s.q, type: s.type, p: Math.max(0, Number(s.p) || 0) };
    if (safeUrl(s.img)) out.img = s.img;
    if (s.hint) out.hint = s.hint;
    if (s.lat != null && s.lng != null) {
      Object.assign(out, { lat: +s.lat.toFixed(6), lng: +s.lng.toFixed(6), r: Math.max(5, Number(s.r) || 30), nav: s.nav, lock: !!s.lock });
    }
    let correct = [];
    if (s.type === 'mc') {
      const lines = s.o.split('\n').map(l => l.trim()).filter(Boolean);
      out.o = lines.map(l => l.replace(/^\*\s*/, ''));
      correct = lines.filter(l => l.startsWith('*')).map(l => l.replace(/^\*\s*/, ''));
    } else if (s.type !== 'none') {
      correct = s.a.split('|').map(x => x.trim()).filter(Boolean);
    }
    out.h = await Promise.all(correct.map(c => hashAnswer(rally.id, normAnswer(s.type, c))));
    rally.s.push(out);
  }
  return encode(rally);
}

function draftProblems(d) {
  const p = [];
  if (!d.t.trim()) p.push('Die Rallye hat noch keinen Namen.');
  d.s.forEach((s, i) => {
    const name = `Station ${i + 1}`;
    if (!s.q.trim()) p.push(`${name}: Aufgabe fehlt.`);
    if ((s.type === 'text' || s.type === 'num') && !s.a.trim()) p.push(`${name}: keine richtige Antwort hinterlegt.`);
    if (s.type === 'mc') {
      const lines = s.o.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) p.push(`${name}: mindestens zwei Auswahlmöglichkeiten nötig.`);
      if (!lines.some(l => l.startsWith('*'))) p.push(`${name}: richtige Auswahl mit * markieren.`);
    }
  });
  return p;
}

const DEMO = {
  id: 'demo2026', u: 1, t: 'Schnupper-Rallye',
  d: 'Eine kleine Probe-Rallye für zu Hause. Hier gibt es kein GPS – in echten Rallyes führt euch ein Kompass zu jeder Station.',
  s: [
    { ...newStation(), n: 'Aufwärmen', q: 'Was hat Zähne, kann aber nicht beißen?', type: 'text', a: 'Kamm|ein Kamm|Säge|Reißverschluss', hint: 'Man benutzt es morgens im Bad.', p: 10 },
    { ...newStation(), n: 'Kopfrechnen', q: 'Ein Lamborghini fährt 300 km/h. Wie viele Minuten braucht er für 75 km?', type: 'num', a: '15', hint: '300 km/h sind 5 km pro Minute.', p: 15 },
    { ...newStation(), n: 'Weinkunde', q: 'Welche dieser Rebsorten ist eine Rotweinsorte?', type: 'mc', o: 'Grüner Silvaner\n*Schwarzriesling\nRiesling\nMüller-Thurgau', p: 10 },
    { ...newStation(), n: 'Teamaufgabe', q: 'Summt gemeinsam ein Kinderlied, ohne zu singen – und lasst es die anderen erraten. Wenn alle mitgemacht haben: bestätigen!', type: 'none', p: 5 },
  ],
};

/* ---------- Router ---------- */

let cleanups = [];
function cleanup() { cleanups.forEach(f => { try { f(); } catch { /* egal */ } }); cleanups = []; }

async function route() {
  cleanup();
  window.scrollTo(0, 0);
  const hash = location.hash.slice(1) || '/';
  const [, view, arg] = hash.split('/');
  try {
    if (view === 'edit') return renderEdit(arg);
    if (view === 'share') return renderShare(arg);
    if (view === 'r' && arg) return renderPlay(arg);
    renderHome();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="card"><h2>Hoppla</h2><p>Da ist etwas schiefgelaufen.</p><a class="btn" href="#/">Zur Startseite</a></div>`;
  }
}
addEventListener('hashchange', route);

/* ---------- Startseite ---------- */

function renderHome() {
  const ds = Object.values(drafts.all()).sort((a, b) => b.u - a.u);
  const played = store.get('played', []);
  app.innerHTML = `
    <section class="hero">
      <h1>Eure eigene <span>Rallye</span> in 10 Minuten.</h1>
      <p class="muted">Schnitzeljagd, Autorallye, Stadtspiel oder Geburtstags-Schatzsuche: Stationen anlegen, Link oder QR-Code verschicken, losfahren.</p>
      <div class="row">
        <a class="btn primary" href="#/edit/new">＋ Neue Rallye bauen</a>
        <button id="demo">▶ Demo spielen</button>
      </div>
    </section>
    <div class="features">
      <div class="feature"><span class="ico">🧭</span><b>GPS-Kompass</b><span class="small muted">Ein Pfeil führt die Teams zur nächsten Station – oder nur „heiß / kalt“.</span></div>
      <div class="feature"><span class="ico">🔒</span><b>Aufgabe erst vor Ort</b><span class="small muted">Die Frage erscheint erst, wenn das Team wirklich da ist.</span></div>
      <div class="feature"><span class="ico">🕵️</span><b>Schummelsicher</b><span class="small muted">Lösungen stehen nur verschlüsselt im Link.</span></div>
      <div class="feature"><span class="ico">🏆</span><b>Punkte & Zeit</b><span class="small muted">Tipps und Fehlversuche kosten Punkte, die Stoppuhr läuft.</span></div>
      <div class="feature"><span class="ico">📲</span><b>Ohne Server</b><span class="small muted">Alles steckt im Link – teilen per WhatsApp oder QR-Code.</span></div>
      <div class="feature"><span class="ico">📴</span><b>Offline-fähig</b><span class="small muted">Als App installierbar, Display bleibt beim Spielen an.</span></div>
    </div>
    ${played.length ? `<div class="card"><h3>Weiterspielen</h3>
      ${played.map(p => `<div class="list-item"><div><div class="title">${esc(p.title)}</div><div class="small muted">${p.done ? 'Beendet' : 'Läuft'} · ${new Date(p.ts).toLocaleDateString('de-DE')}</div></div>
        <div class="row"><a class="btn icon" href="#/r/${esc(p.data)}">${p.done ? 'Ergebnis' : 'Weiter'}</a><button class="icon ghost danger" data-forget="${esc(p.key)}" title="Entfernen">✕</button></div></div>`).join('')}
    </div>` : ''}
    ${ds.length ? `<div class="card"><h3>Meine Rallyes</h3>
      ${ds.map(d => `<div class="list-item"><div><div class="title">${esc(d.t || 'Ohne Namen')}</div><div class="small muted">${d.s.length} Station${d.s.length === 1 ? '' : 'en'}</div></div>
        <div class="row"><a class="btn icon" href="#/edit/${esc(d.id)}">Bearbeiten</a><a class="btn icon primary" href="#/share/${esc(d.id)}">Teilen</a></div></div>`).join('')}
    </div>` : ''}
    <div class="card">
      <h3>Rallye-Link erhalten?</h3>
      <form id="open" class="row"><input id="link" placeholder="Link hier einfügen" style="flex:1;margin:0"><button class="primary">Öffnen</button></form>
    </div>`;

  $('#demo').onclick = async () => { location.hash = '#/r/' + await publish(DEMO); };
  app.querySelectorAll('[data-forget]').forEach(b => b.onclick = () => {
    store.set('played', store.get('played', []).filter(p => p.key !== b.dataset.forget));
    store.del(b.dataset.forget);
    renderHome();
  });
  $('#open').onsubmit = e => {
    e.preventDefault();
    const m = $('#link').value.match(/#\/r\/([A-Za-z0-9_-]+)/);
    if (m) location.hash = '#/r/' + m[1];
    else toast('Das sieht nicht nach einem Rallye-Link aus.');
  };
}

/* ---------- Editor ---------- */

function renderEdit(id) {
  let d;
  if (id === 'new') { d = newDraft(); drafts.save(d); history.replaceState(null, '', '#/edit/' + d.id); }
  else d = drafts.get(id);
  if (!d) { app.innerHTML = `<div class="card"><p>Diese Rallye gibt es nicht (mehr).</p><a class="btn" href="#/">Zurück</a></div>`; return; }

  let saveTimer;
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => drafts.save(d), 300); };
  cleanups.push(() => { clearTimeout(saveTimer); drafts.save(d); });

  const typeFields = (s) => {
    if (s.type === 'mc') return `<label>Auswahlmöglichkeiten – eine pro Zeile, richtige mit * davor
      <textarea data-f="o" rows="4" placeholder="Rom\n*Paris\nBerlin">${esc(s.o)}</textarea></label>`;
    if (s.type === 'none') return `<p class="small muted">Das Team bestätigt selbst, z. B. nachdem es ein Foto in die Gruppe geschickt hat.</p>`;
    return `<label>Richtige Antwort(en) – Alternativen mit | trennen
      <input data-f="a" value="${esc(s.a)}" placeholder="${s.type === 'num' ? '42' : 'Rathaus|das Rathaus'}"></label>
      <p class="small muted" style="margin-top:-6px">Groß-/Kleinschreibung, Umlaute und Satzzeichen sind egal.</p>`;
  };

  const stationHtml = (s, i, n) => `
    <div class="card" data-i="${i}">
      <div class="row between"><h3>Station ${i + 1}</h3>
        <div class="row">
          <button class="icon" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="Nach oben">↑</button>
          <button class="icon" data-act="down" ${i === n - 1 ? 'disabled' : ''} aria-label="Nach unten">↓</button>
          <button class="icon danger" data-act="del" ${n === 1 ? 'disabled' : ''} aria-label="Löschen">✕</button>
        </div></div>
      <label>Name der Station<input data-f="n" value="${esc(s.n)}" placeholder="z. B. Am Marktbrunnen"></label>
      <label>Aufgabe / Frage<textarea data-f="q" rows="3" placeholder="Wie viele Fenster hat das Rathaus?">${esc(s.q)}</textarea></label>
      <div class="grid2">
        <label>Antworttyp<select data-f="type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${s.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Punkte<input data-f="p" type="number" min="0" inputmode="numeric" value="${esc(s.p)}"></label>
      </div>
      ${typeFields(s)}
      <label>Tipp (optional, kostet die Hälfte der Punkte)<input data-f="hint" value="${esc(s.hint)}"></label>
      <label>Bild-Link (optional)<input data-f="img" type="url" value="${esc(s.img)}" placeholder="https://…"></label>
      <details ${s.lat != null ? 'open' : ''}>
        <summary>📍 Ort der Station (GPS)</summary>
        <label>Koordinaten<input data-f="coords" value="${s.lat != null ? `${s.lat.toFixed(6)}, ${s.lng.toFixed(6)}` : ''}" placeholder="49.899100, 8.845200" inputmode="decimal"></label>
        <div class="row" style="margin-bottom:10px">
          <button data-act="here">📍 Mein Standort</button>
          <button data-act="map">🗺️ Auf Karte wählen</button>
          ${s.lat != null ? '<button data-act="clearloc" class="ghost danger">Entfernen</button>' : ''}
        </div>
        <div class="grid2">
          <label>Radius in Metern<input data-f="r" type="number" min="5" inputmode="numeric" value="${esc(s.r)}"></label>
          <label>Navigation<select data-f="nav">${Object.entries(NAV_MODES).map(([k, v]) => `<option value="${k}" ${s.nav === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        </div>
        <label class="check"><input type="checkbox" data-f="lock" ${s.lock ? 'checked' : ''}> Aufgabe erst anzeigen, wenn das Team vor Ort ist</label>
      </details>
    </div>`;

  const render = () => {
    app.innerHTML = `
      <div class="row between" style="margin-bottom:12px"><a href="#/" class="btn icon ghost">← Übersicht</a><span class="small muted">Wird automatisch gespeichert</span></div>
      <div class="card">
        <label>Name der Rallye<input data-g="t" value="${esc(d.t)}" placeholder="Gaudirallye 2027"></label>
        <label>Begrüßungstext<textarea data-g="d" rows="3" placeholder="Liebe Mitstreiter, …">${esc(d.d)}</textarea></label>
      </div>
      <div id="stations">${d.s.map((s, i) => stationHtml(s, i, d.s.length)).join('')}</div>
      <button id="add" class="big">＋ Station hinzufügen</button>
      <div class="card" style="margin-top:16px">
        <div class="row">
          <button id="go" class="primary">🚀 Fertig – Link erstellen</button>
          <button id="export">⬇ Sichern (Datei)</button>
          <label class="btn" style="margin:0;font-weight:600">⬆ Laden<input id="import" type="file" accept=".json,application/json" class="hidden"></label>
          <button id="delete" class="ghost danger">Löschen</button>
        </div>
      </div>`;
  };
  render();

  app.oninput = e => {
    const el = e.target;
    if (el.dataset.g) { d[el.dataset.g] = el.value; return save(); }
    const card = el.closest('[data-i]'); if (!card || !el.dataset.f) return;
    const s = d.s[+card.dataset.i], f = el.dataset.f;
    if (f === 'coords') {
      const c = parseCoords(el.value);
      s.lat = c ? c.lat : null; s.lng = c ? c.lng : null;
    } else if (f === 'lock') s.lock = el.checked;
    else if (f === 'p' || f === 'r') s[f] = el.value === '' ? '' : Number(el.value);
    else s[f] = el.value;
    save();
    if (f === 'type') render();
  };

  app.onclick = async e => {
    const btn = e.target.closest('button'); if (!btn) return;
    const card = btn.closest('[data-i]');
    const i = card ? +card.dataset.i : -1;
    const act = btn.dataset.act;
    if (act === 'up' || act === 'down') {
      const j = act === 'up' ? i - 1 : i + 1;
      [d.s[i], d.s[j]] = [d.s[j], d.s[i]]; save(); render();
    } else if (act === 'del') {
      if (confirm(`Station ${i + 1} löschen?`)) { d.s.splice(i, 1); save(); render(); }
    } else if (act === 'here') {
      btn.disabled = true; btn.textContent = '⏳ Suche…';
      try { Object.assign(d.s[i], await getPosition()); save(); render(); toast('Standort übernommen'); }
      catch { toast('Standort nicht verfügbar'); btn.disabled = false; btn.textContent = '📍 Mein Standort'; }
    } else if (act === 'map') {
      const c = await pickOnMap(d.s[i].lat != null ? d.s[i] : d.s.slice(0, i).reverse().find(s => s.lat != null));
      if (c) { Object.assign(d.s[i], c); save(); render(); }
    } else if (act === 'clearloc') {
      d.s[i].lat = d.s[i].lng = null; save(); render();
    } else if (btn.id === 'add') {
      d.s.push(newStation()); save(); render();
      app.querySelector(`[data-i="${d.s.length - 1}"]`)?.scrollIntoView({ behavior: 'smooth' });
    } else if (btn.id === 'go') {
      const probs = draftProblems(d);
      if (probs.length && !confirm('Noch nicht ganz fertig:\n\n• ' + probs.join('\n• ') + '\n\nTrotzdem Link erstellen?')) return;
      drafts.save(d); location.hash = '#/share/' + d.id;
    } else if (btn.id === 'export') {
      const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (d.t || 'rallye').replace(/[^\wäöüÄÖÜß-]+/g, '_') + '.json';
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } else if (btn.id === 'delete') {
      if (confirm('Diese Rallye wirklich löschen?')) {
        clearTimeout(saveTimer); cleanups = [() => { app.oninput = app.onclick = app.onchange = null; }];
        drafts.remove(d.id); location.hash = '#/';
      }
    }
  };

  app.onchange = async e => {
    if (e.target.id !== 'import' || !e.target.files[0]) return;
    try {
      const data = JSON.parse(await e.target.files[0].text());
      if (!Array.isArray(data.s)) throw new Error();
      d.t = String(data.t || ''); d.d = String(data.d || '');
      d.s = data.s.map(s => ({ ...newStation(), ...s }));
      save(); render(); toast('Rallye geladen');
    } catch { toast('Diese Datei kann ich nicht lesen.'); }
  };
  cleanups.push(() => { app.oninput = app.onclick = app.onchange = null; });
}

async function pickOnMap(start) {
  loadCss('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css');
  try { await loadScript('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'); }
  catch { toast('Karte konnte nicht geladen werden'); return null; }

  return new Promise(resolve => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<div class="card"><h3>Tippe auf den Ort der Station</h3><div id="map"></div>
      <div class="row between"><button data-x="cancel">Abbrechen</button><button data-x="ok" class="primary" disabled>Übernehmen</button></div></div>`;
    document.body.appendChild(modal);
    const map = L.map($('#map', modal)).setView(start ? [start.lat, start.lng] : [51.1, 10.4], start ? 16 : 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    let marker, picked = start && start.lat != null ? { lat: start.lat, lng: start.lng } : null;
    if (picked) marker = L.marker([picked.lat, picked.lng]).addTo(map);
    else getPosition().then(p => map.setView([p.lat, p.lng], 16)).catch(() => {});
    const ok = $('[data-x=ok]', modal);
    ok.disabled = !picked;
    map.on('click', e => {
      picked = { lat: e.latlng.lat, lng: e.latlng.lng };
      marker ? marker.setLatLng(e.latlng) : (marker = L.marker(e.latlng).addTo(map));
      ok.disabled = false;
    });
    const close = val => { map.remove(); modal.remove(); resolve(val); };
    modal.onclick = e => {
      if (e.target === modal || e.target.dataset.x === 'cancel') close(null);
      else if (e.target.dataset.x === 'ok') close(picked);
    };
  });
}

/* ---------- Teilen ---------- */

async function renderShare(id) {
  const d = drafts.get(id);
  if (!d) { location.hash = '#/'; return; }
  const data = await publish(d);
  const url = location.href.split('#')[0] + '#/r/' + data;
  const gps = d.s.filter(s => s.lat != null).length;
  app.innerHTML = `
    <div class="row between" style="margin-bottom:12px"><a href="#/edit/${esc(d.id)}" class="btn icon ghost">← Bearbeiten</a></div>
    <div class="card center">
      <h2>${esc(d.t || 'Rallye')} ist startklar 🎉</h2>
      <p class="muted">${d.s.length} Stationen${gps ? `, davon ${gps} mit GPS` : ''}. Schickt den Teams diesen Link oder lasst sie den QR-Code scannen.</p>
      <div class="qr" id="qr"></div>
      <div class="row" style="justify-content:center">
        ${navigator.share ? '<button id="share" class="primary">📤 Teilen</button>' : ''}
        <button id="copy" class="${navigator.share ? '' : 'primary'}">🔗 Link kopieren</button>
        <a class="btn" href="#/r/${esc(data)}">▶ Selbst testen</a>
      </div>
    </div>
    <div class="card"><p class="small muted">Wichtig: Wenn du die Rallye später änderst, entsteht ein neuer Link. Die Lösungen sind im Link nur als Prüfsumme gespeichert – reinschauen bringt nichts.</p>
      <div class="linkbox muted">${esc(url)}</div></div>`;

  $('#copy').onclick = async () => {
    try { await navigator.clipboard.writeText(url); toast('Link kopiert'); }
    catch { prompt('Link kopieren:', url); }
  };
  $('#share')?.addEventListener('click', () => navigator.share({ title: d.t, text: `Macht mit bei „${d.t}“!`, url }).catch(() => {}));

  try {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js');
    new QRCode($('#qr'), { text: url, width: 240, height: 240, correctLevel: QRCode.CorrectLevel.L });
  } catch {
    $('#qr').outerHTML = '<p class="small muted">Für einen QR-Code ist diese Rallye zu lang – der Link funktioniert trotzdem.</p>';
  }
}

/* ---------- Spielen ---------- */

function pointsFor(st, cur) {
  const factor = (cur.hint ? .5 : 1) * Math.max(.2, 1 - .25 * cur.tries);
  return Math.round(st.p * factor);
}
function fmtTime(ms) {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0');
}

async function renderPlay(data) {
  let rally;
  try { rally = await decode(data); if (!Array.isArray(rally.s)) throw new Error(); }
  catch { app.innerHTML = `<div class="card"><h2>Link kaputt</h2><p>Dieser Rallye-Link ist unvollständig. Lasst ihn euch nochmal schicken.</p><a class="btn" href="#/">Startseite</a></div>`; return; }

  const key = `play:${rally.id}:${rally.u}`;
  let st = store.get(key, null);
  const persist = () => {
    store.set(key, st);
    const played = store.get('played', []).filter(p => p.key !== key);
    played.unshift({ key, data, title: rally.t, ts: Date.now(), done: !!st.end });
    store.set('played', played.slice(0, 10));
  };

  // Display anlassen, solange gespielt wird
  let lock = null;
  const wake = async () => { try { if (document.visibilityState === 'visible') lock = await navigator.wakeLock?.request('screen'); } catch { /* egal */ } };
  wake();
  document.addEventListener('visibilitychange', wake);
  cleanups.push(() => { document.removeEventListener('visibilitychange', wake); lock?.release().catch(() => {}); });

  const maxPts = rally.s.reduce((a, s) => a + s.p, 0);
  const total = () => st.res.reduce((a, r) => a + (r?.pts || 0), 0);

  function intro() {
    app.innerHTML = `
      <div class="card pop">
        <p class="small muted">${rally.s.length} Stationen · bis zu ${maxPts} Punkte</p>
        <h1>${esc(rally.t)}</h1>
        ${rally.d ? `<p class="pre">${esc(rally.d)}</p>` : ''}
        <form id="start" class="stack">
          <label>Euer Teamname<input id="team" required maxlength="40" placeholder="Die Rallye-Raser"></label>
          <button class="primary big">🏁 Los geht's – Stoppuhr startet</button>
        </form>
      </div>
      <div class="card small muted">
        <b>Spielregeln:</b> Jede Station gibt Punkte. Jeder Fehlversuch kostet 25 %, ein Tipp halbiert die Punkte.
        ${rally.s.some(s => s.lat != null) ? 'Bei Stationen mit Ort führt euch der Kompass hin – bitte GPS erlauben.' : ''}
      </div>`;
    $('#start').onsubmit = e => {
      e.preventDefault();
      st = { team: $('#team').value.trim(), start: Date.now(), idx: 0, res: [], cur: { tries: 0, hint: false }, end: null };
      persist(); station();
    };
  }

  // Uhr und GPS gehören zur aktuellen Station und werden beim Wechsel beendet
  let stationCleanups = [];
  const endStation = () => { stationCleanups.forEach(f => f()); stationCleanups = []; };
  cleanups.push(endStation);

  function station() {
    endStation();

    if (st.idx >= rally.s.length) return finish();
    const s = rally.s[st.idx];
    const hasLoc = s.lat != null;
    const unlocked = () => !hasLoc || !s.lock || st.cur.here;

    app.innerHTML = `
      <div class="hud"><span class="pill">⏱ <span id="clock">${fmtTime(Date.now() - st.start)}</span></span>
        <span>${esc(st.team)}</span><span class="pill">⭐ ${total()}</span></div>
      <div class="progress"><div style="width:${st.idx / rally.s.length * 100}%"></div></div>
      <p class="small muted" style="margin:0">Station ${st.idx + 1} von ${rally.s.length}</p>
      <h2>${esc(s.n || 'Station ' + (st.idx + 1))}</h2>
      ${hasLoc ? `<div class="card nav" id="nav">
          <div id="navbody"><p class="muted">📡 Suche GPS-Signal…</p></div>
          ${s.nav === 'arrow' ? '<button id="compass" class="icon">🧭 Kompass einschalten</button>' : ''}
        </div>` : ''}
      <div id="taskwrap"></div>`;

    const tick = setInterval(() => { const c = $('#clock'); if (c) c.textContent = fmtTime(Date.now() - st.start); }, 1000);
    stationCleanups.push(() => clearInterval(tick));

    const renderTask = () => {
      const w = $('#taskwrap');
      if (!unlocked()) {
        w.innerHTML = `<div class="card center muted">🔒 Die Aufgabe erscheint, sobald ihr weniger als ${s.r} m entfernt seid.
          <div id="manual" class="hidden" style="margin-top:10px"><button id="imhere">Kein GPS? Wir sind da!</button></div></div>`;
        $('#imhere').onclick = () => { if (confirm('Seid ihr wirklich an der Station?')) { st.cur.here = true; persist(); renderTask(); } };
        return;
      }
      if (w.dataset.shown) return;
      w.dataset.shown = '1';
      const pts = pointsFor(s, st.cur);
      w.innerHTML = `
        <div class="card pop" id="taskcard">
          ${s.img ? `<img src="${esc(safeUrl(s.img))}" alt="" loading="lazy" style="margin-bottom:12px">` : ''}
          <p class="task pre">${esc(s.q)}</p>
          <div id="hintbox">${st.cur.hint ? `<div class="hint">💡 ${esc(s.hint)}</div>` : ''}</div>
          <form id="answer">
            ${s.type === 'mc' ? `<div class="choices">${s.o.map((o, i) => `<button type="button" class="choice" data-o="${i}">${esc(o)}</button>`).join('')}</div>`
              : s.type === 'none' ? ''
              : `<input id="ans" autocomplete="off" ${s.type === 'num' ? 'inputmode="decimal"' : ''} placeholder="Eure Antwort" style="margin-bottom:12px">`}
            <button class="primary big" id="check">${s.type === 'none' ? '✅ Erledigt' : 'Antwort prüfen'} · <span id="ptsnow">${pts}</span> P.</button>
          </form>
          <div class="row" style="margin-top:10px;justify-content:center">
            ${s.hint && !st.cur.hint ? '<button id="hint" class="ghost">💡 Tipp ansehen</button>' : ''}
            <button id="skip" class="ghost muted">Überspringen</button>
          </div>
        </div>`;

      let sel = null;
      w.querySelectorAll('.choice').forEach(b => b.onclick = () => {
        w.querySelectorAll('.choice').forEach(x => x.classList.remove('sel'));
        b.classList.add('sel'); sel = s.o[+b.dataset.o];
      });
      $('#hint')?.addEventListener('click', () => {
        if (!confirm('Der Tipp halbiert die Punkte dieser Station. Ansehen?')) return;
        st.cur.hint = true; persist();
        $('#hintbox').innerHTML = `<div class="hint pop">💡 ${esc(s.hint)}</div>`;
        $('#hint').remove();
        $('#ptsnow').textContent = pointsFor(s, st.cur);
      });
      $('#skip').onclick = () => { if (confirm('Station ohne Punkte überspringen?')) done(0, true); };
      $('#answer').onsubmit = async e => {
        e.preventDefault();
        let ok;
        if (s.type === 'none') ok = true;
        else {
          const val = s.type === 'mc' ? sel : $('#ans').value;
          if (val == null || !String(val).trim()) return toast(s.type === 'mc' ? 'Wählt eine Antwort aus' : 'Erst eine Antwort eingeben');
          ok = s.h.includes(await hashAnswer(rally.id, normAnswer(s.type, val)));
        }
        if (ok) return done(pointsFor(s, st.cur), false);
        st.cur.tries++; persist(); buzz([80, 60, 80]);
        const card = $('#taskcard');
        card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
        $('#ptsnow').textContent = pointsFor(s, st.cur);
        toast(['Leider falsch!', 'Nope – nochmal!', 'Knapp daneben ist auch vorbei.'][st.cur.tries % 3]);
      };
    };

    function done(pts, skipped) {
      st.res[st.idx] = { pts, tries: st.cur.tries, hint: st.cur.hint, skip: skipped };
      st.idx++; st.cur = { tries: 0, hint: false };
      persist();
      if (!skipped) { buzz(120); confetti(); }
      app.innerHTML = `<div class="card center pop" style="margin-top:24px">
        <div style="font-size:3rem">${skipped ? '⏭️' : '🎉'}</div>
        <h2>${skipped ? 'Übersprungen' : 'Richtig!'}</h2>
        <p class="score">+${pts}</p><p class="muted">Punkte · insgesamt ${total()}</p>
        <button class="primary big" id="next">${st.idx >= rally.s.length ? '🏆 Zum Ergebnis' : 'Weiter zur nächsten Station →'}</button></div>`;
      $('#next').onclick = station;
    }

    renderTask();
    if (hasLoc) startNav(s, renderTask, unlocked);
  }

  function startNav(s, renderTask, unlocked) {
    const target = { lat: s.lat, lng: s.lng };
    let pos = null, heading = null, lastDist = null, trend = '';
    const body = $('#navbody');

    const draw = () => {
      if (!pos) return;
      const dist = distance(pos, target);
      const here = dist <= s.r + Math.min(pos.acc || 0, 25);
      if (here && !st.cur.here) { st.cur.here = true; persist(); buzz([100, 50, 100]); toast('📍 Ihr seid da!'); }
      if (lastDist == null || Math.abs(dist - lastDist) > Math.max(5, (pos.acc || 0) / 3)) {
        if (lastDist != null) trend = dist < lastDist ? 'warm' : 'cold';
        lastDist = dist;
      }
      const trendHtml = trend ? `<div class="trend ${trend}">${trend === 'warm' ? '🔥 Wärmer…' : '🧊 Kälter…'}</div>` : '<div class="trend"></div>';
      if (here) body.innerHTML = `<p class="arrived">📍 Ihr seid am Ziel!</p>`;
      else if (s.nav === 'hot') body.innerHTML = `<div class="temp">${temperature(dist)}</div>${trendHtml}`;
      else if (s.nav === 'dist') body.innerHTML = `<div class="dist">${fmtDist(dist)}</div>${trendHtml}`;
      else {
        const b = bearing(pos, target);
        const rot = heading == null ? b : b - heading;
        body.innerHTML = `<div class="arrow-wrap">${heading == null ? '<span class="n">N</span>' : ''}
            <svg class="arrow" viewBox="0 0 100 100" style="transform:rotate(${rot}deg)"><path d="M50 10 L72 80 L50 66 L28 80 Z" fill="var(--accent)"/></svg></div>
          <div class="dist">${fmtDist(dist)}</div>
          <div class="small muted">${heading == null ? `Richtung ${compassWord(b)} (Norden = oben)` : 'Pfeil zeigt zum Ziel'}</div>${trendHtml}`;
      }
      if (pos.acc > 50) body.insertAdjacentHTML('beforeend', `<p class="small muted">GPS ungenau (±${Math.round(pos.acc)} m)</p>`);
      if (unlocked()) renderTask();
    };

    if (!navigator.geolocation) { gpsFail(); return; }
    const watch = navigator.geolocation.watchPosition(
      p => { pos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }; draw(); },
      gpsFail, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
    stationCleanups.push(() => navigator.geolocation.clearWatch(watch));

    function gpsFail() {
      if (!pos) body.innerHTML = `<p class="muted">⚠️ Kein GPS. Erlaubt den Standortzugriff in den Browser-Einstellungen.</p>`;
      $('#manual')?.classList.remove('hidden');
    }

    const onOrient = e => {
      let h = e.webkitCompassHeading ?? (e.absolute && e.alpha != null ? 360 - e.alpha : null);
      if (h == null) return;
      heading = (h + (screen.orientation?.angle || 0)) % 360;
      const svg = $('.arrow', body);
      if (svg && pos) svg.style.transform = `rotate(${bearing(pos, target) - heading}deg)`;
    };
    const btn = $('#compass');
    if (btn) btn.onclick = async () => {
      if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
        try { if (await DeviceOrientationEvent.requestPermission() !== 'granted') return toast('Kompass nicht erlaubt'); }
        catch { return toast('Kompass nicht verfügbar'); }
      }
      addEventListener('deviceorientationabsolute', onOrient);
      addEventListener('deviceorientation', onOrient);
      btn.remove();
      setTimeout(() => { if (heading == null) toast('Dieses Gerät hat leider keinen Kompass'); }, 2500);
    };
    stationCleanups.push(() => { removeEventListener('deviceorientationabsolute', onOrient); removeEventListener('deviceorientation', onOrient); });
  }

  function finish() {
    if (!st.end) { st.end = Date.now(); persist(); confetti(); }
    const pts = total(), time = fmtTime(st.end - st.start);
    const summary = `🏁 ${rally.t}\nTeam „${st.team}“: ${pts} von ${maxPts} Punkten in ${time}`;
    app.innerHTML = `
      <div class="card center pop">
        <div style="font-size:3rem">🏆</div>
        <h1>Geschafft, ${esc(st.team)}!</h1>
        <p class="score">${pts}</p><p class="muted">von ${maxPts} Punkten · Zeit ${time}</p>
        <div class="row" style="justify-content:center">
          <button id="send" class="primary">📤 Ergebnis senden</button>
          <button id="again" class="ghost">Nochmal spielen</button>
        </div>
      </div>
      <div class="card"><table class="results">
        ${rally.s.map((s, i) => { const r = st.res[i] || {}; return `<tr><td>${esc(s.n || 'Station ' + (i + 1))}
          <div class="small muted">${r.skip ? 'übersprungen' : [r.tries ? `${r.tries} Fehlversuch${r.tries > 1 ? 'e' : ''}` : 'auf Anhieb', r.hint ? 'mit Tipp' : ''].filter(Boolean).join(' · ')}</div></td>
          <td>${r.pts ?? 0} / ${s.p}</td></tr>`; }).join('')}
      </table></div>`;
    $('#send').onclick = async () => {
      if (navigator.share) return navigator.share({ text: summary }).catch(() => {});
      try { await navigator.clipboard.writeText(summary); toast('Ergebnis kopiert – ab in die Gruppe!'); }
      catch { prompt('Ergebnis kopieren:', summary); }
    };
    $('#again').onclick = () => { if (confirm('Spielstand löschen und neu starten?')) { store.del(key); st = null; intro(); } };
  }

  if (!st) intro();
  else if (st.end) finish();
  else station();
}

/* ---------- Start ---------- */

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
route();
