'use strict';
/* Aspect Studio Video — автосубтитры (Whisper tiny, на устройстве).
   AV.transcribe(file, dur, start, end, opt) → [{ text, start, end }] во времени исходного ролика.
   Звук читается потоком, переводится в 16 кГц моно и режется на куски до 30 с по самым тихим местам (так слова не рвутся пополам). */
(function () {
  var AV = (window.AV = window.AV || {});
  var MAX_SEC = 20 * 60, TR = 16000, worker = null, ready = null, seq = 0, waits = new Map();

  function call(msg, transfer) {
    return new Promise(function (res, rej) {
      var id = ++seq; waits.set(id, { res: res, rej: rej });
      worker.postMessage(Object.assign({}, msg, { id: id }), transfer || []);
    });
  }
  function startWorker() {
    if (ready) return ready;
    ready = (async function () {
      if (typeof Worker === 'undefined') throw new Error('В этом браузере нет фоновых потоков.');
      worker = new Worker('js/whisper-worker.js', { type: 'module' });
      worker.onmessage = function (e) { var w = waits.get(e.data.id); if (!w) return; waits.delete(e.data.id); e.data.ok ? w.res(e.data) : w.rej(new Error(e.data.error)); };
      worker.onerror = function (e) {
        e.preventDefault();
        var why = (e && e.message) ? ' (' + e.message + ')' : '';
        waits.forEach(function (w) { w.rej(new Error('Не запустилось распознавание речи' + why + '.')); }); waits.clear();
      };
      await call({ type: 'init' });
    })();
    ready.catch(function () { if (worker) worker.terminate(); worker = null; ready = null; waits.clear(); });
    return ready;
  }
  AV.stopWhisper = function () { if (worker) { worker.terminate(); worker = null; ready = null; waits.forEach(function (w) { w.rej(new Error('abort')); }); waits.clear(); } };

  /* звук отрезка → Float32Array 16 кГц моно (усреднение по окну вместо выбрасывания отсчётов) */
  async function readMono(au, start, end, signal) {
    var sr = au.sr, ratio = sr / TR, total = Math.max(1, Math.floor((end - start) * TR)), out = new Float32Array(total), acc = 0, cnt = 0, o = 0, rd = au.open(start), s0 = Math.floor(start * sr), s1 = Math.floor(end * sr), blk;
    try {
      while (o < total && (blk = await rd.next())) {
        if (signal && signal.aborted) throw new Error('abort');
        var n = blk.ch[0].length, from = Math.max(0, s0 - blk.pos), to = Math.min(n, s1 - blk.pos);
        for (var i = from; i < to; i++) {
          var v = 0; for (var c = 0; c < blk.ch.length; c++) v += blk.ch[c][i];
          acc += v / blk.ch.length; cnt++;
          var target = Math.floor((blk.pos + i + 1 - s0) / ratio);   // номер выходного отсчёта, который закрывается этим входным
          if (target > o) { if (o < total) out[o] = acc / cnt; o++; acc = 0; cnt = 0; }
        }
        if (blk.pos >= s1) break;
      }
    } finally { rd.close(); }
    return out.subarray(0, Math.min(total, Math.max(o, 1)));
  }
  /* границы кусков: около 28 с, но режем в самом тихом окне 100 мс за последние 4 с */
  function splitPoints(a) {
    var cuts = [0], MAXC = 28 * TR, win = TR / 10, pos = 0;
    while (a.length - pos > MAXC + 2 * TR) {
      var from = pos + MAXC - 4 * TR, best = 1e9, at = pos + MAXC;
      for (var p = from; p + win <= pos + MAXC; p += win) {
        var e = 0; for (var i = p; i < p + win; i++) e += a[i] * a[i];
        if (e < best) { best = e; at = p + win / 2; }
      }
      pos = Math.round(at); cuts.push(pos);
    }
    cuts.push(a.length);
    return cuts;
  }
  function rms(a, s, e) { var t = 0; for (var i = s; i < e; i++) t += a[i] * a[i]; return Math.sqrt(t / Math.max(1, e - s)); }
  /* длинную фразу делим на строки по 60 знаков, время — по длине текста */
  function pieces(text, s, e) {
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) return [];
    var words = text.split(' '), lines = [], cur = '';
    words.forEach(function (w) { if (cur && (cur + ' ' + w).length > 60) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; });
    if (cur) lines.push(cur);
    var tot = lines.reduce(function (n, l) { return n + l.length; }, 0), t = s, res = [];
    lines.forEach(function (l) { var d = (e - s) * l.length / tot; res.push({ text: l, start: t, end: t + d }); t += d; });
    return res;
  }

  AV.transcribe = async function (file, dur, start, end, opt) {
    opt = opt || {};
    var signal = opt.signal, prog = opt.onProgress || function () {};
    if (end - start > MAX_SEC) throw new Error('Распознаю не больше 20 минут за раз. Выбери фрагмент короче (начало и конец у видео).');
    if (signal) signal.addEventListener('abort', AV.stopWhisper);
    prog(0, 'Читаю звук…');
    var au = await AV.openAudio(file, dur, {});
    if (!au || !au.open) throw new Error((au && au.reason) || 'В видео нет звука или его не удалось прочитать.');
    var audio = await readMono(au, start, end, signal);
    if (signal && signal.aborted) throw new Error('abort');
    prog(0.02, 'Загружаю модель…');
    await startWorker();
    var cuts = splitPoints(audio), out = [], i;
    for (i = 0; i + 1 < cuts.length; i++) {
      if (signal && signal.aborted) throw new Error('abort');
      var a0 = cuts[i], a1 = cuts[i + 1], piece = audio.slice(a0, a1);
      prog(0.05 + 0.93 * (i / (cuts.length - 1)), 'Распознаю: ' + Math.round(a1 / TR) + ' с из ' + Math.round(audio.length / TR));
      if (a1 - a0 < TR * 0.4 || rms(piece, 0, piece.length) < 0.003) continue;      // тишина: Whisper на ней придумывает текст
      var r = await call({ type: 'run', audio: piece, lang: opt.lang || '' }, [piece.buffer]);
      r.chunks.forEach(function (c) {
        var s = start + a0 / TR + Math.max(0, c.s || 0), e = start + a0 / TR + Math.max(c.e || 0, (c.s || 0) + 0.5);
        e = Math.min(e, start + a1 / TR);
        pieces(c.text, s, Math.max(e, s + 0.5)).forEach(function (p) { out.push(p); });
      });
    }
    prog(1, 'Готово');
    return out.filter(function (c) { return c.text && /[\p{L}\p{N}]/u.test(c.text); });
  };
})();
