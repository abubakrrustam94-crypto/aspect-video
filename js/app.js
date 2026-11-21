'use strict';
/* Aspect Studio Video — интерфейс: очередь, превью, настройки, экспорт */
(function () {
  /* смешанные версии (index.html из старого кэша, скрипты новые): не стартуем, heal.js сам очистит кэш и перезагрузит страницу */
  var mv = document.querySelector('meta[name="av-version"]');
  if (mv && typeof APP_VERSION !== 'undefined' && mv.content !== APP_VERSION) return;
  var AV = window.AV;
  var video = $('#video'), pv = $('#preview'), pctx = pv.getContext('2d', { alpha: false });
  var Q = [], cur = -1, uid = 0;
  var busy = false, abort = null, wmImg = null, wl = null, stripToken = 0;
  var results = [], FS = null;
  var VIDEO_EXT = /\.(mp4|m4v|mov|mkv|webm|avi|3gp|ts|mts|m2ts|ogv)$/i;

  /* ---------- вспомогательное ---------- */
  function item() { return Q[cur] || null; }
  function wmObj() {
    return { on: S.wmOn, type: S.wmType, text: S.wmText, color: S.wmColor, shadow: S.wmShadow, opacity: S.wmOpacity,
      size: S.wmSize, pos: S.wmPos, margin: S.wmMargin, angle: S.wmAngle, when: S.wmWhen, sec: S.wmSec };
  }
  /* shortOver и fmtOver нужны предпросмотру результата: он меньше и всегда MP4/WebM */
  function outSize(it, shortOver, fmtOver) {
    var o = AV.orientedSize(it.vw, it.vh, it.rot), f = fmtOver || S.format;
    return AV.computeSize(S.rw, S.rh, shortOver != null ? shortOver : (f === 'gif' ? Math.min(S.short || 480, 480) : S.short), o.w, o.h);
  }
  /* отрезки исходника, которые попадут в результат: целый фрагмент или куски между вырезанными паузами */
  function segsOf(it) { return it.cuts && it.cuts.length ? it.cuts : [[it.start, it.end]]; }
  function srcDur(it) { return segsOf(it).reduce(function (a, g) { return a + (g[1] - g[0]); }, 0); }
  function durOf(it) { return srcDur(it) / S.speed; }
  function groupDur(items) { return items.reduce(function (a, it) { return a + durOf(it); }, 0); }
  function outFps(dur) { return S.format === 'gif' ? (dur * 15 <= 900 ? 15 : 10) : S.fps; }
  function stabOk(it) {
    return !!(it.stab && it.stab.level === S.stab && it.stab.from <= it.start + 0.05 && it.stab.to >= it.end - 0.05);
  }
  function rparams(it) {
    return {
      rot: it.rot, fh: it.fh, fv: it.fv, mode: S.mode, color: S.color,
      focusAt: S.mode === 'crop' && S.faceTrack && it.track ? function (t) { return AV.focusAt(it.track, t); } : null,
      stab: S.stab && stabOk(it) ? it.stab : null,
      caps: it.caps && it.caps.length ? it.caps : null,
      capStyle: { pos: S.capPos, size: S.capSize, color: S.capColor, box: S.capBox },
      wm: wmObj(), wmImg: wmImg
    };
  }
  /* dur — длина результата в секундах. При лимите размера битрейт считается из него: 90 % лимита на видео и звук, остальное — запас на контейнер и неточность кодека */
  function bitrateFor(o, fps, dur, clip) {
    if (S.target && !clip && S.format !== 'gif' && dur > 0)
      return Math.max(100000, Math.min(60000000, Math.floor((S.target * 1048576 * 8 * 0.9) / dur - (S.mute ? 0 : 128000))));
    return Math.max(1000000, Math.min(60000000, Math.round(o.w * o.h * (fps || S.fps) * S.quality)));
  }
  function baseName(f) { return (f.name || 'video').replace(/\.[^.]+$/, ''); }
  function download(url, name) {
    var a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------- привязка настроек к элементам ---------- */
  function syncUI() {
    if (window.AV && AV.renderInfo && window.AVTab === 'info') AV.renderInfo(item());
    var tm = $('#targetMb'); if (tm && document.activeElement !== tm) tm.value = [0, 10, 25, 50, 100].indexOf(S.target) >= 0 ? '' : S.target;
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
    var cit = item(), fhOn = cit ? cit.fh : S.flipH, fvOn = cit ? cit.fv : S.flipV;
    $('#flipH').setAttribute('aria-pressed', fhOn); $('#flipH').classList.toggle('active', fhOn);
    $('#flipV').setAttribute('aria-pressed', fvOn); $('#flipV').classList.toggle('active', fvOn);
    $('#rotAll').hidden = Q.length < 2;
    $('#smoothRow').hidden = S.speed >= 1;
    $('#colorRow').hidden = S.mode !== 'color';
    $('#faceRow').hidden = S.mode !== 'crop';
    $('#tapNote').hidden = !(S.faceMode === 'tap' && S.faceTrack);
    updateFmtNote();
    $('#modeNote').textContent = {
      blur: 'Поля заполняются размытой копией самого видео.',
      mirror: 'За краями кадра продолжается отражение видео.',
      color: 'Поля заливаются выбранным цветом.',
      smart: 'Поля продолжают цвета края кадра и темнеют к краю экрана: похоже на подсветку.',
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
    if (k === '*') Q.forEach(function (it) { it.track = null; it.noFace = false; it.stab = null; });   // поворот у каждого видео свой и от наборов не меняется
    if (k === 'faceMode' || k === 'trackObj') Q.forEach(function (it) { it.track = null; it.noFace = false; });
    if (k === 'faceMode' && S.faceMode === 'tap' && S.faceTrack) toast('Нажмите на нужного человека в превью.');
    if ((k === 'faceMode' || k === 'trackObj') && S.mode === 'crop' && S.faceTrack && item() && (S.trackObj || S.faceMode !== 'tap')) runFaces(item());
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
    if (g.dataset.group === 'format' && FS && FS[v] === false) { toast('Этот формат не поддерживается в вашем браузере.', true); return; }
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
    b.append(document.createTextNode(p.id), el('small', '', p.hint));
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
  /* активная вкладка всегда по центру полосы (на узком экране видно соседей и ясно, что есть что листать) */
  function centerTab(b) {
    var bar = b.parentNode;
    if (!bar || bar.scrollWidth <= bar.clientWidth) return;
    var to = b.offsetLeft - (bar.clientWidth - b.offsetWidth) / 2;
    try { bar.scrollTo({ left: to, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); } catch (e) { bar.scrollLeft = to; }
  }
  function setTab(name) {
    if (name === 'video') setTimeout(tlStrip, 30);
    window.AVTab = name;
    $$('#settingsTabs [data-tab]').forEach(function (b) {
      var on = b.dataset.tab === name;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
      if (on) centerTab(b);
    });
    $$('#colSettings .card[data-tab]').forEach(function (c) { c.hidden = c.dataset.tab !== name; });
    ls.set(TAB_KEY, name);
    if (name === 'export') updateEstimate();
    if (name === 'info') AV.renderInfo(item());
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
  /* Подсказка, почему видео не открылось и как его перевести */
  var helpCmd = '';
  function showFmtHelp(d, n) {
    helpCmd = d.cmd;
    $('#fmtHelpTitle').textContent = d.title;
    $('#fmtHelpText').textContent = d.text + (n > 1 ? ' Не открылось файлов: ' + n + '.' : '');
    $('#fmtHelpCmd').textContent = d.cmd;
    $('#fmtHelp').hidden = false;
  }
  $('#fmtHelpClose').addEventListener('click', function () { $('#fmtHelp').hidden = true; });
  $('#fmtHelpCopy').addEventListener('click', async function () {
    try { await navigator.clipboard.writeText(helpCmd); toast('Команда скопирована. В Termux сначала: pkg install ffmpeg'); }
    catch (e) { toast('Не удалось скопировать: выделите команду вручную.', true); }
  });
  async function addFiles(files) {
    var list = Array.prototype.filter.call(files, function (f) { return (f.type && f.type.indexOf('video/') === 0) || VIDEO_EXT.test(f.name); });
    if (!list.length) { toast('Это не видео. Выберите видеофайл.', true); return; }
    var first = Q.length === 0, added = 0, failed = [];
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      try {
        var p = await probe(f);
        Q.push({ id: ++uid, file: f, url: p.url, name: f.name, vw: p.vw, vh: p.vh, dur: p.dur, start: 0, end: p.dur, track: null, noFace: false, caps: [], cuts: null, stab: null, tap: null, sound: null, rot: S.rot, fh: S.flipH, fv: S.flipV });
        added++;
        (function (qi) { AV.readMeta(f, { vw: qi.vw, vh: qi.vh, dur: qi.dur }).then(function (m) { qi.meta = m; if (item() === qi) AV.renderInfo(qi); }); })(Q[Q.length - 1]);
      } catch (err) {
        toast('Не удалось открыть «' + f.name + '». Так бывает с HEVC/H.265, AVI и MKV: переведите в MP4 (H.264) или откройте в Chrome.', true);
        logError('Не открылся файл (' + (f.type || 'тип неизвестен') + ', ' + fmtBytes(f.size) + '): ' + (err && err.message), 'файл');
        failed.push(f);
      }
    }
    if (failed.length) AV.diagnose(failed[failed.length - 1]).then(function (d) { showFmtHelp(d, failed.length); }).catch(function () { /* подсказка не обязательна */ });
    if (!added) return;
    $('#uploadZone').hidden = true; $('#resumeBar').hidden = true;
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
      b.append(el('b', '', it.name), el('small', '', it.vw + '×' + it.vh + ' · ' + fmtTime(srcDur(it))));
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
      updateFaceStatus(); updateEstimate(); updateNamePreview(); renderCaps();
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
    syncUI(); updateInfo(); draw(); renderCaps(); updateStabStatus(); updateSilStatus(); renderScenes(); AV.renderInfo(it);
    makeStrip(it);
    if (S.mode === 'crop' && S.faceTrack && !it.track && !it.noFace) runFaces(it);
  }
  function syncTrim(it) {
    [$('#start'), $('#end'), $('#seek')].forEach(function (r) { r.max = it.dur; });
    $('#start').value = it.start; $('#end').value = it.end;
    $('#startLbl').textContent = fmtTime(it.start); $('#endLbl').textContent = fmtTime(it.end);
    tlPaint(it);
  }

  /* ---------- превью ---------- */
  function draw() {
    var it = item();
    if (!it || !video.videoWidth) return;
    var o = outSize(it), p = AV.previewSize(o.w, o.h, 720);
    if (pv.width !== p.w || pv.height !== p.h) { pv.width = p.w; pv.height = p.h; }
    var t = video.currentTime;
    AV.renderAt(pctx, p.w, p.h, video, Object.assign(rparams(it), {
      outDur: durOf(it), fadeIn: S.fadeIn, fadeOut: S.fadeOut
    }), t, Math.max(0, (t - it.start) / S.speed));
    if (S.mode === 'crop' && S.faceTrack && S.faceMode === 'tap' && it.tap && AV.layout) {
      var L = AV.layout, mx = L.x + it.tap.x * L.dw, my = L.y + it.tap.y * L.dh, rr = Math.max(8, p.w * 0.03);
      pctx.save(); pctx.lineWidth = Math.max(2, p.w * 0.006);
      pctx.strokeStyle = 'rgba(0,0,0,.7)'; pctx.beginPath(); pctx.arc(mx, my, rr + pctx.lineWidth, 0, 6.2832); pctx.stroke();
      pctx.strokeStyle = '#fff'; pctx.beginPath(); pctx.arc(mx, my, rr, 0, 6.2832); pctx.stroke(); pctx.restore();
    }
    $('#timeLbl').textContent = fmtTime(t);
    if (document.activeElement !== $('#seek')) $('#seek').value = t;
  }
  function updateInfo() {
    var it = item(); if (!it) return;
    var o = outSize(it);
    $('#info').textContent = it.vw + '×' + it.vh + ' → ' + o.w + '×' + o.h + ' · ' + fmtTime(durOf(it)) + (it.cuts ? ' (паузы вырезаны)' : '');
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
  /* Горячие клавиши: пробел — пуск/пауза; ← → — кадр назад/вперёд (с Shift — секунда); I и O — начало и конец; S — сохранить */
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || !item() || busy || document.querySelector('.modal:not([hidden])')) return;
    var tg = e.target, tag = tg.tagName;
    if (/TEXTAREA|SELECT/.test(tag) || (tag === 'INPUT' && tg.type !== 'checkbox') || (tg.isContentEditable)) return;
    var k = e.key;
    if (k === ' ') { if (/^(INPUT|BUTTON|SUMMARY|A)$/.test(tag)) return; e.preventDefault(); $('#play').click(); return; }
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      if (tg.closest && tg.closest('[role="tablist"],[role="group"]')) return;     // стрелки там нужны для переключения
      e.preventDefault(); video.pause();
      var d = (k === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : 1 / 30);
      video.currentTime = Math.max(0, Math.min(item().dur, video.currentTime + d));
      return;
    }
    if (/^(INPUT|BUTTON|SUMMARY|A)$/.test(tag) && tag !== 'BUTTON') return;
    if (k === 'i' || k === 'I') { e.preventDefault(); $('#setStart').click(); }
    else if (k === 'o' || k === 'O') { e.preventDefault(); $('#setEnd').click(); }
    else if (k === 's' || k === 'S') { e.preventDefault(); $('#saveBtn').click(); }
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
    if (token === stripToken) tlStrip();
  }

  /* ---------- фрагмент ---------- */
  /* ---------- полоса обрезки: два края и бегунок ---------- */
  function tlPaint(it) {
    var tl = $('#tl'); if (!tl) return;
    it = it || item(); if (!it || !(it.dur > 0)) return;
    var a = it.start / it.dur * 100, b = it.end / it.dur * 100, t = Math.min(1, Math.max(0, (video.currentTime || 0) / it.dur)) * 100;
    tl.querySelector('.tl-l').style.width = a + '%'; tl.querySelector('.tl-r').style.width = (100 - b) + '%';
    tl.querySelector('.tl-s').style.left = a + '%'; tl.querySelector('.tl-e').style.left = b + '%';
    tl.querySelector('.tl-head').style.left = t + '%';
  }
  function tlStrip() {                                 // картинка полосы берётся из ленты кадров под превью
    var src = $('#strip'), dst = $('#tlStrip'); if (!src || !dst) return;
    var w = Math.max(240, Math.round(dst.clientWidth || 320)); dst.width = w; dst.height = 44;
    try { dst.getContext('2d').drawImage(src, 0, 0, src.width, src.height, 0, 0, w, 44); } catch (e) { /* ничего */ }
  }
  (function () {
    var tl = $('#tl'), drag = null;
    function tOf(ev) { var r = tl.getBoundingClientRect(), it = item(); return it ? Math.min(it.dur, Math.max(0, (ev.clientX - r.left) / r.width * it.dur)) : 0; }
    tl.addEventListener('pointerdown', function (ev) {
      var it = item(); if (!it || busy) return;
      var r = tl.getBoundingClientRect(), x = ev.clientX - r.left, xs = it.start / it.dur * r.width, xe = it.end / it.dur * r.width;
      var ds = Math.abs(x - xs), de = Math.abs(x - xe);
      drag = ds <= 22 || de <= 22 ? (ds <= de ? 'start' : 'end') : 'seek';
      try { tl.setPointerCapture(ev.pointerId); } catch (e) { /* ничего */ }
      move(ev); ev.preventDefault();
    });
    function move(ev) {
      var it = item(); if (!it || !drag) return;
      var t = tOf(ev);
      if (drag === 'seek') { video.currentTime = Math.min(it.end, Math.max(it.start, t)); tlPaint(it); return; }
      var inp = drag === 'start' ? $('#start') : $('#end');
      inp.value = t; inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
    tl.addEventListener('pointermove', move);
    function stop() { drag = null; }
    tl.addEventListener('pointerup', stop); tl.addEventListener('pointercancel', stop);
    video.addEventListener('timeupdate', function () { tlPaint(); });
    window.addEventListener('resize', tlStrip);
  })();

  $('#start').addEventListener('input', function () {
    var it = item(); if (!it) return;
    it.cuts = null; it.start = Math.max(0, Math.min(parseFloat($('#start').value), it.end - 0.2));
    $('#start').value = it.start; $('#startLbl').textContent = fmtTime(it.start);
    video.currentTime = it.start; updateInfo(); updateEstimate();
  });
  $('#end').addEventListener('input', function () {
    var it = item(); if (!it) return;
    it.cuts = null; it.end = Math.min(it.dur, Math.max(parseFloat($('#end').value), it.start + 0.2));
    $('#end').value = it.end; $('#endLbl').textContent = fmtTime(it.end);
    video.currentTime = Math.max(it.start, it.end - 0.1); updateInfo(); updateEstimate();
  });
  $('#setStart').addEventListener('click', function () {
    var it = item(); if (!it) return;
    it.cuts = null; it.start = Math.min(video.currentTime, it.end - 0.2); syncTrim(it); updateInfo(); updateEstimate();
  });
  $('#setEnd').addEventListener('click', function () {
    var it = item(); if (!it) return;
    it.cuts = null; it.end = Math.max(video.currentTime, it.start + 0.2); syncTrim(it); updateInfo(); updateEstimate();
  });

  /* ---------- поворот ---------- */
  /* поворот относится к выбранному видео; последний выбор запоминается как значение для новых видео */
  function orientChanged(it) {
    it.track = null; it.noFace = false; it.stab = null; it.tap = null;
    set('rot', it.rot, true); set('flipH', it.fh, true); set('flipV', it.fv, true);
    syncUI(); updateInfo(); draw();
    if (S.mode === 'crop' && S.faceTrack && S.faceMode !== 'tap') runFaces(it);
  }
  $('#rotL').addEventListener('click', function () { var it = item(); if (!busy && it) { it.rot = (it.rot + 270) % 360; orientChanged(it); } });
  $('#rotR').addEventListener('click', function () { var it = item(); if (!busy && it) { it.rot = (it.rot + 90) % 360; orientChanged(it); } });
  $('#flipH').addEventListener('click', function () { var it = item(); if (!busy && it) { it.fh = !it.fh; orientChanged(it); } });
  $('#flipV').addEventListener('click', function () { var it = item(); if (!busy && it) { it.fv = !it.fv; orientChanged(it); } });
  $('#rotAll').addEventListener('click', function () {
    var c = item(); if (!c || busy) return;
    Q.forEach(function (it) { if (it !== c) { it.rot = c.rot; it.fh = c.fh; it.fv = c.fv; it.track = null; it.noFace = false; it.stab = null; it.tap = null; } });
    syncUI(); updateInfo(); renderQueue(); toast('Поворот применён ко всем видео: ' + Q.length);
  });

  /* ---------- водяной знак ---------- */
  $('#wmPick').addEventListener('click', function () { $('#wmFile').click(); });
  $('#wmFile').addEventListener('change', function () {
    var f = $('#wmFile').files[0]; $('#wmFile').value = '';
    if (!f) return;
    if (f.size > 20 * 1048576) { toast('Картинка знака слишком большая (больше 20 МБ).', true); return; }
    var img = new Image(), url = URL.createObjectURL(f);
    img.onload = function () { if (wmImg && wmImg.src && wmImg.src !== url) URL.revokeObjectURL(wmImg.src); wmImg = img; $('#wmImgName').textContent = f.name; set('wmOn', true); draw(); };
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
    s.textContent = !it ? '' : it.track ? (S.trackObj ? 'Объект найден: кадр будет следовать за ним.' : 'Лицо найдено: кадр будет следовать за ним.') : it.noFace ? 'Лиц не найдено. Кадр режется по центру.' : 'Ещё не искали.';
  }
  async function runFaces(it, sig) {
    if (facesRunning || !it) return;
    facesRunning = true; updateFaceStatus();
    var s = $('#faceStatus'); s.textContent = 'Подготовка…';
    var fv = document.createElement('video'); fv.muted = true; fv.preload = 'auto'; fv.playsInline = true; fv.src = it.url;
    var ac = new AbortController();
    try {
      await new Promise(function (res, rej) { fv.onloadeddata = res; fv.onerror = rej; setTimeout(function () { rej(new Error('timeout')); }, 15000); });
      var track = await (S.trackObj ? AV.trackSalient : AV.trackFaces)({
        start: 0, end: it.dur, step: Math.max(0.5, it.dur / 120), signal: sig || ac.signal, mode: S.faceMode, tap: it.tap,
        grab: async function (t) { await AV.seekTo(fv, t); var o = AV.getOriented(fv, it.rot, it.fh, it.fv); return o; },
        onProgress: function (f) { s.textContent = (S.trackObj ? 'Ищу объект: ' : 'Ищу лицо: ') + Math.round(f * 100) + '%'; }
      });
      it.track = track; it.noFace = !track;
      if (!track) toast(S.trackObj ? 'Заметного объекта не нашлось. Кадр режется по центру.' : 'Лиц не найдено. Кадр режется по центру.');
    } catch (e) {
      if (e && e.aborted) return;                       // отмена экспорта: молча выходим, ошибку не показываем
      logError(e, 'лица');
      toast('Не получилось запустить поиск лиц: ' + (e && e.message), true);
    } finally {
      fv.removeAttribute('src'); fv.load();
      facesRunning = false; updateFaceStatus(); draw();
      var nowIt = item();                              // пока шёл поиск, могли переключиться на другое видео: ему поиск не запускался
      if (!busy && nowIt && nowIt !== it && S.mode === 'crop' && S.faceTrack && S.faceMode !== 'tap' && !nowIt.track && !nowIt.noFace) setTimeout(function () { runFaces(nowIt); }, 0);
    }
  }
  pv.addEventListener('click', function (e) {
    var it = item();
    if (!it || busy || S.mode !== 'crop' || !S.faceTrack || S.faceMode !== 'tap' || !AV.layout) return;
    var r = pv.getBoundingClientRect(), L = AV.layout;
    var cx = ((e.clientX - r.left) / r.width) * pv.width, cy = ((e.clientY - r.top) / r.height) * pv.height;
    it.tap = { x: Math.max(0, Math.min(1, (cx - L.x) / L.dw)), y: Math.max(0, Math.min(1, (cy - L.y) / L.dh)) };
    it.track = null; it.noFace = false; runFaces(it);
  });
  $('#faceRun').addEventListener('click', function () { var it = item(); if (it) { it.track = null; it.noFace = false; runFaces(it); } });

  /* ---------- подписи и субтитры ---------- */
  function renderCaps() {
    var it = item(), box = $('#capList'); box.replaceChildren();
    $('#capClear').disabled = !it || !it.caps.length;
    if (!it) return;
    it.caps.sort(function (a, b) { return a.start - b.start; });
    it.caps.forEach(function (c, i) {
      var row = el('div', 'cap-row'); row.setAttribute('role', 'listitem');
      var tx = el('input'); tx.type = 'text'; tx.value = c.text; tx.maxLength = 200; tx.setAttribute('aria-label', 'Текст подписи ' + (i + 1));
      tx.addEventListener('input', function () { c.text = tx.value; draw(); });
      function num(v, label, key) {
        var n = el('input', 'cap-t'); n.type = 'number'; n.step = '0.1'; n.min = '0'; n.inputMode = 'decimal'; n.value = (Math.round(v * 10) / 10).toString(); n.setAttribute('aria-label', label + ' ' + (i + 1) + ', секунды');
        n.addEventListener('input', function () { var x = parseFloat(n.value); if (isFinite(x) && x >= 0) { c[key] = x; draw(); } });
        n.addEventListener('change', function () { if (c.end <= c.start) c.end = c.start + 0.5; renderCaps(); });
        return n;
      }
      var del = el('button', 'q-x', '✕'); del.type = 'button'; del.setAttribute('aria-label', 'Убрать подпись ' + (i + 1));
      del.addEventListener('click', function () { it.caps.splice(i, 1); renderCaps(); draw(); });
      row.append(tx, num(c.start, 'Начало подписи', 'start'), num(c.end, 'Конец подписи', 'end'), del);
      box.appendChild(row);
    });
  }
  $('#capAdd').addEventListener('click', function () {
    var it = item(); if (!it) { toast('Сначала выберите видео.'); return; }
    var t = video.currentTime;
    it.caps.push({ text: 'Текст', start: t, end: Math.min(it.dur, t + 2.5) });
    renderCaps(); draw();
    var rows = $$('#capList .cap-row'), idx = it.caps.length - 1;
    it.caps.forEach(function (c, i) { if (c.start === t && c.text === 'Текст') idx = i; });
    var inp = rows[idx] && rows[idx].querySelector('input[type=text]'); if (inp) { inp.focus(); inp.select(); }
  });
  $('#capImport').addEventListener('click', function () { if (!item()) toast('Сначала выберите видео.'); else $('#capFile').click(); });
  $('#capFile').addEventListener('change', async function () {
    var f = $('#capFile').files[0]; $('#capFile').value = '';
    var it = item(); if (!f || !it) return;
    if (f.size > 2 * 1048576) { toast('Файл субтитров слишком большой (больше 2 МБ).', true); return; }
    try {
      var list = AV.parseSubs(await f.text());
      if (!list.length) { toast('В файле не нашлось подписей. Нужен формат SRT или VTT.', true); return; }
      list = list.filter(function (c) { return c.start < it.dur; }).slice(0, 500);
      it.caps = it.caps.concat(list); renderCaps(); draw();
      toast('Добавлено подписей: ' + list.length);
    } catch (e) { logError(e, 'субтитры'); toast('Не удалось прочитать файл.', true); }
  });
  /* автосубтитры: Whisper на устройстве */
  var capAbort = null;
  $('#capAuto').addEventListener('click', async function () {
    var it = item(); if (!it || busy) { if (!it) toast('Сначала выберите видео.'); return; }
    capAbort = new AbortController(); setBusy(true); showProgress(true); setProgress('Распознаю речь', 0, 'Подготовка…'); lockOn();
    var title = 'Распознаю речь';
    try {
      var list = await AV.transcribe(it.file, it.dur, it.start, it.end, { lang: $('#capLang').value, signal: capAbort.signal, onProgress: function (f, t) { setProgress(title, f, t); } });
      if (!list.length) { toast('Речь не найдена. Если в ролике говорят тихо, подними громкость или выбери язык вручную.', true); }
      else { it.caps = it.caps.concat(list.slice(0, 500)); renderCaps(); draw(); toast('Распознано подписей: ' + list.length + '. Проверь текст: нейросеть бывает неточной.'); }
    } catch (err) {
      if (err && err.message === 'abort') toast('Распознавание остановлено.');
      else { logError(err, 'субтитры (речь)'); toast('Не получилось: ' + ((err && err.message) || err), true); }
    } finally { AV.stopWhisper(); capAbort = null; lockOff(); showProgress(false); setBusy(false); }
  });
  $('#infoCopy').addEventListener('click', function () {
    var it = item(); if (!it || !it.meta) return;
    var text = AV.metaText(it.meta);
    (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { toast('Скопировано'); }, function () { toast('Не удалось скопировать. Выделите текст вручную.', true); });
  });
  $('#capClear').addEventListener('click', function () { var it = item(); if (it) { it.caps = []; renderCaps(); draw(); } });

  /* ---------- стабилизация ---------- */
  function updateStabStatus() {
    var it = item(), s = $('#stabStatus'); if (!s) return;
    $('#stabRun').disabled = !it || busy || !S.stab || stabBusy;
    if (stabBusy) return;
    s.textContent = !S.stab ? '' : !it ? '' : stabOk(it) ? 'Рассчитано: видно в превью.' : 'Ещё не рассчитано.';
  }
  var stabBusy = false;
  async function runStab(it) {
    if (stabBusy || !it || !S.stab) return;
    stabBusy = true; updateStabStatus();
    var s = $('#stabStatus'); s.textContent = 'Подготовка…';
    var fv = document.createElement('video'); fv.muted = true; fv.preload = 'auto'; fv.playsInline = true; fv.className = 'vhide'; fv.src = it.url; document.body.appendChild(fv);
    try {
      await new Promise(function (res, rej) { fv.onloadeddata = res; fv.onerror = rej; setTimeout(function () { rej(new Error('timeout')); }, 15000); });
      var level = S.stab, from = it.start, to = it.end;
      var st = await AV.analyzeStab({
        start: from, end: to, level: level, signal: busy && abort ? abort.signal : undefined,
        grab: async function (t) { await AV.seekTo(fv, t); return AV.getOriented(fv, it.rot, it.fh, it.fv); },
        onProgress: function (f) { s.textContent = 'Считаю сдвиги: ' + Math.round(f * 100) + '%'; if (busy) setProgress(stabTitle, f * 0.2, 'Стабилизация: ' + Math.round(f * 100) + '%'); }
      });
      it.stab = { track: st.track, zoom: st.zoom, level: level, from: from, to: to };
    } catch (e) {
      if (e && e.aborted) throw e;
      logError(e, 'стабилизация'); toast('Не получилось рассчитать стабилизацию: ' + (e && e.message), true);
    } finally {
      fv.removeAttribute('src'); fv.load(); fv.remove();
      stabBusy = false; updateStabStatus(); draw();
    }
  }
  var stabTitle = '';
  $('#stabRun').addEventListener('click', function () { var it = item(); if (it) { it.stab = null; runStab(it); } });
  onSet(function (k) { if (k === 'stab' || k === '*') updateStabStatus(); });

  /* ---------- скорость устройства ---------- */
  function benchHint() {
    var h = $('#benchHint'), st = $('#benchStatus'), b = AV.benchLoad(); if (!h) return;
    if (!b) { h.textContent = ''; return; }
    var d = new Date(b.at), pad = function (n) { return String(n).padStart(2, '0'); };
    st.textContent = 'Замер от ' + pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + ': около ' + Math.round(b.fps) + ' кадров/с в 720p.';
    var it = item(); if (!it) { h.textContent = ''; return; }
    var o = outSize(it), grp = S.concat && Q.length > 1 ? Q : [it], dur = groupDur(grp), fps = outFps(dur), e = AV.benchEstimate(b, o.w, o.h, fps, dur), msg = 'Ваше видео (' + o.w + '×' + o.h + ', ' + fps + ' кадров/с, ' + fmtTime(dur) + ') сохранится примерно за ' + fmtTime(e.seconds) + '.';
    var tips = [];
    if (e.seconds > Math.max(120, dur * 3)) tips.push('Чтобы быстрее: выберите 720p или 30 кадров/с');
    if (b.fps < 25 && (S.denoise || S.smooth)) tips.push('шумоподавление и плавное замедление на этом устройстве заметно добавят времени');
    h.textContent = msg + (tips.length ? ' ' + tips.join('; ') + '.' : '');
  }
  $('#benchRun').addEventListener('click', async function () {
    var b = this, st = $('#benchStatus'); if (b.disabled || busy) return;
    b.disabled = true; st.textContent = 'Проверяю…';
    try { await AV.benchRun(function (f) { st.textContent = 'Проверяю: ' + Math.round(f * 100) + '%'; }); benchHint(); toast('Замер готов'); }
    catch (e) { logError(e, 'замер'); st.textContent = (e && e.message) || 'Замер не получился.'; toast(st.textContent, true); }
    b.disabled = false;
  });

  /* ---------- сцены ---------- */
  var scAbort = null;
  function renderScenes() {
    var it = item(), list = $('#scList'); if (!list) return;
    list.replaceChildren();
    var has = !!(it && it.scenes && it.scenes.length);
    $('#scActs').hidden = !has || it.scenes.length < 2; $('#scNote').hidden = $('#scActs').hidden;
    if (!has) { if (it && it.scenes) $('#scStatus').textContent = 'Сцены не найдены: ролик снят одним планом.'; return; }
    $('#scStatus').textContent = 'Найдено сцен: ' + it.scenes.length + '.';
    it.scenes.forEach(function (sc, i) {
      var row = el('div', 'sc-row'); row.setAttribute('role', 'listitem');
      var cb = el('input'); cb.type = 'checkbox'; cb.id = 'sc' + i; cb.checked = sc.keep !== false;
      cb.addEventListener('change', function () { sc.keep = cb.checked; });
      var lb = el('label'); lb.htmlFor = cb.id; lb.append(document.createTextNode('Сцена ' + (i + 1) + ' '), el('span', 'mono', fmtTime(sc.start) + ' – ' + fmtTime(sc.end)));
      var go = el('button', 'btn btn-outlined btn-sm'); go.type = 'button'; go.setAttribute('aria-label', 'Показать сцену ' + (i + 1)); go.appendChild(svgIcon('play'));
      go.addEventListener('click', function () { video.currentTime = sc.start; draw(); tlPaint(); });
      row.append(cb, lb, go); list.appendChild(row);
    });
  }
  $('#scRun').addEventListener('click', async function () {
    var it = item(), b = this; if (!it || busy) return;
    if (scAbort) { scAbort.abort(); return; }
    scAbort = new AbortController(); b.textContent = 'Отмена';
    var st = $('#scStatus'), fv = document.createElement('video'); fv.muted = true; fv.preload = 'auto'; fv.playsInline = true; fv.src = it.url;
    try {
      await new Promise(function (res, rej) { fv.onloadeddata = res; fv.onerror = rej; setTimeout(function () { rej(new Error('timeout')); }, 15000); });
      var sc = await AV.findScenes({ video: fv, start: it.start, end: it.end, signal: scAbort.signal, onProgress: function (f) { st.textContent = 'Ищу сцены: ' + Math.round(f * 100) + '%'; } });
      it.scenes = sc.length > 1 ? sc : [];
      if (!sc.length || sc.length < 2) it.scenes = [];
      renderScenes();
      if (!it.scenes.length) toast('Резких смен кадра не нашлось.');
    } catch (e) {
      if (!(e && e.aborted)) { logError(e, 'сцены'); toast('Не получилось найти сцены: ' + ((e && e.message) || e), true); }
      st.textContent = 'Поиск остановлен.';
    } finally { fv.removeAttribute('src'); fv.load(); scAbort = null; b.textContent = 'Найти сцены'; }
  });
  $('#scKeep').addEventListener('click', function () {
    var it = item(); if (!it || busy || !it.scenes) return;
    var iv = [];
    it.scenes.forEach(function (sc) { if (sc.keep === false) return; var l = iv[iv.length - 1]; if (l && Math.abs(sc.start - l[1]) < 0.001) l[1] = sc.end; else iv.push([sc.start, sc.end]); });
    if (!iv.length) { toast('Отметьте хотя бы одну сцену.', true); return; }
    it.start = iv[0][0]; it.end = iv[iv.length - 1][1]; it.cuts = iv.length > 1 ? iv : null;
    syncTrim(it); video.currentTime = it.start; updateInfo(); updateEstimate(); draw();
    if (it.cuts) updateSilStatus();
    toast(iv.length > 1 ? 'Оставлено кусков: ' + iv.length : 'Оставлена одна сцена');
  });
  $('#scSplit').addEventListener('click', function () {
    var it = item(); if (!it || busy || !it.scenes) return;
    var m = /^(.*?)(\.[^.]*)?$/.exec(it.name), at = cur + 1, n = 0;
    it.scenes.forEach(function (sc, i) {
      if (sc.keep === false) return;
      var c = Object.assign({}, it, { id: ++uid, url: URL.createObjectURL(it.file), name: m[1] + '_сцена' + (i + 1) + (m[2] || ''), start: sc.start, end: sc.end, cuts: null, scenes: null, caps: it.caps ? it.caps.slice() : [] });
      Q.splice(at++, 0, c); n++;
    });
    if (!n) { toast('Отметьте хотя бы одну сцену.', true); return; }
    renderQueue(); updateEstimate(); toast('В очередь добавлено видео: ' + n);
  });

  /* ---------- тишина ---------- */
  function updateSilStatus() {
    var it = item(), s = $('#silStatus'); if (!s) return;
    if (!it || !it.cuts) return;
    s.textContent = 'Оставлено кусков: ' + it.cuts.length + ', длина ' + fmtTime(srcDur(it)) + ' из ' + fmtTime(it.dur) + '. В превью ролик играет целиком, паузы убираются при сохранении.';
  }
  async function soundOf(it) {
    if (!it.sound) it.sound = await AV.analyzeAudio(it.file, it.dur);
    return it.sound;
  }
  function silRun(kind) {
    var it = item(), s = $('#silStatus'); if (!it || busy) return;
    var btns = $$('#silCard button'); btns.forEach(function (b) { b.disabled = true; });
    s.textContent = 'Анализирую звук…';
    soundOf(it).then(function (an) {
      var clip = function (a) { return a.map(function (x) { return [Math.max(it.start, x[0]), Math.min(it.end, x[1])]; }).filter(function (x) { return x[1] - x[0] >= 0.2; }); };
      var iv = clip((S.silSpeech ? AV.speechIntervals : AV.soundIntervals)(an, 0.7, 0.12));
      if (!iv.length && S.silSpeech) {                  // речи нет (музыка, шум): ищем по громкости, как раньше
        iv = clip(AV.soundIntervals(an, 0.7, 0.12));
        if (iv.length) toast('Речи не нашлось, паузы ищу по громкости.');
      }
      if (!iv.length) { s.textContent = 'В выбранном фрагменте не нашлось звука.'; toast('Звук не найден: нечего оставлять.', true); return; }
      var before = srcDur(it);
      it.start = iv[0][0]; it.end = iv[iv.length - 1][1];
      it.cuts = kind === 'cut' && iv.length > 1 ? iv : null;
      syncTrim(it); video.currentTime = it.start; updateInfo(); updateEstimate(); draw();
      var saved = before - srcDur(it);
      s.textContent = saved < 0.2 ? 'Тишины не нашлось, ролик остался как был.' : it.cuts ? '' : 'Убрано по краям: ' + fmtTime(saved) + '.';
      if (it.cuts) updateSilStatus();
    }).catch(function (e) {
      s.textContent = (e && e.message) || 'Не удалось разобрать звук.';
      toast(s.textContent, true);
    }).finally(function () { btns.forEach(function (b) { b.disabled = busy; }); });
  }
  $('#silEdge').addEventListener('click', function () { silRun('edge'); });
  $('#silCut').addEventListener('click', function () { silRun('cut'); });
  $('#silReset').addEventListener('click', function () {
    var it = item(); if (!it || busy) return;
    it.cuts = null; it.start = 0; it.end = it.dur; syncTrim(it); video.currentTime = 0; updateInfo(); updateEstimate(); draw();
    $('#silStatus').textContent = 'Ролик возвращён целиком.';
  });

  /* ---------- формат результата ---------- */
  function updateFmtNote() {
    var n = $('#fmtNote'); if (!n) return;
    var t = { mp4: 'Работает почти везде: телефоны, соцсети, мессенджеры. Звук AAC.',
      webm: 'Для сайтов и Android. Звук Opus. Старые iPhone могут не открыть.',
      gif: 'Без звука. Не больше 480 пикселей по короткой стороне и 15 кадров/с, до 60 секунд. Файл получается большим.' }[S.format] || '';
    if (FS && FS[S.format] === false) t = 'Этот формат не поддерживается в вашем браузере. Выберите другой.';
    n.textContent = t;
    $$('#fmtCard [data-val]').forEach(function (b) { b.setAttribute('aria-disabled', FS && FS[b.dataset.val] === false ? 'true' : 'false'); });
  }
  AV.formatSupport().then(function (r) { FS = r; updateFmtNote(); }).catch(function () { /* оставим как есть */ });

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
    var o = outSize(it), grp = S.concat && Q.length > 1 ? Q : [it], dur = groupDur(grp), fps = outFps(dur);
    var est = S.format === 'gif' ? dur * fps * o.w * o.h * 0.3 : (bitrateFor(o, fps, dur) + (S.mute || S.format === 'gif' ? 0 : 128000)) * dur / 8;
    n.textContent = 'Результат ' + o.w + '×' + o.h + ', ' + fps + ' кадров/с, ~' + fmtBytes(est) + ' (' + fmtTime(dur) + (grp.length > 1 ? ', склейка из ' + grp.length : '') + ').';
    var warn = '';
    if (S.target && S.format !== 'gif' && bitrateFor(o, fps, dur) / (o.w * o.h * fps) < 0.03) warn = 'Для лимита ' + S.target + ' МБ это видео слишком длинное: качество будет низким. Уменьшите размер кадра, обрежьте видео или выберите больший лимит.';
    else if (S.format === 'gif' && dur * fps > 900) warn = 'Для GIF слишком длинно: не больше 90 секунд. Сократите фрагмент или ускорьте видео.';
    else if (!AV.hasOpfs() && est > DEV_MEM * 90 * 1048576) warn = 'Файл получится большим, а запись на диск в этом браузере недоступна: он собирается в памяти. На слабом телефоне может не хватить памяти. Уменьшите размер, битрейт или длину.';
    else if (est > 1.5 * 1073741824) warn = 'Файл получится больше 1,5 ГБ. Для соцсетей лучше уменьшить размер или выбрать «Компактный» битрейт.';
    w.hidden = !warn; w.textContent = warn;
    benchHint();
    var fn = $('#fitNote');
    if (fn) {
      if (S.target && S.format !== 'gif') {
        var bpp = bitrateFor(o, fps, dur) / (o.w * o.h * fps), q = bpp >= 0.07 ? 'хорошее' : bpp >= 0.045 ? 'среднее' : bpp >= 0.03 ? 'низкое' : 'плохое';
        fn.textContent = 'Уложится в ' + S.target + ' МБ. Качество при таком лимите: ' + q + '.';
      } else fn.textContent = '';
    }
  }

  /* ---------- экспорт ---------- */
  async function lockOn() { try { if (navigator.wakeLock) wl = await navigator.wakeLock.request('screen'); } catch (e) { wl = null; } }
  function lockOff() { try { if (wl) wl.release(); } catch (e) { /* ничего */ } wl = null; }
  document.addEventListener('visibilitychange', function () { if (busy && document.visibilityState === 'visible' && (!wl || wl.released)) lockOn(); });

  var pStart = 0, pEta = 0;
  function showProgress(on) {
    if (on) { pStart = Date.now(); pEta = 0; $('#pEta').textContent = ''; }
    $('#progress').hidden = !on;
    document.body.classList.toggle('progress-on', on);
  }
  function setProgress(title, frac, text) {
    $('#pTitle').textContent = title;
    $('#pBar').style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
    $('#pPct').textContent = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
    $('#pText').textContent = text || '';
    /* примерное время: по скорости с начала, со сглаживанием, чтобы цифра не прыгала */
    var f = Math.max(0, Math.min(1, frac)), sec = (Date.now() - pStart) / 1000, eta = $('#pEta');
    if (f >= 0.04 && sec >= 2 && f < 1) {
      var left = sec * (1 - f) / f; pEta = pEta ? pEta * 0.7 + left * 0.3 : left;
      eta.textContent = pEta < 5 ? 'почти готово' : 'осталось ~' + Math.floor(pEta / 60) + ':' + String(Math.round(pEta % 60) % 60).padStart(2, '0');
    } else if (f < 0.04) eta.textContent = 'оцениваю время…';
    else eta.textContent = '';
  }
  function setBusy(b) {
    busy = b;
    $$('#colSettings input, #colSettings button, #saveBtn, #saveAllBtn, #addMore, #prevItem, #nextItem, #play').forEach(function (x) {
      if (x.closest('#settingsTabs')) return;
      x.disabled = b;
    });
    if (!b) { renderQueue(); updateFaceStatus(); }
  }
  $('#pCancel').addEventListener('click', function () { if (abort) abort.abort(); if (capAbort) capAbort.abort(); });

  /* Для экспорта у каждого файла своё скрытое видео: так склейка читает несколько файлов, а превью не мешает */
  var exVids = new Map();
  function exportVideoFor(it) {
    if (exVids.has(it.id)) return exVids.get(it.id).pr;
    var v = document.createElement('video'); v.className = 'vhide'; v.muted = true; v.playsInline = true; v.preload = 'auto';
    var pr = new Promise(function (resolve, reject) {
      v.onloadeddata = function () { AV.primeVideo(v).then(function () { resolve(v); }, function () { resolve(v); }); };
      v.onerror = function () { reject(new Error('Не открылось видео «' + it.name + '».')); };
    });
    exVids.set(it.id, { pr: pr, el: v });
    v.src = it.url; document.body.appendChild(v);
    return pr;
  }
  function releaseExportVideos() {
    exVids.forEach(function (x) { x.el.removeAttribute('src'); x.el.load(); x.el.remove(); });
    exVids.clear();
  }

  /* group — одно видео или несколько (склейка) */
  async function exportGroup(group, title, clip) {
    var i, it;
    for (i = 0; i < group.length; i++) {
      it = group[i];
      if (S.mode === 'crop' && S.faceTrack && !it.track && !it.noFace) { setProgress(title, 0, 'Ищу лицо…'); await runFaces(it, abort.signal); }
      if (S.stab && !stabOk(it)) { stabTitle = title; setProgress(title, 0, 'Стабилизация…'); await runStab(it); }
      if (abort.signal.aborted) { var ae = new Error('Отменено'); ae.aborted = true; throw ae; }
    }
    /* clip = { start, end }: короткий предпросмотр результата. Он меньше, без звука и без затуханий, всегда MP4 (или WebM, если MP4 нет) */
    var fmt = clip ? (FS && FS.mp4 === false ? 'webm' : 'mp4') : S.format;
    var o = outSize(group[0], clip ? Math.min(S.short || 480, 480) : null, fmt);
    var dur = clip ? (clip.end - clip.start) / S.speed : groupDur(group), fps = clip ? Math.min(S.fps, 30) : outFps(dur), segs = [];
    group.forEach(function (g) {
      var r = rparams(g);
      if (clip) { segs.push({ file: g.file, start: clip.start, end: clip.end, dur: g.dur, r: r, load: function () { return exportVideoFor(g); } }); return; }
      segsOf(g).forEach(function (sg) {
        segs.push({ file: g.file, start: sg[0], end: sg[1], dur: g.dur, r: r, load: function () { return exportVideoFor(g); } });
      });
    });
    var common = {
      format: fmt, segs: segs, W: o.w, H: o.h, fps: fps, bitrate: bitrateFor(o, fps, dur, !!clip), speed: S.speed,
      mute: clip ? true : S.mute, vol: S.vol / 100, norm: S.norm, denoise: !clip && S.denoise, dateMode: S.dateMode, metaTitle: S.mTitle, metaGps: S.mGps && group[0] && group[0].meta && group[0].meta.gps ? { lat: group[0].meta.gps.lat, lon: group[0].meta.gps.lon } : null, srcDate: group[0] && group[0].meta && group[0].meta.created ? +group[0].meta.created : 0, smooth: !clip && S.smooth, fadeIn: clip ? 0 : S.fadeIn, fadeOut: clip ? 0 : S.fadeOut,
      tOff: clip ? (clip.start - group[0].start) / S.speed : 0,
      /* для записи в реальном времени (только один цельный отрезок) */
      video: video, file: group[0].file, start: segs[0].start, end: segs[0].end, r: segs[0].r,
      fast: window.AV_NOFAST ? false : undefined, audioStream: window.AV_NOSTREAM ? false : undefined,   // только для проверок
      onProgress: function (f, t) { setProgress(title, f, t); }, signal: abort.signal
    };
    var res, single = segs.length === 1 && group.length === 1;
    try {
      if (fmt === 'mp4' && !AV.canWebCodecs()) throw new Error('NO_H264');
      if (fmt === 'webm' && typeof VideoEncoder === 'undefined') throw new Error('NO_VP9');
      res = await AV.exportMedia(common);
    } catch (err) {
      if (err && err.aborted) throw err;
      if (err && /Не хватает места/.test(err.message)) throw err;
      if (err && err.message === 'NO_VP9') throw new Error('Этот браузер не умеет кодировать WebM. Выберите MP4.');
      if (fmt === 'gif' || fmt === 'webm') throw err;
      if (!err || err.message !== 'NO_H264') logError(err, 'WebCodecs');
      if (abort.signal.aborted) throw err;
      if (!single) throw new Error('Склейка и вырезанные паузы работают только в быстром режиме, а он недоступен в этом браузере.' + (err && err.message && err.message !== 'NO_H264' ? ' (' + err.message + ')' : ''));
      toast('Быстрый режим недоступен. Идёт запись в реальном времени, не закрывайте вкладку.', false, { ms: 5000 });
      res = await AV.exportRealtime(common);
    } finally { releaseExportVideos(); }
    res.o = o; res.fmt = fmt; res.group = group;
    return res;
  }

  async function runQueue(all, opts) {
    opts = opts || {};
    if (busy || !item()) return;
    var items = opts.items || (all ? Q.slice() : [item()]), startCur = cur;
    var groups = opts.groups || (all && S.concat && items.length > 1 ? [items] : items.map(function (x) { return [x]; }));
    var skip = [];
    if (opts.rec) { AV.session.adopt(opts.rec); skip = AV.session.doneSet(); }
    else AV.session.begin(items, groups.map(function (g) { return g.map(function (x) { return items.indexOf(x); }); }));
    abort = new AbortController();
    var dir = null;
    if (S.toFolder && window.showDirectoryPicker) {
      try { dir = await window.showDirectoryPicker({ mode: 'readwrite' }); }
      catch (e) { toast('Папка не выбрана: файлы будут в списке «Готовые видео».'); }
    }
    setBusy(true); showProgress(true); setProgress('Старт', 0, 'Подготовка…'); lockOn();
    var done = 0, lastErr = null;
    try {
      for (var i = 0; i < groups.length; i++) {
        if (skip.indexOf(i) >= 0) { done++; continue; }
        var grp = groups[i], it = grp[0], qi = Q.indexOf(it);
        if (qi !== cur) { await select(qi); }
        video.pause();
        var res, title = grp.length > 1 ? 'Склейка из ' + grp.length + ' видео' : groups.length > 1 ? 'Видео ' + (i + 1) + ' из ' + groups.length : 'Сохраняю видео';
        var tStart = performance.now();
        try { res = await exportGroup(grp, title); }
        catch (err) {
          if (err && err.aborted) throw err;
          lastErr = err; logError(err, 'экспорт');
          toast('«' + it.name + '»: ' + ((err && err.message) || err), true);
          continue;
        }
        if (S.target && res.fmt !== 'gif' && res.blob.size > S.target * 1048576) (res.warnings = res.warnings || []).push('Файл получился ' + fmtBytes(res.blob.size) + ', больше лимита ' + S.target + ' МБ. Уменьшите размер кадра или выберите больший лимит.');
        if (AV.perfAdd) AV.perfAdd({ fmt: res.fmt, w: res.o.w, h: res.o.h, dur: groupDur(grp), ms: performance.now() - tStart, eng: res.engine });
        var name = fileName(it, res.o, 0, res.ext);   // счётчик растёт после каждого сохранения, поэтому сдвиг по номеру группы давал дыры: 001, 003, 005
        if (grp.length > 1) name = name.replace(/(\.[^.]+)$/, '_склейка$1');
        var opfs = res.opfsName || null;
        if (!opfs) { var pb = await AV.persistBlob(res.blob, res.ext); if (pb) { res.blob = pb.blob; opfs = pb.name; } }   // готовое видео переживёт перезапуск и не держит память
        var saved = false;
        if (dir) {
          try {
            var fh = await dir.getFileHandle(name, { create: true }), w = await fh.createWritable();
            await w.write(res.blob); await w.close(); saved = true;
          } catch (e2) { logError(e2, 'папка'); toast('В папку записать не удалось, файл в списке ниже.', true); }
        }
        ls.set(COUNT_KEY, String((+ls.get(COUNT_KEY) || 0) + 1));
        if (AV.afterSave) AV.afterSave();
        await AV.session.done(i, { name: name, opfs: opfs, ext: res.ext, fmt: res.fmt, type: res.blob.type, w: res.o.w, h: res.o.h, warnings: res.warnings, streamed: !!res.streamed });
        addResult({ engine: res.engine, name: name, blob: res.blob, url: URL.createObjectURL(res.blob), o: res.o, warnings: res.warnings, ext: res.ext, fmt: res.fmt, saved: saved, streamed: res.streamed });
        done++;
      }
      if (done) toast(done > 1 ? 'Готово: ' + done + ' видео' : 'Готово');
      else if (!lastErr) toast('Ничего не сохранено.');
    } catch (err2) {
      if (err2 && err2.aborted) toast('Сохранение отменено.');
      else { logError(err2, 'экспорт'); toast('Не получилось: ' + ((err2 && err2.message) || err2), true); }
    } finally {
      AV.session.clear();                 // дошли до конца или отменили: журнал не нужен. После сбоя он остаётся.
      releaseExportVideos();
      lockOff(); showProgress(false); setBusy(false);
      if (startCur >= 0 && startCur < Q.length && startCur !== cur) await select(startCur); else { video.currentTime = item() ? item().start : 0; draw(); }
      document.dispatchEvent(new CustomEvent('avsaved'));
    }
  }
  $('#targetMb').addEventListener('input', function () {
    var v = parseFloat(this.value.replace(',', '.'));
    if (busy) return;
    if (this.value === '') { set('target', 0); return; }
    if (v >= 1 && v <= 5000) set('target', Math.round(v * 10) / 10);
  });
  $('#saveBtn').addEventListener('click', function () { runQueue(false); });
  $('#saveAllBtn').addEventListener('click', function () { runQueue(true); });

  /* ---------- предпросмотр результата ---------- */
  var clipUrl = '', clipOpener = null;
  function clipClose() {
    var v = $('#clipVideo'); v.pause(); v.removeAttribute('src'); v.load();
    if (clipUrl) { URL.revokeObjectURL(clipUrl); clipUrl = ''; }
    $('#clipDlg').hidden = true;
    if (clipOpener && clipOpener.focus) clipOpener.focus();
  }
  $('#clipClose').addEventListener('click', clipClose);
  $('#clipDlg').addEventListener('click', function (e) { if (e.target === $('#clipDlg')) clipClose(); });
  $('#clipDlg').addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.stopPropagation(); clipClose(); }
    else if (e.key === 'Tab') {
      var f = [$('#clipVideo'), $('#clipClose')], i = f.indexOf(document.activeElement);
      e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
  });
  async function runClip() {
    var it = item(); if (busy || !it) return;
    var t = video.currentTime; if (t < it.start || t >= it.end - 0.25) t = it.start;
    var end = Math.min(it.end, t + 3 * S.speed);
    clipOpener = document.activeElement;
    video.pause(); abort = new AbortController();
    setBusy(true); showProgress(true); setProgress('Предпросмотр', 0, 'Подготовка…'); lockOn();
    try {
      var res = await exportGroup([it], 'Предпросмотр', { start: t, end: end });
      var v = $('#clipVideo'); clipUrl = URL.createObjectURL(res.blob); v.src = clipUrl;
      $('#clipNote').textContent = 'Показано ' + fmtTime(end - t) + ' источника с места ' + fmtTime(t) + ': без звука и в уменьшенном размере. Итоговый файл будет в выбранном формате и размере.' +
        (res.warnings && res.warnings.length ? ' ' + res.warnings.join(' ') : '');
      $('#clipDlg').hidden = false; $('#clipClose').focus(); v.play().catch(function () { /* ждём нажатия */ });
    } catch (err) {
      if (err && err.aborted) toast('Предпросмотр отменён.');
      else { logError(err, 'предпросмотр'); toast('Не получилось: ' + ((err && err.message) || err), true); }
    } finally {
      releaseExportVideos(); lockOff(); showProgress(false); setBusy(false);
      video.currentTime = Math.max(it.start, t); draw();
    }
  }
  $('#clipBtn').addEventListener('click', runClip);

  /* ---------- результаты ---------- */
  function zipBtn() { var b = $('#zipAll'); b.hidden = results.length < 2; }
  function addResult(r) {
    results.unshift(r); zipBtn();
    var list = $('#resultList'); list.replaceChildren();
    results.forEach(function (x, i) {
      var card = el('article', 'res-card' + (i === 0 ? ' fresh' : '')), isGif = x.ext === 'gif';
      var th = el('div', 'res-thumb'); th.style.aspectRatio = x.o.w + ' / ' + x.o.h;
      var media;
      if (isGif) { media = el('img'); media.alt = 'Готовая GIF-анимация'; media.src = x.url; }
      else { media = el('video'); media.muted = true; media.playsInline = true; media.preload = 'metadata'; media.src = x.url + '#t=0.1'; media.setAttribute('aria-label', 'Предпросмотр: ' + x.name); }
      th.appendChild(media);
      if (!isGif) {
        var pl = el('button', 'res-play'); pl.type = 'button'; pl.setAttribute('aria-label', 'Смотреть: ' + x.name);
        pl.appendChild(svgIcon('play'));
        pl.addEventListener('click', function () {
          if (media.controls) return;
          $$('.res-thumb video').forEach(function (v) { if (v !== media) { v.pause(); v.controls = false; v.closest('.res-thumb').classList.remove('on'); } });
          media.muted = false; media.controls = true; th.classList.add('on'); media.play().catch(function () { /* ждём нажатия */ });
        });
        th.appendChild(pl);
      }
      var info = el('div', 'res-info');
      var chips = el('div', 'res-chips');
      [(x.ext || 'mp4').toUpperCase(), x.o.w + '×' + x.o.h, fmtBytes(x.blob.size)].forEach(function (t) { chips.appendChild(el('span', 'res-chip', t)); });
      info.append(el('b', '', x.name), chips);
      if (i === 0) info.prepend(el('span', 'res-badge', 'Готово'));
      var extra = (x.saved ? 'Сохранено в папку' : '') + (x.streamed ? (x.saved ? ' · ' : '') + 'Записано на диск' : '');
      if (extra) info.appendChild(el('small', '', extra));
      var chk = el('small', 'res-check', 'Проверяю файл…'); info.appendChild(chk);
      if (x.ext === 'mp4' || x.ext === 'webm') {
        AV.readMeta(new File([x.blob], x.name, { type: x.blob.type }), { vw: x.o.w, vh: x.o.h, dur: 0 }).then(function (m) {
          var bits = [], bad = false;
          if (x.ext === 'mp4') { bad = !m.v || m.v.w !== x.o.w || m.v.h !== x.o.h; if (m.v && m.v.w) bits.push(m.v.w + '×' + m.v.h); }
          if (m.v && m.v.codec) bits.push(m.v.codec); if (m.a && m.a.codec) bits.push(m.a.codec); if (x.ext === 'mp4' && m.dur) bits.push(fmtTime(m.dur));
          chk.textContent = bad ? 'Размер в файле не совпал с ожидаемым: ' + bits.join(' · ') : 'Проверено: ' + (bits.join(' · ') || 'файл читается');
          chk.classList.toggle('bad', bad);
        }).catch(function () { chk.textContent = ''; });
      } else chk.remove();
      var acts = el('div', 'res-acts');
      var dl = el('a', 'btn btn-main', 'Скачать'); dl.href = x.url; dl.download = x.name; dl.prepend(svgIcon('save'));
      acts.append(dl);
      var f = new File([x.blob], x.name, { type: x.blob.type || 'video/mp4' });
      if (navigator.canShare && navigator.canShare({ files: [f] })) {
        var sh = el('button', 'btn btn-tonal', 'Поделиться'); sh.type = 'button';
        sh.addEventListener('click', function () { navigator.share({ files: [f] }).catch(function () { /* отменено */ }); });
        acts.append(sh);
      }
      card.append(th, info, acts); list.appendChild(card);
    });
    var warns = []; results.slice(0, 1).forEach(function (x) { (x.warnings || []).forEach(function (w) { warns.push(w); }); });
    if (r.ext === 'webm' && r.fmt !== 'webm') warns.push('Браузер записал WebM: на некоторых устройствах такой файл открывается не везде.');
    var n = $('#resultNote'); n.hidden = !warns.length; n.textContent = warns.join(' ');
    $('#resultCard').hidden = false;
    $('#resultCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('#zipAll').addEventListener('click', async function () {
    var b = this; if (b.disabled || results.length < 2) return;
    var old = b.textContent; b.disabled = true;
    try {
      var z = await AV.makeZip(results.slice().reverse().map(function (r) { return { name: r.name, blob: r.blob }; }), function (f) { b.textContent = 'Архив ' + Math.round(f * 100) + '%'; });
      var url = URL.createObjectURL(z), d = new Date(), pad = function (n) { return String(n).padStart(2, '0'); };
      download(url, 'aspect-video_' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.zip');
      setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
      toast('Архив готов: ' + results.length + ' видео');
    } catch (e) { logError(e, 'архив'); toast((e && e.message) || 'Не удалось собрать архив', true); }
    b.disabled = false; b.textContent = old;
  });
  $('#clearResults').addEventListener('click', function () {
    $$('#resultList video').forEach(function (v) { v.pause(); v.removeAttribute('src'); v.load(); });
    results.forEach(function (r) { URL.revokeObjectURL(r.url); });
    results.length = 0; $('#resultList').replaceChildren(); zipBtn();
    $('#resultCard').hidden = true;
    AV.cleanOpfs();                        // файлы на диске нужны, пока результаты в списке
    toast('Список очищен, место освобождено');
  });

  /* ---------- кадр как картинка ---------- */
  function snap(type) {
    var it = item(); if (!it || busy) return;
    var o = outSize(it), c = document.createElement('canvas'); c.width = o.w; c.height = o.h;
    var t = video.currentTime;
    AV.renderAt(c.getContext('2d', { alpha: false }), o.w, o.h, video, Object.assign(rparams(it), { outDur: durOf(it), fadeIn: 0, fadeOut: 0 }), t, Math.max(0, (t - it.start) / S.speed));
    c.toBlob(function (b) {
      if (!b) { toast('Не получилось сохранить кадр.', true); return; }
      var url = URL.createObjectURL(b);
      download(url, baseName(it.file) + '_кадр_' + fmtTime(t).replace(':', '-').replace('.', '_') + (type === 'png' ? '.png' : '.jpg'));
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }, type === 'png' ? 'image/png' : 'image/jpeg', 0.93);
  }
  $('#snapPng').addEventListener('click', function () { snap('png'); });
  $('#snapJpg').addEventListener('click', function () { snap('jpg'); });

  /* ---------- продолжение после сбоя ---------- */
  var resumeRec = null;
  async function initResume() {
    var m = await AV.session.load();
    if (!m) return;
    resumeRec = m;
    $('#resumeText').textContent = 'Прошлое сохранение не завершилось: готово ' + m.done.filter(function (d) { return d.opfs; }).length + ' из ' + m.groups.length + '. Готовое останется, остальное сделаем заново.';
    if (!Q.length) $('#resumeBar').hidden = false;
  }
  function pickFiles() {
    return new Promise(function (resolve) {
      var inp = $('#resumeFile'); inp.value = '';
      inp.onchange = function () { resolve(Array.prototype.slice.call(inp.files)); };
      inp.oncancel = function () { resolve([]); };
      inp.click();
    });
  }
  $('#resumeGo').addEventListener('click', async function () {
    var m = resumeRec; if (!m || busy) return;
    if (Q.length) { toast('Сначала уберите видео из списка.', true); return; }
    var files = await AV.session.files(m), need = [];
    files.forEach(function (f, i) { if (!f) need.push(i); });
    if (need.length) {
      toast('Копий видео нет. Выберите те же файлы: ' + need.map(function (i) { return m.items[i].name; }).join(', '));
      var picked = await pickFiles();
      need.forEach(function (i) {
        var f = picked.filter(function (p) { return p.name === m.items[i].name && p.size === m.items[i].size; })[0];
        if (f) files[i] = f;
      });
      if (files.some(function (f) { return !f; })) { toast('Не нашлось нужных файлов. Выберите те же видео.', true); return; }
    }
    await addFiles(files);
    if (Q.length !== m.items.length) { toast('Не все видео открылись, продолжить нельзя.', true); return; }
    m.items.forEach(function (sv, i) {
      var it = Q[i];
      it.start = Math.max(0, Math.min(sv.start, it.dur)); it.end = Math.max(it.start + 0.1, Math.min(sv.end, it.dur));
      it.cuts = sv.cuts || null; it.caps = sv.caps || []; it.tap = sv.tap || null;
      it.rot = [0, 90, 180, 270].indexOf(sv.rot) >= 0 ? sv.rot : it.rot; it.fh = sv.fh === true; it.fv = sv.fv === true;
    });
    var okDone = [];
    for (var k = 0; k < m.done.length; k++) {
      var d = m.done[k], blob = d.opfs ? await AV.readOpfs(d.opfs, d.type) : null;
      if (!blob) continue;                              // файла нет: эта группа пойдёт заново
      okDone.push(d);
      addResult({ name: d.name, blob: blob, url: URL.createObjectURL(blob), o: { w: d.w, h: d.h }, warnings: d.warnings || [], ext: d.ext, fmt: d.fmt, saved: false, streamed: !!d.streamed, engine: 'restored' });
    }
    m.done = okDone;
    $('#resumeBar').hidden = true; resumeRec = null;
    syncTrim(Q[0]); updateInfo(); updateEstimate(); renderCaps();
    await runQueue(true, { rec: m, items: Q.slice(), groups: m.groups.map(function (g) { return g.map(function (ix) { return Q[ix]; }); }) });
  });
  $('#resumeDrop').addEventListener('click', async function () {
    await AV.session.clear(); AV.cleanOpfs(); resumeRec = null; $('#resumeBar').hidden = true; toast('Журнал удалён.');
  });

  /* ---------- последний проект ---------- */
  var projArmed = false, projLast = '', projRec = null;
  function projSnap() {
    return { v: 1, ts: Date.now(), items: Q.map(function (it) {
      return { name: it.name, size: it.file.size, start: it.start, end: it.end, cuts: it.cuts, caps: it.caps, tap: it.tap, rot: it.rot, fh: it.fh, fv: it.fv };
    }) };
  }
  setInterval(function () {                               // раз в пару секунд сверяем и пишем только если что-то поменялось
    if (!projArmed) { if (Q.length) projArmed = true; else return; }
    if (!Q.length) { if (projLast) { projLast = ''; AV.project.clear(); } return; }
    var snap = projSnap(), key = JSON.stringify(snap.items);
    if (key !== projLast) { projLast = key; AV.project.save(snap); }
  }, 2500);
  async function initProject() {
    var m = await AV.project.load();
    if (!m || Q.length || resumeRec) return;
    projRec = m;
    $('#projText').textContent = 'Последний проект, файлов: ' + m.items.length + ' (' + m.items.slice(0, 3).map(function (x) { return x.name; }).join(', ') + (m.items.length > 3 ? '…' : '') +
      '). Выберите те же файлы, и обрезка, подписи и повороты вернутся. Сами видео сайт не хранит.';
    $('#projBar').hidden = false;
  }
  $('#projGo').addEventListener('click', function () { $('#projFile').value = ''; $('#projFile').click(); });
  $('#projFile').addEventListener('change', async function () {
    var m = projRec, picked = Array.prototype.slice.call($('#projFile').files); if (!m || !picked.length || busy) return;
    var ordered = [], metas = [];
    m.items.forEach(function (sv) {
      var f = picked.filter(function (p) { return p.name === sv.name && p.size === sv.size && ordered.indexOf(p) < 0; })[0];
      if (f) { ordered.push(f); metas.push(sv); }
    });
    if (!ordered.length) { toast('Среди выбранных нет файлов проекта. Нужны те же видео.', true); return; }
    $('#projBar').hidden = true; projRec = null;
    await addFiles(ordered);
    ordered.forEach(function (f, i) {
      var it = Q.filter(function (q) { return q.file === f; })[0], sv = metas[i]; if (!it) return;
      it.start = Math.max(0, Math.min(sv.start, it.dur - 0.2)); it.end = Math.max(it.start + 0.2, Math.min(sv.end == null ? it.dur : sv.end, it.dur));
      it.cuts = sv.cuts ? sv.cuts.filter(function (c) { return c[0] < it.dur; }) : null; if (it.cuts && !it.cuts.length) it.cuts = null;
      it.caps = sv.caps.filter(function (c) { return c.start < it.dur; }); it.tap = sv.tap;
      it.rot = sv.rot; it.fh = sv.fh; it.fv = sv.fv; it.track = null; it.noFace = false; it.stab = null;
    });
    var c = item(); if (c) { syncTrim(c); video.currentTime = c.start; syncUI(); updateInfo(); updateEstimate(); renderCaps(); draw(); }
    toast(ordered.length < m.items.length ? 'Открыто видео: ' + ordered.length + ' из ' + m.items.length + '. Остальных среди выбранных не нашлось.' : 'Проект открыт.');
  });
  $('#projDrop').addEventListener('click', async function () { await AV.project.clear(); projRec = null; $('#projBar').hidden = true; toast('Проект забыт.'); });
  window.AVProjectReset = function () { return AV.project.clear(); };

  /* ---------- старт ---------- */
  $('#folderCard').hidden = !window.showDirectoryPicker;
  if (!window.showDirectoryPicker && S.toFolder) set('toFolder', false, true);
  setTab(['frame', 'video', 'wm', 'export', 'info', 'components', 'about'].indexOf(ls.get(TAB_KEY)) >= 0 ? ls.get(TAB_KEY) : 'frame');
  syncUI();
  initResume().then(function () { return AV.cleanOpfs(); }, function () { return AV.cleanOpfs(); }).then(initProject, initProject);
  window.AVApp = {
    Q: function () { return Q; }, select: select, addFiles: addFiles, runQueue: runQueue, results: function () { return results; },
    runFaces: function () { return runFaces(item()); }, runStab: function () { return runStab(item()); }, formatSupport: function () { return FS; }, outSize: function () { return outSize(item()); }, setTab: setTab, hasJournal: function () { return !!resumeRec; }
  };
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(function () { /* офлайн не включится */ });
})();
