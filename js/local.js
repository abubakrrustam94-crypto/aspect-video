'use strict';
/* Aspect Studio Video — мелочи на устройстве: предложение установить приложение и журнал скорости сохранений.
   Ничего никуда не отправляется: журнал лежит в localStorage. */
(function () {
  var AV = (window.AV = window.AV || {});

  /* ---------- Установка ---------- */
  var deferred = null;
  function standalone() { try { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (e) { return false; } }
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; });
  window.addEventListener('appinstalled', function () { deferred = null; $('#installBar').hidden = true; });
  AV.afterSave = function () {                                    // зовётся после каждого сохранённого видео
    if (!deferred || standalone() || ls.get(INSTALL_KEY)) return;
    $('#installBar').hidden = false;
  };
  $('#installGo').addEventListener('click', async function () {
    var d = deferred; $('#installBar').hidden = true; if (!d) return;
    try { await d.prompt(); var c = await d.userChoice; if (c && c.outcome === 'dismissed') ls.set(INSTALL_KEY, '1'); } catch (e) { logError(e, 'установка'); }
    deferred = null;
  });
  $('#installNo').addEventListener('click', function () { ls.set(INSTALL_KEY, '1'); $('#installBar').hidden = true; });

  /* ---------- Журнал скорости ---------- */
  var PERF_MAX = 20;
  function load() {
    try { var a = JSON.parse(ls.get(PERF_KEY) || '[]'); return Array.isArray(a) ? a.filter(function (x) { return x && isFinite(x.ms) && isFinite(x.dur); }).slice(-PERF_MAX) : []; } catch (e) { return []; }
  }
  function fmt1(n) { return (Math.round(n * 10) / 10).toString().replace('.', ','); }
  AV.perfRender = function () {
    var a = load(), lines = a.slice().reverse().map(function (x) {
      var d = new Date(x.t);
      return d.toLocaleDateString() + ' ' + d.toLocaleTimeString().slice(0, 5) + ' · ' + x.w + '×' + x.h + ' · ' + String(x.fmt).toUpperCase() +
        '\nВидео ' + fmt1(x.dur) + ' с, сохранено за ' + fmt1(x.ms / 1000) + ' с (' + fmt1(x.dur / Math.max(0.001, x.ms / 1000)) + '× реального времени)' + (x.eng ? ', ' + x.eng : '');
    });
    $('#perfCount').textContent = a.length;
    $('#perfText').textContent = lines.length ? lines.join('\n\n') : 'Пока пусто. После первого сохранения здесь появится скорость.';
  };
  /* rec: { fmt, w, h, dur — секунд результата, ms — сколько заняло сохранение, eng } */
  AV.perfAdd = function (rec) {
    var a = load(); a.push({ t: Date.now(), fmt: String(rec.fmt || ''), w: rec.w | 0, h: rec.h | 0, dur: +rec.dur || 0, ms: Math.round(rec.ms) || 0, eng: String(rec.eng || '').slice(0, 40) });
    ls.set(PERF_KEY, JSON.stringify(a.slice(-PERF_MAX))); AV.perfRender();
  };
  $('#perfClear').addEventListener('click', function () { ls.del(PERF_KEY); AV.perfRender(); toast('Журнал скорости очищен'); });
  AV.perfRender();
})();
