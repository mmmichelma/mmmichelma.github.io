// Erzeugt aus den Quelldaten die Spieler-Daten und den verschlüsselten Orga-Bereich.
//
//   node tools/build.mjs <rallye.json> <fotos-ordner> <benutzername> <passwort>
//
// Freischalt-Kette: Station 1 ist offen. Jede weitere Station ist mit einem
// Schlüssel verschlüsselt, den man nur aus den richtigen Antworten der
// vorherigen Station berechnen kann (oder mit deren Joker-Code).
//
// rallye.json kann auch die Datei sein, die der Orga-Bereich unter
// „Quelldaten herunterladen“ speichert – dort stecken die Fotos schon drin.
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const here = path.dirname(new URL(import.meta.url).pathname);
require(path.join(here, '..', 'common.js'));
const { encrypt, toB64, loginKey, seal, answerKey, jokerKey, stationKey, normAnswer } = globalThis.Rallye;

const [src, fotoDir, user, pw] = process.argv.slice(2);
if (!src || !user || !pw) {
  console.error('Aufruf: node tools/build.mjs <rallye.json> <fotos-ordner> <benutzername> <passwort>');
  process.exit(1);
}
const data = JSON.parse(await readFile(src, 'utf8'));
const photos = data.photoData || {};
const wanted = new Set([...data.stations.flatMap(s => s.photos), ...(data.extraPhotos || []).map(p => p.file)]);
for (const name of wanted) {
  if (photos[name]) continue;
  const bytes = await readFile(path.join(fotoDir, name + '.jpg'));
  photos[name] = 'data:image/jpeg;base64,' + toB64(new Uint8Array(bytes));
}

const rand = n => crypto.getRandomValues(new Uint8Array(n));
const usedJokers = new Set();
function newJoker() {
  let c;
  do { c = String(1000 + new DataView(rand(4).buffer).getUint32(0) % 9000); } while (usedJokers.has(c));
  usedJokers.add(c);
  return c;
}

const payloads = [], keys = [];
for (const s of data.stations) {
  const secrets = [];
  const questions = [];
  for (const [qi, q] of s.questions.entries()) {
    const fields = [];
    for (const [fi, f] of q.fields.entries()) {
      if (!f.a.length) { fields.push({ label: f.label || '', open: true }); continue; }
      const secret = rand(32);
      const fieldKey = `${s.id}|${qi}|${fi}`;
      // Varianten, die nach dem Normalisieren gleich sind, nur einmal einpacken
      const variants = [...new Map(f.a.map(a => [normAnswer(q.type, a), a])).values()];
      const wraps = await Promise.all(variants.map(async a => seal(await answerKey(data.salt, fieldKey, q.type, a), secret)));
      wraps.sort();
      secrets.push(secret);
      fields.push({ label: f.label || '', wraps });
    }
    questions.push({ q: q.q, type: q.type, options: q.options, fields });
  }
  const key = secrets.length ? await stationKey(secrets) : rand(32);
  s.joker = newJoker();
  const p = { id: s.id, title: s.title, ort: s.ort, w3w: s.w3w, text: s.text, questions,
    joker: await seal(await jokerKey(data.salt, s.id, s.joker), key) };
  if (!secrets.length) p.free = toB64(key); // nur offene Fragen: jede Antwort schaltet frei
  payloads.push(p);
  keys.push(key);
}

const enc = new TextEncoder();
const chain = [payloads[0]];
for (let i = 1; i < payloads.length; i++) chain.push(await seal(keys[i - 1], enc.encode(JSON.stringify(payloads[i]))));

const player = { title: data.title, subtitle: data.subtitle, intro: data.intro, salt: data.salt,
  count: payloads.length, fieldCount: payloads.reduce((a, p) => a + p.questions.reduce((b, q) => b + q.fields.length, 0), 0), stations: chain };

const outDir = path.join(here, '..');
await writeFile(path.join(outDir, 'fragen.js'), '// Automatisch erzeugt – ab Station 2 verschlüsselt, Lösungen nicht enthalten.\nwindow.RALLYE = ' + JSON.stringify(player) + ';\n');
await writeFile(path.join(outDir, 'orga.enc.json'), JSON.stringify(await encrypt({ ...data, photoData: photos }, loginKey(user, pw))));
console.log(`fertig: ${payloads.length} Stationen, Joker: ${data.stations.map(s => s.id + '=' + s.joker).join(', ')}`);
