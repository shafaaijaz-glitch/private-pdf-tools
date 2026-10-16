// Offline support: cache the app shell on install, then serve from cache first.
const CACHE = 'private-pdf-tools-v1';
const FILES = [
  './', 'index.html', 'css/styles.css', 'icon.svg', 'manifest.webmanifest',
  'js/app.js', 'js/ops.js', 'js/render.js', 'js/ui.js',
  'js/tools/index.js', 'js/tools/common.js', 'js/tools/organize.js', 'js/tools/split.js',
  'js/tools/compress.js', 'js/tools/sign.js', 'js/tools/stamp.js', 'js/tools/toimages.js', 'js/tools/metadata.js',
  'vendor/jszip.min.js', 'vendor/pdf-lib.esm.min.js', 'vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
