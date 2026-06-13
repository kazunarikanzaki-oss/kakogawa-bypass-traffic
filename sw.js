// NERV TRAFFIC Service Worker
// オフライン耐性 (シェル): index.html / style.css / app.js / icon.svg / manifest.json
// 動的データ (tweets.json, ライブカメラ, 地図) は SW を通さずネットワーク直行

const CACHE = 'nerv-traffic-v8';
const SHELL = [
  './',
  'index.html',
  'style.css?v=15',
  'app.js?v=14',
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

  // HTML ナビゲーション (index.html / './') は network-first。
  // オンライン時は常に最新 HTML を取得し、正しいバージョンの JS/CSS を読み込ませる。
  // (cache-first だと古い index.html が固定され、新コードに更新されない問題を防ぐ)
  const isHTML = e.request.mode === 'navigate' ||
    e.request.destination === 'document' ||
    /\.html$/.test(url.pathname) || url.pathname.endsWith('/');
  if (isHTML) {
    e.respondWith(
      fetch(e.request).then((resp) => {
        if (resp && resp.status === 200) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return resp;
      }).catch(() => caches.match(e.request, { ignoreSearch: false })
        .then((c) => c || caches.match('./')))
    );
    return;
  }

  // その他のシェルアセット (バージョン付き JS/CSS 等): cache-first + 背景更新
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
