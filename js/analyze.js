'use strict';
/* Aspect Studio Video — анализ: стабилизация, тишина, разбор файлов субтитров. Всё считается на устройстве. */
(function () {
  var AV = (window.AV = window.AV || {});
  function abortErr() { var e = new Error('Отменено'); e.aborted = true; return e; }

  /* ---------- Стабилизация ----------
     Берём кадры с частотой 15 в секунду, уменьшаем до 160 пикселей по ширине и для каждой пары соседних кадров ищем сдвиг
     с наименьшей разницей. Складываем сдвиги в путь камеры, сглаживаем его скользящим средним, а разницу между сглаженным
     и реальным путём компенсируем сдвигом кадра. Края прячутся небольшим увеличением. Это лёгкая стабилизация
     от мелкой дрожи рук, а не замена штатива и не вырезание резких поворотов. */
  var LEVELS = { 1: { win: 0.5, max: 0.03, zoom: 1.07 }, 2: { win: 1.0, max: 0.06, zoom: 1.14 } };
  var SW = 160, SEARCH = 8;

  function gray(src, sw, sh, cv, g) {
    var w = SW, h = Math.max(24, Math.round((SW * sh) / sw));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    g.drawImage(src, 0, 0, w, h);
    var px = g.getImageData(0, 0, w, h).data, out = new Uint8Array(w * h);
    for (var i = 0, j = 0; j < out.length; i += 4, j++) out[j] = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8;
    return { d: out, w: w, h: h };
  }
  /* на сколько пикселей сместилось содержимое кадра cur относительно prev */
  function shiftBetween(prev, cur) {
    var w = prev.w, h = prev.h, m = SEARCH + 2, best = 1e18, bu = 0, bv = 0;
    for (var v = -SEARCH; v <= SEARCH; v++) {
      for (var u = -SEARCH; u <= SEARCH; u++) {
        var sad = 0;
        for (var y = m; y < h - m; y += 2) {
          var ro = y * w, po = (y - v) * w - u;
          for (var x = m; x < w - m; x += 2) { var d = cur.d[ro + x] - prev.d[po + x]; sad += d < 0 ? -d : d; }
        }
        /* небольшой штраф за большие сдвиги: на однородных кадрах не выдумываем движение */
        sad += (u < 0 ? -u : u) + (v < 0 ? -v : v);
        if (sad < best) { best = sad; bu = u; bv = v; }
      }
    }
    return { u: bu, v: bv };
  }

  /* o: { start, end, level (1|2), grab(t) → Promise<{src,sw,sh}>, onProgress(f), signal } → { track: [{t,dx,dy}], zoom } */
  AV.analyzeStab = async function (o) {
    var L = LEVELS[o.level] || LEVELS[1], fps = 15;
    var n = Math.max(2, Math.min(1200, Math.ceil((o.end - o.start) * fps) + 1));
    var step = (o.end - o.start) / (n - 1);
    var cv = document.createElement('canvas'), g = cv.getContext('2d', { willReadFrequently: true });
    var times = [], px = [], py = [], prev = null, cx = 0, cy = 0, w0 = SW;
    for (var i = 0; i < n; i++) {
      if (o.signal && o.signal.aborted) throw abortErr();
      var t = Math.min(o.end - 0.001, o.start + i * step);
      var fr = await o.grab(t);
      var cur = gray(fr.src, fr.sw, fr.sh, cv, g);
      w0 = cur.w;
      if (prev) { var s = shiftBetween(prev, cur); cx += s.u; cy += s.v; }
      times.push(t); px.push(cx); py.push(cy); prev = cur;
      if (o.onProgress && i % 4 === 0) o.onProgress((i + 1) / n);
    }
    var half = Math.max(1, Math.round((L.win * fps) / 2)), track = [], h0 = prev.h;
    for (var k = 0; k < n; k++) {
      var a = Math.max(0, k - half), b = Math.min(n - 1, k + half), sx = 0, sy = 0;
      for (var j = a; j <= b; j++) { sx += px[j]; sy += py[j]; }
      sx /= b - a + 1; sy /= b - a + 1;
      var dx = (sx - px[k]) / w0, dy = (sy - py[k]) / h0;
      dx = Math.max(-L.max, Math.min(L.max, dx)); dy = Math.max(-L.max, Math.min(L.max, dy));
      track.push({ t: times[k], dx: dx, dy: dy });
    }
    return { track: track, zoom: L.zoom, raw: { x: px, y: py } };
  };

  /* ---------- Звук: уровни по 50 мс ---------- */
  AV.analyzeAudio = async function (file, dur, onProgress) {
    var au = await AV.openAudio(file, dur);
    if (!au.open) throw new Error(au.reason || 'В видео нет звука или его не удалось прочитать.');
    var hop = 0.05, step = Math.max(1, Math.round(au.sr * hop)), n = Math.max(1, Math.ceil((dur + 1) * au.sr / step) + 1);
    var sum = new Float64Array(n), cnt = new Float64Array(n), zc = new Float64Array(n), df = new Float64Array(n), rd = au.open(0), blk, last = 0, pv = 0;
    try {
      while ((blk = await rd.next())) {
        for (var c = 0; c < blk.ch.length; c++) {
          var d = blk.ch[c];
          for (var j = 0; j < d.length; j += 2) {
            var w = Math.floor((blk.pos + j) / step);
            if (w >= n) break;
            sum[w] += d[j] * d[j]; cnt[w]++;
            if (c === 0) { if ((d[j] >= 0) !== (pv >= 0)) zc[w]++; df[w] += (d[j] - pv) * (d[j] - pv); pv = d[j]; }   // для отличия речи от шума
            if (w > last) last = w;
          }
        }
        if (onProgress) onProgress(Math.min(1, (blk.pos / au.sr) / Math.max(dur, 0.1)));
      }
    } finally { rd.close(); }
    var len = last + 1, rms = new Float32Array(len), zcr = new Float32Array(len), hfr = new Float32Array(len);
    for (var i = 0; i < len; i++) {
      rms[i] = cnt[i] ? Math.sqrt(sum[i] / cnt[i]) : 0;
      zcr[i] = cnt[i] ? zc[i] / cnt[i] : 0; hfr[i] = sum[i] > 0 ? df[i] / sum[i] : 0;
    }
    return { rms: rms, zcr: zcr, hfr: hfr, hop: hop, dur: Math.min(dur, len * hop), kind: au.kind };
  };
  function threshold(rms) {
    var mx = 0; for (var i = 0; i < rms.length; i++) if (rms[i] > mx) mx = rms[i];
    return { thr: Math.max(0.004, mx * 0.06), max: mx };
  }
  /* Речь, а не просто громкость. Шум, гул и музыка тоже громкие, но у речи есть признаки:
     голосовые звуки (мало пересечений нуля, мало «шипения»), ритм слогов (громкость заметно прыгает 3–8 раз в секунду) и уровень выше собственного шума записи.
     Окно 0,6 с считается речью, если в нём достаточно голосовых кадров и громкость «дышит». Это обычный расчёт без нейросети. */
  AV.speechIntervals = function (an, minSilence, pad) {
    var rms = an.rms, n = rms.length, i, j;
    if (!an.zcr || !n) return AV.soundIntervals(an, minSilence, pad);
    var sorted = Array.prototype.slice.call(rms).sort(function (a, b) { return a - b; }), mx = sorted[n - 1];
    if (mx < 0.002) return [];
    var floor = Math.max(0.0008, sorted[Math.floor(n * 0.15)]), thr = Math.max(floor * 3.5, mx * 0.03);
    var voiced = new Uint8Array(n);
    for (i = 0; i < n; i++) voiced[i] = rms[i] > thr && an.zcr[i] < 0.32 && an.hfr[i] < 1.2 ? 1 : 0;
    var peak = new Uint8Array(n);                       // слоговые пики: заметно выше соседей в пределах 0,2 с
    var pr = Math.max(2, Math.round(0.2 / an.hop));
    for (i = 1; i < n - 1; i++) {
      if (!(rms[i] > thr && rms[i] > rms[i - 1] && rms[i] >= rms[i + 1])) continue;
      var lo1 = 1e9, lo2 = 1e9;                         // пик должен быть выше соседей с обеих сторон: у начала и конца ровного звука с одной стороны плоско
      for (j = Math.max(0, i - pr); j < i; j++) if (rms[j] < lo1) lo1 = rms[j];
      for (j = i + 1; j <= Math.min(n - 1, i + pr); j++) if (rms[j] < lo2) lo2 = rms[j];
      if (rms[i] > lo1 * 1.25 && rms[i] > lo2 * 1.25) peak[i] = 1;
    }
    var W = Math.max(4, Math.round(0.6 / an.hop)), half = W >> 1, speech = new Uint8Array(n);
    for (i = 0; i < n; i++) {
      var a = Math.max(0, i - half), b = Math.min(n - 1, i + half), v = 0, pk = 0, c = b - a + 1;
      for (j = a; j <= b; j++) { v += voiced[j]; pk += peak[j]; }
      /* ровный тон, гул и плавное нарастание пиков не дают: у них нет слогового ритма */
      speech[i] = rms[i] > thr && v / c >= 0.2 && pk >= 1 ? 1 : 0;
    }
    var iv = [], s = -1;
    for (i = 0; i < n; i++) {
      if (speech[i] && s < 0) s = i;
      if (!speech[i] && s >= 0) { iv.push([s * an.hop, i * an.hop]); s = -1; }
    }
    if (s >= 0) iv.push([s * an.hop, n * an.hop]);
    var merged = [];
    iv.forEach(function (x) { var last = merged[merged.length - 1]; if (last && x[0] - last[1] < minSilence) last[1] = x[1]; else merged.push([x[0], x[1]]); });
    return merged.filter(function (x) { return x[1] - x[0] >= 0.25; }).map(function (x) { return [Math.max(0, x[0] - pad), Math.min(an.dur, x[1] + pad)]; });
  };

  /* Звук есть там, где уровень выше порога. Возвращает интервалы речи/звука в секундах. */
  AV.soundIntervals = function (an, minSilence, pad) {
    var t = threshold(an.rms), thr = t.thr, iv = [], s = -1, i;
    if (t.max < 0.002) return [];
    for (i = 0; i < an.rms.length; i++) {
      var on = an.rms[i] > thr;
      if (on && s < 0) s = i;
      if (!on && s >= 0) { iv.push([s * an.hop, i * an.hop]); s = -1; }
    }
    if (s >= 0) iv.push([s * an.hop, an.rms.length * an.hop]);
    var merged = [];                                   // склеиваем звуки, между которыми пауза короче minSilence
    iv.forEach(function (x) {
      var last = merged[merged.length - 1];
      if (last && x[0] - last[1] < minSilence) last[1] = x[1]; else merged.push([x[0], x[1]]);
    });
    return merged.filter(function (x) { return x[1] - x[0] >= 0.15; }).map(function (x) { return [Math.max(0, x[0] - pad), Math.min(an.dur, x[1] + pad)]; });
  };

  /* ---------- Субтитры SRT / VTT ---------- */
  function parseTime(s) {
    var m = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(String(s).trim());
    if (!m) return NaN;
    return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (+((m[4] + '00').slice(0, 3))) / 1000;
  }
  AV.parseSubs = function (text) {
    var out = [], blocks = String(text).replace(/^﻿/, '').replace(/\r/g, '').split(/\n{2,}/);
    blocks.forEach(function (b) {
      var lines = b.split('\n').filter(function (l) { return l.trim() !== ''; }), k = -1;
      for (var i = 0; i < lines.length; i++) if (lines[i].indexOf('-->') >= 0) { k = i; break; }
      if (k < 0) return;
      var parts = lines[k].split('-->'), st = parseTime(parts[0]), en = parseTime(parts[1].trim().split(/\s+/)[0]);
      var txt = lines.slice(k + 1).join('\n').replace(/<[^>]+>/g, '').trim();
      if (isFinite(st) && isFinite(en) && en > st && txt) out.push({ text: txt, start: st, end: en });
    });
    return out;
  };
})();
