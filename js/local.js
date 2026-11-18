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
    var a = load(), box = $('#perfText');
    $('#perfCount').textContent = a.length;
    if (!a.length) { box.replaceChildren(el('p', 'perf-empty', 'Пока пусто. После первого сохранения здесь появится скорость.')); return; }
    var sp = a.map(function (x) { return x.dur / Math.max(0.001, x.ms / 1000); });                 // во сколько раз быстрее реального времени
    var avg = sp.reduce(function (p, v) { return p + v; }, 0) / sp.length, best = Math.max.apply(null, sp);
    function tile(v, l) { var t = el('div', 'perf-tile'); t.append(el('b', '', v), el('span', '', l)); return t; }
    var sum = el('div', 'perf-sum'); sum.append(tile(fmt1(avg) + '×', 'Средняя'), tile(fmt1(best) + '×', 'Лучшая'), tile(String(a.length), 'Сохранений'));
    var list = el('ul', 'perf-list');
    a.slice().reverse().forEach(function (x, i0) {
      var i = a.length - 1 - i0, v = sp[i], d = new Date(x.t), row = el('li', 'perf-row' + (v < 1 ? ' slow' : ''));
      var top = el('div', 'perf-top'), bar = el('div', 'perf-bar'), fill = el('i'), meta = el('div', 'perf-meta');
      top.append(el('b', 'perf-x', fmt1(v) + '×'), el('span', 'perf-main', x.w + '×' + x.h + ' · ' + String(x.fmt).toUpperCase() + ' · ' + fmt1(x.dur) + ' с → ' + fmt1(x.ms / 1000) + ' с'));
      fill.style.width = Math.max(4, Math.round(100 * v / best)) + '%'; bar.appendChild(fill); bar.setAttribute('aria-hidden', 'true');
      meta.textContent = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + (x.eng ? ' · ' + x.eng : '');
      row.append(top, bar, meta); list.appendChild(row);
    });
    box.replaceChildren(sum, el('p', 'perf-hint', '× реального времени: во сколько раз сохранение быстрее самого видео. Меньше 1× значит медленнее.'), list);
  };
  /* rec: { fmt, w, h, dur — секунд результата, ms — сколько заняло сохранение, eng } */
  AV.perfAdd = function (rec) {
    var a = load(); a.push({ t: Date.now(), fmt: String(rec.fmt || ''), w: rec.w | 0, h: rec.h | 0, dur: +rec.dur || 0, ms: Math.round(rec.ms) || 0, eng: String(rec.eng || '').slice(0, 40) });
    ls.set(PERF_KEY, JSON.stringify(a.slice(-PERF_MAX))); AV.perfRender();
  };
  $('#perfClear').addEventListener('click', function () { ls.del(PERF_KEY); AV.perfRender(); toast('Журнал скорости очищен'); });
  AV.perfRender();
})();
