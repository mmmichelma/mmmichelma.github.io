// Erzeugt aus den Quelldaten die Spieler-Daten (ohne Lösungen) und den
// verschlüsselten Orga-Bereich (mit Lösungen und Fotos).
//
//   node tools/build.mjs <rallye.json> <fotos-ordner> <passwort>
//
// rallye.json kann auch die Datei sein, die der Orga-Bereich unter
// „Quelldaten herunterladen“ speichert – dort stecken die Fotos schon drin.
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const here = path.dirname(new URL(import.meta.url).pathname);
require(path.join(here, '..', 'common.js'));
const { hashAnswer, encrypt, toB64 } = globalThis.Rallye;

const [src, fotoDir, password] = process.argv.slice(2);
if (!src || !password) {
  console.error('Aufruf: node tools/build.mjs <rallye.json> <fotos-ordner> <passwort>');
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

const player = { title: data.title, subtitle: data.subtitle, intro: data.intro, salt: data.salt, stations: [] };
for (const s of data.stations) {
  const out = { id: s.id, title: s.title, ort: s.ort, w3w: s.w3w, text: s.text, questions: [] };
  for (const [qi, q] of s.questions.entries()) {
    const fields = [];
    for (const [fi, f] of q.fields.entries()) {
      const key = `${s.id}|${qi}|${fi}`;
      const h = await Promise.all(f.a.map(a => hashAnswer(data.salt, key, q.type, a)));
      fields.push({ label: f.label || '', open: f.a.length === 0, h });
    }
    out.questions.push({ q: q.q, type: q.type, options: q.options, fields });
  }
  player.stations.push(out);
}

const outDir = path.join(here, '..');
await writeFile(path.join(outDir, 'fragen.js'), '// Automatisch erzeugt – Lösungen nur als Prüfsumme.\nwindow.RALLYE = ' + JSON.stringify(player) + ';\n');
await writeFile(path.join(outDir, 'orga.enc.json'), JSON.stringify(await encrypt({ ...data, photoData: photos }, password)));
console.log(`fertig: ${player.stations.length} Stationen, ${Object.keys(photos).length} Fotos verschlüsselt`);
