/* Steadier offline shell. Registration is intentionally owned by the production app entry point. */
const CACHE_NAME = 'steadier-shell-v6';
const CACHE_PREFIX = 'steadier-';
const INDEX_PATH = '/index.html';
const ROOT_PATH = '/';
const STATIC_PATHS = [
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
];

function isExpectedContentType(path, contentType) {
  const type = contentType.toLowerCase();
  const pathname = path.split('?')[0];
  if (pathname.endsWith('.js') || pathname.endsWith('.mjs')) return type.includes('javascript') || type.includes('ecmascript');
  if (pathname.endsWith('.css')) return type.includes('text/css');
  if (pathname.endsWith('.webmanifest')) return type.includes('manifest') || type.includes('json');
  if (pathname.endsWith('.png') || pathname.endsWith('.svg')) return type.startsWith('image/');
  return false;
}

async function fetchChecked(path) {
  const response = await fetch(path, { cache: 'reload' });
  if (!response.ok) throw new Error(`Precache request failed for ${path}: ${response.status}`);

  const contentType = response.headers.get('content-type') || '';
  if (!isExpectedContentType(path, contentType)) {
    throw new Error(`Precache response for ${path} had an unexpected content type: ${contentType || 'missing'}`);
  }
  return response;
}

async function cacheChecked(cache, path) {
  const response = await fetchChecked(path);
  await cache.put(path, response);
}

function bundlePaths(indexHtml) {
  const paths = new Set();
  const attribute = /(?:src|href)\s*=\s*["'](\/assets\/[^"'#?]+(?:\?[^"'#]*)?)["']/gi;
  let match;

  while ((match = attribute.exec(indexHtml))) {
    const url = new URL(match[1], self.location.origin);
    // HTML can contain other asset types; this worker deliberately precaches
    // only emitted JS and CSS bundles, which are checked before caching.
    if ((url.pathname.endsWith('.js') || url.pathname.endsWith('.mjs') || url.pathname.endsWith('.css'))
      && url.origin === self.location.origin) {
      paths.add(`${url.pathname}${url.search}`);
    }
  }
  return [...paths];
}

async function precacheShell() {
  const cache = await caches.open(CACHE_NAME);
  const indexResponse = await fetch(INDEX_PATH, { cache: 'reload' });
  if (!indexResponse.ok) throw new Error(`Precache request failed for ${INDEX_PATH}: ${indexResponse.status}`);
  const indexType = indexResponse.headers.get('content-type') || '';
  if (!indexType.toLowerCase().includes('text/html')) {
    throw new Error(`Precache response for ${INDEX_PATH} was not HTML`);
  }

  const indexHtml = await indexResponse.clone().text();
  await Promise.all([
    cache.put(INDEX_PATH, indexResponse.clone()),
    cache.put(ROOT_PATH, indexResponse.clone()),
  ]);

  const paths = [...STATIC_PATHS, ...bundlePaths(indexHtml)];
  await Promise.all(paths.map(path => cacheChecked(cache, path)));
}

self.addEventListener('install', event => {
  // Do not hide precache failures: an incomplete shell must not be activated.
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function networkFirstNavigation(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(CACHE_NAME);
    return (await cache.match(INDEX_PATH))
      || new Response('Steadier is unavailable offline until it has been opened while online.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
  }
}

async function cacheFirstAsset(request) {
  const cached = await caches.match(request);
  return cached || fetch(request);
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.searchParams.has('compass_oauth') || url.pathname.startsWith('/.well-known/')) return;
  // Never inspect, cache, or replay API or Manus runtime calls.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/__manus')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // Vite production bundles are content-hashed. Only those pre-cached bundles
  // use cache-first behavior; all unrelated resources continue to use network.
  if (/^\/assets\/.+-[A-Za-z0-9_-]{6,}\.(?:js|mjs|css)$/.test(url.pathname)) {
    event.respondWith(cacheFirstAsset(request));
  }
});
