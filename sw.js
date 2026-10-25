/**
 * Service Worker
 *
 * 刷新策略（重要）
 * ----------------
 * 桌面书签是 PWA 独立模式，没有地址栏，iOS 也不支持下拉刷新，
 * 所以页面必须自己提供刷新入口。这里配合页面实现三件事：
 *
 * 1. 静态资源走「缓存优先 + 后台更新」（stale-while-revalidate）
 *    → 打开瞬间就有内容，不等网络；同时后台悄悄拉新版
 * 2. 页面可以发 SKIP_WAITING 消息，让新版本立刻接管
 * 3. 页面可以发 CHECK_UPDATE 消息，主动检查是否有新版本
 */

const CACHE = 'tx-tracker-v3';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/catalog.js',
  './js/db.js',
  './js/utils.js',
  './js/plan.js',
  './js/import.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/** 判断请求是不是应用外壳（HTML 或静态资源） */
function isShell(req, url) {
  if (url.origin !== self.location.origin) return false;
  if (req.mode === 'navigate') return true;
  return /\.(html|css|js|json|webmanifest|png|svg|woff2?)$/i.test(url.pathname);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (!isShell(req, url)) return;

  // 页面导航：网络优先，失败回缓存（保证能打开最新版 HTML）
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(async () => {
          const hit = await caches.match(req);
          return hit || caches.match('./index.html');
        })
    );
    return;
  }

  // 静态资源：缓存优先 + 后台更新
  e.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => hit);

      return hit || network;
    })
  );
});

self.addEventListener('message', (e) => {
  const data = e.data || {};

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (data.type === 'CHECK_UPDATE') {
    e.waitUntil(
      (async () => {
        try {
          const reg = self.registration;
          await reg.update();
          const hasUpdate = !!reg.waiting;
          e.source?.postMessage({ type: 'UPDATE_STATUS', hasUpdate });
        } catch {
          e.source?.postMessage({ type: 'UPDATE_STATUS', hasUpdate: false });
        }
      })()
    );
  }

  if (data.type === 'CLEAR_CACHE') {
    e.waitUntil(
      caches.keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .then(() => e.source?.postMessage({ type: 'CACHE_CLEARED' }))
    );
  }
});
