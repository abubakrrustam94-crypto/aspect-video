'use strict';
/* Aspect Studio Video — слежение за лицом для режима «Обрезать».
   Модель BlazeFace (MediaPipe) лежит рядом с сайтом (vendor/blazeface, vendor/tfjs), грузится при первом запуске и работает
   в отдельном потоке (js/faces-worker.js). Видео никуда не отправляется. */
(function () {
  var AV = (window.AV = window.AV || {});
  var N = 256, MIN_SCORE = 0.7;
  var worker = null, ready = null, seq = 0, waits = new Map(), backend = '';

  function call(msg, transfer) {
    return new Promise(function (res, rej) {
      var id = ++seq;
      waits.set(id, { res: res, rej: rej });
      worker.postMessage(Object.assign({}, msg, { id: id }), transfer || []);
    });
  }
  function start() {
    if (ready) return ready;
    ready = (async function () {
      if (typeof Worker === 'undefined') throw new Error('В этом браузере нет фоновых потоков.');
      worker = new Worker('js/faces-worker.js');
      worker.onmessage = function (e) {
        var w = waits.get(e.data.id); if (!w) return;
        waits.delete(e.data.id);
        e.data.ok ? w.res(e.data) : w.rej(new Error(e.data.error));
      };
      worker.onerror = function (e) {
        e.preventDefault();
        waits.forEach(function (w) { w.rej(new Error('Не запустился поиск лиц.')); });
        waits.clear();
      };
      var r = await call({ type: 'init' });
      backend = r.backend;
    })();
    ready.catch(function () {
      if (worker) worker.terminate();
      worker = null; ready = null; waits.clear();
    });
    return ready;
  }

  var cv = null, cg = null;
  /* Лица на одном кадре (src — холст или видео, sw×sh — его размер). Результат в долях кадра. */
  async function detect(src, sw, sh) {
    if (!cv) { cv = document.createElement('canvas'); cv.width = cv.height = N; cg = cv.getContext('2d', { willReadFrequently: true }); }
    var k = Math.min(N / sw, N / sh), dw = sw * k, dh = sh * k, ox = (N - dw) / 2, oy = (N - dh) / 2;
    cg.fillStyle = '#000'; cg.fillRect(0, 0, N, N);
    cg.imageSmoothingQuality = 'high';
    cg.drawImage(src, ox, oy, dw, dh);
    var px = cg.getImageData(0, 0, N, N).data;
    var r = await call({ type: 'detect', pixels: px, minScore: MIN_SCORE }, [px.buffer]);
    return r.boxes.map(function (b) {
      return {
        x0: Math.max(0, (b[0] * N - ox) / dw), y0: Math.max(0, (b[1] * N - oy) / dh),
        x1: Math.min(1, (b[2] * N - ox) / dw), y1: Math.min(1, (b[3] * N - oy) / dh), score: b[4]
      };
    }).filter(function (f) { return f.x1 - f.x0 > 0.01 && f.y1 - f.y0 > 0.01; });
  }

  /* Центр внимания: самое крупное лицо, чуть приподнятый к глазам */
  function pick(faces) {
    if (!faces.length) return null;
    faces.sort(function (a, b) { return (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0); });
    var f = faces[0];
    return { x: (f.x0 + f.x1) / 2, y: (f.y0 + f.y1) / 2 };
  }

  /* Идёт по видео с шагом step секунд. grab(t) → Promise<{src,sw,sh}>: ставит видео на время t и отдаёт кадр.
     Возвращает дорожку [{t,x,y}] или null, если лиц не нашлось. */
  AV.trackFaces = async function (o) {
    await start();
    var pts = [], total = Math.max(1, Math.ceil((o.end - o.start) / o.step) + 1), found = 0;
    for (var i = 0; i < total; i++) {
      if (o.signal && o.signal.aborted) { var e = new Error('Отменено'); e.aborted = true; throw e; }
      var t = Math.min(o.end - 0.001, o.start + i * o.step);
      var fr = await o.grab(t);
      var c = pick(await detect(fr.src, fr.sw, fr.sh));
      if (c) found++;
      pts.push({ t: t, c: c });
      if (o.onProgress) o.onProgress((i + 1) / total);
    }
    if (found < Math.max(1, total * 0.1)) return null;
    /* заполняем пропуски ближайшими найденными значениями */
    var last = null;
    pts.forEach(function (p) { if (p.c) last = p.c; else if (last) p.c = last; });
    last = null;
    for (var j = pts.length - 1; j >= 0; j--) { if (pts[j].c) last = pts[j].c; else if (last) pts[j].c = last; }
    /* сглаживание: камера не должна дёргаться вслед за каждой ошибкой детектора */
    var out = [], sx = pts[0].c.x, sy = pts[0].c.y;
    pts.forEach(function (p) {
      sx += (p.c.x - sx) * 0.45; sy += (p.c.y - sy) * 0.45;
      out.push({ t: p.t, x: sx, y: sy });
    });
    return out;
  };

  /* Положение «камеры» в момент t (линейная интерполяция по дорожке) */
  AV.focusAt = function (track, t) {
    if (!track || !track.length) return null;
    if (t <= track[0].t) return { x: track[0].x, y: track[0].y };
    var n = track.length - 1;
    if (t >= track[n].t) return { x: track[n].x, y: track[n].y };
    var lo = 0, hi = n;
    while (hi - lo > 1) { var m = (lo + hi) >> 1; if (track[m].t <= t) lo = m; else hi = m; }
    var a = track[lo], b = track[hi], k = (t - a.t) / (b.t - a.t || 1);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  };
  AV.facesBackend = function () { return backend; };
})();
