/* Aspect Studio Video — service worker (офлайн-режим) */
const VERSION = 'aspect-video-v2.2.0';
const CORE = ['./', './index.html', './manifest.webmanifest', './css/base.css', './css/style.css',
  './js/core.js', './js/render.js', './js/faces.js', './js/analyze.js', './js/export.js', './js/app.js', './js/extras.js', './js/about.js', './js/changelog-data.js',
  './vendor/mp4-muxer.js', './vendor/webm-muxer.js', './vendor/gifenc.js', './fonts/roboto-flex-cyrillic.woff2', './fonts/roboto-flex-latin.woff2', './icons/icon-192.png', './icons/icon-512.png'];
/* Модель лиц тяжёлая: докладываем в кэш при первом использовании, а не при установке */
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(CORE.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(resp => {
    if (resp && resp.ok && /\/(vendor|js|css|fonts|icons)\//.test(req.url)) { const copy = resp.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return resp;
  })));
});
