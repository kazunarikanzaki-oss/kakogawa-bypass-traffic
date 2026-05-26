// NERV TRAFFIC Service Worker
// オフライン耐性 (シェル): index.html / style.css / app.js / icon.svg / manifest.json
// 動的データ (tweets.json, ライブカメラ, 地図) は SW を通さずネットワーク直行

const CACHE = 'nerv-traffic-v3';
const SHELL = [
  './',
  'index.html',
  'style.css?v=11',
  'app.js?v=10',
  'manifest.json',
  'icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // 同一オリジン以外 (raw.githubusercontent / Google Maps / mlit camera / X) は素通し
  if (url.origin !== self.location.origin) return;
  // GET 以外は素通し
  if (e.request.method !== 'GET') return;

  // シェルアセット: cache-first + ネットワーク更新
  e.respondWith(
    caches.match(e.request, { ignoreSearch: false }).then((cached) => {
      const fetched = fetch(e.request).then((resp) => {
        if (resp && resp.status === 200) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return resp;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
});
