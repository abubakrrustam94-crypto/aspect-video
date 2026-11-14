/* Aspect Studio Video — отрисовка кадра и расчёт размеров.
   Один и тот же код рисует и превью, и кадры экспорта. */
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

  function even(n) {
    var v = Math.round(n / 2) * 2;
    return v < 2 ? 2 : v;
  }

  /* Размер выходного кадра.
     shortSide = 0 → «Авто»: исходник целиком, без уменьшения.
     shortSide > 0 → короткая сторона кадра равна shortSide. */
  AV.computeSize = function (rw, rh, shortSide, srcW, srcH) {
    var ratio = rw / rh;
    var W, H;
    if (!shortSide) {
      var srcRatio = srcW / srcH;
      if (srcRatio >= ratio) {
        W = srcW;
        H = srcW / ratio;
      } else {
        H = srcH;
        W = srcH * ratio;
      }
    } else if (ratio >= 1) {
      H = shortSide;
      W = shortSide * ratio;
    } else {
      W = shortSide;
      H = shortSide / ratio;
    }
    var m = Math.max(W, H);
    if (m > MAX_SIDE) {
      W = (W * MAX_SIDE) / m;
      H = (H * MAX_SIDE) / m;
    }
    return { w: even(W), h: even(H) };
  };

  /* Размер для превью: длинная сторона не больше maxLong. */
  AV.previewSize = function (W, H, maxLong) {
    var k = Math.min(1, maxLong / Math.max(W, H));
    return { w: even(W * k), h: even(H * k) };
  };

  var tiny = null;
  var tinyCtx = null;
  var mid = null;
  var midCtx = null;

  function ensureBlurCanvases() {
    if (!tiny) {
      tiny = document.createElement('canvas');
      tinyCtx = tiny.getContext('2d');
      mid = document.createElement('canvas');
      midCtx = mid.getContext('2d');
    }
  }

  /* Рисует размытый фон: источник → крошечный холст → средний → полный.
     Работает везде (не зависит от ctx.filter, которого нет в Safari). */
  function drawBlurBackground(ctx, W, H, src, sw, sh) {
    ensureBlurCanvases();
    var tw = 32;
    var th = Math.max(2, Math.round((tw * H) / W));
    tiny.width = tw;
    tiny.height = th;
    var k = Math.max(tw / sw, th / sh);
    var dw = sw * k;
    var dh = sh * k;
    tinyCtx.imageSmoothingEnabled = true;
    tinyCtx.imageSmoothingQuality = 'high';
    tinyCtx.drawImage(src, (tw - dw) / 2, (th - dh) / 2, dw, dh);

    mid.width = tw * 6;
    mid.height = th * 6;
    midCtx.imageSmoothingEnabled = true;
    midCtx.imageSmoothingQuality = 'high';
    midCtx.drawImage(tiny, 0, 0, mid.width, mid.height);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(mid, 0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(0, 0, W, H);
  }

  /* opts: { mode: 'blur' | 'color' | 'crop', color: '#rrggbb' } */
  AV.drawFrame = function (ctx, W, H, src, sw, sh, opts) {
    var mode = (opts && opts.mode) || 'blur';
    if (!sw || !sh) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      return;
    }
    var k;
    if (mode === 'crop') {
      k = Math.max(W / sw, H / sh);
    } else {
      k = Math.min(W / sw, H / sh);
      if (mode === 'color') {
        ctx.fillStyle = (opts && opts.color) || '#000000';
        ctx.fillRect(0, 0, W, H);
      } else {
        drawBlurBackground(ctx, W, H, src, sw, sh);
      }
    }
    var dw = sw * k;
    var dh = sh * k;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
  };

  AV.fmtTime = function (s) {
    if (!isFinite(s) || s < 0) s = 0;
    var m = Math.floor(s / 60);
    var sec = s - m * 60;
    var str = sec.toFixed(1);
    if (sec < 9.95) str = '0' + str;
    return m + ':' + str;
  };

  /* Вызывает cb(mediaTime) на каждый показанный кадр видео.
     Возвращает функцию остановки. */
  AV.onVideoFrame = function (video, cb) {
    var stopped = false;
    var lastT = -1;
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
        if (t !== lastT) {
          lastT = t;
          cb(t);
        }
        if (!stopped) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
    return function () {
      stopped = true;
    };
  };
})();
