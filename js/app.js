'use strict';
/* Aspect Studio Video — интерфейс: очередь, превью, настройки, экспорт */
(function () {
  var AV = window.AV;
  var video = $('#video'), pv = $('#preview'), pctx = pv.getContext('2d', { alpha: false });
  var Q = [], cur = -1, uid = 0;
  var busy = false, abort = null, wmImg = null, wl = null, stripToken = 0;
  var results = [];
  var VIDEO_EXT = /\.(mp4|m4v|mov|mkv|webm|avi|3gp|ts|mts|m2ts|ogv)$/i;

  /* ---------- вспомогательное ---------- */
  function item() { return Q[cur] || null; }
  function wmObj() {
    return { on: S.wmOn, type: S.wmType, text: S.wmText, color: S.wmColor, shadow: S.wmShadow, opacity: S.wmOpacity,
      size: S.wmSize, pos: S.wmPos, margin: S.wmMargin, angle: S.wmAngle, when: S.wmWhen, sec: S.wmSec };
  }
  function outSize(it) {
    var o = AV.orientedSize(it.vw, it.vh, S.rot);
    return AV.computeSize(S.rw, S.rh, S.short, o.w, o.h);
  }
  function rparams(it) {
    return {
      rot: S.rot, fh: S.flipH, fv: S.flipV, mode: S.mode, color: S.color,
      focusAt: S.mode === 'crop' && S.faceTrack && it.track ? function (t) { return AV.focusAt(it.track, t); } : null,
      wm: wmObj(), wmImg: wmImg
    };
  }
  function bitrateFor(o) {
    return Math.max(1000000, Math.min(60000000, Math.round(o.w * o.h * S.fps * S.quality)));
  }
  function baseName(f) { return (f.name || 'video').replace(/\.[^.]+$/, ''); }
  function download(url, name) {
    var a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------- привязка настроек к элементам ---------- */
  function syncUI() {
    $$('[data-key]').forEach(function (e) {
      var k = e.dataset.key;
      if (e.type === 'checkbox') e.checked = !!S[k];
      else if (document.activeElement !== e) e.value = S[k];
    });
    $$('[data-out]').forEach(function (o) {
      var k = o.dataset.out, v = S[k];
      o.textContent = (k === 'fadeIn' || k === 'fadeOut' ? Number(v).toFixed(1) : String(v).replace('.', ',')) + (o.dataset.unit || '');
    });
    $$('[data-group]').forEach(function (g) {
      var k = g.dataset.group;
      $$('[data-val]', g).forEach(function (b) {
        var on = String(S[k]) === b.dataset.val;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    });
    Array.prototype.forEach.call($('#presets').children, function (c) { c.classList.toggle('active', c.dataset.id === S.rw + ':' + S.rh); });
    if (document.activeElement !== $('#cw')) $('#cw').value = S.rw;
    if (document.activeElement !== $('#ch')) $('#ch').value = S.rh;
    $('#flipH').setAttribute('aria-pressed', S.flipH); $('#flipH').classList.toggle('active', S.flipH);
    $('#flipV').setAttribute('aria-pressed', S.flipV); $('#flipV').classList.toggle('active', S.flipV);
    $('#colorRow').hidden = S.mode !== 'color';
    $('#faceRow').hidden = S.mode !== 'crop';
    $('#modeNote').textContent = {
      blur: 'Поля заполняются размытой копией самого видео.',
      mirror: 'За краями кадра продолжается отражение видео.',
      color: 'Поля заливаются выбранным цветом.',
      crop: 'Кадр заполняется целиком, края обрезаются. Остальные режимы ничего не режут.'
    }[S.mode];
    $('#wmTextRow').hidden = S.wmType !== 'text';
    $('#wmColorRow').hidden = S.wmType !== 'text';
    $('#wmImgRow').hidden = S.wmType !== 'image';
    $('#wmAngleRow').hidden = S.wmPos !== 'tile';
    $('#wmSecRow').hidden = S.wmWhen !== 'first';
    updateFaceStatus();
    updateNamePreview();
    updateEstimate();
  }
  function afterSet(k) {
    if (k === 'rot' || k === 'flipH' || k === 'flipV' || k === '*') Q.forEach(function (it) { it.track = null; it.noFace = false; });
    syncUI();
    if (k === 'speed' || k === '*') video.playbackRate = S.speed;
    if (k === 'mute' || k === '*') video.muted = S.mute;
    if (k === 'faceTrack' && S.faceTrack && S.mode === 'crop' && item() && !item().track && !item().noFace) runFaces(item());
    if (k === 'mode' && S.mode === 'crop' && S.faceTrack && item() && !item().track && !item().noFace) runFaces(item());
    updateInfo();
    draw();
  }
  onSet(afterSet);

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-group] [data-val]');
    if (!b) return;
    var g = b.closest('[data-group]'), v = b.dataset.val;
    if (busy) return;
    set(g.dataset.group, g.hasAttribute('data-num') ? Number(v) : v);
  });
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (!t.dataset || !t.dataset.key) return;
    var k = t.dataset.key;
    if (t.type === 'checkbox') set(k, t.checked);
    else if (t.type === 'range') set(k, Number(t.value));
    else set(k, t.value);
  });

  /* ---------- форматы и сценарии ---------- */
  AV.PRESETS.forEach(function (p) {
    var b = el('button', 'chip'); b.type = 'button'; b.dataset.id = p.id;
    b.innerHTML = p.id + '<small>' + p.hint + '</small>';
    b.addEventListener('click', function () { if (!busy) setMany({ rw: p.w, rh: p.h }); });
    $('#presets').appendChild(b);
  });
  AV.SCENARIOS.forEach(function (sc) {
    var b = el('button', 'chip', sc.name); b.type = 'button';
    b.addEventListener('click', function () { if (busy) return; setMany(sc.set); toast('Выбрано: ' + sc.name); });
    $('#scenarios').appendChild(b);
  });
  function onCustom() {
    var w = parseInt($('#cw').value, 10), h = parseInt($('#ch').value, 10);
    if (w >= 1 && h >= 1 && !busy) setMany({ rw: Math.min(100, w), rh: Math.min(100, h) });
  }
  $('#cw').addEventListener('input', onCustom);
  $('#ch').addEventListener('input', onCustom);

  /* ---------- вкладки ---------- */
  function setTab(name) {
    window.AVTab = name;
    $$('#settingsTabs [data-tab]').forEach(function (b) {
      var on = b.dataset.tab === name;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    $$('#colSettings .card[data-tab]').forEach(function (c) { c.hidden = c.dataset.tab !== name; });
    ls.set(TAB_KEY, name);
    if (name === 'export') updateEstimate();
    document.dispatchEvent(new CustomEvent('avtab', { detail: name }));
  }
  window.setSettingsTab = setTab;
  $('#settingsTabs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tab]');
    if (b) setTab(b.dataset.tab);
  });
  $('#settingsTabs').addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    var tabs = $$('#settingsTabs [data-tab]'), i = tabs.findIndex(function (b) { return b.getAttribute('aria-selected') === 'true'; });
    i = (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[i].focus(); setTab(tabs[i].dataset.tab);
    e.preventDefault();
  });

  /* ---------- тема ---------- */
  function resolvedTheme() {
    var m = ls.get(THEME_KEY);
    return m === 'light' || m === 'dark' ? m : (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  }
  function applyTheme() {
    var t = resolvedTheme();
    document.documentElement.dataset.theme = t;
    var m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = t === 'light' ? '#faf8ff' : '#0f0f14';
    $('#themeBtn use').setAttribute('href', t === 'light' ? '#i-moon' : '#i-sun');
    $('#themeBtn').setAttribute('aria-label', t === 'light' ? 'Включить тёмную тему' : 'Включить светлую тему');
    document.dispatchEvent(new CustomEvent('avtheme'));
  }
  window.applyTheme = applyTheme;
  applyTheme();
  $('#themeBtn').addEventListener('click', function () { ls.set(THEME_KEY, resolvedTheme() === 'light' ? 'dark' : 'light'); applyTheme(); });
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () { if (!ls.get(THEME_KEY)) applyTheme(); });

  /* ---------- добавление файлов ---------- */
  function probe(file) {
    return new Promise(function (resolve, reject) {
      var v = document.createElement('video'), url = URL.createObjectURL(file), done = false;
      v.preload = 'metadata'; v.muted = true;
      var fin = function (err) {
        if (done) return; done = true; clearTimeout(timer);
        if (err) { URL.revokeObjectURL(url); reject(err); }
        else resolve({ url: url, vw: v.videoWidth, vh: v.videoHeight, dur: v.duration });
        v.removeAttribute('src'); v.load();
      };
      var timer = setTimeout(function () { fin(new Error('timeout')); }, 15000);
      v.onloadedmetadata = function () { (v.videoWidth && isFinite(v.duration)) ? fin() : fin(new Error('nometa')); };
      v.onerror = function () { fin(new Error('decode')); };
      v.src = url;
    });
  }
  async function addFiles(files) {
    var list = Array.prototype.filter.call(files, function (f) { return (f.type && f.type.indexOf('video/') === 0) || VIDEO_EXT.test(f.name); });
    if (!list.length) { toast('Это не видео. Выберите видеофайл.', true); return; }
    var first = Q.length === 0, added = 0;
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      try {
        var p = await probe(f);
        Q.push({ id: ++uid, file: f, url: p.url, name: f.name, vw: p.vw, vh: p.vh, dur: p.dur, start: 0, end: p.dur, track: null, noFace: false });
        added++;
      } catch (err) {
        toast('Не удалось открыть «' + f.name + '». Так бывает с HEVC/H.265, AVI и MKV: переведите в MP4 (H.264) или откройте в Chrome.', true);
        logError('Не открылся ' + f.name + ' (' + (f.type || 'тип неизвестен') + '): ' + (err && err.message), 'файл');
      }
    }
    if (!added) return;
    $('#uploadZone').hidden = true;
    $('#previewCard').hidden = false; $('#queueCard').hidden = false; $('#toolbar').hidden = false;
    renderQueue();
    if (first || cur < 0) await select(0);
    else toast('Добавлено видео: ' + added);
  }
  var fi = $('#fileInput');
  $('#uploadZone').addEventListener('click', function (e) { if (!e.target.closest('button')) fi.click(); });
  $('#uploadBtn').addEventListener('click', function () { fi.click(); });
  $('#addMore').addEventListener('click', function () { if (!busy) fi.click(); });
  fi.addEventListener('change', function () { if (fi.files.length) addFiles(fi.files); fi.value = ''; });
  ['dragenter', 'dragover'].forEach(function (ev) { document.addEventListener(ev, function (e) { e.preventDefault(); $('#uploadZone').classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { document.addEventListener(ev, function (e) { e.preventDefault(); $('#uploadZone').classList.remove('over'); }); });
  document.addEventListener('drop', function (e) { if (!busy && e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });

  /* ---------- очередь ---------- */
  function renderQueue() {
    var box = $('#queue'); box.replaceChildren();
    Q.forEach(function (it, i) {
      var row = el('div', 'q-item' + (i === cur ? ' on' : '')); row.setAttribute('role', 'listitem');
      var b = el('button', 'q-main'); b.type = 'button';
      b.append(el('b', '', it.name), el('small', '', it.vw + '×' + it.vh + ' · ' + fmtTime(it.end - it.start)));
      if (i === cur) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', function () { if (!busy) select(i); });
      var x = el('button', 'q-x', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'Убрать из очереди: ' + it.name);
      x.addEventListener('click', function () { if (!busy) removeItem(i); });
      row.append(b, x); box.appendChild(row);
    });
    $('#qCount').textContent = Q.length > 1 ? Q.length + ' шт.' : '';
    $('#qPos').textContent = (cur + 1) + ' из ' + Q.length;
    $('#prevItem').disabled = Q.length < 2 || cur <= 0;
    $('#nextItem').disabled = Q.length < 2 || cur >= Q.length - 1;
    $('#saveAllBtn').hidden = Q.length < 2;
    $('#saveAllBtn span').textContent = 'Сохранить все (' + Q.length + ')';
  }
  function removeItem(i) {
    URL.revokeObjectURL(Q[i].url);
    Q.splice(i, 1);
    if (!Q.length) {
      cur = -1; video.removeAttribute('src'); video.load();
      $('#previewCard').hidden = true; $('#queueCard').hidden = true; $('#toolbar').hidden = true; $('#uploadZone').hidden = false;
      updateFaceStatus(); updateEstimate(); updateNamePreview();
      return;
    }
    if (i < cur) cur--;
    else if (i === cur) { cur = Math.min(cur, Q.length - 1); select(cur, true); return; }
    renderQueue();
  }
  $('#prevItem').addEventListener('click', function () { if (!busy && cur > 0) select(cur - 1); });
  $('#nextItem').addEventListener('click', function () { if (!busy && cur < Q.length - 1) select(cur + 1); });

  function loadVideo(it) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var ok = function () { if (done) return; done = true; cleanup(); resolve(); };
      var bad = function () { if (done) return; done = true; cleanup(); reject(new Error('Видео не открылось')); };
      var cleanup = function () { video.removeEventListener('loadeddata', ok); video.removeEventListener('error', bad); };
      video.addEventListener('loadeddata', ok); video.addEventListener('error', bad);
      video.muted = S.mute; video.playbackRate = S.speed;
      video.src = it.url; video.load();
    });
  }
  async function select(i, force) {
    if (i === cur && !force) return;
    cur = i;
    var it = Q[i];
    video.pause();
    renderQueue();
    try { await loadVideo(it); } catch (e) { toast('Не удалось показать видео «' + it.name + '».', true); return; }
    syncTrim(it);
    try { video.currentTime = Math.min(it.start + 0.05, it.dur / 2); } catch (e2) { /* ничего */ }
    syncUI(); updateInfo(); draw();
    makeStrip(it);
    if (S.mode === 'crop' && S.faceTrack && !it.track && !it.noFace) runFaces(it);
  }
  function syncTrim(it) {
    [$('#start'), $('#end'), $('#seek')].forEach(function (r) { r.max = it.dur; });
    $('#start').value = it.start; $('#end').value = it.end;
    $('#startLbl').textContent = fmtTime(it.start); $('#endLbl').textContent = fmtTime(it.end);
  }

  /* ---------- превью ---------- */
  function draw() {
    var it = item();
    if (!it || !video.videoWidth) return;
    var o = outSize(it), p = AV.previewSize(o.w, o.h, 720);
    if (pv.width !== p.w || pv.height !== p.h) { pv.width = p.w; pv.height = p.h; }
    var t = video.currentTime;
    AV.renderAt(pctx, p.w, p.h, video, Object.assign(rparams(it), {
      outDur: (it.end - it.start) / S.speed, fadeIn: S.fadeIn, fadeOut: S.fadeOut
    }), t, Math.max(0, (t - it.start) / S.speed));
    $('#timeLbl').textContent = fmtTime(t);
    if (document.activeElement !== $('#seek')) $('#seek').value = t;
  }
  function updateInfo() {
    var it = item(); if (!it) return;
    var o = outSize(it);
    $('#info').textContent = it.vw + '×' + it.vh + ' → ' + o.w + '×' + o.h + ' · ' + fmtTime((it.end - it.start) / S.speed);
    renderQueue();
  }
  video.addEventListener('seeked', draw);
  video.addEventListener('loadeddata', draw);
  AV.onVideoFrame(video, function (t) {
    if (busy) return;
    draw();
    var it = item();
    if (it && !video.paused && t >= it.end - 0.03) { video.pause(); video.currentTime = it.start; }
  });
  $('#play').addEventListener('click', function () {
    var it = item(); if (!it || busy) return;
    if (video.paused) {
      if (video.currentTime < it.start || video.currentTime >= it.end - 0.05) video.currentTime = it.start;
      video.playbackRate = S.speed; video.play();
    } else video.pause();
  });
  video.addEventListener('play', function () { $('#play use').setAttribute('href', '#i-pause'); $('#play').setAttribute('aria-label', 'Пауза'); });
  video.addEventListener('pause', function () { $('#play use').setAttribute('href', '#i-play'); $('#play').setAttribute('aria-label', 'Играть'); draw(); });
  $('#seek').addEventListener('input', function () { video.currentTime = parseFloat($('#seek').value); });
  document.addEventListener('keydown', function (e) {
    if (e.key === ' ' && !/INPUT|TEXTAREA|SELECT|BUTTON|SUMMARY/.test(e.target.tagName) && item() && !busy) { e.preventDefault(); $('#play').click(); }
  });

  /* полоса миниатюр под ползунком: рисуется отдельным видео, превью не трогает */
  async function makeStrip(it) {
    var token = ++stripToken, cv = $('#strip'), w = Math.max(240, Math.round(cv.clientWidth || 320));
    var h = 44, N = Math.max(4, Math.min(12, Math.round(w / 56)));
    cv.width = w * 2 / 2; cv.height = h;
    var g = cv.getContext('2d'); g.fillStyle = '#222'; g.fillRect(0, 0, w, h);
    var v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.playsInline = true; v.src = it.url;
    try {
      await new Promise(function (res, rej) { v.onloadeddata = res; v.onerror = rej; setTimeout(rej, 8000); });
      var tw = w / N;
      for (var i = 0; i < N; i++) {
        if (token !== stripToken) return;
        await AV.seekTo(v, Math.min(it.dur - 0.05, (it.dur * (i + 0.5)) / N));
        var k = Math.max(tw / v.videoWidth, h / v.videoHeight), dw = v.videoWidth * k, dh = v.videoHeight * k;
        g.save(); g.beginPath(); g.rect(i * tw, 0, tw, h); g.clip();
        g.drawImage(v, i * tw + (tw - dw) / 2, (h - dh) / 2, dw, dh); g.restore();
      }
    } catch (e) { /* миниатюры не обязательны */ }
    v.removeAttribute('src'); v.load();
  }

  /* ---------- фрагмент ---------- */
  $('#start').addEventListener('input', function () {
    var it = item(); if (!it) return;
    it.start = Math.max(0, Math.min(parseFloat($('#start').value), it.end - 0.2));
    $('#start').value = it.start; $('#startLbl').textContent = fmtTime(it.start);
    video.currentTime = it.start; updateInfo(); updateEstimate();
  });
  $('#end').addEventListener('input', function () {
    var it = item(); if (!it) return;
    it.end = Math.min(it.dur, Math.max(parseFloat($('#end').value), it.start + 0.2));
    $('#end').value = it.end; $('#endLbl').textContent = fmtTime(it.end);
    video.currentTime = Math.max(it.start, it.end - 0.1); updateInfo(); updateEstimate();
  });
  $('#setStart').addEventListener('click', function () {
    var it = item(); if (!it) return;
    it.start = Math.min(video.currentTime, it.end - 0.2); syncTrim(it); updateInfo(); updateEstimate();
  });
  $('#setEnd').addEventListener('click', function () {
    var it = item(); if (!it) return;
    it.end = Math.max(video.currentTime, it.start + 0.2); syncTrim(it); updateInfo(); updateEstimate();
  });

  /* ---------- поворот ---------- */
  $('#rotL').addEventListener('click', function () { if (!busy) set('rot', (S.rot + 270) % 360); });
  $('#rotR').addEventListener('click', function () { if (!busy) set('rot', (S.rot + 90) % 360); });
  $('#flipH').addEventListener('click', function () { if (!busy) set('flipH', !S.flipH); });
  $('#flipV').addEventListener('click', function () { if (!busy) set('flipV', !S.flipV); });

  /* ---------- водяной знак ---------- */
  $('#wmPick').addEventListener('click', function () { $('#wmFile').click(); });
  $('#wmFile').addEventListener('change', function () {
    var f = $('#wmFile').files[0]; $('#wmFile').value = '';
    if (!f) return;
    var img = new Image(), url = URL.createObjectURL(f);
    img.onload = function () { wmImg = img; $('#wmImgName').textContent = f.name; set('wmOn', true); draw(); };
    img.onerror = function () { URL.revokeObjectURL(url); toast('Не удалось открыть картинку.', true); };
    img.src = url;
  });

  /* ---------- слежение за лицом ---------- */
  var facesRunning = false;
  function updateFaceStatus() {
    var it = item(), s = $('#faceStatus'), b = $('#faceRun');
    if (!s) return;
    b.disabled = facesRunning || !it || busy;
    if (facesRunning) return;
    s.textContent = !it ? '' : it.track ? 'Лицо найдено: кадр будет следовать за ним.' : it.noFace ? 'Лиц не найдено. Кадр режется по центру.' : 'Ещё не искали.';
  }
  async function runFaces(it) {
    if (facesRunning || !it) return;
    facesRunning = true; updateFaceStatus();
    var s = $('#faceStatus'); s.textContent = 'Подготовка…';
    var fv = document.createElement('video'); fv.muted = true; fv.preload = 'auto'; fv.playsInline = true; fv.src = it.url;
    var ac = new AbortController();
    try {
      await new Promise(function (res, rej) { fv.onloadeddata = res; fv.onerror = rej; setTimeout(function () { rej(new Error('timeout')); }, 15000); });
      var track = await AV.trackFaces({
        start: 0, end: it.dur, step: Math.max(0.5, it.dur / 120), signal: ac.signal,
        grab: async function (t) { await AV.seekTo(fv, t); var o = AV.getOriented(fv, S.rot, S.flipH, S.flipV); return o; },
        onProgress: function (f) { s.textContent = 'Ищу лицо: ' + Math.round(f * 100) + '%'; }
      });
      it.track = track; it.noFace = !track;
      if (!track) toast('Лиц не найдено. Кадр режется по центру.');
    } catch (e) {
      logError(e, 'лица');
      toast('Не получилось запустить поиск лиц: ' + (e && e.message), true);
    } finally {
      fv.removeAttribute('src'); fv.load();
      facesRunning = false; updateFaceStatus(); draw();
    }
  }
  $('#faceRun').addEventListener('click', function () { var it = item(); if (it) { it.track = null; it.noFace = false; runFaces(it); } });

  /* ---------- имя файла, оценка размера ---------- */
  function nextN(index) { return String((+ls.get(COUNT_KEY) || 0) + 1 + (index || 0)).padStart(3, '0'); }
  function fileName(it, o, index, ext) {
    var tpl = S.nameTpl || '{name}';
    if (S.counter && tpl.indexOf('{n}') < 0) tpl += '_{n}';
    var d = new Date(), pad = function (n) { return String(n).padStart(2, '0'); };
    var base = AV.makeName(tpl, {
      name: baseName(it.file), ratio: S.rw + 'x' + S.rh, size: o.w + 'x' + o.h, n: nextN(index),
      date: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    }, S.translit);
    return base + '.' + (ext || 'mp4');
  }
  function updateNamePreview() {
    var it = item(), p = $('#namePrev'); if (!p) return;
    p.textContent = it ? 'Пример: ' + fileName(it, outSize(it), 0) : '';
  }
  function updateEstimate() {
    var it = item(), n = $('#estNote'), w = $('#memWarn'); if (!n) return;
    if (!it) { n.textContent = ''; w.hidden = true; return; }
    var o = outSize(it), dur = (it.end - it.start) / S.speed, est = (bitrateFor(o) + (S.mute ? 0 : 128000)) * dur / 8;
    n.textContent = 'Результат ' + o.w + '×' + o.h + ', ' + S.fps + ' кадров/с, ~' + fmtBytes(est) + ' (' + fmtTime(dur) + ').';
    var warn = '';
    if (!AV.hasOpfs() && est > DEV_MEM * 90 * 1048576) warn = 'Файл получится большим, а запись на диск в этом браузере недоступна: он собирается в памяти. На слабом телефоне может не хватить памяти. Уменьшите размер, битрейт или длину.';
    else if (est > 1.5 * 1073741824) warn = 'Файл получится больше 1,5 ГБ. Для соцсетей лучше уменьшить размер или выбрать «Компактный» битрейт.';
    w.hidden = !warn; w.textContent = warn;
  }

  /* ---------- экспорт ---------- */
  async function lockOn() { try { if (navigator.wakeLock) wl = await navigator.wakeLock.request('screen'); } catch (e) { wl = null; } }
  function lockOff() { try { if (wl) wl.release(); } catch (e) { /* ничего */ } wl = null; }
  document.addEventListener('visibilitychange', function () { if (busy && document.visibilityState === 'visible' && (!wl || wl.released)) lockOn(); });

  function showProgress(on) {
    $('#progress').hidden = !on;
    document.body.classList.toggle('progress-on', on);
  }
  function setProgress(title, frac, text) {
    $('#pTitle').textContent = title;
    $('#pBar').style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
    $('#pPct').textContent = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
    $('#pText').textContent = text || '';
  }
  function setBusy(b) {
    busy = b;
    $$('#colSettings input, #colSettings button, #saveBtn, #saveAllBtn, #addMore, #prevItem, #nextItem, #play').forEach(function (x) {
      if (x.closest('#settingsTabs')) return;
      x.disabled = b;
    });
    if (!b) { renderQueue(); updateFaceStatus(); }
  }
  $('#pCancel').addEventListener('click', function () { if (abort) abort.abort(); });

  async function exportOne(it, qi, qn) {
    var o = outSize(it), title = qn > 1 ? 'Видео ' + (qi + 1) + ' из ' + qn : 'Сохраняю видео';
    if (S.mode === 'crop' && S.faceTrack && !it.track && !it.noFace) {
      setProgress(title, 0, 'Ищу лицо…');
      await runFaces(it);
    }
    var common = {
      video: video, file: it.file, W: o.w, H: o.h, fps: S.fps, bitrate: bitrateFor(o),
      start: it.start, end: it.end, speed: S.speed, r: rparams(it), mute: S.mute,
      vol: S.vol / 100, norm: S.norm, fadeIn: S.fadeIn, fadeOut: S.fadeOut,
      onProgress: function (f, t) { setProgress(title, f, t); }, signal: abort.signal
    };
    var res;
    if (AV.canWebCodecs()) {
      try { res = await AV.exportMp4(common); }
      catch (err) {
        if (err && err.aborted) throw err;
        if (err && /Не хватает места/.test(err.message)) throw err;
        if (!err || err.message !== 'NO_H264') logError(err, 'WebCodecs');
        if (abort.signal.aborted) throw err;
        toast('Быстрый режим недоступен. Идёт запись в реальном времени, не закрывайте вкладку.', false, { ms: 5000 });
        res = await AV.exportRealtime(common);
      }
    } else {
      toast('Быстрый режим недоступен в этом браузере. Идёт запись в реальном времени, не закрывайте вкладку.', false, { ms: 5000 });
      res = await AV.exportRealtime(common);
    }
    res.o = o;
    return res;
  }

  async function runQueue(all) {
    if (busy || !item()) return;
    var items = all ? Q.slice() : [item()], startCur = cur;
    abort = new AbortController();
    var dir = null;
    if (S.toFolder && window.showDirectoryPicker) {
      try { dir = await window.showDirectoryPicker({ mode: 'readwrite' }); }
      catch (e) { toast('Папка не выбрана: файлы будут в списке «Готовые видео».'); }
    }
    setBusy(true); showProgress(true); setProgress('Старт', 0, 'Подготовка…'); lockOn();
    var done = 0, lastErr = null;
    try {
      for (var i = 0; i < items.length; i++) {
        var it = items[i], qi = Q.indexOf(it);
        if (qi !== cur) { await select(qi); }
        video.pause();
        var res;
        try { res = await exportOne(it, i, items.length); }
        catch (err) {
          if (err && err.aborted) throw err;
          lastErr = err; logError(err, 'экспорт');
          toast('«' + it.name + '»: ' + ((err && err.message) || err), true);
          continue;
        }
        var name = fileName(it, res.o, i, res.ext), saved = false;
        if (dir) {
          try {
            var fh = await dir.getFileHandle(name, { create: true }), w = await fh.createWritable();
            await w.write(res.blob); await w.close(); saved = true;
          } catch (e2) { logError(e2, 'папка'); toast('В папку записать не удалось, файл в списке ниже.', true); }
        }
        ls.set(COUNT_KEY, String((+ls.get(COUNT_KEY) || 0) + 1));
        addResult({ name: name, blob: res.blob, url: URL.createObjectURL(res.blob), o: res.o, warnings: res.warnings, ext: res.ext, saved: saved, streamed: res.streamed });
        done++;
      }
      if (done) toast(done > 1 ? 'Готово: ' + done + ' видео' : 'Видео готово');
      else if (!lastErr) toast('Ничего не сохранено.');
    } catch (err2) {
      if (err2 && err2.aborted) toast('Сохранение отменено.');
      else { logError(err2, 'экспорт'); toast('Не получилось: ' + ((err2 && err2.message) || err2), true); }
    } finally {
      lockOff(); showProgress(false); setBusy(false);
      if (startCur >= 0 && startCur < Q.length && startCur !== cur) await select(startCur); else { video.currentTime = item() ? item().start : 0; draw(); }
      document.dispatchEvent(new CustomEvent('avsaved'));
    }
  }
  $('#saveBtn').addEventListener('click', function () { runQueue(false); });
  $('#saveAllBtn').addEventListener('click', function () { runQueue(true); });

  /* ---------- результаты ---------- */
  function addResult(r) {
    results.unshift(r);
    var list = $('#resultList'); list.replaceChildren();
    results.forEach(function (x) {
      var row = el('div', 'res-row'), info = el('div', 'res-info');
      info.append(el('b', '', x.name), el('small', '', x.o.w + '×' + x.o.h + ' · ' + fmtBytes(x.blob.size) + (x.saved ? ' · сохранено в папку' : '') + (x.streamed ? ' · записано на диск' : '')));
      var acts = el('div', 'res-acts');
      var watch = el('button', 'btn btn-outlined btn-sm', 'Смотреть'); watch.type = 'button';
      watch.addEventListener('click', function () { var v = $('#resultVideo'); v.hidden = false; v.src = x.url; v.play().catch(function () { /* ждём нажатия */ }); v.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
      var dl = el('a', 'btn btn-tonal btn-sm', 'Скачать'); dl.href = x.url; dl.download = x.name;
      acts.append(watch, dl);
      var f = new File([x.blob], x.name, { type: x.blob.type || 'video/mp4' });
      if (navigator.canShare && navigator.canShare({ files: [f] })) {
        var sh = el('button', 'btn btn-outlined btn-sm', 'Поделиться'); sh.type = 'button';
        sh.addEventListener('click', function () { navigator.share({ files: [f] }).catch(function () { /* отменено */ }); });
        acts.append(sh);
      }
      row.append(info, acts); list.appendChild(row);
    });
    var warns = []; results.slice(0, 1).forEach(function (x) { (x.warnings || []).forEach(function (w) { warns.push(w); }); });
    if (r.ext === 'webm') warns.push('Браузер записал WebM: на некоторых устройствах такой файл открывается не везде.');
    var n = $('#resultNote'); n.hidden = !warns.length; n.textContent = warns.join(' ');
    $('#resultCard').hidden = false;
    $('#resultCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('#clearResults').addEventListener('click', function () {
    results.forEach(function (r) { URL.revokeObjectURL(r.url); });
    results.length = 0; $('#resultList').replaceChildren();
    var v = $('#resultVideo'); v.pause(); v.removeAttribute('src'); v.hidden = true;
    $('#resultCard').hidden = true;
    AV.cleanOpfs();                        // файлы на диске нужны, пока результаты в списке
    toast('Список очищен, место освобождено');
  });

  /* ---------- кадр как картинка ---------- */
  function snap(type) {
    var it = item(); if (!it || busy) return;
    var o = outSize(it), c = document.createElement('canvas'); c.width = o.w; c.height = o.h;
    var t = video.currentTime;
    AV.renderAt(c.getContext('2d', { alpha: false }), o.w, o.h, video, Object.assign(rparams(it), { outDur: (it.end - it.start) / S.speed, fadeIn: 0, fadeOut: 0 }), t, Math.max(0, (t - it.start) / S.speed));
    c.toBlob(function (b) {
      if (!b) { toast('Не получилось сохранить кадр.', true); return; }
      var url = URL.createObjectURL(b);
      download(url, baseName(it.file) + '_кадр_' + fmtTime(t).replace(':', '-').replace('.', '_') + (type === 'png' ? '.png' : '.jpg'));
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }, type === 'png' ? 'image/png' : 'image/jpeg', 0.93);
  }
  $('#snapPng').addEventListener('click', function () { snap('png'); });
  $('#snapJpg').addEventListener('click', function () { snap('jpg'); });

  /* ---------- старт ---------- */
  $('#folderCard').hidden = !window.showDirectoryPicker;
  if (!window.showDirectoryPicker && S.toFolder) set('toFolder', false, true);
  setTab(['frame', 'video', 'wm', 'export', 'components', 'about'].indexOf(ls.get(TAB_KEY)) >= 0 ? ls.get(TAB_KEY) : 'frame');
  syncUI();
  AV.cleanOpfs();
  window.AVApp = {
    Q: function () { return Q; }, select: select, addFiles: addFiles, runQueue: runQueue, results: function () { return results; },
    runFaces: function () { return runFaces(item()); }, outSize: function () { return outSize(item()); }, setTab: setTab
  };
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(function () { /* офлайн не включится */ });
})();
