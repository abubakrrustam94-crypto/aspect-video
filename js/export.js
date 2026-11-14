/* Aspect Studio Video — экспорт.
   1) Основной путь: WebCodecs (H.264 + AAC) → MP4 через mp4-muxer. Быстрее реального времени, кадр в кадр.
   2) Запасной путь: MediaRecorder в реальном времени (если WebCodecs/H.264 нет). */
(function () {
  'use strict';
  var AV = (window.AV = window.AV || {});

  function abortErr() {
    var e = new Error('Отменено');
    e.aborted = true;
    return e;
  }

  function wait(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }

  AV.canWebCodecs = function () {
    return (
      typeof VideoEncoder !== 'undefined' &&
      typeof VideoFrame !== 'undefined' &&
      typeof window.Mp4Muxer !== 'undefined'
    );
  };

  function seekTo(video, t) {
    return new Promise(function (resolve) {
      if (Math.abs(video.currentTime - t) < 0.0005 && video.readyState >= 2) {
        resolve();
        return;
      }
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

  async function pickVideoConfig(W, H, fps, bitrate) {
    var area = W * H;
    var list =
      area > 2088960
        ? ['avc1.640033', 'avc1.640034', 'avc1.640032']
        : ['avc1.64002A', 'avc1.640028', 'avc1.4D0028', 'avc1.42E028'];
    for (var i = 0; i < list.length; i++) {
      var cfg = {
        codec: list[i],
        width: W,
        height: H,
        bitrate: bitrate,
        framerate: fps,
        avc: { format: 'avc' }
      };
      try {
        var r = await VideoEncoder.isConfigSupported(cfg);
        if (r && r.supported) return r.config || cfg;
      } catch (e) {
        /* пробуем следующий */
      }
    }
    return null;
  }

  async function prepareAudio(file) {
    if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return null;
    if (file.size > 600 * 1024 * 1024) return null;
    var buf = null;
    var ac = null;
    try {
      var ab = await file.arrayBuffer();
      var Ctx = window.AudioContext || window.webkitAudioContext;
      ac = new Ctx();
      buf = await new Promise(function (res, rej) {
        var p = ac.decodeAudioData(ab, res, rej);
        if (p && p.then) p.then(res, rej);
      });
    } catch (e) {
      buf = null;
    }
    if (ac && ac.close) {
      try {
        ac.close();
      } catch (e2) {
        /* ничего */
      }
    }
    if (!buf || !buf.length) return null;
    var ch = Math.min(2, buf.numberOfChannels);
    var cfg = {
      codec: 'mp4a.40.2',
      sampleRate: buf.sampleRate,
      numberOfChannels: ch,
      bitrate: 128000
    };
    try {
      var r = await AudioEncoder.isConfigSupported(cfg);
      if (!r || !r.supported) return null;
    } catch (e3) {
      return null;
    }
    return { buf: buf, cfg: cfg };
  }

  /* o: { video, file, W, H, fps, bitrate, start, end, drawOpts, mute, onProgress(frac,text), signal } */
  AV.exportMp4 = async function (o) {
    var video = o.video;
    var W = o.W;
    var H = o.H;
    var fps = o.fps;
    var total = Math.max(1, Math.round((o.end - o.start) * fps));
    var warnings = [];

    var vcfg = await pickVideoConfig(W, H, fps, o.bitrate);
    if (!vcfg) throw new Error('NO_H264');

    var audio = null;
    if (!o.mute) {
      o.onProgress(0, 'Подготовка звука…');
      audio = await prepareAudio(o.file);
      if (!audio) warnings.push('Звук не удалось перенести — видео сохранено без звука.');
    }
    if (o.signal.aborted) throw abortErr();

    var target = new Mp4Muxer.ArrayBufferTarget();
    var muxOpts = {
      target: target,
      video: { codec: 'avc', width: W, height: H },
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset'
    };
    if (audio) {
      muxOpts.audio = {
        codec: 'aac',
        numberOfChannels: audio.cfg.numberOfChannels,
        sampleRate: audio.cfg.sampleRate
      };
    }
    var muxer = new Mp4Muxer.Muxer(muxOpts);

    var encErr = null;
    var venc = new VideoEncoder({
      output: function (chunk, meta) {
        muxer.addVideoChunk(chunk, meta);
      },
      error: function (e) {
        encErr = e;
      }
    });
    venc.configure(vcfg);

    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d', { alpha: false });

    var wasPaused = video.paused;
    video.pause();
    var t0 = performance.now();

    try {
      var keyEvery = Math.max(1, Math.round(fps * 2));
      for (var i = 0; i < total; i++) {
        if (o.signal.aborted) throw abortErr();
        if (encErr) throw encErr;
        var t = Math.min(o.start + i / fps, Math.max(o.start, o.end - 0.001));
        await seekTo(video, t);
        AV.drawFrame(ctx, W, H, video, video.videoWidth, video.videoHeight, o.drawOpts);
        var frame = new VideoFrame(canvas, {
          timestamp: Math.round((i * 1e6) / fps),
          duration: Math.round(1e6 / fps)
        });
        venc.encode(frame, { keyFrame: i % keyEvery === 0 });
        frame.close();
        while (venc.encodeQueueSize > 6) {
          if (encErr) throw encErr;
          await wait(4);
        }
        if (i % 3 === 0 || i === total - 1) {
          var frac = (i + 1) / total;
          var el = (performance.now() - t0) / 1000;
          var eta = frac > 0.02 ? Math.round((el / frac) * (1 - frac)) : null;
          o.onProgress(
            frac * (audio ? 0.92 : 0.98),
            'Кадр ' + (i + 1) + ' из ' + total + (eta !== null ? ' · ещё ~' + eta + ' с' : '')
          );
        }
      }
      await venc.flush();
      if (encErr) throw encErr;
      venc.close();

      if (audio) {
        o.onProgress(0.93, 'Кодирую звук…');
        var buf = audio.buf;
        var sr = buf.sampleRate;
        var n = audio.cfg.numberOfChannels;
        var s0 = Math.max(0, Math.floor(o.start * sr));
        var s1 = Math.min(buf.length, Math.floor(o.end * sr));
        var aerr = null;
        var aenc = new AudioEncoder({
          output: function (chunk, meta) {
            muxer.addAudioChunk(chunk, meta);
          },
          error: function (e) {
            aerr = e;
          }
        });
        aenc.configure(audio.cfg);
        var CH = 4096;
        var chans = [];
        for (var c = 0; c < n; c++) chans.push(buf.getChannelData(c));
        for (var p = s0; p < s1; p += CH) {
          if (o.signal.aborted) throw abortErr();
          if (aerr) throw aerr;
          var len = Math.min(CH, s1 - p);
          var data = new Float32Array(len * n);
          for (var c2 = 0; c2 < n; c2++) {
            data.set(chans[c2].subarray(p, p + len), c2 * len);
          }
          var ad = new AudioData({
            format: 'f32-planar',
            sampleRate: sr,
            numberOfFrames: len,
            numberOfChannels: n,
            timestamp: Math.round(((p - s0) / sr) * 1e6),
            data: data
          });
          aenc.encode(ad);
          ad.close();
          while (aenc.encodeQueueSize > 20) await wait(2);
        }
        await aenc.flush();
        if (aerr) throw aerr;
        aenc.close();
      }

      o.onProgress(0.99, 'Собираю MP4…');
      muxer.finalize();
    } catch (err) {
      try {
        if (venc.state !== 'closed') venc.close();
      } catch (e4) {
        /* ничего */
      }
      throw err;
    } finally {
      if (!wasPaused) video.play();
    }

    return {
      blob: new Blob([target.buffer], { type: 'video/mp4' }),
      ext: 'mp4',
      warnings: warnings
    };
  };

  /* Запасной путь: запись в реальном времени через MediaRecorder. */
  AV.exportRealtime = function (o) {
    return new Promise(function (resolve, reject) {
      if (typeof MediaRecorder === 'undefined') {
        reject(new Error('Браузер не умеет записывать видео (нет MediaRecorder).'));
        return;
      }
      var video = o.video;
      var canvas = document.createElement('canvas');
      canvas.width = o.W;
      canvas.height = o.H;
      var ctx = canvas.getContext('2d', { alpha: false });
      var stream = canvas.captureStream(o.fps);
      var warnings = [];

      if (!o.mute) {
        try {
          var cs = video.captureStream || video.mozCaptureStream;
          var ms = cs.call(video);
          var tr = ms.getAudioTracks();
          if (tr.length) stream.addTrack(tr[0]);
          else warnings.push('Звук не удалось захватить.');
        } catch (e) {
          warnings.push('Звук не удалось захватить — видео без звука.');
        }
      }

      var mimes = [
        'video/mp4;codecs=avc1.640028,mp4a.40.2',
        'video/mp4',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm'
      ];
      var mime = '';
      for (var i = 0; i < mimes.length; i++) {
        if (MediaRecorder.isTypeSupported(mimes[i])) {
          mime = mimes[i];
          break;
        }
      }
      var rec;
      try {
        rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: o.bitrate } : {});
      } catch (e2) {
        reject(e2);
        return;
      }
      var parts = [];
      var finished = false;
      var stopFrames = null;
      var dur = o.end - o.start;

      rec.ondataavailable = function (ev) {
        if (ev.data && ev.data.size) parts.push(ev.data);
      };
      rec.onerror = function (ev) {
        cleanup();
        reject((ev && ev.error) || new Error('Ошибка записи'));
      };
      rec.onstop = function () {
        cleanup();
        if (o.signal.aborted) {
          reject(abortErr());
          return;
        }
        var type = rec.mimeType || mime || 'video/webm';
        resolve({
          blob: new Blob(parts, { type: type }),
          ext: type.indexOf('mp4') !== -1 ? 'mp4' : 'webm',
          warnings: warnings
        });
      };

      function cleanup() {
        if (stopFrames) stopFrames();
        video.removeEventListener('ended', onEnded);
        o.signal.removeEventListener('abort', onAbort);
        video.pause();
      }
      function stop() {
        if (finished) return;
        finished = true;
        if (rec.state !== 'inactive') rec.stop();
      }
      function onEnded() {
        stop();
      }
      function onAbort() {
        stop();
      }
      o.signal.addEventListener('abort', onAbort);
      video.addEventListener('ended', onEnded);

      seekTo(video, o.start).then(function () {
        AV.drawFrame(ctx, o.W, o.H, video, video.videoWidth, video.videoHeight, o.drawOpts);
        stopFrames = AV.onVideoFrame(video, function (t) {
          AV.drawFrame(ctx, o.W, o.H, video, video.videoWidth, video.videoHeight, o.drawOpts);
          var frac = Math.min(1, Math.max(0, (t - o.start) / dur));
          o.onProgress(frac, 'Запись в реальном времени: ' + Math.round(frac * 100) + '%');
          if (t >= o.end - 0.03) stop();
        });
        rec.start(500);
        video.play().catch(function (e3) {
          stop();
          reject(e3);
        });
      });
    });
  };
})();
