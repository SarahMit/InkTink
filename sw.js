// InkTink service worker — caches the app shell so it loads offline.
//
// Strategy: network-first for the app shell (HTML/JS/CSS). When online the user
// always gets the latest files, so shipping changes needs NO manual version
// bump. When offline we fall back to the last cached copy. Other static assets
// (images, manifest, fonts) use cache-first since they rarely change.
//
// CACHE is only a storage namespace now; bump it only if you ever need to force
// a hard wipe of every client's cache.
const CACHE = 'inktink-v3';
const ASSETS = [
  '.',
  'index.html',
  'app.js',
  'style.css',
  'manifest.json',
  'assets/Logo.svg',
  'assets/favicon.svg',
  'vendor/docx.min.js'
];

// Files that make up the app shell — these must stay fresh, so we prefer the
// network and only use the cache as an offline fallback.
const SHELL = new Set(['', 'index.html', 'app.js', 'style.css']);

function isShellRequest(request) {
  if (request.mode === 'navigate') return true;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  // Path relative to the SW scope, e.g. "app.js" or "" for the root.
  const path = url.pathname.replace(self.registration.scope.replace(self.location.origin, ''), '');
  return SHELL.has(path);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  if (isShellRequest(event.request)) {
    // Network-first: fetch fresh, cache the new copy, fall back to cache offline.
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match('index.html')))
    );
    return;
  }

  // Cache-first for everything else (images, manifest, fonts…).
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
