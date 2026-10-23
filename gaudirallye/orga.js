'use strict';

/* Orga-Bereich: entschlüsselt Lösungen und Fotos mit dem Passwort. */

const { decrypt, w3wUrl } = window.Rallye;
const $ = (sel, el = document) => el.querySelector(sel);
const app = $('#app');
const SESSION = 'gaudi-orga-pw';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

let bundle;
async function getBundle() {
  bundle ||= await fetch('orga.enc.json', { cache: 'no-store' }).then(r => r.json());
  return bundle;
}

async function unlock(pw) {
  try {
    const data = await decrypt(await getBundle(), pw);
    try { sessionStorage.setItem(SESSION, pw); } catch { /* egal */ }
    render(data);
    return true;
  } catch {
    return false;
  }
}

function login() {
  app.innerHTML = `
    <div class="card" style="max-width:420px;margin:40px auto">
      <h2>🔐 Spielleitung</h2>
      <p class="muted">Hier stehen alle Lösungen und Fotos – nur für die Orga.</p>
      <form id="login" class="stack">
        <label>Passwort<input id="pw" type="password" autocomplete="current-password" required></label>
        <button class="primary big" id="go">Entsperren</button>
      </form>
      <p class="small center" style="margin-top:16px"><a href="./">← Zum Quiz</a></p>
    </div>`;
  $('#pw').focus();
  $('#login').onsubmit = async e => {
    e.preventDefault();
    const btn = $('#go');
    btn.disabled = true; btn.textContent = 'Entschlüssele…';
    if (!(await unlock($('#pw').value))) {
      btn.disabled = false; btn.textContent = 'Entsperren';
      $('#login').classList.remove('shake'); void $('#login').offsetWidth; $('#login').classList.add('shake');
      toast('Falsches Passwort');
    }
  };
}

function solutionHtml(q) {
  return q.fields.map(f => {
    const label = f.label ? `<b>${esc(f.label)}:</b> ` : '';
    if (!f.a.length) return `<div class="solution missing">${label}⚠️ Lösung fehlt – Antworten selbst werten</div>`;
    const [main, ...alt] = f.a;
    return `<div class="solution">${label}✅ <b>${esc(main)}</b>${alt.length ? ` <span class="small muted">(auch richtig: ${alt.map(esc).join(', ')})</span>` : ''}</div>`;
  }).join('');
}

function render(d) {
  const img = name => d.photoData[name] ? `<img src="${d.photoData[name]}" alt="${esc(name)}" loading="lazy">` : '';
  const total = d.stations.reduce((a, s) => a + s.questions.reduce((b, q) => b + q.fields.filter(f => f.a.length).length, 0), 0);
  app.innerHTML = `
    <div class="row between noprint" style="margin-bottom:12px">
      <a href="./" class="btn icon ghost">← Zum Quiz</a>
      <div class="row">
        <button id="print" class="icon">🖨 Drucken</button>
        <button id="export" class="icon">⬇ Quelldaten</button>
        <button id="logout" class="icon ghost">Abmelden</button>
      </div>
    </div>
    <section class="hero" style="padding-top:0">
      <p class="muted" style="margin:0">${esc(d.subtitle)}</p>
      <h1>${esc(d.title)} – Lösungen</h1>
      <p class="muted">${d.stations.length} Stationen · ${total} Punkte automatisch gewertet</p>
    </section>
    ${d.stations.map((s, i) => `
      <div class="card">
        <h2>${i + 1}. ${esc(s.title)}</h2>
        <p class="muted" style="margin-bottom:8px">📍 ${esc(s.ort)}</p>
        ${s.w3w.length ? `<div class="w3w">${s.w3w.map(w => `<a class="btn" href="${esc(w3wUrl(w.words))}" target="_blank" rel="noopener">${esc(w.label)} <b>///</b>${esc(w.words)}</a>`).join('')}</div>` : ''}
        ${s.text ? `<p class="pre small muted">Text für die Teams: ${esc(s.text)}</p>` : ''}
        ${s.orga ? `<div class="note pre small">📝 ${esc(s.orga)}</div>` : ''}
        ${s.questions.map(q => `<div class="question"><p>${esc(q.q)}${q.added ? '<span class="badge">ergänzt</span>' : ''}</p>
          ${q.options ? `<p class="small muted" style="margin-bottom:4px">Auswahl: ${q.options.map(esc).join(' · ')}</p>` : ''}
          ${solutionHtml(q)}</div>`).join('')}
        ${s.photos.length ? `<div class="photos">${s.photos.map(img).join('')}</div>` : ''}
      </div>`).join('')}
    ${d.extraPhotos?.length ? `<div class="card"><h2>Weitere Fotos</h2>
      ${d.extraPhotos.map(p => `<p class="small muted">${esc(p.label)}</p><div class="photos">${img(p.file)}</div>`).join('')}</div>` : ''}`;

  $('#print').onclick = () => print();
  $('#logout').onclick = () => { try { sessionStorage.removeItem(SESSION); } catch { /* egal */ } login(); };
  $('#export').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }));
    a.download = 'rallye-quelldaten.json';
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Achtung: Die Datei enthält alle Lösungen!');
  };
  app.querySelectorAll('.photos img').forEach(i => i.onclick = () => {
    const lb = document.createElement('div');
    lb.className = 'lightbox';
    lb.innerHTML = `<img src="${i.src}" alt="">`;
    lb.onclick = () => lb.remove();
    document.body.appendChild(lb);
  });
}

(async () => {
  let pw = null;
  try { pw = sessionStorage.getItem(SESSION); } catch { /* egal */ }
  if (!(pw && await unlock(pw))) login();
})();
