'use strict';
/* Защита от смешанных версий: если файлы из кэша не совпадают с index.html, чистим кэш и один раз перезагружаемся */
(function () {
  var m = document.querySelector('meta[name="av-version"]'), want = m && m.content, bad = false;
  try { bad = typeof APP_VERSION === 'undefined' || APP_VERSION !== want || typeof PIN_KEY === 'undefined' || typeof svgIcon !== 'function' || !window.AV || typeof AV.audioSupport !== 'function' || typeof AV.exportMedia !== 'function'; } catch (e) { bad = true; }
  if (!bad) { try { sessionStorage.removeItem('av-heal'); } catch (e) { /* ничего */ } return; }
  try { if (sessionStorage.getItem('av-heal')) return; sessionStorage.setItem('av-heal', '1'); } catch (e) { return; }
  var go = function () { location.reload(); };
  Promise.all([
    window.caches ? caches.keys().then(function (k) { return Promise.all(k.map(function (x) { return caches.delete(x); })); }) : 0,
    navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(function (r) { return Promise.all(r.map(function (x) { return x.unregister(); })); }) : 0
  ]).then(go, go);
})();
