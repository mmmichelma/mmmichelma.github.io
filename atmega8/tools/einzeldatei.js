// Baut die ganze AVR-Werkstatt in EINE HTML-Datei (alle CSS/JS eingebettet).
// Die Datei läuft offline in jedem Browser, per Doppelklick.
// Aufruf: node atmega8/tools/einzeldatei.js  ->  atmega8/AVR-Werkstatt.html
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, href) =>
  '<style>\n' + fs.readFileSync(path.join(dir, href), 'utf8') + '\n</style>');
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) =>
  '<script>\n' + fs.readFileSync(path.join(dir, src), 'utf8').replace(/<\/script/gi, '<\\/script') + '\n</script>');
const icon = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(dir, 'icon.svg')).toString('base64');
html = html.replace(/<link rel="icon" href="icon.svg"[^>]*>/, '<link rel="icon" href="' + icon + '">');
html = html.replace(/<link rel="manifest"[^>]*>\n?/, '');
html = html.replace(/<img src="icon.svg"/g, '<img src="' + icon + '"');

const out = path.join(dir, 'AVR-Werkstatt.html');
fs.writeFileSync(out, html);
console.log(out, Math.round(html.length / 1024) + ' KB');
