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

  async function sha256(data) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  }

  // Verschlüsseln mit einem rohen 256-Bit-Schlüssel (für die Freischalt-Kette der Stationen).
  async function seal(keyBytes, bytes) {
    const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
    return toB64(iv) + '.' + toB64(ct);
  }
  // Wirft einen Fehler, wenn der Schlüssel nicht passt.
  async function unseal(keyBytes, sealed) {
    const [iv, ct] = sealed.split('.').map(fromB64);
    const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct));
  }
  async function tryUnseal(keyBytes, sealed) {
    try { return await unseal(keyBytes, sealed); } catch { return null; }
  }

  // Schlüssel aus einer Antwort: nur die richtige Antwort öffnet das Geheimnis des Feldes.
  function answerKey(salt, fieldKey, type, value) { return sha256(salt + '|' + fieldKey + '|' + normAnswer(type, value)); }
  function jokerKey(salt, stationId, code) { return sha256(salt + '|joker|' + stationId + '|' + normText(code)); }
  // Schlüssel der Station = Hash aller Feld-Geheimnisse; er öffnet die nächste Station.
  function stationKey(secrets) {
    const all = new Uint8Array(secrets.reduce((a, b) => a + b.length, 0));
    let o = 0;
    for (const b of secrets) { all.set(b, o); o += b.length; }
    return sha256(all);
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

  g.Rallye = { normText, normNum, normAnswer, encrypt, decrypt, toB64, fromB64, loginKey, w3wUrl,
    sha256, seal, unseal, tryUnseal, answerKey, jokerKey, stationKey };
})(typeof window !== 'undefined' ? window : globalThis);
