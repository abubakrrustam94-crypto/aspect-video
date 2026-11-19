'use strict';
/* Aspect Studio Video — шумоподавление звука.
   RNNoise (Xiph/Mozilla, нейросеть на 100 КБ) в WebAssembly: vendor/rnnoise. Работает на частоте 48 кГц кусками по 480 отсчётов
   (10 мс), поэтому подаём звук уже в том виде, в каком он уходит в кодировщик. Звук задерживается на 10 мс, на синхронизацию это не влияет. */
(function () {
  var AV = (window.AV = window.AV || {});
  var FR = 480, mod = null, loading = null;

  AV.loadDenoise = function () {
    if (mod) return Promise.resolve(mod);
    if (!loading) {
      loading = import('../vendor/rnnoise/rnnoise.js').then(function (m) {
        return m.default({ locateFile: function (p) { return 'vendor/rnnoise/' + p; } });
      }).then(function (M) {
        if (!M || !M._rnnoise_create || !M._rnnoise_process_frame) throw new Error('Модуль шумоподавления загрузился не полностью.');
        mod = M; return M;
      }).catch(function (e) { loading = null; throw e; });
    }
    return loading;
  };

  /* Один канал: process(Float32Array) меняет массив на месте (значения −1…1), длина не меняется. */
  AV.makeDenoiser = function (M) {
    var ptr = M._malloc(FR * 4), idx = ptr >> 2, st = M._rnnoise_create(), fill = 0, q = new Float32Array(FR * 4), qh = 0, qt = 0;
    return {
      process: function (x) {
        for (var i = 0; i < x.length; i++) {
          M.HEAPF32[idx + fill] = x[i] * 32768;
          if (++fill === FR) {
            M._rnnoise_process_frame(st, ptr, ptr);
            for (var k = 0; k < FR; k++) { q[qt] = M.HEAPF32[idx + k] / 32768; qt = (qt + 1) % q.length; }
            fill = 0;
          }
          if (qh !== qt) { x[i] = q[qh]; qh = (qh + 1) % q.length; } else x[i] = 0;
        }
      },
      close: function () { try { M._rnnoise_destroy(st); M._free(ptr); } catch (e) { /* уже освобождено */ } }
    };
  };
})();
