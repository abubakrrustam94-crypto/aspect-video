/* Aspect Studio Video — service worker (офлайн-режим) */
const VERSION = 'aspect-video-v2.7.1';
const CORE = ['./', './index.html', './manifest.webmanifest', './css/base.css', './css/style.css',
  './js/core.js', './js/render.js', './js/faces.js', './js/denoise.js', './js/interp.js', './js/subsai.js', './js/whisper-worker.js', './js/analyze.js', './js/decode.js', './js/audio.js', './js/session.js', './js/project.js', './js/local.js', './js/export.js', './js/app.js', './js/extras.js', './js/about.js', './js/changelog-data.js', './js/heal.js', './js/faces-worker.js', './js/i18n-en.js', './js/i18n.js',
  './vendor/mp4-muxer.js', './vendor/webm-muxer.js', './vendor/gifenc.js', './vendor/mp4box/mp4box.all.mjs', './vendor/mp4box/rolldown-runtime-CNh9ExCG.mjs', './vendor/mp4box/styp-BV5G3FS-.mjs', './fonts/roboto-flex-cyrillic.woff2', './fonts/roboto-flex-latin.woff2', './icons/icon-192.png', './icons/icon-512.png'];
/* Компоненты (модель лиц и её рантайм) лежат не в кэше сайта, а в файловой системе сайта (OPFS, папка aspect-video-components):
   их не сносит обновление версии, а размер виден отдельно. Service worker отдаёт их оттуда, поэтому всё работает без сети. */
const COMP_DIR = 'aspect-video-components';
const COMP_FILES = ['vendor/tfjs/runtime.js', 'vendor/tfjs/tfjs-backend-wasm-simd.wasm', 'vendor/tfjs/tfjs-backend-wasm.wasm', 'vendor/blazeface/blazeface-back.json', 'vendor/blazeface/blazeface-back.bin'];
const COMP_PREFIX = ['vendor/rnnoise/', 'vendor/whisper/'];
const BASE = new URL('./', self.registration.scope).pathname;
const relPath = url => { const p = new URL(url).pathname; return p.startsWith(BASE) ? p.slice(BASE.length) : ''; };
const MIME = { js: 'text/javascript', mjs: 'text/javascript', wasm: 'application/wasm', json: 'application/json', onnx: 'application/octet-stream', txt: 'text/plain', bin: 'application/octet-stream' };
async function opfsDir(create) { return (await navigator.storage.getDirectory()).getDirectoryHandle(COMP_DIR, { create: !!create }); }
async function opfsFile(path) { try { return await (await (await opfsDir()).getFileHandle(encodeURIComponent(path))).getFile(); } catch (e) { return null; } }
async function opfsPut(path, resp) {
  const fh = await (await opfsDir(true)).getFileHandle(encodeURIComponent(path), { create: true }), w = await fh.createWritable();
  try { await w.write(await resp.blob()); await w.close(); } catch (e) { try { await w.abort(); } catch (_) { /* ничего */ } try { await (await opfsDir()).removeEntry(encodeURIComponent(path)); } catch (_) { /* ничего */ } throw e; }
}
/* При обновлении переносим то, что раньше лежало в кэше сайта, в OPFS: пользователю не придётся качать заново */
async function migrateOld() {
  try {
    if (!(navigator.storage && navigator.storage.getDirectory)) return;
    const keys = (await caches.keys()).filter(k => /^aspect-video-v\d/.test(k) && k !== VERSION);
    for (const rel of COMP_FILES) {
      if (await opfsFile(rel)) continue;
      for (const k of keys) {
        const hit = await (await caches.open(k)).match(new URL(rel, self.registration.scope).href, { ignoreSearch: true });
        if (hit && hit.ok) { await opfsPut(rel, hit); break; }
      }
    }
  } catch (e) { /* перенос необязателен: можно скачать заново на вкладке «Компоненты» */ }
}
/* Модель лиц тяжёлая: скачивается по кнопке на вкладке «Компоненты» */
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(CORE.map(async u => {
    const r = await fetch(u + (u.endsWith('/') ? '' : (u.includes('?') ? '&' : '?') + 'v=' + VERSION), { cache: 'reload' });
    if (!r.ok) throw new Error(u + ' ' + r.status);
    await c.put(new Request(u), r);
  }))).then(migrateOld).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const rel = relPath(req.url);
  if (rel && (COMP_FILES.indexOf(rel) >= 0 || COMP_PREFIX.some(x => rel.startsWith(x)))) {                   // компонент: сначала OPFS, потом сеть; в кэш сайта не кладём
    e.respondWith((async () => {
      const f = await opfsFile(rel);
      if (f && f.size) return new Response(f, { status: 200, headers: { 'Content-Type': MIME[rel.split('.').pop()] || 'application/octet-stream', 'Content-Length': String(f.size) } });
      return fetch(req);
    })());
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(resp => {
    if (resp && resp.ok && /\/(vendor|js|css|fonts|icons)\//.test(req.url)) { const copy = resp.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return resp;
  })));
});
