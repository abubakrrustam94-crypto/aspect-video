'use strict';
/* Aspect Studio Video — замер скорости устройства.
   Кодирует 40 кадров 1280×720 (H.264, как при сохранении) и считает, сколько кадров в секунду тянет устройство.
   Это грубая оценка: реальный экспорт зависит ещё от декодирования, фона, шумоподавления и плавного замедления. */
(function () {
  var AV = (window.AV = window.AV || {});
  var KEY = 'av-bench';
  AV.benchLoad = function () {
    try { var o = JSON.parse(ls.get(KEY) || 'null'); return o && o.fps > 0 && o.at ? o : null; } catch (e) { return null; }
  };
  AV.benchRun = async function (onProgress) {
    if (typeof VideoEncoder === 'undefined') throw new Error('В этом браузере нет аппаратного кодирования видео. Сохранение пойдёт медленнее.');
    var W = 1280, H = 720, N = 40, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var g = cv.getContext('2d', { alpha: false }), done = 0, err = null, cfg = null, codecs = ['avc1.64002A', 'avc1.4D0028', 'avc1.42E028'];
    for (var i = 0; i < codecs.length && !cfg; i++) {
      var c = { codec: codecs[i], width: W, height: H, bitrate: 4000000, framerate: 30 };
      try { var sup = await VideoEncoder.isConfigSupported(c); if (sup && sup.supported) cfg = c; } catch (e) { /* пробуем дальше */ }
    }
    if (!cfg) throw new Error('Кодек H.264 в этом браузере недоступен.');
    var enc = new VideoEncoder({ output: function () { done++; }, error: function (e) { err = e; } });
    enc.configure(cfg);
    var t0 = performance.now();
    for (var f = 0; f < N; f++) {
      if (err) throw err;
      var gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, 'hsl(' + (f * 9) % 360 + ',70%,50%)'); gr.addColorStop(1, 'hsl(' + (f * 9 + 120) % 360 + ',70%,30%)');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff'; g.fillRect((f * 23) % W, (f * 11) % H, 200, 120);
      for (var k = 0; k < 40; k++) { g.fillStyle = 'rgba(' + ((k * 37 + f) & 255) + ',' + ((k * 91) & 255) + ',200,.5)'; g.fillRect((k * 53 + f * 7) % W, (k * 29) % H, 90, 60); }
      var vf = new VideoFrame(cv, { timestamp: Math.round(f * 1e6 / 30) });
      enc.encode(vf, { keyFrame: f % 30 === 0 }); vf.close();
      while (enc.encodeQueueSize > 6) await new Promise(function (r) { setTimeout(r, 4); });
      if (onProgress) onProgress((f + 1) / N);
    }
    await enc.flush(); enc.close();
    if (err) throw err;
    var sec = Math.max(0.001, (performance.now() - t0) / 1000), fps = N / sec;
    var res = { fps: Math.round(fps * 10) / 10, at: Date.now(), cores: navigator.hardwareConcurrency || 0 };
    ls.set(KEY, JSON.stringify(res));
    return res;
  };
  /* Оценка времени сохранения для результата w×h: скорость падает пропорционально числу пикселей. Берём запас 1,6 на всё остальное. */
  AV.benchEstimate = function (bench, w, h, fps, secs) {
    var rate = bench.fps * (1280 * 720) / Math.max(1, w * h), frames = Math.max(1, secs * fps), t = frames / Math.max(1, rate) * 1.6;
    return { rate: rate, seconds: t };
  };
})();
