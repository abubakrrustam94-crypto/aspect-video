'use strict';
/* Aspect Studio Video — вкладка «О программе»: версия, «Что нового», «Как это работает», проверка скорости,
   журнал ошибок, «Сообщить о проблеме», офлайн-режим, счётчик. Устроено так же, как в Aspect Studio. */
(function () {
  $('#appVersion').textContent = 'v' + APP_VERSION;

  /* ---------- окна ---------- */
  function modal(box, closeBtn, onClose) {
    var opener = null;
    function open() { opener = document.activeElement; box.hidden = false; closeBtn.focus(); }
    function close() { box.hidden = true; if (onClose) onClose(); if (opener && opener.focus) opener.focus(); }
    closeBtn.addEventListener('click', close);
    box.addEventListener('click', function (e) { if (e.target === box) close(); });
    box.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      else if (e.key === 'Tab') { e.preventDefault(); closeBtn.focus(); }
    });
    return { open: open, close: close };
  }

  /* ---------- Что нового ---------- */
  async function wnRender() {
    var box = $('#wnList');
    if (typeof CHANGELOG === 'undefined') {
      box.textContent = 'Загружаю…';
      try { await lazyLoad('changelog-data'); } catch (e) { box.textContent = 'Не удалось загрузить список изменений. Проверь соединение.'; return; }
    }
    box.replaceChildren();
    $('#wnSub').textContent = 'Сейчас у тебя v' + APP_VERSION;
    CHANGELOG.forEach(function (e, idx) {
      var cur = idx === 0, node = el(cur ? 'section' : 'details', 'wn-rel' + (cur ? ' cur' : ''));
      var head = el(cur ? 'header' : 'summary', 'wn-head');
      var ver = el('span', 'wn-ver', 'v' + e.v), ttl = el('span', 'wn-ttl', e.t);
      head.append(ver, ttl);
      if (cur) head.append(el('span', 'wn-badge', 'Новое'));
      var ul = el('ul', 'wn-items');
      e.items.forEach(function (x) { ul.append(el('li', /^Исправлено/.test(x) ? 'fix' : '', x)); });
      node.append(head, ul); box.append(node);
    });
    box.scrollTop = 0;
  }
  var wn = modal($('#whatsnew'), $('#wnClose'), function () { ls.set(SEEN_KEY, APP_VERSION); });
  function wnOpen() { wn.open(); return wnRender(); }
  $('#wnOpenBtn').addEventListener('click', wnOpen);
  (function () {                       // после обновления (не при первом запуске) показываем изменения один раз
    var seen = ls.get(SEEN_KEY);
    if (!seen) { ls.set(SEEN_KEY, APP_VERSION); return; }
    if (seen !== APP_VERSION) setTimeout(wnOpen, 900);   // версия сменилась (в том числе номером ниже): покажем один раз
  })();

  /* ---------- Как это работает ---------- */
  var HOW = [
    ['shield', 'Видео не уходят на сервер', 'Всё считает твой браузер. У сайта нет сервера, куда можно что-то загрузить: ролик читается прямо с устройства, обрабатывается в памяти и записывается обратно на устройство.'],
    ['save', 'Что скачивается', 'Только сам сайт. Если включишь «Следить за лицом», один раз подгрузится небольшая модель поиска лиц (~1,7 МБ): она лежит на том же сайте, а не на чужих серверах. Всё остальное работает сразу.'],
    ['pin', 'Что хранится на устройстве', 'Настройки, тема и счётчик сохранённых видео. Это хранится в самом браузере. Ещё запоминается последний проект: имена файлов, обрезка, вырезы, подписи и повороты, но не сами видео. «Сбросить все настройки» стирает всё. Во время сохранения большой ролик временно пишется во внутреннюю папку сайта и стирается при следующем запуске.'],
    ['play', 'Горячие клавиши', 'Пробел — пуск и пауза. Стрелки ← → — на кадр назад и вперёд, с Shift — на секунду. I — начало обрезки здесь, O — конец здесь, S — сохранить видео. Клавиши не работают, пока открыто окно или идёт сохранение.'],
    ['search', 'Как проверить самому', 'Загрузи страницу, выключи интернет (авиарежим) и сохрани видео: всё продолжит работать. Либо открой вкладку «Сеть» в инструментах браузера: во время обработки там нет запросов. Исходный код открыт на GitHub.']
  ];
  var how = modal($('#howDlg'), $('#howClose'));
  HOW.forEach(function (p) {
    var b = el('div', 'how-item'), ic = el('span', 'how-ic'), tx = el('div', '', ''), t = el('b', '', p[1]), d = el('p', '', p[2]);
    ic.setAttribute('aria-hidden', 'true'); ic.appendChild(svgIcon(p[0])); tx.append(t, d);
    b.append(ic, tx); $('#howList').appendChild(b);
  });
  $('#howBtn').addEventListener('click', how.open);
  $('#howLink').addEventListener('click', function (e) { e.stopPropagation(); how.open(); });

  /* ---------- Офлайн ---------- */
  async function offlineReady() {
    if (!('caches' in window) || !navigator.serviceWorker || !navigator.serviceWorker.controller) return false;
    try {
      var keys = (await caches.keys()).filter(function (k) { return /^aspect-video-v\d+/.test(k); });
      if (!keys.length) return false;
      var c = await caches.open(keys.sort().pop());
      var need = ['./index.html', './js/app.js', './js/export.js', './vendor/mp4-muxer.js'];
      return (await Promise.all(need.map(function (u) { return c.match(u); }))).every(Boolean);
    } catch (e) { return false; }
  }
  async function drawOffline() {
    var chip = $('#offChip'), ok = await offlineReady();
    chip.classList.toggle('warn', !ok);
    chip.textContent = ok
      ? 'Сайт скачан: работает без интернета. Нужна сеть только для первой загрузки модели поиска лиц.'
      : (navigator.serviceWorker && navigator.serviceWorker.controller
        ? 'Файлы ещё докачиваются. Подожди минуту и открой вкладку снова.'
        : 'Офлайн-режим включится после первой полной загрузки по https (при «Установить» или обычном посещении).');
    return ok;
  }
  (async function () {
    if (await drawOffline() && ls.get('aspect-video-offline-ok') !== '1') { ls.set('aspect-video-offline-ok', '1'); toast('Готово: сайт работает без интернета', false, { ms: 5000 }); }
  })();
  addEventListener('offline', async function () { drawOffline(); toast((await offlineReady()) ? 'Нет сети. Всё нужное скачано, можно работать' : 'Нет сети. Часть функций может не открыться', false, { ms: 5000 }); });
  addEventListener('online', drawOffline);

  /* ---------- Счётчик ---------- */
  function drawCount() {
    var n = +ls.get(COUNT_KEY) || 0, c = $('#cntLine');
    c.textContent = n ? 'Сохранено на этом устройстве: ' + n + ' видео. Счёт хранится только в браузере.' : '';
    c.hidden = !n;
  }
  drawCount();
  document.addEventListener('avsaved', drawCount);
  document.addEventListener('avtab', function (e) { if (e.detail === 'about') { drawCount(); drawOffline(); } });

  /* ---------- Журнал ошибок ---------- */
  async function features() {
    var f = [['WebCodecs', AV.canWebCodecs()], ['AAC', await AV.audioSupport()], ['Запись на диск', AV.hasOpfs()], ['Не засыпать экран', !!navigator.wakeLock], ['Выбор папки', !!window.showDirectoryPicker]];
    featList = f;
    return f.map(function (x) { return x[0] + ' ' + (x[1] ? 'да' : 'нет'); }).join(', ');
  }
  var featCache = '', featList = [];
  features().then(function (s) { featCache = s; renderErrLog(); });
  function errLogText() {
    var app = window.AVApp, it = app && app.Q()[0];
    return 'Aspect Studio Video v' + APP_VERSION + '\n' + navigator.userAgent + '\nЭкран ' + innerWidth + '×' + innerHeight + ', память ' + DEV_MEM + ' ГБ' +
      '\nВозможности: ' + featCache +
      '\nНастройки: ' + S.rw + ':' + S.rh + ', ' + S.mode + ', ' + S.short + 'p, ' + S.fps + ' к/с, скорость ' + S.speed + (S.wmOn ? ', знак' : '') + (S.faceTrack ? ', лица' : '') +
      (it ? '\nПервое видео: ' + it.vw + '×' + it.vh + ', ' + it.dur.toFixed(1) + ' с' : '') +
      '\n\n' + (errLog.length ? errLog.map(function (e) { return '[' + new Date(e.t).toLocaleString('ru-RU') + '] ' + e.w + (e.n > 1 ? ' ×' + e.n : '') + '\n' + e.m; }).join('\n\n') : 'Ошибок нет');
  }
  window.errLogText = errLogText;
  window.renderErrLog = function () {
    $('#errLogCount').textContent = errLog.length;
    var box = $('#errLogText'), app = window.AVApp, it = app && app.Q()[0];
    function chip(t, cls) { return el('span', 'err-chip' + (cls ? ' ' + cls : ''), t); }
    var dev = el('div', 'err-dev'), chips = el('div', 'err-chips');
    chips.append(chip('v' + APP_VERSION), chip(innerWidth + '×' + innerHeight), chip(DEV_MEM + ' ГБ'));
    featList.forEach(function (x) { chips.append(chip((x[1] ? '✓ ' : '✕ ') + x[0], x[1] ? 'ok' : 'no')); });
    var ua = el('p', 'err-ua', navigator.userAgent); ua.setAttribute('data-i18n-skip', '');
    dev.append(el('p', 'err-h', 'Об устройстве'), chips, ua);
    var st = el('div', 'err-status' + (errLog.length ? ' bad' : ''));
    st.append(el('b', '', errLog.length ? 'Записей: ' + errLog.length : 'Ошибок нет'), el('span', '', errLog.length ? 'Новые сверху. Нажми на запись, чтобы развернуть.' : 'Всё в порядке. Если что-то сломается, это появится здесь.'));
    var list = el('ul', 'err-list');
    errLog.slice().reverse().forEach(function (e) {
      var row = el('li', ''), d = el('details', 'err-item'), sm = el('summary', 'err-sum'), first = String(e.m || '').split('\n')[0].replace(/^[A-Za-z]*Error:\s*/, '');
      var w = el('span', 'err-where', e.w || 'ошибка'), msg = el('span', 'err-first', first), when = el('time', 'err-when', new Date(e.t).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }));
      w.setAttribute('data-i18n-skip', ''); msg.setAttribute('data-i18n-skip', '');
      sm.append(w); if (e.n > 1) sm.append(el('span', 'err-n', '×' + e.n)); sm.append(when, msg);
      var pre = el('pre', 'err-msg', e.m); pre.setAttribute('data-i18n-skip', ''); pre.tabIndex = 0;
      d.append(sm, pre); row.appendChild(d); list.appendChild(row);
    });
    box.replaceChildren(dev, st); if (errLog.length) box.appendChild(list);
  };
  renderErrLog();
  $('#errLogCopy').addEventListener('click', async function () {
    try { await navigator.clipboard.writeText(errLogText()); toast('Журнал скопирован'); } catch (e) { toast('Не удалось скопировать: выдели текст вручную', true); }
  });
  $('#errLogShare').addEventListener('click', async function () {
    var text = errLogText();
    try {
      if (navigator.share) await navigator.share({ title: 'Aspect Studio Video: журнал', text: text });
      else { await navigator.clipboard.writeText(text); toast('Журнал скопирован: вставь его в сообщение'); }
    } catch (e) { /* отменено */ }
  });
  $('#errLogClear').addEventListener('click', function () { errLog.length = 0; ls.del(ERRLOG_KEY); renderErrLog(); toast('Журнал очищен'); });

  /* ---------- Сообщить о проблеме ---------- */
  $('#reportBtn').addEventListener('click', function () {
    var log = ''; try { log = errLogText(); } catch (e) { /* без журнала */ }
    var body = '**Что случилось** (опиши своими словами; видео прикладывать не нужно)\n\n\n**Что ожидал(а)**\n\n\n---\nСлужебные сведения (без видео и имён файлов):\n```\n' + String(log).slice(0, 2200) + '\n```\n';
    window.open(REPO + '/issues/new?title=' + encodeURIComponent('Проблема: ') + '&body=' + encodeURIComponent(body), '_blank', 'noopener,noreferrer');
  });

  /* ---------- Проверить скорость ---------- */
  $('#speedBtn').addEventListener('click', async function () {
    var out = $('#speedOut'), btn = $('#speedBtn');
    btn.disabled = true; out.hidden = false; out.textContent = 'Замеряю…';
    try {
      var rows = [];
      var add = function (a, b) { rows.push([a, b]); };
      var frame = function () { return new Promise(function (r) { requestAnimationFrame(function () { r(); }); }); };
      await frame();
      /* 1) один кадр 1080×1920 с размытым фоном и знаком */
      var src = document.createElement('canvas'); src.width = 1920; src.height = 1080;
      var sg = src.getContext('2d'); sg.fillStyle = '#7a8'; sg.fillRect(0, 0, 1920, 1080); sg.fillStyle = '#c52'; sg.fillRect(300, 200, 900, 600);
      var dst = document.createElement('canvas'); dst.width = 1080; dst.height = 1920; var dg = dst.getContext('2d', { alpha: false });
      var r = { rot: 0, fh: false, fv: false, mode: 'blur', color: '#000', focusAt: null, wm: { on: true, type: 'text', text: '@test', color: '#fff', shadow: true, opacity: 70, size: 5, pos: 'br', margin: 3, angle: 0, when: 'all', sec: 5 }, wmImg: null, fadeIn: 0, fadeOut: 0, outDur: 10 };
      var fakeV = { videoWidth: 1920, videoHeight: 1080 };
      var o = AV.getOriented(fakeV, 0, false, false); o.src = src;
      var t0 = performance.now();
      for (var i = 0; i < 10; i++) { AV.drawFrame(dg, 1080, 1920, src, 1920, 1080, { mode: 'blur' }); AV.drawWatermark(dg, 1080, 1920, r.wm, null, 1); }
      var tFrame = (performance.now() - t0) / 10;
      add('Отрисовка кадра 1080×1920', Math.round(tFrame) + ' мс');
      /* 2) кодирование H.264 */
      var encRate = 0;
      if (AV.canWebCodecs()) {
        try {
          var cfg = { codec: 'avc1.64002A', width: 1080, height: 1920, bitrate: 6e6, framerate: 30, avc: { format: 'avc' } };
          var sup = await VideoEncoder.isConfigSupported(cfg);
          if (sup && sup.supported) {
            var n = 0, enc = null; enc = new VideoEncoder({ output: function () { n++; }, error: function () { /* учтётся ниже */ } });
            enc.configure(sup.config || cfg);
            var t1 = performance.now(), N = 45;
            for (var j = 0; j < N; j++) {
              dg.fillStyle = 'hsl(' + (j * 8) + ',60%,50%)'; dg.fillRect(0, 0, 1080, 1920);
              var vf = new VideoFrame(dst, { timestamp: j * 33333 }); enc.encode(vf, { keyFrame: j === 0 }); vf.close();
              while (enc.encodeQueueSize > 4) await new Promise(function (rs) { setTimeout(rs, 2); });
            }
            await enc.flush(); enc.close();
            encRate = N / ((performance.now() - t1) / 1000);
            add('Кодирование H.264 1080×1920', Math.round(encRate) + ' кадров/с');
          } else add('Кодирование H.264 1080×1920', 'не поддерживается');
        } catch (e) { try { if (enc && enc.state !== 'closed') enc.close(); } catch (e9) { /* ничего */ } add('Кодирование H.264 1080×1920', 'ошибка'); }
      } else add('Быстрый режим (WebCodecs)', 'недоступен');
      add('Запись на диск', AV.hasOpfs() ? 'есть' : 'нет, всё в памяти');
      add('Звук AAC', (await AV.audioSupport()) ? 'есть' : 'нет');
      add('Экран не гаснет при сохранении', navigator.wakeLock ? 'да' : 'нет');
      add('Ядра процессора', navigator.hardwareConcurrency || '?');
      add('Память устройства', navigator.deviceMemory ? '≥ ' + navigator.deviceMemory + ' ГБ' : 'не сообщается');
      try { var est = await navigator.storage.estimate(); add('Свободно для записи', fmtBytes(est.quota - est.usage)); } catch (e2) { /* нет данных */ }
      var verdict;
      if (!encRate) verdict = 'Быстрого режима нет: видео будет записываться в реальном времени.';
      else {
        var perMin = (60 * 30) / (encRate * 60);      // минут на минуту видео при 30 кадрах/с
        verdict = encRate >= 45 ? 'Быстро: минута видео займёт ~' + Math.max(1, Math.round(perMin * 60)) + ' с.' : encRate >= 15 ? 'Нормально: минута видео займёт ~' + perMin.toFixed(1).replace('.', ',') + ' мин.' : 'Медленно: минута видео займёт ~' + perMin.toFixed(1).replace('.', ',') + ' мин. Для длинных роликов выбирай 720 и 24 кадра.';
      }
      out.replaceChildren();
      rows.forEach(function (p) { var rw = el('div', 'sp-row'); rw.append(el('span', '', p[0]), el('b', '', String(p[1]))); out.append(rw); });
      out.append(el('div', 'sp-sum', verdict));
    } catch (e3) {
      logError(e3, 'скорость'); out.textContent = 'Замер не удался: ' + (e3 && e3.message);
    } finally { btn.disabled = false; }
  });

  /* ---------- Сброс ---------- */
  var armed = false, armTimer = 0;
  $('#resetAll').addEventListener('click', function () {
    var b = $('#resetAll'), note = $('#resetNote');
    if (!armed) {
      armed = true; b.classList.add('armed'); b.textContent = 'Нажми ещё раз'; note.hidden = false;
      armTimer = setTimeout(function () { armed = false; b.classList.remove('armed'); b.textContent = 'Сбросить все настройки'; note.hidden = true; }, 5000);
      return;
    }
    clearTimeout(armTimer); armed = false;
    [STORE_KEY, COUNT_KEY, THEME_KEY, TAB_KEY, SEEN_KEY, PRESETS_KEY, ACCENT_KEY, ONB_KEY, PIN_KEY, FOLD_KEY, INSTALL_KEY, PERF_KEY, 'aspect-video-offline-ok'].forEach(ls.del);
    if (window.AVProjectReset) window.AVProjectReset();
    toast('Настройки сброшены'); setTimeout(function () { location.reload(); }, 600);
  });
})();
