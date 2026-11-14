/* Aspect Studio Video — отрисовка кадра: поворот, заполнение полей, водяной знак, затухание.
   Один код рисует и превью, и кадры экспорта, поэтому результат совпадает с тем, что видно на экране. */
(function () {
  'use strict';
  var AV = (window.AV = window.AV || {});
  var MAX_SIDE = 3840;

  AV.PRESETS = [
    { id: '9:16', w: 9, h: 16, hint: 'Reels · TikTok · Shorts' },
    { id: '4:5', w: 4, h: 5, hint: 'Лента Instagram' },
    { id: '1:1', w: 1, h: 1, hint: 'Квадрат' },
    { id: '3:4', w: 3, h: 4, hint: 'Портрет' },
    { id: '16:9', w: 16, h: 9, hint: 'YouTube · ТВ' },
    { id: '4:3', w: 4, h: 3, hint: 'Классика' },
    { id: '21:9', w: 21, h: 9, hint: 'Кинопанорама' }
  ];
  /* Готовые сценарии: формат + размер + частота + качество одним нажатием */
  AV.SCENARIOS = [
    { id: 'reels', name: 'Reels · Shorts · TikTok', set: { rw: 9, rh: 16, short: 1080, fps: 30, quality: 0.12, mode: 'blur' } },
    { id: 'vk', name: 'Клип ВКонтакте', set: { rw: 9, rh: 16, short: 1080, fps: 30, quality: 0.12, mode: 'blur' } },
    { id: 'feed', name: 'Пост 4:5 Instagram', set: { rw: 4, rh: 5, short: 1080, fps: 30, quality: 0.12, mode: 'blur' } },
    { id: 'yt', name: 'YouTube 1080p', set: { rw: 16, rh: 9, short: 1080, fps: 30, quality: 0.2, mode: 'blur' } },
    { id: 'tg', name: 'Telegram, лёгкий файл', set: { rw: 16, rh: 9, short: 720, fps: 30, quality: 0.07, mode: 'blur' } },
    { id: 'old', name: 'Старый телефон 4:3', set: { rw: 4, rh: 3, short: 720, fps: 24, quality: 0.07, mode: 'blur' } }
  ];

  function even(n) {
    var v = Math.round(n / 2) * 2;
    return v < 2 ? 2 : v;
  }

  /* Размер выходного кадра. shortSide = 0 → «Авто»: исходник целиком, без уменьшения. */
  AV.computeSize = function (rw, rh, shortSide, srcW, srcH) {
    var ratio = rw / rh;
    var W, H;
    if (!shortSide) {
      if (srcW / srcH >= ratio) { W = srcW; H = srcW / ratio; } else { H = srcH; W = srcH * ratio; }
    } else if (ratio >= 1) {
      H = shortSide; W = shortSide * ratio;
    } else {
      W = shortSide; H = shortSide / ratio;
    }
    var m = Math.max(W, H);
    if (m > MAX_SIDE) { W = (W * MAX_SIDE) / m; H = (H * MAX_SIDE) / m; }
    return { w: even(W), h: even(H) };
  };
  AV.previewSize = function (W, H, maxLong) {
    var k = Math.min(1, maxLong / Math.max(W, H));
    return { w: even(W * k), h: even(H * k) };
  };

  /* ---------- Поворот и отражение ---------- */
  var orient = null;
  var orientCtx = null;
  /* Возвращает { src, sw, sh }: либо само видео, либо холст с повёрнутым кадром */
  AV.getOriented = function (video, rot, fh, fv) {
    var vw = video.videoWidth, vh = video.videoHeight;
    if (!rot && !fh && !fv) return { src: video, sw: vw, sh: vh };
    var swap = rot === 90 || rot === 270;
    var ow = swap ? vh : vw, oh = swap ? vw : vh;
    if (!orient) { orient = document.createElement('canvas'); orientCtx = orient.getContext('2d', { alpha: false }); }
    if (orient.width !== ow || orient.height !== oh) { orient.width = ow; orient.height = oh; }
    orientCtx.save();
    orientCtx.translate(ow / 2, oh / 2);
    orientCtx.scale(fh ? -1 : 1, fv ? -1 : 1);
    orientCtx.rotate((rot * Math.PI) / 180);
    orientCtx.drawImage(video, -vw / 2, -vh / 2, vw, vh);
    orientCtx.restore();
    return { src: orient, sw: ow, sh: oh };
  };
  AV.orientedSize = function (vw, vh, rot) {
    return rot === 90 || rot === 270 ? { w: vh, h: vw } : { w: vw, h: vh };
  };

  /* ---------- Фон ---------- */
  var tiny = null, tinyCtx = null, mid = null, midCtx = null;
  function drawBlurBackground(ctx, W, H, src, sw, sh) {
    if (!tiny) {
      tiny = document.createElement('canvas'); tinyCtx = tiny.getContext('2d');
      mid = document.createElement('canvas'); midCtx = mid.getContext('2d');
    }
    var tw = 32, th = Math.max(2, Math.round((tw * H) / W));
    tiny.width = tw; tiny.height = th;
    var k = Math.max(tw / sw, th / sh), dw = sw * k, dh = sh * k;
    tinyCtx.imageSmoothingEnabled = true; tinyCtx.imageSmoothingQuality = 'high';
    tinyCtx.drawImage(src, (tw - dw) / 2, (th - dh) / 2, dw, dh);
    mid.width = tw * 6; mid.height = th * 6;
    midCtx.imageSmoothingEnabled = true; midCtx.imageSmoothingQuality = 'high';
    midCtx.drawImage(tiny, 0, 0, mid.width, mid.height);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(mid, 0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(0, 0, W, H);
  }
  /* Зеркальное продолжение краёв: за границами кадра рисуются отражённые копии самого видео */
  function drawMirrorBackground(ctx, W, H, src, sw, sh, x, y, dw, dh) {
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    var i, cx;
    if (dw < W - 1) {
      for (i = 1; x - i * dw > -dw; i++) {          // слева
        cx = x - i * dw;
        ctx.save();
        if (i % 2) { ctx.translate(cx + dw, 0); ctx.scale(-1, 1); ctx.drawImage(src, 0, y, dw, dh); }
        else ctx.drawImage(src, cx, y, dw, dh);
        ctx.restore();
      }
      for (i = 1; x + i * dw < W; i++) {            // справа
        cx = x + i * dw;
        ctx.save();
        if (i % 2) { ctx.translate(cx + dw, 0); ctx.scale(-1, 1); ctx.drawImage(src, 0, y, dw, dh); }
        else ctx.drawImage(src, cx, y, dw, dh);
        ctx.restore();
      }
    }
    if (dh < H - 1) {
      for (i = 1; y - i * dh > -dh; i++) {          // сверху
        var cy = y - i * dh;
        ctx.save();
        if (i % 2) { ctx.translate(0, cy + dh); ctx.scale(1, -1); ctx.drawImage(src, x, 0, dw, dh); }
        else ctx.drawImage(src, x, cy, dw, dh);
        ctx.restore();
      }
      for (i = 1; y + i * dh < H; i++) {            // снизу
        var cy2 = y + i * dh;
        ctx.save();
        if (i % 2) { ctx.translate(0, cy2 + dh); ctx.scale(1, -1); ctx.drawImage(src, x, 0, dw, dh); }
        else ctx.drawImage(src, x, cy2, dw, dh);
        ctx.restore();
      }
    }
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(0, 0, W, H);
  }

  /* o: { mode: 'blur'|'mirror'|'color'|'crop', color, focus: {x,y}|null } */
  AV.drawFrame = function (ctx, W, H, src, sw, sh, o) {
    var mode = (o && o.mode) || 'blur';
    if (!sw || !sh) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); return; }
    var k, dw, dh, x, y;
    if (mode === 'crop') {
      k = Math.max(W / sw, H / sh);
      dw = sw * k; dh = sh * k;
      var fx = o && o.focus ? o.focus.x : 0.5, fy = o && o.focus ? o.focus.y : 0.5;
      x = Math.min(0, Math.max(W - dw, W / 2 - fx * dw));
      y = Math.min(0, Math.max(H - dh, H / 2 - fy * dh));
    } else {
      k = Math.min(W / sw, H / sh);
      dw = sw * k; dh = sh * k;
      x = (W - dw) / 2; y = (H - dh) / 2;
      if (mode === 'color') { ctx.fillStyle = (o && o.color) || '#000000'; ctx.fillRect(0, 0, W, H); }
      else if (mode === 'mirror') drawMirrorBackground(ctx, W, H, src, sw, sh, x, y, dw, dh);
      else drawBlurBackground(ctx, W, H, src, sw, sh);
    }
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, x, y, dw, dh);
  };

  /* ---------- Водяной знак ---------- */
  function isDark(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return false;
    var n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return 0.299 * r + 0.587 * g + 0.114 * b < 110;
  }
  /* wm: { on, type, text, color, shadow, opacity, size, pos, margin, angle, when, sec }, img — готовая картинка знака */
  AV.drawWatermark = function (ctx, W, H, wm, img, t) {
    if (!wm || !wm.on) return;
    if (wm.when === 'first' && t > wm.sec) return;
    var short = Math.min(W, H), px = Math.max(8, short * (wm.size / 100)), m = short * (wm.margin / 100);
    var isImg = wm.type === 'image';
    if (isImg && !(img && img.width)) return;
    if (!isImg && !String(wm.text || '').trim()) return;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, wm.opacity / 100));
    var tw, th;
    if (isImg) {
      tw = Math.min(W * 0.9, short * (wm.size / 100) * 6); th = tw * (img.height / img.width);
    } else {
      ctx.font = '700 ' + px + 'px "Roboto Flex", system-ui, sans-serif';
      tw = ctx.measureText(wm.text).width; th = px;
      ctx.fillStyle = wm.color;
      if (wm.shadow) {
        ctx.shadowColor = isDark(wm.color) ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.6)';
        ctx.shadowBlur = px * 0.18; ctx.shadowOffsetY = px * 0.04;
      }
      ctx.textBaseline = 'middle';
    }
    var put = function (x, y) {            // x, y — левый верхний угол знака
      if (isImg) ctx.drawImage(img, x, y, tw, th);
      else ctx.fillText(wm.text, x, y + th / 2);
    };
    if (wm.pos === 'tile') {
      var diag = Math.sqrt(W * W + H * H), sx = tw * 1.7, sy = th * 3.2;
      ctx.translate(W / 2, H / 2);
      ctx.rotate((wm.angle * Math.PI) / 180);
      var row = 0;
      for (var yy = -diag / 2; yy < diag / 2; yy += sy, row++) {
        for (var xx = -diag / 2 + (row % 2 ? sx / 2 : 0); xx < diag / 2; xx += sx) put(xx, yy);
      }
    } else {
      var p = wm.pos || 'br', x, y;
      x = p.indexOf('l') >= 0 ? m : p.indexOf('r') >= 0 ? W - m - tw : (W - tw) / 2;
      y = p.indexOf('t') >= 0 ? m : p.indexOf('b') >= 0 ? H - m - th : (H - th) / 2;
      if (p === 'c') { x = (W - tw) / 2; y = (H - th) / 2; }
      put(x, y);
    }
    ctx.restore();
  };

  /* ---------- Кадр целиком ---------- */
  /* r: { rot, fh, fv, mode, color, focusAt(tSrc)->{x,y}|null, wm, wmImg, fadeIn, fadeOut, outDur }
     tSrc — время в исходнике, tOut — время в результате (с учётом скорости). */
  AV.renderAt = function (ctx, W, H, video, r, tSrc, tOut) {
    var o = AV.getOriented(video, r.rot, r.fh, r.fv);
    AV.drawFrame(ctx, W, H, o.src, o.sw, o.sh, {
      mode: r.mode, color: r.color, focus: r.focusAt ? r.focusAt(tSrc) : null
    });
    AV.drawWatermark(ctx, W, H, r.wm, r.wmImg, tOut);
    var a = 0;
    if (r.fadeIn > 0 && tOut < r.fadeIn) a = Math.max(a, 1 - tOut / r.fadeIn);
    if (r.fadeOut > 0 && r.outDur - tOut < r.fadeOut) a = Math.max(a, 1 - Math.max(0, r.outDur - tOut) / r.fadeOut);
    if (a > 0.001) { ctx.fillStyle = 'rgba(0,0,0,' + Math.min(1, a).toFixed(3) + ')'; ctx.fillRect(0, 0, W, H); }
  };

  /* Вызывает cb(mediaTime) на каждый показанный кадр. Возвращает функцию остановки. */
  AV.onVideoFrame = function (video, cb) {
    var stopped = false, lastT = -1;
    if (typeof video.requestVideoFrameCallback === 'function') {
      var step = function (now, meta) {
        if (stopped) return;
        cb(meta && typeof meta.mediaTime === 'number' ? meta.mediaTime : video.currentTime);
        if (!stopped) video.requestVideoFrameCallback(step);
      };
      video.requestVideoFrameCallback(step);
    } else {
      var loop = function () {
        if (stopped) return;
        var t = video.currentTime;
        if (t !== lastT) { lastT = t; cb(t); }
        if (!stopped) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
    return function () { stopped = true; };
  };

  /* Транслит для имён файлов */
  var TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
  AV.translit = function (s) {
    return String(s).replace(/[А-Яа-яЁё]/g, function (c) {
      var low = c.toLowerCase(), t = TR[low] || '';
      return c !== low && t ? t[0].toUpperCase() + t.slice(1) : t;
    });
  };
  /* Имя файла по шаблону: {name} {ratio} {size} {n} {date} */
  AV.makeName = function (tpl, v, translit) {
    var out = String(tpl || '{name}')
      .replace(/\{name\}/g, v.name || 'video')
      .replace(/\{ratio\}/g, v.ratio || '')
      .replace(/\{size\}/g, v.size || '')
      .replace(/\{n\}/g, v.n != null ? String(v.n) : '')
      .replace(/\{date\}/g, v.date || '');
    if (translit) out = AV.translit(out);
    out = out.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, '_').replace(/^\.+/, '').replace(/_+/g, '_').slice(0, 120);
    return out || 'video';
  };
})();
