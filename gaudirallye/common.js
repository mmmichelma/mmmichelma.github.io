// Gemeinsamer Code für Quiz, Orga-Bereich und Build-Skript (Browser + Node).
(function (g) {
  'use strict';

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

  function toB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromB64(str) {
    const bin = atob(str), b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return b;
  }

  async function hashAnswer(salt, key, type, value) {
    const data = new TextEncoder().encode(salt + '|' + key + '|' + normAnswer(type, value));
    const buf = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
    return Array.from(buf.slice(0, 8), b => b.toString(16).padStart(2, '0')).join('');
  }

  const ITER = 250000;
  async function deriveKey(password, salt) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encrypt(obj, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj))));
    return { v: 1, salt: toB64(salt), iv: toB64(iv), ct: toB64(ct) };
  }
  // Wirft einen Fehler, wenn das Passwort falsch ist.
  async function decrypt(bundle, password) {
    const key = await deriveKey(password, fromB64(bundle.salt));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(bundle.iv) }, key, fromB64(bundle.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  // Benutzername + Passwort ergeben zusammen den Schlüssel für den Orga-Bereich.
  function loginKey(user, pw) { return String(user).trim().toLowerCase() + ':' + pw; }

  function w3wUrl(words) { return 'https://what3words.com/' + encodeURIComponent(words); }

  g.Rallye = { normText, normNum, normAnswer, hashAnswer, encrypt, decrypt, toB64, fromB64, loginKey, w3wUrl };
})(typeof window !== 'undefined' ? window : globalThis);
