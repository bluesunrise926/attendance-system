// Service Worker — 員工打卡系統 PWA
// v4：改用 compat SDK，強制清除所有舊快取
const CACHE_NAME = 'attendance-v4';
const CACHE_FILES = ['/', '/index.html', '/style.css', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CACHE_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => {
        console.log('[SW] 清除舊快取:', k);
        return caches.delete(k);
      }))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Firebase、googleapis、gstatic 請求完全不走快取
  if (e.request.url.includes('firebase') ||
      e.request.url.includes('googleapis') ||
      e.request.url.includes('gstatic')) {
    return;
  }

  // app.js 永遠從網路取得最新版（不快取）
  if (e.request.url.includes('app.js')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // 其他資源：網路優先，失敗才用快取
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
