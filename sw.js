// public/sw.js
const CACHE_PREFIX = 'eph-cache';
const STATIC_CACHE = `${CACHE_PREFIX}-v5`; // 之後我改碼會改這個 v 以強制刷新

self.addEventListener('install', (event) => {
  self.skipWaiting(); // 新版 SW 立刻進入 waiting
  event.waitUntil(
    caches.open(STATIC_CACHE).then((c) =>
      c.addAll([
        '/', '/index.html', '/styles.css', '/main.js',
        '/manifest.webmanifest', '/icon.png'
      ]).catch(()=>{}) // 第一次離線載入失敗也別報錯
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith(CACHE_PREFIX) && k !== STATIC_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// HTML 走「網路優先」，其他靜態走「快取優先、背景更新」
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const accept = req.headers.get('accept') || '';
  const isHTML = req.mode === 'navigate' || accept.includes('text/html');

  if (isHTML) {
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then((res) => {
          const clone = res.clone();
          caches.open(STATIC_CACHE).then((c) => c.put('/', clone).catch(()=>{}));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/index.html')))
    );
    return;
  }

  // 其他資源：Cache First + 背景更新
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req, { cache: 'no-store' })
        .then((res) => {
          caches.open(STATIC_CACHE).then((c) => c.put(req, res.clone()).catch(()=>{}));
          return res;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
