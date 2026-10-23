'use strict';

/* Orga-Bereich: Login entschlüsselt Lösungen und Fotos, dazu Rangliste aller Autos. */

const { decrypt, w3wUrl, normAnswer, fromB64, loginKey } = window.Rallye;
const $ = (sel, el = document) => el.querySelector(sel);
const app = $('#app');
const SESSION = 'gaudi-orga-key';
const RESULTS = 'gaudi-ergebnisse';
const OPEN = 'gaudi-offene-loesungen';
const TEST_OFF = 'gaudi-testdaten-aus';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* privater Modus */ } },
};
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}
function fmtTime(ms) {
  if (!(ms > 0)) return '–';
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0');
}

/* ---------- Ergebnis-Links der Teams ---------- */

// Kommt jemand über einen Ergebnis-Link, merken wir ihn bis nach dem Login.
if (location.hash.startsWith('#e=')) {
  try { sessionStorage.setItem('gaudi-pending', location.hash.slice(3)); } catch { /* egal */ }
  history.replaceState(null, '', location.pathname);
}
function parseResult(code) {
  const m = String(code).match(/#?e=([A-Za-z0-9_-]+)/);
  const raw = (m ? m[1] : String(code).trim()).replace(/-/g, '+').replace(/_/g, '/');
  const r = JSON.parse(new TextDecoder().decode(fromB64(raw + '='.repeat((4 - raw.length % 4) % 4))));
  if (!r.t || typeof r.a !== 'object') throw new Error('kein Ergebnis');
  return { t: String(r.t).slice(0, 40), s: +r.s, e: +r.e, c: Array.isArray(r.c) ? r.c : [], a: r.a };
}
function addResult(r) {
  const all = store.get(RESULTS, {});
  const id = r.t.trim().toLowerCase();
  const replaced = !!all[id];
  all[id] = { ...r, imported: Date.now() };
  store.set(RESULTS, all);
  return replaced;
}

/* ---------- Testdaten: 6 Autos ---------- */

function testResults() {
  const base = Date.UTC(2026, 7, 15, 8, 0, 0);
  const car = (t, startMin, dur, ans, unchecked = []) => {
    const a = {}, ids = Object.keys(ans);
    for (const id of ids) a[id] = ans[id];
    return { t, s: base + startMin * 60000, e: base + startMin * 60000 + dur * 1000, c: ids.filter(i => !unchecked.includes(i)), a, test: true };
  };
  const all = [
    car('Roter Blitz', 0, 2 * 3600 + 4 * 60 + 37, ({
      tiermauer: { '0-0': '4', '1-0': '4' }, denkmal: { '0-0': '32', '1-0': 'Menora' }, wasserwerk: { '0-0': '3', '1-0': 'Frösche' },
      hergershausen: { '0-0': '3', '1-0': '40' }, ampeln: { '0-0': '4' }, packstation: { '0-0': '28', '0-1': '21', '0-2': '8', '0-3': '3' },
      loewen: { '0-0': 'Löwen' }, pranger: { '0-0': '14. Jahrhundert', '1-0': '6' }, briefkasten: { '0-0': '9:15' } })),
    car('Gelbe Gurke', 5, 2 * 3600 + 21 * 60 + 10, ({
      tiermauer: { '0-0': '4', '1-0': '2' }, denkmal: { '0-0': '32', '1-0': 'Menora' }, wasserwerk: { '0-0': '3', '1-0': 'Frösche' },
      hergershausen: { '0-0': '3', '1-0': '38' }, ampeln: { '0-0': '4' }, packstation: { '0-0': '28', '0-1': '21', '0-2': '8', '0-3': '3' },
      loewen: { '0-0': 'Zum Löwen' }, pranger: { '0-0': '14. Jh', '1-0': '6' }, briefkasten: { '0-0': '9:15' } })),
    car('Silberpfeil', 10, 1 * 3600 + 58 * 60 + 2, ({
      tiermauer: { '0-0': '4', '1-0': '4' }, denkmal: { '0-0': '6', '1-0': 'Chanukkia' }, wasserwerk: { '0-0': '3', '1-0': 'Wild' },
      hergershausen: { '0-0': '3', '1-0': '40' }, ampeln: { '0-0': '5' }, packstation: { '0-0': '28', '0-1': '21', '0-2': '8', '0-3': '3' },
      loewen: { '0-0': 'Löwen' }, pranger: { '0-0': '14. Jahrhundert', '1-0': '8' }, briefkasten: { '0-0': '09:15' } })),
    car('Blaue Elise', 15, 2 * 3600 + 45 * 60 + 51, ({
      tiermauer: { '0-0': '3', '1-0': '4' }, denkmal: { '0-0': '32', '1-0': 'Menora' }, wasserwerk: { '0-0': '2', '1-0': 'Frösche' },
      hergershausen: { '0-0': '3', '1-0': '36' }, ampeln: { '0-0': '4' }, packstation: { '0-0': '27', '0-1': '21', '0-2': '8', '0-3': '3' },
      loewen: { '0-0': 'Zum Löwen' }, pranger: { '0-0': '15. Jh', '1-0': '6' }, briefkasten: { '0-0': '10:15' } })),
    car('Schwarzer Panther', 20, 2 * 3600 + 9 * 60 + 14, ({
      tiermauer: { '0-0': '4', '1-0': '4' }, denkmal: { '0-0': '32', '1-0': 'Menora' }, wasserwerk: { '0-0': '3', '1-0': 'Frösche' },
      hergershausen: { '0-0': '3', '1-0': '40' }, ampeln: { '0-0': '3' }, packstation: { '0-0': '28', '0-1': '21', '0-2': '8', '0-3': '3' },
      loewen: { '0-0': 'Löwen' }, pranger: { '0-0': '14', '1-0': '7' }, briefkasten: { '0-0': '' } }), ['briefkasten']),
    car('Grüne Minna', 25, 2 * 3600 + 30 * 60 + 40, ({
      tiermauer: { '0-0': '4', '1-0': '4' }, denkmal: { '0-0': '32', '1-0': 'Menora' }, wasserwerk: { '0-0': '3', '1-0': 'Frösche' },
      hergershausen: { '0-0': '3', '1-0': '40' }, ampeln: { '0-0': '4' }, packstation: { '0-0': '28', '0-1': '20', '0-2': '8', '0-3': '3' },
      loewen: { '0-0': 'Löwe' }, pranger: { '0-0': '14. Jh.', '1-0': '6' }, briefkasten: { '0-0': '9:15' } })),
  ];
  return all;
}
function loadTestData() {
  const all = store.get(RESULTS, {});
  for (const r of testResults()) all['test:' + r.t.toLowerCase()] = { ...r, imported: Date.now() };
  store.set(RESULTS, all);
  try { localStorage.removeItem(TEST_OFF); } catch { /* egal */ }
}
function removeTestData() {
  const all = store.get(RESULTS, {});
  for (const k of Object.keys(all)) if (all[k].test) delete all[k];
  store.set(RESULTS, all);
  store.set(TEST_OFF, true);
}

/* ---------- Wertung ---------- */

let D; // entschlüsselte Rallye-Daten

function fieldsOf(s) {
  return s.questions.flatMap((q, qi) => q.fields.map((f, fi) => ({ q, qi, f, fi, k: `${qi}-${fi}`, key: `${s.id}|${qi}|${fi}` })));
}
function openFields() { return D.stations.flatMap(s => fieldsOf(s).filter(x => !x.f.a.length).map(x => ({ ...x, s }))); }
function solutionsFor(x, open) {
  if (x.f.a.length) return x.f.a;
  return open[x.key] != null && String(open[x.key]).trim() !== '' ? [open[x.key]] : [];
}
function maxPoints() {
  const open = store.get(OPEN, {});
  return D.stations.reduce((a, s) => a + fieldsOf(s).filter(x => solutionsFor(x, open).length).length, 0);
}

function score(r) {
  const open = store.get(OPEN, {});
  let pts = 0, pending = 0;
  const stations = D.stations.map(s => {
    const checked = r.c.includes(s.id);
    let got = 0, max = 0;
    const fields = fieldsOf(s).map(x => {
      const val = r.a[s.id]?.[x.k] ?? '';
      const sol = solutionsFor(x, open);
      let ok = null;
      if (sol.length) {
        max++;
        ok = checked && !!String(val).trim() && sol.some(a => normAnswer(x.q.type, a) === normAnswer(x.q.type, val));
        if (ok) got++;
      } else if (checked) pending++;
      return { ...x, val, ok };
    });
    pts += got;
    return { s, checked, got, max, fields };
  });
  return { r, pts, pending, time: r.e - r.s, stations };
}

function ranking() {
  const all = Object.values(store.get(RESULTS, {}));
  return all.map(score).sort((a, b) => b.pts - a.pts || (a.time || Infinity) - (b.time || Infinity));
}

/* ---------- Login ---------- */

let bundle;
async function getBundle() {
  bundle ||= await fetch('orga.enc.json', { cache: 'no-store' }).then(r => r.json());
  return bundle;
}
async function unlock(key) {
  try {
    D = await decrypt(await getBundle(), key);
  } catch {
    return false;
  }
  try { sessionStorage.setItem(SESSION, key); } catch { /* egal */ }
  if (!store.get(RESULTS, null) && !store.get(TEST_OFF, false)) loadTestData();
  let pending = null;
  try { pending = sessionStorage.getItem('gaudi-pending'); sessionStorage.removeItem('gaudi-pending'); } catch { /* egal */ }
  if (pending) importCode(pending);
  show('wertung');
  return true;
}

function login() {
  app.innerHTML = `
    <div class="card" style="max-width:420px;margin:40px auto">
      <h2>🔐 Spielleitung</h2>
      <p class="muted">Rangliste, Lösungen und alle Fotos – nur für die Orga.</p>
      <form id="login" class="stack">
        <label>Benutzername<input id="user" autocomplete="username" autocapitalize="none" required></label>
        <label>Passwort<input id="pw" type="password" autocomplete="current-password" required></label>
        <button class="primary big" id="go">Anmelden</button>
      </form>
      <p class="small center" style="margin-top:16px"><a href="./">← Zum Quiz</a></p>
    </div>`;
  $('#user').focus();
  $('#login').onsubmit = async e => {
    e.preventDefault();
    const btn = $('#go');
    btn.disabled = true; btn.textContent = 'Prüfe…';
    if (!(await unlock(loginKey($('#user').value, $('#pw').value)))) {
      btn.disabled = false; btn.textContent = 'Anmelden';
      const f = $('#login'); f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake');
      toast('Benutzername oder Passwort falsch');
    }
  };
}

function importCode(code) {
  try {
    const r = parseResult(code);
    const replaced = addResult(r);
    toast(`🚗 ${r.t}: Ergebnis ${replaced ? 'aktualisiert' : 'übernommen'}`);
    return true;
  } catch {
    toast('Das ist kein gültiger Ergebnis-Link.');
    return false;
  }
}

/* ---------- Ansichten ---------- */

let tab = 'wertung';
function show(t) {
  tab = t;
  app.innerHTML = `
    <div class="row between noprint" style="margin-bottom:12px">
      <div class="tabs" role="tablist">
        <button role="tab" data-tab="wertung" aria-selected="${t === 'wertung'}">🏆 Wertung</button>
        <button role="tab" data-tab="loesungen" aria-selected="${t === 'loesungen'}">✅ Lösungen & Fotos</button>
      </div>
      <div class="row">
        <button id="print" class="icon">🖨</button>
        <button id="logout" class="icon ghost">Abmelden</button>
      </div>
    </div>
    <div id="view"></div>`;
  app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => show(b.dataset.tab));
  $('#print').onclick = () => print();
  $('#logout').onclick = () => { try { sessionStorage.removeItem(SESSION); } catch { /* egal */ } D = null; login(); };
  if (t === 'wertung') renderWertung($('#view')); else renderLoesungen($('#view'));
}

