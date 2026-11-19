'use strict';
/* Aspect Studio Video — плавное замедление.
   При замедлении между соседними кадрами исходника не хватает кадров, и видео «дёргается». Здесь недостающие кадры достраиваются:
   1) по двум соседним кадрам ищется движение (блоки 8×8 на уменьшенной копии, полный перебор в окне ±8);
   2) вектора сглаживаются (медиана 3×3) и плавно растягиваются на весь кадр;
   3) новый кадр на доле alpha между A и B = смесь A, сдвинутого на alpha·v назад, и B, сдвинутого на (1−alpha)·v вперёд.
   Где движение найти не удалось (резкая смена плана, быстрое перекрытие), берётся ближайший настоящий кадр: лучше повтор, чем «призрак».
   Это обычный алгоритм без нейросети: работает везде, ничего не скачивается. */
(function () {
  var AV = (window.AV = window.AV || {});
  var SW = 160, BS = 8, R = 8, LAMBDA = 2, OK_SAD = 22, CUT_SAD = 34;

  AV.makeInterp = function (maxSide) {
    var W = 0, H = 0, sw = 0, sh = 0, bw = 0, bh = 0;
    var cv = null, g = null, cs = null, gs = null, out = null, go = null;
    var A = null, B = null, gA = null, gB = null;        // пиксели полного размера и серые уменьшенные копии
    var fx = null, fy = null, rel = null, cut = false, key = -1;

    function ensure(w, h) {
      var k = Math.min(1, (maxSide || 1920) / Math.max(w, h)), nw = Math.max(16, Math.round(w * k)), nh = Math.max(16, Math.round(h * k));
      if (nw === W && nh === H && cv) return;
      W = nw; H = nh;
      cv = document.createElement('canvas'); cv.width = W; cv.height = H; g = cv.getContext('2d', { willReadFrequently: true, alpha: false });
      out = document.createElement('canvas'); out.width = W; out.height = H; go = out.getContext('2d', { alpha: false });
      sw = SW; sh = Math.max(BS * 2, Math.round(SW * H / W / BS) * BS);
      cs = document.createElement('canvas'); cs.width = sw; cs.height = sh; gs = cs.getContext('2d', { willReadFrequently: true, alpha: false });
      bw = Math.floor(sw / BS); bh = Math.floor(sh / BS);
      A = B = gA = gB = null; key = -1;
    }
    function grab(src) {                                  // копия кадра + серая миниатюра
      var w = src.videoWidth || src.displayWidth || src.width, h = src.videoHeight || src.displayHeight || src.height;
      ensure(w, h);
      g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, W, H);
      var px = g.getImageData(0, 0, W, H).data;
      gs.imageSmoothingQuality = 'high'; gs.drawImage(cv, 0, 0, sw, sh);
      var sp = gs.getImageData(0, 0, sw, sh).data, gray = new Uint8Array(sw * sh);
      for (var i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = (sp[i] * 77 + sp[i + 1] * 150 + sp[i + 2] * 29) >> 8;
      return { px: px, gray: gray };
    }
    function median(a, w, h, x, y) {
      var v = [], i, j;
      for (j = -1; j <= 1; j++) for (i = -1; i <= 1; i++) { var xx = Math.min(w - 1, Math.max(0, x + i)), yy = Math.min(h - 1, Math.max(0, y + j)); v.push(a[yy * w + xx]); }
      v.sort(function (p, q) { return p - q; });
      return v[4];
    }
    function estimate() {
      var n = bw * bh, vx = new Float32Array(n), vy = new Float32Array(n), ok = new Uint8Array(n), total = 0, bx, by, dx, dy, x, y;
      for (by = 0; by < bh; by++) for (bx = 0; bx < bw; bx++) {
        var x0 = bx * BS, y0 = by * BS, best = 1e9, bdx = 0, bdy = 0, bsad = 0;
        for (dy = -R; dy <= R; dy++) {
          if (y0 + dy < 0 || y0 + dy + BS > sh) continue;
          for (dx = -R; dx <= R; dx++) {
            if (x0 + dx < 0 || x0 + dx + BS > sw) continue;
            var cost = LAMBDA * (Math.abs(dx) + Math.abs(dy)) * 4, sad = 0;
            for (y = 0; y < BS && cost < best; y++) {
              var ia = (y0 + y) * sw + x0, ib = (y0 + y + dy) * sw + x0 + dx;
              for (x = 0; x < BS; x++) { var d = gA[ia + x] - gB[ib + x]; sad += d < 0 ? -d : d; }
              cost = sad + LAMBDA * (Math.abs(dx) + Math.abs(dy)) * 4;
            }
            if (y === BS && cost < best) { best = cost; bdx = dx; bdy = dy; bsad = sad; }
          }
        }
        var i = by * bw + bx, m = bsad / (BS * BS);
        vx[i] = bdx; vy[i] = bdy; ok[i] = m <= OK_SAD ? 1 : 0; total += m;
      }
      cut = total / n > CUT_SAD;
      var mx = new Float32Array(n), my = new Float32Array(n);
      for (by = 0; by < bh; by++) for (bx = 0; bx < bw; bx++) { mx[by * bw + bx] = median(vx, bw, bh, bx, by); my[by * bw + bx] = median(vy, bw, bh, bx, by); }
      fx = mx; fy = my; rel = new Float32Array(n);
      for (var k = 0; k < n; k++) rel[k] = ok[k];
    }

    return {
      reset: function () { key = -1; B = null; },
      get w() { return W; }, get h() { return H; }, get cut() { return cut; }, get key() { return key; },
      /* пара кадров с номером k: A берём от прошлой пары (она была B), если номер следующий; getA/getB возвращают картинку */
      pair: async function (k, getA, getB) {
        if (k === key) return true;
        var a;
        if (k === key + 1 && B) { A = B; gA = gB; B = null; }
        else { a = await getA(); if (!a) return false; var ga = grab(a); A = ga.px; gA = ga.gray; }
        var b = await getB(); if (!b) { key = -1; return false; }
        var gb = grab(b); B = gb.px; gB = gb.gray;
        estimate(); key = k;
        return true;
      },
      /* кадр на доле alpha (0..1) между A и B: холст W×H */
      frame: function (alpha) {
        var nearest = alpha < 0.5 ? A : B, img = go.createImageData(W, H), o = img.data, a = A, b = B;
        if (cut || !fx) { o.set(nearest); go.putImageData(img, 0, 0); return out; }
        var scale = W / sw, ia = 1 - alpha, x, y, W4 = W * 4, Wm = W - 1, Hm = H - 1;
        var gxs = new Float32Array(W), gx0 = new Int32Array(W), gx1 = new Int32Array(W);
        for (x = 0; x < W; x++) {
          var gx = (x + 0.5) / scale / BS - 0.5, i0 = Math.floor(gx);
          gxs[x] = gx - i0; gx0[x] = Math.min(bw - 1, Math.max(0, i0)); gx1[x] = Math.min(bw - 1, Math.max(0, i0 + 1));
        }
        for (y = 0; y < H; y++) {
          var gy = (y + 0.5) / scale / BS - 0.5, j0 = Math.floor(gy), wy = gy - j0, r0 = Math.min(bh - 1, Math.max(0, j0)) * bw, r1 = Math.min(bh - 1, Math.max(0, j0 + 1)) * bw;
          for (x = 0; x < W; x++) {
            var wx = gxs[x], c00 = r0 + gx0[x], c10 = r0 + gx1[x], c01 = r1 + gx0[x], c11 = r1 + gx1[x];
            var w00 = (1 - wx) * (1 - wy), w10 = wx * (1 - wy), w01 = (1 - wx) * wy, w11 = wx * wy;
            var rl = rel[c00] * w00 + rel[c10] * w10 + rel[c01] * w01 + rel[c11] * w11, p = y * W4 + x * 4;
            if (rl < 0.5) { o[p] = nearest[p]; o[p + 1] = nearest[p + 1]; o[p + 2] = nearest[p + 2]; o[p + 3] = 255; continue; }
            var vx = (fx[c00] * w00 + fx[c10] * w10 + fx[c01] * w01 + fx[c11] * w11) * scale, vy = (fy[c00] * w00 + fy[c10] * w10 + fy[c01] * w01 + fy[c11] * w11) * scale;
            if (vx * vx + vy * vy < 0.25) {                  // почти нет движения: простая смесь
              o[p] = a[p] * ia + b[p] * alpha; o[p + 1] = a[p + 1] * ia + b[p + 1] * alpha; o[p + 2] = a[p + 2] * ia + b[p + 2] * alpha; o[p + 3] = 255; continue;
            }
            var sx = x - alpha * vx, sy = y - alpha * vy, tx = x + ia * vx, ty = y + ia * vy;
            sx = sx < 0 ? 0 : sx > Wm ? Wm : sx; sy = sy < 0 ? 0 : sy > Hm ? Hm : sy; tx = tx < 0 ? 0 : tx > Wm ? Wm : tx; ty = ty < 0 ? 0 : ty > Hm ? Hm : ty;
            var ax0 = sx | 0, ay0 = sy | 0, ax1 = ax0 < Wm ? ax0 + 1 : ax0, ay1 = ay0 < Hm ? ay0 + 1 : ay0, fax = sx - ax0, fay = sy - ay0;
            var bx0 = tx | 0, by0 = ty | 0, bx1 = bx0 < Wm ? bx0 + 1 : bx0, by1 = by0 < Hm ? by0 + 1 : by0, fbx = tx - bx0, fby = ty - by0;
            var pa00 = ay0 * W4 + ax0 * 4, pa10 = ay0 * W4 + ax1 * 4, pa01 = ay1 * W4 + ax0 * 4, pa11 = ay1 * W4 + ax1 * 4;
            var pb00 = by0 * W4 + bx0 * 4, pb10 = by0 * W4 + bx1 * 4, pb01 = by1 * W4 + bx0 * 4, pb11 = by1 * W4 + bx1 * 4;
            var qa00 = (1 - fax) * (1 - fay), qa10 = fax * (1 - fay), qa01 = (1 - fax) * fay, qa11 = fax * fay;
            var qb00 = (1 - fbx) * (1 - fby), qb10 = fbx * (1 - fby), qb01 = (1 - fbx) * fby, qb11 = fbx * fby;
            for (var c = 0; c < 3; c++) {
              var va = a[pa00 + c] * qa00 + a[pa10 + c] * qa10 + a[pa01 + c] * qa01 + a[pa11 + c] * qa11;
              var vb = b[pb00 + c] * qb00 + b[pb10 + c] * qb10 + b[pb01 + c] * qb01 + b[pb11 + c] * qb11;
              o[p + c] = va * ia + vb * alpha;
            }
            o[p + 3] = 255;
          }
        }
        go.putImageData(img, 0, 0);
        return out;
      },
      /* настоящий кадр A или B как холст (для долей около 0 и 1) */
      real: function (second) {
        var img = go.createImageData(W, H); img.data.set(second ? B : A); go.putImageData(img, 0, 0); return out;
      }
    };
  };
})();
