/* ════════════════════════════════════
   SERVICE WORKER — offline support
   HTML: network-first (3 s timeout) so updates arrive; static files: cache-first.
   Caches are versioned and namespaced "healthlog-" so they never touch the old
   Gym Tracker's caches on the same origin. A new version waits until the user
   taps "Refresh" in the update banner.
   ════════════════════════════════════ */
const VERSION = 'v16';
const STATIC = `healthlog-static-${VERSION}`;
const PAGES = `healthlog-pages-${VERSION}`;
const CHART_JS = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';

// Keep in sync with the <script>/<link> tags in index.html (matched ignoring ?v=)
const ASSETS = [
  './', 'index.html', 'styles.css', 'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/icon-maskable-512.png',
  'fonts/barlow-condensed-600.woff2', 'fonts/barlow-condensed-700.woff2', 'fonts/inter-latin-var.woff2',
  'js/util.js', 'js/units.js', 'js/schema.js', 'js/domain.js', 'js/session.js', 'js/backup.js', 'js/legacy.js', 'js/demo.js', 'js/db.js', 'js/repo.js',
  'js/ui/toast.js', 'js/ui/sheet.js', 'js/ui/entry.js', 'js/ui/rest.js', 'js/ui/duration.js', 'js/ui/exercises.js', 'js/ui/workout.js',
  'js/ui/charts.js', 'js/ui/history.js', 'js/ui/insights.js', 'js/ui/trackers.js', 'js/ui/data.js', 'js/ui/legacy-import.js',
  'js/ui/today.js', 'js/ui/settings.js', 'js/app.js',
];

async function precache() {
  const cache = await caches.open(STATIC);
  await cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })));
  // Charts work offline even if Insights was never opened online; a CDN hiccup mustn't block install
  try { await cache.add(new Request(CHART_JS, { mode: 'cors' })); } catch { /* retried by ensureCached */ }
}

// The old Gym Tracker's worker deletes every other cache on this origin when it updates,
// so pages ask us to re-check on each launch and refill anything missing.
async function ensureCached() {
  const cache = await caches.open(STATIC);
  for (const url of [...ASSETS, CHART_JS]) {
    if (await cache.match(url, { ignoreSearch: true })) continue;
    try { await cache.add(new Request(url, url === CHART_JS ? { mode: 'cors' } : { cache: 'reload' })); } catch { /* offline: try next launch */ }
  }
}

self.addEventListener('install', e => { e.waitUntil(precache()); });

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('healthlog-') && k !== STATIC && k !== PAGES) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
  if (e.data === 'ENSURE_CACHE') e.waitUntil(ensureCached());
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

async function networkFirst(request) {
  const cache = await caches.open(PAGES);
  try {
    const res = await Promise.race([fetch(request), timeout(3000)]);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    return (await cache.match(request, { ignoreSearch: true }))
      || (await caches.match('index.html', { ignoreSearch: true, cacheName: STATIC }))
      || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (request.mode === 'navigate') { e.respondWith(networkFirst(request)); return; }
  const scope = new URL(self.registration.scope);
  if ((url.origin === scope.origin && url.pathname.startsWith(scope.pathname)) || url.href === CHART_JS) {
    e.respondWith(cacheFirst(request));
  }
});