const MEDALS = ['🥇', '🥈', '🥉'];

function renderWertung(el) {
  const rank = ranking();
  const max = maxPoints();
  const hasTest = rank.some(x => x.r.test);
  const opens = openFields();
  const openSol = store.get(OPEN, {});
  const missing = opens.filter(x => !String(openSol[x.key] ?? '').trim());

  if (!rank.length) {
    el.innerHTML = `
      <div class="card center"><div style="font-size:3rem">🚗</div><h2>Noch keine Ergebnisse</h2>
        <p class="muted">Sobald ein Auto sein Ergebnis per WhatsApp schickt, tippst du auf den Link darin – dann landet es hier.</p>
        <button id="test" class="icon">Testdaten (6 Autos) laden</button></div>
      ${importCard()}`;
    $('#test').onclick = () => { loadTestData(); show('wertung'); };
    wireImport(el);
    return;
  }

  const podium = rank.slice(0, 3);
  el.innerHTML = `
    <section class="hero" style="padding-top:0">
      <p class="muted" style="margin:0">${esc(D.subtitle)}</p>
      <h1>🏆 Rangliste</h1>
      <p class="muted">${rank.length} Auto${rank.length > 1 ? 's' : ''} · ${max} Punkte möglich${missing.length ? ` · ${missing.length} Frage${missing.length > 1 ? 'n' : ''} noch ohne Lösung` : ''}</p>
      ${hasTest ? `<div class="note small row between"><span>🧪 Das sind <b>Testdaten</b> mit 6 Beispiel-Autos.</span><button id="untest" class="icon">Testdaten entfernen</button></div>` : ''}
    </section>

    <div class="podium">
      ${[1, 0, 2].filter(i => podium[i]).map(i => `
        <div class="podest p${i + 1}">
          <div class="medal">${MEDALS[i]}</div>
          <div class="car">${esc(podium[i].r.t)}</div>
          <div class="small muted">${podium[i].pts} P · ${fmtTime(podium[i].time)}</div>
          <div class="block">${i + 1}</div>
        </div>`).join('')}
    </div>

    <div class="card">
      <h3>Punkte pro Auto</h3>
      <div class="chart" role="img" aria-label="Balkendiagramm: Punkte pro Auto, Tabelle darunter">
        <div class="axis">${[0, .25, .5, .75, 1].map(f => `<span style="left:${f * 100}%">${Math.round(max * f)}</span>`).join('')}</div>
        ${rank.map((x, i) => `
          <div class="bar-row" data-i="${i}" tabindex="0">
            <div class="bar-label">${i + 1}. ${esc(x.r.t)}</div>
            <div class="bar-track"><div class="bar" style="width:${max ? x.pts / max * 100 : 0}%"></div></div>
            <div class="bar-val">${x.pts}</div>
          </div>`).join('')}
      </div>
      <div id="tip" class="tip" hidden></div>
    </div>

    <div class="card" style="overflow-x:auto">
      <h3>Tabelle</h3>
      <table class="results rank">
        <thead><tr><th>Platz</th><th>Auto</th><th>Punkte</th><th>Zeit</th><th>Stationen</th></tr></thead>
        <tbody>${rank.map((x, i) => `<tr><td>${MEDALS[i] || i + 1}</td><td>${esc(x.r.t)}${x.r.test ? ' <span class="badge">Test</span>' : ''}</td>
          <td><b>${x.pts}</b> / ${max}</td><td>${fmtTime(x.time)}</td><td>${x.r.c.length} / ${D.stations.length}</td></tr>`).join('')}</tbody>
      </table>
      <p class="small muted" style="margin:8px 0 0">Bei Punktgleichstand gewinnt die schnellere Zeit.</p>
    </div>

    <div class="card" style="overflow-x:auto">
      <h3>Stationen im Vergleich</h3>
      <table class="matrix">
        <thead><tr><th>Station</th>${rank.map(x => `<th title="${esc(x.r.t)}">${esc(x.r.t)}</th>`).join('')}</tr></thead>
        <tbody>${D.stations.map((s, si) => `<tr><td>${si + 1}. ${esc(s.title)}</td>${rank.map(x => {
          const st = x.stations[si];
          if (!st.checked) return '<td class="na" title="nicht geprüft">–</td>';
          if (!st.max) return '<td title="noch ohne Lösung">📝</td>';
          const full = st.got === st.max;
          return `<td class="${full ? 'full' : st.got ? 'part' : 'zero'}">${full ? '✅' : st.got ? '◐' : '❌'} ${st.got}/${st.max}</td>`;
        }).join('')}</tr>`).join('')}</tbody>
      </table>
      <p class="small muted" style="margin:8px 0 0">✅ alles richtig · ◐ teilweise · ❌ nichts richtig · – nicht geprüft · 📝 Lösung fehlt noch</p>
    </div>

    ${opens.length ? `<div class="card">
      <h3>📝 Fehlende Lösungen nachtragen</h3>
      <p class="small muted">Diese Fragen hatten noch keine Lösung. Sobald du sie einträgst, werden alle Autos automatisch neu gewertet.</p>
      <form id="opens" class="stack">
        ${opens.map(x => `<label>${esc(x.s.title)}: ${esc(x.q.q)}<input data-key="${esc(x.key)}" value="${esc(openSol[x.key] ?? '')}" inputmode="decimal" placeholder="Lösung"></label>`).join('')}
        <button class="primary">Speichern & neu werten</button>
      </form>
    </div>` : ''}

    <div class="card">
      <h3>Antworten der Autos</h3>
      ${rank.map(x => `<details class="answers"><summary><b>${esc(x.r.t)}</b> – ${x.pts} Punkte</summary>
        <table class="results">${x.stations.map(st => `<tr><td colspan="2"><b>${esc(st.s.title)}</b>${st.checked ? '' : ' <span class="small muted">(nicht geprüft)</span>'}</td></tr>
          ${st.fields.map(f => `<tr><td class="small">${esc(f.f.label || f.q.q)}</td><td>${esc(f.val || '–')} ${f.ok === true ? '✅' : f.ok === false ? '❌' : '📝'}</td></tr>`).join('')}`).join('')}</table>
        <button class="icon ghost danger" data-del="${esc(Object.entries(store.get(RESULTS, {})).find(([, v]) => v.t === x.r.t && !!v.test === !!x.r.test)?.[0] || '')}">Ergebnis löschen</button>
      </details>`).join('')}
    </div>

    ${importCard()}
    ${hasTest ? '' : '<p class="center"><button id="test" class="icon ghost">Testdaten (6 Autos) laden</button></p>'}`;

  wireImport(el);
  $('#untest')?.addEventListener('click', () => { removeTestData(); toast('Testdaten entfernt'); show('wertung'); });
  $('#test')?.addEventListener('click', () => { loadTestData(); show('wertung'); });
  $('#opens')?.addEventListener('submit', e => {
    e.preventDefault();
    const o = store.get(OPEN, {});
    e.target.querySelectorAll('[data-key]').forEach(i => { o[i.dataset.key] = i.value.trim(); });
    store.set(OPEN, o); toast('Gespeichert – neu gewertet'); show('wertung');
  });
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    if (!b.dataset.del || !confirm('Dieses Ergebnis löschen?')) return;
    const all = store.get(RESULTS, {}); delete all[b.dataset.del]; store.set(RESULTS, all); show('wertung');
  });

  // Tooltip pro Balken (Maus und Antippen)
  const tip = $('#tip');
  const showTip = (row) => {
    const x = rank[+row.dataset.i];
    const full = x.stations.filter(s => s.max && s.got === s.max).length;
    tip.innerHTML = `<b>${esc(x.r.t)}</b><br>${x.pts} von ${max} Punkten · Platz ${+row.dataset.i + 1}<br>Zeit ${fmtTime(x.time)} · ${full} Stationen fehlerfrei`;
    tip.hidden = false;
    const card = row.closest('.card').getBoundingClientRect(), r = row.getBoundingClientRect();
    tip.style.top = (r.bottom - card.top + 4) + 'px';
  };
  el.querySelectorAll('.bar-row').forEach(row => {
    row.addEventListener('mouseenter', () => showTip(row));
    row.addEventListener('focus', () => showTip(row));
    row.addEventListener('click', () => showTip(row));
    row.addEventListener('mouseleave', () => { tip.hidden = true; });
    row.addEventListener('blur', () => { tip.hidden = true; });
  });
}

