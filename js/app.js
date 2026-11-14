/* Aspect Studio Video — интерфейс */
(function () {
  'use strict';
  var AV = window.AV;
  var $ = function (id) {
    return document.getElementById(id);
  };

  var el = {
    drop: $('drop'), file: $('file'), editor: $('editor'), preview: $('preview'), video: $('video'),
    play: $('play'), seek: $('seek'), time: $('time'), info: $('info'), presets: $('presets'),
    cw: $('cw'), ch: $('ch'), modes: $('modes'), colorRow: $('colorRow'), color: $('color'),
    start: $('start'), end: $('end'), startLbl: $('startLbl'), endLbl: $('endLbl'),
    short: $('short'), fps: $('fps'), quality: $('quality'), mute: $('mute'),
    exportBtn: $('export'), progress: $('progress'), bar: $('bar'), ptext: $('ptext'),
    cancel: $('cancel'), note: $('note'), other: $('other'), result: $('result'),
    resultVideo: $('resultVideo'), resultInfo: $('resultInfo'), download: $('download'), share: $('share')
  };
  var pctx = el.preview.getContext('2d', { alpha: false });
  var video = el.video;

  var S = {
    file: null, url: null, vw: 0, vh: 0, dur: 0,
    rw: 9, rh: 16, mode: 'blur', color: '#000000',
    start: 0, end: 0, busy: false, abort: null, resultUrl: null, resultFile: null
  };

  /* ---------- служебное ---------- */
  function showNote(text, isErr) {
    el.note.hidden = !text;
    el.note.textContent = text || '';
    el.note.classList.toggle('err', !!isErr);
  }
  function outSize() {
    return AV.computeSize(S.rw, S.rh, parseInt(el.short.value, 10) || 0, S.vw, S.vh);
  }
  function drawOpts() {
    return { mode: S.mode, color: S.color };
  }
  function fmtBytes(b) {
    if (b > 1048576) return (b / 1048576).toFixed(1) + ' МБ';
    return Math.round(b / 1024) + ' КБ';
  }

  /* ---------- отрисовка превью ---------- */
  function draw() {
    if (!S.vw) return;
    var o = outSize();
    var p = AV.previewSize(o.w, o.h, 720);
    if (el.preview.width !== p.w || el.preview.height !== p.h) {
      el.preview.width = p.w;
      el.preview.height = p.h;
    }
    AV.drawFrame(pctx, p.w, p.h, video, S.vw, S.vh, drawOpts());
    el.time.textContent = AV.fmtTime(video.currentTime);
    if (document.activeElement !== el.seek) el.seek.value = video.currentTime;
  }
  function updateInfo() {
    var o = outSize();
    var d = Math.max(0, S.end - S.start);
    el.info.textContent =
      'Исходник ' + S.vw + '×' + S.vh + ' → результат ' + o.w + '×' + o.h + ' · ' + AV.fmtTime(d);
  }

  /* ---------- форматы ---------- */
  function buildPresets() {
    AV.PRESETS.forEach(function (p) {
      var b = document.createElement('button');
      b.className = 'chip';
      b.dataset.id = p.id;
      b.innerHTML = p.id + '<small>' + p.hint + '</small>';
      b.addEventListener('click', function () {
        S.rw = p.w;
        S.rh = p.h;
        syncRatioUi();
        draw();
        updateInfo();
      });
      el.presets.appendChild(b);
    });
  }
  function syncRatioUi() {
    var id = S.rw + ':' + S.rh;
    Array.prototype.forEach.call(el.presets.children, function (c) {
      c.classList.toggle('on', c.dataset.id === id);
    });
    el.cw.value = S.rw;
    el.ch.value = S.rh;
  }
  function onCustom() {
    var w = parseInt(el.cw.value, 10);
    var h = parseInt(el.ch.value, 10);
    if (!(w >= 1 && h >= 1)) return;
    S.rw = Math.min(100, w);
    S.rh = Math.min(100, h);
    Array.prototype.forEach.call(el.presets.children, function (c) {
      c.classList.toggle('on', c.dataset.id === S.rw + ':' + S.rh);
    });
    draw();
    updateInfo();
  }
  el.cw.addEventListener('input', onCustom);
  el.ch.addEventListener('input', onCustom);

  Array.prototype.forEach.call(el.modes.querySelectorAll('button'), function (b) {
    b.addEventListener('click', function () {
      S.mode = b.dataset.mode;
      Array.prototype.forEach.call(el.modes.children, function (x) {
        var on = x === b;
        x.classList.toggle('on', on);
        x.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      el.colorRow.hidden = S.mode !== 'color';
      draw();
    });
  });
  el.color.addEventListener('input', function () {
    S.color = el.color.value;
    draw();
  });
  el.short.addEventListener('change', function () {
    draw();
    updateInfo();
  });

  /* ---------- загрузка файла ---------- */
  function loadFile(f) {
    if (!f) return;
    if (f.type && f.type.indexOf('video/') !== 0) {
      alert('Это не видео. Выберите видеофайл.');
      return;
    }
    if (S.busy) return;
    if (S.url) URL.revokeObjectURL(S.url);
    clearResult();
    showNote('');
    S.file = f;
    S.url = URL.createObjectURL(f);
    video.muted = el.mute.checked;
    video.src = S.url;
    video.load();
  }

  video.addEventListener('loadedmetadata', function () {
    S.vw = video.videoWidth;
    S.vh = video.videoHeight;
    S.dur = video.duration;
    if (!S.vw || !isFinite(S.dur)) {
      showNote('Не удалось прочитать видео. Формат может не поддерживаться этим браузером.', true);
      return;
    }
    S.start = 0;
    S.end = S.dur;
    [el.start, el.end, el.seek].forEach(function (r) {
      r.max = S.dur;
    });
    el.start.value = 0;
    el.end.value = S.dur;
    el.seek.value = 0;
    updateTrimLabels();
    el.drop.hidden = true;
    el.editor.hidden = false;
    syncRatioUi();
    updateInfo();
    video.currentTime = Math.min(0.05, S.dur / 2);
  });
  video.addEventListener('loadeddata', draw);
  video.addEventListener('seeked', draw);
  video.addEventListener('error', function () {
    if (S.file) showNote('Браузер не смог открыть это видео (кодек не поддерживается).', true);
  });

  el.drop.addEventListener('click', function () {
    el.file.click();
  });
  el.drop.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      el.file.click();
    }
  });
  el.file.addEventListener('change', function () {
    loadFile(el.file.files[0]);
    el.file.value = '';
  });
  ['dragenter', 'dragover'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      e.preventDefault();
      el.drop.classList.add('over');
    });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      e.preventDefault();
      el.drop.classList.remove('over');
    });
  });
  document.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });
  el.other.addEventListener('click', function () {
    if (S.busy) return;
    el.file.click();
  });

  /* ---------- воспроизведение и обрезка ---------- */
  function updateTrimLabels() {
    el.startLbl.textContent = AV.fmtTime(S.start);
    el.endLbl.textContent = AV.fmtTime(S.end);
  }
  el.start.addEventListener('input', function () {
    S.start = Math.min(parseFloat(el.start.value), S.end - 0.2);
    if (S.start < 0) S.start = 0;
    el.start.value = S.start;
    updateTrimLabels();
    updateInfo();
    video.currentTime = S.start;
  });
  el.end.addEventListener('input', function () {
    S.end = Math.max(parseFloat(el.end.value), S.start + 0.2);
    if (S.end > S.dur) S.end = S.dur;
    el.end.value = S.end;
    updateTrimLabels();
    updateInfo();
    video.currentTime = Math.max(S.start, S.end - 0.1);
  });
  el.seek.addEventListener('input', function () {
    video.currentTime = parseFloat(el.seek.value);
  });
  el.mute.addEventListener('change', function () {
    video.muted = el.mute.checked;
  });

  el.play.addEventListener('click', function () {
    if (S.busy) return;
    if (video.paused) {
      if (video.currentTime < S.start || video.currentTime >= S.end - 0.05) video.currentTime = S.start;
      video.play();
    } else {
      video.pause();
    }
  });
  video.addEventListener('play', function () {
    el.play.textContent = '❚❚';
  });
  video.addEventListener('pause', function () {
    el.play.textContent = '▶';
    draw();
  });
  AV.onVideoFrame(video, function (t) {
    if (S.busy) return;
    draw();
    if (!video.paused && t >= S.end - 0.03) {
      video.pause();
      video.currentTime = S.start;
    }
  });

  /* ---------- экспорт ---------- */
  function setBusy(b) {
    S.busy = b;
    el.exportBtn.disabled = b;
    el.progress.hidden = !b;
    [el.cw, el.ch, el.short, el.fps, el.quality, el.mute, el.start, el.end, el.seek, el.play].forEach(function (x) {
      x.disabled = b;
    });
  }
  function onProgress(frac, text) {
    el.bar.style.width = Math.round(frac * 100) + '%';
    el.ptext.textContent = text;
  }
  function clearResult() {
    if (S.resultUrl) URL.revokeObjectURL(S.resultUrl);
    S.resultUrl = null;
    S.resultFile = null;
    el.result.hidden = true;
    el.resultVideo.removeAttribute('src');
    el.resultVideo.load();
  }

  el.cancel.addEventListener('click', function () {
    if (S.abort) S.abort.abort();
  });

  el.exportBtn.addEventListener('click', async function () {
    if (S.busy || !S.vw) return;
    clearResult();
    showNote('');
    video.pause();
    var o = outSize();
    var fps = parseInt(el.fps.value, 10);
    var bitrate = Math.round(o.w * o.h * fps * parseFloat(el.quality.value));
    bitrate = Math.max(1000000, Math.min(60000000, bitrate));

    S.abort = new AbortController();
    var common = {
      video: video, file: S.file, W: o.w, H: o.h, fps: fps, bitrate: bitrate,
      start: S.start, end: S.end, drawOpts: drawOpts(), mute: el.mute.checked,
      onProgress: onProgress, signal: S.abort.signal
    };
    var savedMuted = video.muted;
    setBusy(true);
    onProgress(0, 'Старт…');
    var res = null;
    try {
      if (AV.canWebCodecs()) {
        try {
          res = await AV.exportMp4(common);
        } catch (err) {
          if (err && err.aborted) throw err;
          if (!err || err.message !== 'NO_H264') {
            console.warn('WebCodecs не сработал, пробую запись в реальном времени:', err);
          }
          if (S.abort.signal.aborted) throw err;
          showNote('Быстрый режим недоступен — идёт запись в реальном времени. Не закрывайте вкладку.');
          video.muted = el.mute.checked;
          res = await AV.exportRealtime(common);
        }
      } else {
        showNote('Быстрый режим недоступен в этом браузере — идёт запись в реальном времени. Не закрывайте вкладку.');
        res = await AV.exportRealtime(common);
      }
      showResult(res, o);
    } catch (err2) {
      if (err2 && err2.aborted) showNote('Экспорт отменён.');
      else showNote('Не получилось: ' + ((err2 && err2.message) || err2), true);
    } finally {
      video.muted = savedMuted;
      setBusy(false);
      video.currentTime = S.start;
      draw();
    }
  });

  function showResult(res, o) {
    var base = (S.file.name || 'video').replace(/\.[^.]+$/, '');
    var name = base + '_' + S.rw + 'x' + S.rh + '.' + res.ext;
    S.resultUrl = URL.createObjectURL(res.blob);
    S.resultFile = new File([res.blob], name, { type: res.blob.type });
    el.resultVideo.src = S.resultUrl;
    el.download.href = S.resultUrl;
    el.download.download = name;
    el.resultInfo.textContent = name + ' · ' + o.w + '×' + o.h + ' · ' + fmtBytes(res.blob.size) +
      (res.ext === 'webm' ? ' · формат WebM' : '');
    el.share.hidden = !(navigator.canShare && navigator.canShare({ files: [S.resultFile] }));
    el.result.hidden = false;
    var msg = res.warnings && res.warnings.length ? res.warnings.join(' ') : '';
    if (res.ext === 'webm') msg += ' Ваш браузер записал WebM — на некоторых устройствах он открывается не везде.';
    showNote(msg.trim());
    el.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  el.share.addEventListener('click', function () {
    if (S.resultFile) navigator.share({ files: [S.resultFile] }).catch(function () {});
  });

  /* ---------- старт ---------- */
  buildPresets();
  syncRatioUi();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
