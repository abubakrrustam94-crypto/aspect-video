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

  async function pickVideoConfig(W, H, fps, bitrate) {
    var area = W * H;
    var list = area > 2088960
      ? ['avc1.640033', 'avc1.640034', 'avc1.640032']
      : ['avc1.64002A', 'avc1.640028', 'avc1.4D0028', 'avc1.42E028'];
    for (var i = 0; i < list.length; i++) {
      var cfg = { codec: list[i], width: W, height: H, bitrate: bitrate, framerate: fps, avc: { format: 'avc' } };
      try {
        var r = await VideoEncoder.isConfigSupported(cfg);
        if (r && r.supported) return r.config || cfg;
      } catch (e) { /* пробуем следующий */ }
    }
    return null;
  }

  AV.audioSupport = async function () {
    if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return false;
    try { var r = await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 }); return !!(r && r.supported); } catch (e) { return false; }
  };

  /* Декодирует звук файла целиком. Слишком длинные ролики пропускаем: распакованный звук занимает много памяти. */
  async function prepareAudio(file, dur) {
    if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return { reason: 'Браузер не умеет кодировать звук (AAC).' };
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
    var cfg = { codec: 'mp4a.40.2', sampleRate: buf.sampleRate, numberOfChannels: Math.min(2, buf.numberOfChannels), bitrate: 128000 };
    try {
      var r = await AudioEncoder.isConfigSupported(cfg);
      if (!r || !r.supported) return { reason: 'Браузер не умеет кодировать AAC-звук.' };
    } catch (e3) { return { reason: 'Браузер не умеет кодировать AAC-звук.' }; }
    return { buf: buf, cfg: cfg };
  }

  /* Куда писать: на диск (OPFS), если файл большой, иначе в память */
  async function openTarget(estBytes) {
    if (estBytes > AV.streamFrom && AV.hasOpfs()) {
      try {
        var q = navigator.storage.estimate ? await navigator.storage.estimate() : null;
        if (q && q.quota && q.quota - (q.usage || 0) < estBytes * 1.3) {
          throw new Error('Не хватает места на устройстве: нужно около ' + fmtBytes(estBytes * 1.3) + ', свободно ' + fmtBytes(q.quota - (q.usage || 0)) + '. Уменьшите размер или битрейт.');
        }
        var root = await navigator.storage.getDirectory();
        var name = EXPORT_PREFIX + Date.now() + '.mp4';
        var fh = await root.getFileHandle(name, { create: true });
        var w = await fh.createWritable();
        var chain = Promise.resolve();
        var target = new Mp4Muxer.StreamTarget({
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
            return f.slice(0, f.size, 'video/mp4');
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
    var t = new Mp4Muxer.ArrayBufferTarget();
    return {
      target: t, stream: false, fastStart: 'in-memory',
      finish: async function () { return new Blob([t.buffer], { type: 'video/mp4' }); },
      abort: async function () { /* память освободит сборщик мусора */ }
    };
  }

  /* o: { video, file, W, H, fps, bitrate, start, end, speed, r (параметры кадра), mute, vol, norm,
          fadeIn, fadeOut, onProgress(frac, text), signal } */
  AV.exportMp4 = async function (o) {
    var video = o.video, W = o.W, H = o.H, fps = o.fps, speed = o.speed || 1;
    var outDur = (o.end - o.start) / speed;
    var total = Math.max(1, Math.round(outDur * fps));
    var r = Object.assign({}, o.r, { outDur: outDur, fadeIn: o.fadeIn, fadeOut: o.fadeOut });
    var warnings = [];

    var vcfg = await pickVideoConfig(W, H, fps, o.bitrate);
    if (!vcfg) throw new Error('NO_H264');

    var audio = null;
    if (!o.mute) {
      o.onProgress(0, 'Подготовка звука…');
      var pa = await prepareAudio(o.file, video.duration || (o.end - o.start));
      if (pa.buf) audio = pa;
      else warnings.push(pa.reason + ' Видео сохранено без звука.');
    }
    if (o.signal.aborted) throw abortErr();

    var est = (o.bitrate + (audio ? 128000 : 0)) * outDur / 8 * 1.05;
    var out = await openTarget(est);
    var muxOpts = {
      target: out.target,
      video: { codec: 'avc', width: W, height: H },
      fastStart: out.fastStart,
      firstTimestampBehavior: 'offset'
    };
    if (audio) muxOpts.audio = { codec: 'aac', numberOfChannels: audio.cfg.numberOfChannels, sampleRate: audio.cfg.sampleRate };
    var muxer = new Mp4Muxer.Muxer(muxOpts);

    var encErr = null;
    var venc = new VideoEncoder({
      output: function (chunk, meta) { muxer.addVideoChunk(chunk, meta); },
      error: function (e) { encErr = e; }
    });
    venc.configure(vcfg);

    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d', { alpha: false });
    var wasPaused = video.paused;
    video.pause();
    var t0 = performance.now(), ok = false;

    try {
      var keyEvery = Math.max(1, Math.round(fps * 2));
      var cs = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false };
      for (var i = 0; i < total; i++) {
        if (o.signal.aborted) throw abortErr();
        if (encErr) throw encErr;
        var tOut = i / fps;
        var tSrc = Math.min(o.start + tOut * speed, Math.max(o.start, o.end - 0.001));
        await seekTo(video, tSrc);
        AV.renderAt(ctx, W, H, video, r, tSrc, tOut);
        var init = { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) };
        var frame;
        try { frame = new VideoFrame(canvas, Object.assign({ colorSpace: cs }, init)); } catch (e0) { frame = new VideoFrame(canvas, init); }
        venc.encode(frame, { keyFrame: i % keyEvery === 0 });
        frame.close();
        while (venc.encodeQueueSize > 6) {
          if (encErr) throw encErr;
          await wait(4);
        }
        if (i % 3 === 0 || i === total - 1) {
          var frac = (i + 1) / total, el = (performance.now() - t0) / 1000;
          var eta = frac > 0.02 ? Math.round((el / frac) * (1 - frac)) : null;
          o.onProgress(frac * (audio ? 0.92 : 0.98), 'Кадр ' + (i + 1) + ' из ' + total + (eta !== null ? ' · ещё ~' + eta + ' с' : ''));
        }
      }
      await venc.flush();
      if (encErr) throw encErr;
      venc.close();

      if (audio) {
        o.onProgress(0.93, 'Кодирую звук…');
        await encodeAudio(audio, muxer, o, outDur);
      }
      o.onProgress(0.99, out.stream ? 'Дописываю файл на диск…' : 'Собираю MP4…');
      muxer.finalize();
      var blob = await out.finish();
      ok = true;
      return { blob: blob, ext: 'mp4', warnings: warnings, streamed: out.stream };
    } finally {
      if (!ok) {
        try { if (venc.state !== 'closed') venc.close(); } catch (e4) { /* ничего */ }
        await out.abort();
      }
      if (!wasPaused) video.play();
    }
  };

  /* Звук: вырезаем фрагмент, меняем скорость, громкость, затухание и кодируем в AAC кусками */
  async function encodeAudio(audio, muxer, o, outDur) {
    var buf = audio.buf, sr = buf.sampleRate, n = audio.cfg.numberOfChannels, speed = o.speed || 1;
    var s0 = Math.max(0, Math.floor(o.start * sr)), s1 = Math.min(buf.length, Math.floor(o.end * sr));
    var outLen = Math.max(1, Math.floor((s1 - s0) / speed));
    var chans = [];
    for (var c = 0; c < n; c++) chans.push(buf.getChannelData(c));

    var gain = Math.max(0, o.vol);
    if (o.norm) {                                       // подгоняем самый громкий пик под ~ -0,4 дБ
      var peak = 0;
      for (var cc = 0; cc < n; cc++) {
        var d = chans[cc];
        for (var p = s0; p < s1; p++) { var v = d[p] < 0 ? -d[p] : d[p]; if (v > peak) peak = v; }
      }
      if (peak > 0.001) gain *= Math.min(8, 0.95 / peak);
    }
    var aerr = null;
    var aenc = new AudioEncoder({
      output: function (chunk, meta) { muxer.addAudioChunk(chunk, meta); },
      error: function (e) { aerr = e; }
    });
    aenc.configure(audio.cfg);
    var CH = 4096;
    for (var j0 = 0; j0 < outLen; j0 += CH) {
      if (o.signal.aborted) throw abortErr();
      if (aerr) throw aerr;
      var len = Math.min(CH, outLen - j0);
      var data = new Float32Array(len * n);
      for (var ch = 0; ch < n; ch++) {
        var src = chans[ch], base = ch * len;
        for (var k = 0; k < len; k++) {
          var j = j0 + k, g = gain;
          var tt = j / sr;
          if (o.fadeIn > 0 && tt < o.fadeIn) g *= tt / o.fadeIn;
          if (o.fadeOut > 0 && outDur - tt < o.fadeOut) g *= Math.max(0, (outDur - tt) / o.fadeOut);
          var val;
          if (speed === 1) val = src[s0 + j];
          else {
            var pos = s0 + j * speed, i0 = Math.floor(pos), fr = pos - i0;
            var a = src[i0], b = src[Math.min(i0 + 1, src.length - 1)];
            val = a + (b - a) * fr;
          }
          var s = val * g;
          data[base + k] = s > 1 ? 1 : s < -1 ? -1 : s;
        }
      }
      var ad = new AudioData({
        format: 'f32-planar', sampleRate: sr, numberOfFrames: len, numberOfChannels: n,
        timestamp: Math.round((j0 / sr) * 1e6), data: data
      });
      aenc.encode(ad);
      ad.close();
      while (aenc.encodeQueueSize > 20) await wait(2);
    }
    await aenc.flush();
    if (aerr) throw aerr;
    aenc.close();
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