function importCard() {
  return `<div class="card noprint">
    <h3>Ergebnis manuell übernehmen</h3>
    <p class="small muted">Normalerweise reicht es, in WhatsApp auf den Link im Ergebnis zu tippen. Klappt das nicht, Link hier einfügen:</p>
    <form id="import" class="row"><input id="code" placeholder="https://…/orga.html#e=…" style="flex:1;margin:0"><button class="primary">Übernehmen</button></form>
  </div>`;
}
function wireImport(el) {
  $('#import', el).onsubmit = e => {
    e.preventDefault();
    if (importCode($('#code').value)) show('wertung');
  };
}

function solutionHtml(q) {
  const open = store.get(OPEN, {});
  return q.fields.map((f, fi) => {
    const label = f.label ? `<b>${esc(f.label)}:</b> ` : '';
    if (!f.a.length) {
      const key = q._key + '|' + fi;
      return open[key] ? `<div class="solution">${label}✅ <b>${esc(open[key])}</b> <span class="small muted">(von dir nachgetragen)</span></div>`
        : `<div class="solution missing">${label}⚠️ Lösung fehlt – unter „Wertung“ nachtragen</div>`;
    }
    const [main, ...alt] = f.a;
    return `<div class="solution">${label}✅ <b>${esc(main)}</b>${alt.length ? ` <span class="small muted">(auch richtig: ${alt.map(esc).join(', ')})</span>` : ''}</div>`;
  }).join('');
}

