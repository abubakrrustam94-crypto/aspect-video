'use strict';
/* Aspect Studio Video — сцены и заметный объект. Обычные алгоритмы без нейросети: ничего не скачивается, работает везде.
   AV.findScenes: сравнивает соседние кадры (яркость 32×18 и гистограмма), резкая смена = граница сцены; место уточняется делением пополам.
   AV.trackSalient: на каждом шаге строит карту заметности (контраст цвета с окружением + движение + лёгкий упор на центр),
   берёт самое заметное место и сглаживает путь. Результат того же вида, что у слежения за лицом, поэтому кадр «Обрезать» идёт за объектом. */
(function () {
  var AV = (window.AV = window.AV || {});
  var FW = 32, FH = 18;

  function mk(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function abortErr() { var e = new Error('Отменено'); e.aborted = true; return e; }
  function sample(v, g, cv) {                          // кадр видео → яркость и гистограмма
    g.drawImage(v, 0, 0, FW, FH);
    var d = g.getImageData(0, 0, FW, FH).data, y = new Uint8Array(FW * FH), h = new Float32Array(24), n = FW * FH;
    for (var i = 0, j = 0; j < n; i += 4, j++) {
      y[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
      h[d[i] >> 5]++; h[8 + (d[i + 1] >> 5)]++; h[16 + (d[i + 2] >> 5)]++;
    }
    for (var k = 0; k < 24; k++) h[k] /= n;
    return { y: y, h: h };
  }
  function dist(a, b) {
    var s = 0, i, n = a.y.length;
    for (i = 0; i < n; i++) s += Math.abs(a.y[i] - b.y[i]);
    var l = s / n / 255, hs = 0;
    for (i = 0; i < 24; i++) hs += Math.abs(a.h[i] - b.h[i]);
    return l + hs / 6;                                  // яркость 0..1 плюс гистограмма 0..1
  }
  function median(a) { var b = a.slice().sort(function (p, q) { return p - q; }); return b.length ? b[b.length >> 1] : 0; }

  /* o: { video, start, end, step?, minLen?, signal?, onProgress? } → [{ start, end }] */
  AV.findScenes = async function (o) {
    var cv = mk(FW, FH), g = cv.getContext('2d', { willReadFrequently: true });
    var dur = o.end - o.start, step = o.step || Math.min(1, Math.max(0.2, dur / 400)), minLen = o.minLen || 1;
    var n = Math.max(2, Math.ceil(dur / step) + 1), ts = [], fr = [], i;
    for (i = 0; i < n; i++) {
      if (o.signal && o.signal.aborted) throw abortErr();
      var t = Math.min(o.end - 0.02, o.start + i * step);
      await AV.seekTo(o.video, t); ts.push(t); fr.push(sample(o.video, g, cv));
      if (o.onProgress) o.onProgress(0.8 * (i + 1) / n);
    }
    var d = [];
    for (i = 1; i < n; i++) d.push(dist(fr[i - 1], fr[i]));
    var cuts = [];
    for (i = 0; i < d.length; i++) {
      var loc = median(d.slice(Math.max(0, i - 6), Math.min(d.length, i + 7)));
      if (d[i] > Math.max(0.24, loc * 3.2)) cuts.push(i);
    }
    var bounds = [o.start];
    for (var c = 0; c < cuts.length; c++) {              // уточняем границу внутри шага
      if (o.signal && o.signal.aborted) throw abortErr();
      var lo = ts[cuts[c]], hi = ts[cuts[c] + 1], a = fr[cuts[c]], full = d[cuts[c]];
      for (var k = 0; k < 4 && hi - lo > 0.05; k++) {
        var mid = (lo + hi) / 2; await AV.seekTo(o.video, mid);
        var m = sample(o.video, g, cv);
        if (dist(a, m) > full * 0.5) hi = mid; else lo = mid;
      }
      bounds.push(hi);
      if (o.onProgress) o.onProgress(0.8 + 0.2 * (c + 1) / cuts.length);
    }
    bounds.push(o.end);
    var out = [];
    for (i = 0; i < bounds.length - 1; i++) {
      var s = bounds[i], e = bounds[i + 1];
      if (out.length && e - s < minLen) { out[out.length - 1].end = e; continue; }   // слишком короткую сцену присоединяем к предыдущей
      out.push({ start: s, end: e });
    }
    if (out.length > 1 && out[0].end - out[0].start < minLen) { out[1].start = out[0].start; out.shift(); }
    return out;
  };

  /* ---------- заметный объект ---------- */
  var SW = 48, SH = 48;
  function blur(src, w, h, r) {                         // коробочное размытие в два прохода
    var tmp = new Float32Array(w * h), out = new Float32Array(w * h), x, y, k, s, c;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      s = 0; c = 0; for (k = -r; k <= r; k++) { var xx = x + k; if (xx >= 0 && xx < w) { s += src[y * w + xx]; c++; } }
      tmp[y * w + x] = s / c;
    }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      s = 0; c = 0; for (k = -r; k <= r; k++) { var yy = y + k; if (yy >= 0 && yy < h) { s += tmp[yy * w + x]; c++; } }
      out[y * w + x] = s / c;
    }
    return out;
  }
  function saliency(d, prev) {                          // d: RGBA SW×SH; prev: прошлая яркость или null
    var n = SW * SH, ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)], lum = new Float32Array(n), i;
    for (i = 0; i < n; i++) {
      var r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
      lum[i] = (r * 77 + g * 150 + b * 29) / 256;
      ch[0][i] = lum[i]; ch[1][i] = r - g; ch[2][i] = (r + g) / 2 - b;   // яркость и две цветовые оси
    }
    var sal = new Float32Array(n);
    for (var c = 0; c < 3; c++) {
      var fine = blur(ch[c], SW, SH, 1), coarse = blur(ch[c], SW, SH, 9);
      for (i = 0; i < n; i++) sal[i] += Math.abs(fine[i] - coarse[i]) * (c === 0 ? 1 : 0.8);
    }
    var mx = 0; for (i = 0; i < n; i++) if (sal[i] > mx) mx = sal[i];
    var rawMax = mx;
    if (mx > 0) for (i = 0; i < n; i++) sal[i] /= mx;
    if (prev) {
      var mo = new Float32Array(n), mm = 0;
      for (i = 0; i < n; i++) { mo[i] = Math.abs(lum[i] - prev[i]); if (mo[i] > mm) mm = mo[i]; }
      var mb = blur(mo, SW, SH, 2);
      if (mm > 6) for (i = 0; i < n; i++) sal[i] += mb[i] / mm * 0.9;   // подвижное заметнее неподвижного
    }
    for (var y = 0; y < SH; y++) for (var x = 0; x < SW; x++) {
      var dx = x / SW - 0.5, dy = y / SH - 0.5;
      sal[y * SW + x] *= 1 - 0.5 * Math.min(1, Math.sqrt(dx * dx + dy * dy) * 1.4);   // снимают чаще в центре
    }
    var sm = blur(sal, SW, SH, 3), bi = 0, bv = -1;
    for (i = 0; i < n; i++) if (sm[i] > bv) { bv = sm[i]; bi = i; }
    return { x: ((bi % SW) + 0.5) / SW, y: (Math.floor(bi / SW) + 0.5) / SH, v: rawMax, lum: lum };
  }
  /* o: { start, end, step, grab(t) → { src, sw, sh }, signal?, onProgress? } → [{ t, x, y }] или null */
  AV.trackSalient = async function (o) {
    var cv = mk(SW, SH), g = cv.getContext('2d', { willReadFrequently: true });
    var total = Math.max(1, Math.ceil((o.end - o.start) / o.step) + 1), pts = [], prev = null, i;
    for (i = 0; i < total; i++) {
      if (o.signal && o.signal.aborted) throw abortErr();
      var t = Math.min(o.end - 0.001, o.start + i * o.step), fr = await o.grab(t);
      g.drawImage(fr.src, 0, 0, SW, SH);
      var s = saliency(g.getImageData(0, 0, SW, SH).data, prev); prev = s.lum;
      pts.push({ t: t, x: s.x, y: s.y, v: s.v });
      if (o.onProgress) o.onProgress((i + 1) / total);
    }
    var best = 0; pts.forEach(function (p) { if (p.v > best) best = p.v; });
    if (best < 10) return null;                         // кадр ровный (разница с окружением почти нулевая): выделять нечего
    var out = [], sx = pts[0].x, sy = pts[0].y;
    pts.forEach(function (p) {                          // медленнее лица: камера не должна прыгать между «заметными» местами
      var k = 0.25; sx += (p.x - sx) * k; sy += (p.y - sy) * k;
      out.push({ t: p.t, x: sx, y: sy });
    });
    return out;
  };
})();
