'use strict';
/* Aspect Studio Video — быстрое чтение кадров.
   Обычный путь: для каждого кадра результата ставим скрытое <video> на нужное время и ждём «seeked». Это медленно.
   Быстрый путь: MP4/MOV разбираем библиотекой mp4box (читаем только таблицу кадров), а кадры подаём в VideoDecoder подряд,
   как их читает плеер. Так не нужна перемотка на каждый кадр. Если что-то пошло не так (формат, кодек, ошибка декодера),
   источник кадров сам переключается на перемотку, результат тот же, просто медленнее.
   Общие части с блоком звука (разбор контейнера) лежат здесь же: AV.openMp4. */
(function () {
  var AV = (window.AV = window.AV || {});
  var mod = null;

  function loadMp4box() {
    if (!mod) mod = import('../vendor/mp4box/mp4box.all.mjs').catch(function (e) { mod = null; throw e; });
    return mod;
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* Разбирает контейнер: читает файл кусками, пока mp4box не найдёт таблицу (moov), даже если она в конце файла. */
  AV.openMp4 = async function (file) {
    var m = await loadMp4box(), isf = m.createFile(), info = null, err = null, pos = 0, guard = 0;
    isf.onReady = function (i) { info = i; };
    isf.onError = function (a, b) { err = b || a; };
    while (!info && !err && pos < file.size && guard++ < 400) {
      var end = Math.min(file.size, pos + 4 * 1048576), ab = await file.slice(pos, end).arrayBuffer();
      var next = isf.appendBuffer(m.MP4BoxBuffer.fromArrayBuffer(ab, pos), end >= file.size);
      pos = typeof next === 'number' && next !== pos && next >= 0 && next <= file.size ? next : end;
    }
    if (!info) throw new Error(err || 'Не удалось разобрать контейнер.');
    return { m: m, isf: isf, info: info };
  };
  AV.looksLikeMp4 = function (file) {
    return /\.(mp4|m4v|mov|m4a)$/i.test(file.name || '') || /mp4|quicktime|m4v/i.test(file.type || '');
  };
  /* Почему видео не открылось: определяем кодек и подсказываем, что делать. Файл никуда не уходит. */
  AV.diagnose = async function (file) {
    var ext = ((/\.([a-z0-9]+)$/i.exec(file.name || '') || [])[1] || '').toLowerCase(), codec = '', t, x;
    if (AV.looksLikeMp4(file)) {
      try { var mp = await AV.openMp4(file), v = mp.info.videoTracks[0]; codec = v ? String(v.codec || '') : ''; } catch (e) { /* не разобрался: скажем общее */ }
    }
    var c = codec.toLowerCase();
    if (/^(hvc1|hev1)/.test(c)) { t = 'Видео в формате H.265 (HEVC)'; x = 'Так снимают многие новые телефоны. Этот браузер не умеет его показывать. Переведите видео в H.264 (MP4) или в настройках камеры включите «Наиболее совместимый» формат.'; }
    else if (/^av01/.test(c)) { t = 'Видео в формате AV1'; x = 'Этот браузер или устройство не умеет его показывать. Переведите видео в H.264 (MP4) или откройте сайт в свежем Chrome.'; }
    else if (/^(apch|apcn|apcs|apco|ap4h|ap4x)/.test(c)) { t = 'Видео в формате ProRes'; x = 'Браузеры не показывают ProRes. Переведите видео в H.264 (MP4).'; }
    else if (/^(mkv|avi|ts|mts|m2ts|wmv|flv|3gp|ogv)$/.test(ext)) { t = 'Файл .' + ext + ': этот браузер открывает такой формат не всегда'; x = 'Внутри может быть видео, которое браузер не умеет показывать. Переведите его в MP4 (H.264): так оно откроется везде.'; }
    else { t = 'Видео не открылось'; x = 'Возможно, файл повреждён или записан в формате, который этот браузер не умеет показывать (H.265, AV1, ProRes). Попробуйте перевести его в MP4 (H.264).'; }
    return { title: t, text: x, codec: codec, ext: ext, cmd: 'ffmpeg -i input.' + (ext || 'mov') + ' -c:v libx264 -crf 20 -pix_fmt yuv420p -c:a aac -movflags +faststart output.mp4' };
  };
  /* Описание кодека (avcC, hvcC, av1C) без заголовка бокса */
  AV.codecDescription = function (m, entry) {
    var box = entry.avcC || entry.hvcC || entry.av1C || entry.vvcC;
    if (!box) return undefined;
    var st = new m.DataStream(undefined, 0, m.Endianness.BIG_ENDIAN);
    box.write(st);
    return new Uint8Array(st.buffer, 8, st.position - 8);
  };

  /* Окно чтения: берём из файла сразу кусок побольше, а не по одному кадру */
  function reader(file) {
    var win = null;
    return async function (off, size) {
      if (!win || off < win.start || off + size > win.start + win.buf.byteLength) {
        var len = Math.max(size, 6 * 1048576);
        win = { start: off, buf: await file.slice(off, Math.min(file.size, off + len)).arrayBuffer() };
      }
      return new Uint8Array(win.buf, off - win.start, size);
    };
  }

  /* ---------- Быстрый источник ---------- */
  async function makeFast(file) {
    if (typeof VideoDecoder === 'undefined' || typeof EncodedVideoChunk === 'undefined') throw new Error('нет VideoDecoder');
    var mp = await AV.openMp4(file), tr = mp.info.videoTracks[0];
    if (!tr) throw new Error('нет видеодорожки');
    var samples = mp.isf.getTrackSamplesInfo(tr.id);
    if (!samples || samples.length < 2) throw new Error('кадры не найдены (фрагментированный файл?)');
    var entry = mp.isf.getTrackById(tr.id).mdia.minf.stbl.stsd.entries[0];
    var cfg = { codec: tr.codec, codedWidth: tr.video.width, codedHeight: tr.video.height };
    var desc = AV.codecDescription(mp.m, entry);
    if (desc) cfg.description = desc;
    var sup = await VideoDecoder.isConfigSupported(cfg);
    if (!sup || !sup.supported) throw new Error('кодек ' + tr.codec + ' не поддерживается декодером');

    var mx = tr.matrix ? Array.prototype.slice.call(Object.values(tr.matrix)).map(function (v) { return v / 65536; }) : [1, 0];
    var theta = Math.atan2(mx[1] || 0, mx[0] === undefined ? 1 : mx[0]);
    var rot = ((Math.round(theta / (Math.PI / 2)) * 90) % 360 + 360) % 360;
    var N = samples.length, minCts = Infinity, i;
    for (i = 0; i < N; i++) if (samples[i].cts < minCts) minCts = samples[i].cts;
    var pts = new Float64Array(N), syncs = [];
    for (i = 0; i < N; i++) { pts[i] = (samples[i].cts - minCts) / samples[i].timescale; if (samples[i].is_sync) syncs.push(i); }
    if (!syncs.length || syncs[0] !== 0) throw new Error('нет ключевого кадра в начале');
    var readAt = reader(file);

    var swap = rot === 90 || rot === 270;
    var cv = document.createElement('canvas'), cx = cv.getContext('2d', { alpha: false }), drawn = null;
    var dec = null, pending = [], prev = null, next = null, fed = 0, ended = false, flushing = false, err = null, lastOut = 0, maxFedPts = -1;

    function dropAll() {
      pending.forEach(function (f) { f.close(); }); pending = [];
      if (prev) prev.close(); if (next) next.close();
      prev = next = null; drawn = null;
    }
    function startAt(k) {
      dropAll();
      if (dec) { try { dec.close(); } catch (e) { /* уже закрыт */ } }
      err = null; ended = false; flushing = false; fed = k; maxFedPts = -1; lastOut = performance.now();
      dec = new VideoDecoder({
        output: function (f) { lastOut = performance.now(); pending.push(f); },
        error: function (e) { err = e; }
      });
      dec.configure(cfg);
    }
    function syncBefore(t) {
      var lo = 0, hi = syncs.length - 1;
      while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (pts[syncs[mid]] <= t) lo = mid; else hi = mid - 1; }
      return syncs[lo];
    }
    async function feed() {
      var n = 0;
      while (fed < N && n < 6 && dec.decodeQueueSize < 8 && pending.length < 4) {
        var s = samples[fed], data = await readAt(s.offset, s.size);
        dec.decode(new EncodedVideoChunk({ type: s.is_sync ? 'key' : 'delta', timestamp: Math.round(pts[fed] * 1e6), duration: Math.round((s.duration / s.timescale) * 1e6), data: data }));
        if (pts[fed] > maxFedPts) maxFedPts = pts[fed];
        fed++; n++;
      }
      if (fed >= N && !flushing) {
        flushing = true;
        dec.flush().then(function () { ended = true; }, function (e) { err = err || e; ended = true; });
      }
      if (!n) await sleep(1);
    }
    function paint(f) {
      var w = f.displayWidth, h = f.displayHeight, ow = swap ? h : w, oh = swap ? w : h;
      if (cv.width !== ow || cv.height !== oh) { cv.width = ow; cv.height = oh; }
      cx.save(); cx.translate(ow / 2, oh / 2); cx.rotate(theta); cx.drawImage(f, -w / 2, -h / 2, w, h); cx.restore();
      drawn = f;
    }

    return {
      kind: 'decoder', rot: rot, codec: tr.codec, frames: N,
      at: async function (t) {
        var tt = t + 1e-3;
        if (!dec || (prev && tt < prev.timestamp / 1e6 - 2e-3) || (!prev && !next && !pending.length && maxFedPts >= 0 && tt < pts[0]) ||
            (maxFedPts >= 0 && t - maxFedPts > 2 && syncBefore(tt) > fed)) startAt(syncBefore(tt));
        for (;;) {
          if (err) throw err;
          if (!next && pending.length) next = pending.shift();
          if (next && next.timestamp / 1e6 <= tt) { if (prev) prev.close(); prev = next; next = null; continue; }
          if (next || (ended && !pending.length)) break;
          if (performance.now() - lastOut > 8000) throw new Error('декодер завис');
          await feed();
        }
        var f = prev || next;
        if (!f) throw new Error('кадр не получен');
        if (drawn !== f) paint(f);
        return cv;
      },
      close: function () { dropAll(); if (dec) { try { dec.close(); } catch (e) { /* уже закрыт */ } dec = null; } }
    };
  }

  /* ---------- Источник кадров ----------
     opt.fast === false выключает быстрый путь (для проверок). Возвращает { at(t) → картинка для drawImage, close(), kind }. */
  AV.frameSource = async function (file, video, opt) {
    opt = opt || {};
    var fast = null, why = '';
    if (opt.fast !== false && AV.looksLikeMp4(file)) {
      try { fast = await makeFast(file); } catch (e) { why = (e && e.message) || String(e); fast = null; }
    } else if (opt.fast === false) why = 'выключено';
    else why = 'не MP4/MOV';
    var failed = !fast, note = why, checked = false;
    return {
      get kind() { return failed ? 'seek' : 'decoder'; },
      get note() { return note; },
      at: async function (t) {
        if (!failed) {
          try {
            var cv = await fast.at(t);
            if (!checked && video && video.videoWidth > 0 && cv.width > 0) {   // проверка поворота: пропорции кадра должны совпасть с тем, что показывает сам браузер
              checked = true;
              var a = cv.width / cv.height, b = video.videoWidth / video.videoHeight;
              if (Math.abs(a / b - 1) > 0.03) throw new Error('ориентация не совпала с браузером (' + cv.width + '×' + cv.height + ' и ' + video.videoWidth + '×' + video.videoHeight + ')');
            }
            return cv;
          }
          catch (e) {
            failed = true; note = 'ошибка быстрого чтения: ' + ((e && e.message) || e);
            if (window.logError) window.logError(e, 'быстрое чтение кадров');
            try { fast.close(); } catch (e2) { /* ничего */ }
          }
        }
        await AV.seekTo(video, t);
        return video;
      },
      close: function () { if (fast) { try { fast.close(); } catch (e) { /* ничего */ } } }
    };
  };
})();