function renderLoesungen(el) {
  const img = name => D.photoData[name] ? `<img src="${D.photoData[name]}" alt="${esc(name)}" loading="lazy">` : '';
  el.innerHTML = `
    <section class="hero" style="padding-top:0">
      <p class="muted" style="margin:0">${esc(D.subtitle)}</p>
      <h1>${esc(D.title)} – Lösungen</h1>
      <p class="muted">${D.stations.length} Stationen · alle Fotos zum Vergrößern antippen</p>
    </section>
    ${D.stations.map((s, i) => `
      <div class="card">
        <h2>${i + 1}. ${esc(s.title)}</h2>
        <p class="muted" style="margin-bottom:8px">📍 ${esc(s.ort)}</p>
        ${s.w3w.length ? `<div class="w3w">${s.w3w.map(w => `<a class="btn" href="${esc(w3wUrl(w.words))}" target="_blank" rel="noopener">${esc(w.label)} <b>///</b>${esc(w.words)}</a>`).join('')}</div>` : ''}
        ${s.text ? `<p class="pre small muted">Text für die Teams: ${esc(s.text)}</p>` : ''}
        ${s.orga ? `<div class="note pre small">📝 ${esc(s.orga)}</div>` : ''}
        ${s.questions.map((q, qi) => (q._key = `${s.id}|${qi}`, `<div class="question"><p>${esc(q.q)}${q.added ? '<span class="badge">ergänzt</span>' : ''}</p>
          ${q.options ? `<p class="small muted" style="margin-bottom:4px">Auswahl: ${q.options.map(esc).join(' · ')}</p>` : ''}
          ${solutionHtml(q)}</div>`)).join('')}
        ${s.photos.length ? `<div class="photos">${s.photos.map(img).join('')}</div>` : ''}
      </div>`).join('')}
    ${D.extraPhotos?.length ? `<div class="card"><h2>Weitere Fotos</h2>
      ${D.extraPhotos.map(p => `<p class="small muted">${esc(p.label)}</p><div class="photos">${img(p.file)}</div>`).join('')}</div>` : ''}`;
  el.querySelectorAll('.photos img').forEach(i => i.onclick = () => {
    const lb = document.createElement('div');
    lb.className = 'lightbox';
    lb.innerHTML = `<img src="${i.src}" alt="">`;
    lb.onclick = () => lb.remove();
    document.body.appendChild(lb);
  });
}

(async () => {
  let key = null;
  try { key = sessionStorage.getItem(SESSION); } catch { /* egal */ }
  if (!(key && await unlock(key))) login();
})();
