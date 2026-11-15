/* Aspect Studio Video — экспорт.
   1) Основной путь: WebCodecs (H.264 + AAC) → MP4 через mp4-muxer. Быстрее реального времени, кадр в кадр.
      Большие файлы пишутся прямо на диск (OPFS), а не копятся в оперативной памяти.
   2) Запасной путь: MediaRecorder в реальном времени (если WebCodecs/H.264 нет). */
(function () {
  'use strict';
  var AV = (window.AV = window.AV || {});
  var EXPORT_PREFIX = 'aspect-video-export-';
  AV.streamFrom = 120 * 1048576;          // с такого оценочного размера пишем на диск, а не в память

  function abortErr() { var e = new Error('Отменено'); e.aborted = true; return e; }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  AV.canWebCodecs = function () {
    return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined' && typeof window.Mp4Muxer !== 'undefined';
  };
  AV.canGif = function () { return !!(window.gifenc && window.gifenc.GIFEncoder); };
  /* Какие форматы реально доступны в этом браузере */
  AV.formatSupport = async function () {
    var res = { mp4: false, webm: false, gif: AV.canGif() };
    res.mp4 = AV.canWebCodecs() && !!(await pickVideoConfig(1280, 720, 30, 4e6, 'mp4'));
    if (typeof VideoEncoder !== 'undefined' && typeof window.WebMMuxer !== 'undefined') res.webm = !!(await pickVideoConfig(1280, 720, 30, 4e6, 'webm'));
    return res;
  };
  AV.hasOpfs = function () {
    return !!(navigator.storage && navigator.storage.getDirectory && typeof FileSystemFileHandle !== 'undefined' &&
      FileSystemFileHandle.prototype && typeof FileSystemFileHandle.prototype.createWritable === 'function');
  };

  /* Убирает недокачанные файлы прошлых экспортов */
  AV.cleanOpfs = async function (keepName) {
    if (!AV.hasOpfs()) return;
    try {
      var root = await navigator.storage.getDirectory();
      var names = [];
      for await (var k of root.keys()) names.push(k);
      for (var i = 0; i < names.length; i++) {
        if (names[i].indexOf(EXPORT_PREFIX) === 0 && names[i] !== keepName) await root.removeEntry(names[i]).catch(function () {});
      }
    } catch (e) { /* не страшно */ }
  };

  function seekTo(video, t) {
    return new Promise(function (resolve) {
      if (Math.abs(video.currentTime - t) < 0.0005 && video.readyState >= 2) { resolve(); return; }
      var done = false;
      var finish = function () {
        if (done) return;
        done = true;
        video.removeEventListener('seeked', finish);
        clearTimeout(timer);
        resolve();
      };
      var timer = setTimeout(finish, 5000);
      video.addEventListener('seeked', finish);
      video.currentTime = t;
    });
  }
  AV.seekTo = seekTo;

  async function pickVideoConfig(W, H, fps, bitrate, fmt) {
    var area = W * H, list, i;
    if (fmt === 'webm') list = [area > 2088960 ? 'vp09.00.51.08' : 'vp09.00.40.08', 'vp8'];
    else list = area > 2088960 ? ['avc1.640033', 'avc1.640034', 'avc1.640032'] : ['avc1.64002A', 'avc1.640028', 'avc1.4D0028', 'avc1.42E028'];
    for (i = 0; i < list.length; i++) {
      var cfg = { codec: list[i], width: W, height: H, bitrate: bitrate, framerate: fps };
      if (fmt !== 'webm') cfg.avc = { format: 'avc' };
      try {
        var r = await VideoEncoder.isConfigSupported(cfg);
        if (r && r.supported) return r.config || cfg;
      } catch (e) { /* пробуем следующий */ }
    }
    return null;
  }

  var ACFG = {
    mp4: { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 },
    webm: { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 }
  };
  AV.audioSupport = async function (fmt) {
    if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return false;
    try { var r = await AudioEncoder.isConfigSupported(ACFG[fmt || 'mp4']); return !!(r && r.supported); } catch (e) { return false; }
  };

  /* Декодирует звук файла целиком. Слишком длинные ролики пропускаем: распакованный звук занимает много памяти. */
  async function decodeFile(file, dur) {
    if (file.size > 800 * 1048576) return { reason: 'Файл слишком большой, чтобы перенести звук.' };
    if (dur * 48000 * 2 * 4 > 480 * 1048576) return { reason: 'Ролик слишком длинный, чтобы перенести звук без нехватки памяти.' };
    var buf = null, ac = null;
    try {
      var ab = await file.arrayBuffer();
      var Ctx = window.AudioContext || window.webkitAudioContext;
      ac = new Ctx();
      buf = await new Promise(function (res, rej) {
        var p = ac.decodeAudioData(ab, res, rej);
        if (p && p.then) p.then(res, rej);
      });
    } catch (e) { buf = null; }
    if (ac && ac.close) { try { ac.close(); } catch (e2) { /* ничего */ } }
    if (!buf || !buf.length) return { reason: 'В видео нет звука или его не удалось прочитать.' };
    return { buf: buf };
  }

  /* Куда писать: на диск (OPFS), если файл большой, иначе в память */
  async function openTarget(fmt, estBytes) {
    var M = fmt === 'webm' ? WebMMuxer : Mp4Muxer, mime = fmt === 'webm' ? 'video/webm' : 'video/mp4';
    if (estBytes > AV.streamFrom && AV.hasOpfs()) {
      try {
        var q = navigator.storage.estimate ? await navigator.storage.estimate() : null;
        if (q && q.quota && q.quota - (q.usage || 0) < estBytes * 1.3) {
          throw new Error('Не хватает места на устройстве: нужно около ' + fmtBytes(estBytes * 1.3) + ', свободно ' + fmtBytes(q.quota - (q.usage || 0)) + '. Уменьшите размер или битрейт.');
        }
        var root = await navigator.storage.getDirectory();
        var name = EXPORT_PREFIX + Date.now() + '.' + fmt;
        var fh = await root.getFileHandle(name, { create: true });
        var w = await fh.createWritable();
        var chain = Promise.resolve();
        var target = new M.StreamTarget({
          onData: function (data, position) {
            var chunk = data.slice();
            chain = chain.then(function () { return w.write({ type: 'write', data: chunk, position: position }); });
            chain.catch(function () { /* ошибку заберёт finish */ });
          },
          chunked: true,
          chunkSize: 8 * 1048576
        });
        return {
          target: target, stream: true, fastStart: false,
          finish: async function () {
            await chain; await w.close();
            var f = await fh.getFile();
            return f.slice(0, f.size, mime);
          },
          abort: async function () {
            try { await chain; } catch (e) { /* уже ошибка */ }
            try { await w.abort(); } catch (e2) { /* ничего */ }
            try { await root.removeEntry(name); } catch (e3) { /* ничего */ }
          }
        };
      } catch (e) {
        if (e && /Не хватает места/.test(e.message)) throw e;
        /* OPFS недоступен: пишем в память */
      }
    }
    var t = new M.ArrayBufferTarget();
    return {
      target: t, stream: false, fastStart: 'in-memory',
      finish: async function () { return new Blob([t.buffer], { type: mime }); },
      abort: async function () { /* память освободит сборщик мусора */ }
    };
  }

  /* Экспорт: mp4 (H.264+AAC), webm (VP9/VP8+Opus) или gif.
     o: { format, segs:[{file, start, end, dur, r, load()→Promise<video>}], W, H, fps, bitrate, speed, mute, vol, norm,
          fadeIn, fadeOut, onProgress(frac, text), signal }
     Несколько отрезков склеиваются в один ролик (очередь, вырезанные паузы). Время кадров считается по всему ролику. */
  AV.exportMedia = async function (o) {
    var fmt = o.format || 'mp4', W = o.W, H = o.H, fps = o.fps, speed = o.speed || 1, warnings = [];
    var segs = o.segs, ns = segs.map(function (g) { return Math.max(1, Math.round(((g.end - g.start) / speed) * fps)); });
    var total = ns.reduce(function (a, b) { return a + b; }, 0), outDur = total / fps;
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: fmt === 'gif' });
    function rOf(g) { return Object.assign({}, g.r, { outDur: outDur, fadeIn: o.fadeIn, fadeOut: o.fadeOut }); }
    var t0 = performance.now();
    function prog(i, text, scale) {
      var frac = i / total, el = (performance.now() - t0) / 1000, eta = frac > 0.02 ? Math.round((el / frac) * (1 - frac)) : null;
      o.onProgress(frac * scale, text + (eta !== null ? ' · ещё ~' + eta + ' с' : ''));
    }
    var vid;

    if (fmt === 'gif') {
      if (!AV.canGif()) throw new Error('Не загрузился модуль GIF. Обновите страницу.');
      if (total > 900) throw new Error('Для GIF слишком много кадров (' + total + '). Сократите ролик, уменьшите частоту кадров или ускорьте.');
      var gif = window.gifenc.GIFEncoder(), idx = 0;
      for (var si = 0; si < segs.length; si++) {
        vid = await segs[si].load();
        vid.pause();
        var rg = rOf(segs[si]);
        for (var k = 0; k < ns[si]; k++) {
          if (o.signal.aborted) throw abortErr();
          var tSrc = Math.min(segs[si].start + (k / fps) * speed, Math.max(segs[si].start, segs[si].end - 0.001));
          await seekTo(vid, tSrc);
          AV.renderAt(ctx, W, H, vid, rg, tSrc, idx / fps);
          var px = ctx.getImageData(0, 0, W, H).data;
          var pal = window.gifenc.quantize(px, 256, { format: 'rgb444' });
          gif.writeFrame(window.gifenc.applyPalette(px, pal, 'rgb444'), W, H, { palette: pal, delay: Math.round(1000 / fps) });
          idx++;
          if (idx % 2 === 0 || idx === total) prog(idx, 'Кадр ' + idx + ' из ' + total, 0.98);
          if (idx % 8 === 0) await wait(0);
        }
      }
      gif.finish();
      return { blob: new Blob([gif.bytes()], { type: 'image/gif' }), ext: 'gif', warnings: warnings, streamed: false };
    }

    var vcfg = await pickVideoConfig(W, H, fps, o.bitrate, fmt);
    if (!vcfg) throw new Error(fmt === 'webm' ? 'NO_VP9' : 'NO_H264');
    var M = fmt === 'webm' ? WebMMuxer : Mp4Muxer;

    /* звук: пробуем декодировать файлы; если не вышло ни у одного — без звука */
    var audioOn = false, cache = { file: null, res: null };
    async function getDecoded(g) {
      if (cache.file !== g.file) { cache.file = g.file; cache.res = null; cache.res = await decodeFile(g.file, g.dur || (g.end - g.start)); }
      return cache.res;
    }
    if (!o.mute) {
      o.onProgress(0, 'Подготовка звука…');
      if (!(await AV.audioSupport(fmt))) warnings.push('Браузер не умеет кодировать звук для ' + (fmt === 'webm' ? 'WebM (Opus)' : 'MP4 (AAC)') + '. Видео сохранено без звука.');
      else {
        var tried = {}, reasons = [];
        for (var q = 0; q < segs.length && Object.keys(tried).length < 3 && !audioOn; q++) {
          var key = segs[q].file.name + ':' + segs[q].file.size;
          if (tried[key]) continue;
          tried[key] = 1;
          var pr = await getDecoded(segs[q]);
          if (pr.buf) audioOn = true; else reasons.push(pr.reason);
          if (o.signal.aborted) throw abortErr();
        }
        if (!audioOn) warnings.push((reasons[0] || 'Звук не удалось прочитать.') + ' Видео сохранено без звука.');
      }
    }
    var acfg = ACFG[fmt];
    var est = (o.bitrate + (audioOn ? acfg.bitrate : 0)) * outDur / 8 * 1.05;
    var out = await openTarget(fmt, est);
    var muxOpts = { target: out.target, firstTimestampBehavior: 'offset' };
    if (fmt === 'webm') muxOpts.video = { codec: vcfg.codec === 'vp8' ? 'V_VP8' : 'V_VP9', width: W, height: H, frameRate: fps };
    else { muxOpts.video = { codec: 'avc', width: W, height: H }; muxOpts.fastStart = out.fastStart; }
    if (audioOn) muxOpts.audio = fmt === 'webm'
      ? { codec: 'A_OPUS', numberOfChannels: 2, sampleRate: 48000 }
      : { codec: 'aac', numberOfChannels: 2, sampleRate: 48000 };
    var muxer = new M.Muxer(muxOpts);

    var encErr = null, ok = false;
    var venc = new VideoEncoder({
      output: function (chunk, meta) { muxer.addVideoChunk(chunk, meta); },
      error: function (e) { encErr = e; }
    });
    venc.configure(vcfg);
    var aenc = null, aerr = null;
    if (audioOn) {
      aenc = new AudioEncoder({
        output: function (chunk, meta) { muxer.addAudioChunk(chunk, meta); },
        error: function (e) { aerr = e; }
      });
      aenc.configure(acfg);
    }
    try {
      var keyEvery = Math.max(1, Math.round(fps * 2)), cs = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false };
      var fi = 0, sampleOff = 0;
      for (var s2 = 0; s2 < segs.length; s2++) {
        var g = segs[s2], rr = rOf(g);
        vid = await g.load();
        vid.pause();
        var feeder = null;
        if (audioOn) {
          var dr = await getDecoded(g);
          feeder = makeSegAudio(aenc, function () { return aerr; }, dr.buf || null, g, ns[s2] / fps, sampleOff, o, outDur, speed);
        }
        for (var i = 0; i < ns[s2]; i++) {
          if (o.signal.aborted) throw abortErr();
          if (encErr) throw encErr;
          var ts = Math.min(g.start + (i / fps) * speed, Math.max(g.start, g.end - 0.001));
          await seekTo(vid, ts);
          AV.renderAt(ctx, W, H, vid, rr, ts, fi / fps);
          var init = { timestamp: Math.round((fi * 1e6) / fps), duration: Math.round(1e6 / fps) }, frame;
          try { frame = new VideoFrame(canvas, Object.assign({ colorSpace: cs }, init)); } catch (e0) { frame = new VideoFrame(canvas, init); }
          venc.encode(frame, { keyFrame: fi % keyEvery === 0 });
          frame.close();
          while (venc.encodeQueueSize > 6) { if (encErr) throw encErr; await wait(4); }
          fi++;
          if (feeder) await feeder.feed(Math.round(((i + 1) / fps) * 48000));
          if (fi % 3 === 0 || fi === total) prog(fi, 'Кадр ' + fi + ' из ' + total + (segs.length > 1 ? ' · часть ' + (s2 + 1) + '/' + segs.length : ''), audioOn ? 0.97 : 0.98);
        }
        if (feeder) { await feeder.feed(feeder.len); sampleOff += feeder.len; }
      }
      await venc.flush();
      if (encErr) throw encErr;
      venc.close();
      if (aenc) { await aenc.flush(); if (aerr) throw aerr; aenc.close(); }
      o.onProgress(0.99, out.stream ? 'Дописываю файл на диск…' : 'Собираю файл…');
      muxer.finalize();
      var blob = await out.finish();
      ok = true;
      return { blob: blob, ext: fmt, warnings: warnings, streamed: out.stream };
    } finally {
      if (!ok) {
        try { if (venc.state !== 'closed') venc.close(); } catch (e4) { /* ничего */ }
        try { if (aenc && aenc.state !== 'closed') aenc.close(); } catch (e5) { /* ничего */ }
        await out.abort();
      }
    }
  };

  /* Звук одного отрезка: вырезаем, меняем скорость, громкость, затухание, приводим к 48 кГц стерео, кодируем кусками.
     buf = null → тишина нужной длины. Возвращает новое смещение в сэмплах. */
  function makeSegAudio(aenc, getErr, buf, g, segOut, off, o, outDur, speed) {
    var SR = 48000, CH = 4096, len = Math.max(1, Math.round(segOut * SR));
    var chans = [], sr = SR, s0 = 0, s1 = 0, gain = Math.max(0, o.vol);
    if (buf) {
      sr = buf.sampleRate;
      for (var c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
      s0 = Math.max(0, Math.floor(g.start * sr)); s1 = Math.min(buf.length, Math.floor(g.end * sr));
      if (o.norm) {                                    // подгоняем самый громкий пик под ~ -0,4 дБ
        var peak = 0;
        for (var cc = 0; cc < chans.length; cc++) { var d = chans[cc]; for (var p = s0; p < s1; p += 2) { var v = d[p] < 0 ? -d[p] : d[p]; if (v > peak) peak = v; } }
        if (peak > 0.001) gain *= Math.min(8, 0.95 / peak);
      }
    }
    var step = (sr / SR) * speed, done = 0;            // step: сколько входных сэмплов на один выходной
    return {
      len: len,
      /* кодирует звук до сэмпла upTo этого отрезка (вместе с кадрами, чтобы muxer не копил видео в памяти) */
      feed: async function (upTo) {
        upTo = Math.min(len, upTo);
        while (done < upTo) {
          if (o.signal.aborted) throw abortErr();
          if (getErr()) throw getErr();
          var j0 = done, n = Math.min(CH, len - j0), data = new Float32Array(n * 2);
          for (var ch = 0; ch < 2; ch++) {
            var src = chans.length ? chans[Math.min(ch, chans.length - 1)] : null, base = ch * n;
            if (!src) continue;
            for (var k = 0; k < n; k++) {
              var j = j0 + k, gg = gain, tt = (off + j) / SR;
              if (o.fadeIn > 0 && tt < o.fadeIn) gg *= tt / o.fadeIn;
              if (o.fadeOut > 0 && outDur - tt < o.fadeOut) gg *= Math.max(0, (outDur - tt) / o.fadeOut);
              var pos = s0 + j * step, i0 = Math.floor(pos), val = 0;
              if (i0 < src.length) { var a = src[i0], b = src[Math.min(i0 + 1, src.length - 1)]; val = a + (b - a) * (pos - i0); }
              var sv = val * gg;
              data[base + k] = sv > 1 ? 1 : sv < -1 ? -1 : sv;
            }
          }
          var ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(((off + j0) / SR) * 1e6), data: data });
          aenc.encode(ad);
          ad.close();
          done += n;
          while (aenc.encodeQueueSize > 20) await wait(2);
        }
      }
    };
  }

  /* Запасной путь: запись в реальном времени через MediaRecorder */
  AV.exportRealtime = function (o) {
    return new Promise(function (resolve, reject) {
      if (typeof MediaRecorder === 'undefined') { reject(new Error('Браузер не умеет записывать видео (нет MediaRecorder).')); return; }
      var video = o.video, speed = o.speed || 1;
      var outDur = (o.end - o.start) / speed;
      var r = Object.assign({}, o.r, { outDur: outDur, fadeIn: o.fadeIn, fadeOut: o.fadeOut });
      var canvas = document.createElement('canvas');
      canvas.width = o.W; canvas.height = o.H;
      var ctx = canvas.getContext('2d', { alpha: false });
      var stream = canvas.captureStream(o.fps);
      var warnings = ['Записано в реальном времени: громкость и затухание звука не применяются.'];
      var prevRate = video.playbackRate;

      if (!o.mute) {
        try {
          var cs = video.captureStream || video.mozCaptureStream;
          var tr = cs.call(video).getAudioTracks();
          if (tr.length) stream.addTrack(tr[0]); else warnings.push('Звук не удалось захватить.');
        } catch (e) { warnings.push('Звук не удалось захватить — видео без звука.'); }
      }
      var mimes = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
      var mime = '';
      for (var i = 0; i < mimes.length; i++) { if (MediaRecorder.isTypeSupported(mimes[i])) { mime = mimes[i]; break; } }
      var rec;
      try { rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: o.bitrate } : {}); } catch (e2) { reject(e2); return; }
      var parts = [], finished = false, stopFrames = null;

      rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) parts.push(ev.data); };
      rec.onerror = function (ev) { cleanup(); reject((ev && ev.error) || new Error('Ошибка записи')); };
      rec.onstop = function () {
        cleanup();
        if (o.signal.aborted) { reject(abortErr()); return; }
        var type = rec.mimeType || mime || 'video/webm';
        resolve({ blob: new Blob(parts, { type: type }), ext: type.indexOf('mp4') !== -1 ? 'mp4' : 'webm', warnings: warnings, streamed: false });
      };
      function cleanup() {
        if (stopFrames) stopFrames();
        video.removeEventListener('ended', stop);
        o.signal.removeEventListener('abort', stop);
        video.pause();
        video.playbackRate = prevRate;
      }
      function stop() {
        if (finished) return;
        finished = true;
        if (rec.state !== 'inactive') rec.stop();
      }
      o.signal.addEventListener('abort', stop);
      video.addEventListener('ended', stop);

      seekTo(video, o.start).then(function () {
        video.playbackRate = speed;
        var draw = function (t) { AV.renderAt(ctx, o.W, o.H, video, r, t, (t - o.start) / speed); };
        draw(o.start);
        stopFrames = AV.onVideoFrame(video, function (t) {
          draw(t);
          var frac = Math.min(1, Math.max(0, (t - o.start) / (o.end - o.start)));
          o.onProgress(frac, 'Запись в реальном времени: ' + Math.round(frac * 100) + '%');
          if (t >= o.end - 0.03) stop();
        });
        rec.start(500);
        video.play().catch(function (e3) { stop(); reject(e3); });
      });
    });
  };
})();
