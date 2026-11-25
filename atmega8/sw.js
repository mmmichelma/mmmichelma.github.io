/* Offline-Cache für die AVR-Werkstatt */
const CACHE = 'avr8-v1';
const FILES = [
  './', 'index.html', 'style.css', 'icon.svg', 'manifest.webmanifest',
  'vendor/codemirror/codemirror.css', 'vendor/codemirror/codemirror.js', 'vendor/codemirror/clike.js',
  'vendor/codemirror/matchbrackets.js', 'vendor/codemirror/closebrackets.js', 'vendor/codemirror/active-line.js',
  'vendor/codemirror/comment.js',
  'js/mcu.js', 'js/compiler.js', 'js/vm.js', 'js/board.js', 'js/examples.js', 'js/help.js', 'js/app.js',
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Erst Netz (immer aktuell), offline aus dem Cache
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(r => {
      const copy = r.clone();
      if (r.ok && new URL(e.request.url).origin === location.origin) caches.open(CACHE).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
