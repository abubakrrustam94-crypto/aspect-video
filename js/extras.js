'use strict';
/* Aspect Studio Video — удобство: наборы настроек, поиск, закрепление и сворачивание карточек,
   цвет акцента, мини-обучение, вкладка «Компоненты». Устроено так же, как в Aspect Studio. */
(function () {
  var AV = window.AV;
  function jget(k, d) { try { var v = JSON.parse(ls.get(k)); return v == null ? d : v; } catch (e) { return d; } }
  var norm = function (s) { return String(s).toLowerCase().replace(/ё/g, 'е'); };

  /* ---------- Закрепление и сворачивание карточек ---------- */
  var pins = new Set(jget(PIN_KEY, [])), folds = new Set(jget(FOLD_KEY, []));
  var cards = $$('#colSettings .card[data-tab]');
  var counters = {};
  cards.forEach(function (c) {
    counters[c.dataset.tab] = (counters[c.dataset.tab] || 0) + 1;
    c.dataset.cid = c.id || (c.dataset.tab + '-' + counters[c.dataset.tab]);
    var title = $('.card-title', c); if (!title) return;
    var name = title.textContent.replace(/\s+/g, ' ').trim();
    var pin = el('button', 'pin-btn'); pin.type = 'button';
    pin.replaceChildren(svgIcon('pin'));
    pin.setAttribute('aria-label', 'Закрепить «' + name + '» на всех вкладках');
    var fold = el('button', 'card-fold'); fold.type = 'button';
    fold.replaceChildren(svgIcon('chev'));
    fold.setAttribute('aria-label', 'Свернуть или развернуть «' + name + '»');
    pin.addEventListener('click', function () {
      if (pins.has(c.dataset.cid)) pins.delete(c.dataset.cid); else pins.add(c.dataset.cid);
      ls.set(PIN_KEY, JSON.stringify(Array.from(pins))); paint(); applyView();
      toast(pins.has(c.dataset.cid) ? 'Закреплено: теперь карточка видна на всех вкладках' : 'Откреплено');
    });
    fold.addEventListener('click', function () {
      if (folds.has(c.dataset.cid)) folds.delete(c.dataset.cid); else folds.add(c.dataset.cid);
      ls.set(FOLD_KEY, JSON.stringify(Array.from(folds))); paint();
    });
    title.append(pin, fold);
  });
  function paint() {
    cards.forEach(function (c) {
      var p = pins.has(c.dataset.cid), f = folds.has(c.dataset.cid);
      c.classList.toggle('folded', f);
      var pb = $('.pin-btn', c), fb = $('.card-fold', c);
      if (pb) pb.setAttribute('aria-pressed', p ? 'true' : 'false');
      if (fb) fb.setAttribute('aria-expanded', f ? 'false' : 'true');
    });
  }
  paint();

  /* ---------- Поиск по настройкам ---------- */
  var search = $('#setSearch');
  function applyView() {
    var tab = window.AVTab || 'frame', q = norm(search.value.trim()), shown = 0;
    cards.forEach(function (c) {
      var vis = q ? norm(c.textContent).indexOf(q) >= 0 : (c.dataset.tab === tab || pins.has(c.dataset.cid));
      c.hidden = !vis; if (vis) shown++;
    });
    $('#setNone').hidden = !(q && !shown);
    $('#setSearchClear').hidden = !q;
    $('#settingsTabs').classList.toggle('searching', !!q);
  }
  search.addEventListener('input', applyView);
  search.addEventListener('keydown', function (e) { if (e.key === 'Escape') { search.value = ''; applyView(); } });
  $('#setSearchClear').addEventListener('click', function () { search.value = ''; applyView(); search.focus(); });
  document.addEventListener('avtab', function () { if (search.value) { search.value = ''; } applyView(); });
  applyView();

  /* ---------- Наборы настроек ---------- */
  var KEEP = ['rw', 'rh', 'mode', 'color', 'speed', 'fadeIn', 'fadeOut', 'mute', 'vol', 'norm', 'short', 'fps', 'quality',
    'nameTpl', 'translit', 'counter', 'wmOn', 'wmType', 'wmText', 'wmColor', 'wmShadow', 'wmOpacity', 'wmSize', 'wmPos', 'wmMargin', 'wmAngle', 'wmWhen', 'wmSec',
    'capPos', 'capSize', 'capColor', 'capBox', 'capLook', 'capFont', 'capHi', 'cropZoom', 'stab', 'format', 'faceMode'];
  var presets = jget(PRESETS_KEY, []);
  if (!Array.isArray(presets)) presets = [];
  function savePresets() { ls.set(PRESETS_KEY, JSON.stringify(presets)); }
  function drawPresets() {
    var box = $('#presetList'); box.replaceChildren();
    presets.forEach(function (p, i) {
      var wrap = el('span', 'preset');
      var b = el('button', 'chip', p.name); b.type = 'button';
      b.addEventListener('click', function () { setMany(p.set); toast('Набор «' + p.name + '» применён'); });
      var x = el('button', 'preset-x', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'Удалить набор «' + p.name + '»');
      x.addEventListener('click', function () { presets.splice(i, 1); savePresets(); drawPresets(); toast('Набор удалён'); });
      wrap.append(b, x); box.appendChild(wrap);
    });
    $('#presetEmpty').hidden = presets.length > 0;
  }
  $('#presetSave').addEventListener('click', function () {
    var inp = $('#presetName'), name = inp.value.trim().slice(0, 30);
    if (!name) { toast('Напиши название набора', true); inp.focus(); return; }
    var set0 = {}; KEEP.forEach(function (k) { set0[k] = S[k]; });
    var at = presets.findIndex(function (p) { return p.name === name; });
    if (at >= 0) presets[at].set = set0;
    else { if (presets.length >= 12) { toast('Можно хранить до 12 наборов. Удали ненужный.', true); return; } presets.push({ name: name, set: set0 }); }
    savePresets(); drawPresets(); inp.value = ''; toast('Набор «' + name + '» сохранён');
  });
  $('#presetName').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#presetSave').click(); });
  drawPresets();

  /* ---------- Тема и акцент ---------- */
  function paintThemeSeg() {
    var m = ls.get(THEME_KEY); m = m === 'light' || m === 'dark' ? m : 'auto';
    $$('#themeSeg button').forEach(function (b) { var on = b.dataset.mode === m; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  }
  $('#themeSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.mode === 'auto') ls.del(THEME_KEY); else ls.set(THEME_KEY, b.dataset.mode);
    window.applyTheme(); paintThemeSeg();
  });
  document.addEventListener('avtheme', paintThemeSeg);
  paintThemeSeg();

  var ACCENTS = [['violet', 262, 'Фиолетовый'], ['blue', 217, 'Синий'], ['teal', 174, 'Бирюзовый'], ['green', 142, 'Зелёный'], ['orange', 28, 'Оранжевый'], ['pink', 330, 'Розовый']];
  var accentSheet = (function () {   // конструируемая таблица стилей: работает и с жёсткой политикой безопасности
    try { var sh = new CSSStyleSheet(); document.adoptedStyleSheets = document.adoptedStyleSheets.concat([sh]); return { set: function (t) { sh.replaceSync(t || ''); } }; }
    catch (e) { var st = document.head.appendChild(document.createElement('style')); return { set: function (t) { st.textContent = t || ''; } }; }
  })();
  function hslRgb(h, s, l) { s /= 100; l /= 100; var a = s * Math.min(l, 1 - l); var f = function (n) { var k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return [f(0), f(8), f(4)].map(function (x) { return x * 255; }); }
  function relLum(c) { var q = c.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * q[0] + 0.7152 * q[1] + 0.0722 * q[2]; }
  function contrast(a, b) { var x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function palette(h) {      // подбираем яркость так, чтобы текст на цвете читался (контраст не ниже 4,5:1) в обеих темах
    var lp = 36; while (lp > 16 && (contrast(hslRgb(h, 70, lp), [255, 255, 255]) < 4.8 || contrast(hslRgb(h, 70, lp), [250, 248, 255]) < 4.8)) lp--;
    var dc = 36, opc = hslRgb(h, 100, 97); while (dc > 18 && contrast(hslRgb(h, 65, dc), opc) < 5) dc--;
    return { lp: lp, dc: dc };
  }
  function applyAccent(id) {
    var a = ACCENTS.filter(function (x) { return x[0] === id; })[0] || ACCENTS[0], h = a[1], pl = palette(h);
    accentSheet.set(a[0] === 'violet' ? '' :
      ':root { --md-sys-color-primary: hsl(' + h + ' 90% 82%); --md-sys-color-on-primary: hsl(' + h + ' 70% 16%); --md-sys-color-primary-container: hsl(' + h + ' 65% ' + pl.dc + '%); --md-sys-color-on-primary-container: hsl(' + h + ' 100% 97%); }\n' +
      '[data-theme="light"] { --md-sys-color-primary: hsl(' + h + ' 70% ' + pl.lp + '%); --md-sys-color-on-primary: #fff; --md-sys-color-primary-container: hsl(' + h + ' 90% 93%); --md-sys-color-on-primary-container: hsl(' + h + ' 70% 18%); }');
    $$('#accentRow .accent-dot').forEach(function (b) { var on = b.dataset.id === a[0]; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    ls.set(ACCENT_KEY, a[0]);
  }
  ACCENTS.forEach(function (a) {
    var b = el('button', 'accent-dot'); b.type = 'button'; b.dataset.id = a[0];
    b.style.background = 'hsl(' + a[1] + ' 70% 52%)'; b.title = a[2]; b.setAttribute('aria-label', 'Акцент: ' + a[2]);
    b.addEventListener('click', function () { applyAccent(a[0]); });
    $('#accentRow').appendChild(b);
  });
  applyAccent(ls.get(ACCENT_KEY) || 'violet');

  /* ---------- Мини-обучение ---------- */
  var STEPS = [
    ['video', 'Добавь видео', 'Нажми на область загрузки или перетащи файлы. Можно сразу несколько: они встанут в очередь.'],
    ['frame', 'Выбери формат', 'Во вкладке «Кадр» укажи пропорции или готовый сценарий (Reels, YouTube и другие). Видео не обрезается: пустые поля заполняются размытием, зеркалом или цветом.'],
    ['video', 'Обрежь и поправь звук', 'Во вкладке «Видео» тяни края полосы, чтобы обрезать. Там же скорость, поворот, подписи, вырезание пауз по речи и поиск сцен.'],
    ['droplet', 'Знак и подписи', 'Во вкладке «Знак» добавь текст или картинку поверх видео. Подписи (в том числе с подсветкой слов) лежат во вкладке «Видео».'],
    ['save', 'Размер и качество', 'Во вкладке «Экспорт» выбери формат, качество и лимит размера в мегабайтах. Кнопка «Проверить» измерит скорость устройства и подскажет настройки.'],
    ['shield', 'Данные файла', 'Вкладка «Данные» показывает, что внутри исходника (дата, устройство, координаты) и что попадёт в результат. Координаты по умолчанию не переносятся.'],
    ['save', 'Сохрани результат', 'Кнопка внизу соберёт видео. Всё работает на твоём устройстве, ничего не отправляется. Несколько готовых видео можно скачать одним архивом.']
  ];
  var step = 0, opener = null;
  function onbRender() {
    var s = STEPS[step], last = step === STEPS.length - 1;
    $('#onbIc').replaceChildren(svgIcon(s[0]));
    $('#onbTitle').textContent = s[1]; $('#onbText').textContent = s[2];
    $('#onbStep').textContent = (step + 1) + ' / ' + STEPS.length;
    $('#onbDots').replaceChildren.apply($('#onbDots'), STEPS.map(function (_, i) { return el('i', i === step ? 'on' : i < step ? 'done' : ''); }));
    $('#onbDots').style.setProperty('--n', STEPS.length);
    $('#onbNext').textContent = last ? 'Понятно' : 'Далее';
    $('#onbSkip').hidden = last; $('#onbBack').hidden = step === 0;
    ['#onbIc', '#onbBody'].forEach(function (q) { var n = $(q); n.style.animation = 'none'; void n.offsetWidth; n.style.animation = ''; });   // анимация появления на каждом шаге
  }
  function onbOpen() { opener = document.activeElement; step = 0; onbRender(); $('#onboard').hidden = false; $('#onbNext').focus(); }
  function onbClose() { $('#onboard').hidden = true; ls.set(ONB_KEY, '1'); if (opener && opener.focus) opener.focus(); }
  $('#onbBack').addEventListener('click', function () { if (step > 0) { step--; onbRender(); } });
  $('#onbNext').addEventListener('click', function () { if (step >= STEPS.length - 1) onbClose(); else { step++; onbRender(); } });
  $('#onbSkip').addEventListener('click', onbClose);
  $('#helpBtn').addEventListener('click', onbOpen);
  $('#onbBtn').addEventListener('click', onbOpen);
  $('#onboard').addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.stopPropagation(); onbClose(); }
    else if (e.key === 'Tab') {
      var f = $$('button:not([hidden])', $('#onboard')), i = f.indexOf(document.activeElement);
      e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
  });
  /* показываем один раз и только новичкам: тем, у кого сайт уже стоял, обучение не навязываем */
  if (!ls.get(ONB_KEY)) { if (!ls.get(SEEN_KEY)) setTimeout(onbOpen, 500); else ls.set(ONB_KEY, '1'); }

  /* ---------- Компоненты ---------- */
  var COMPS = [{
    id: 'faces', icon: 'user', bytes: 1735240, name: 'Поиск лиц', size: '~1,7 МБ',
    desc: 'Нужен для «Следить за лицом» в режиме «Обрезать». Модель BlazeFace, работает на устройстве.',
    files: ['vendor/tfjs/runtime.js', 'vendor/tfjs/tfjs-backend-wasm-simd.wasm', 'vendor/tfjs/tfjs-backend-wasm.wasm', 'vendor/blazeface/blazeface-back.json', 'vendor/blazeface/blazeface-back.bin'],
    sha: {
      'vendor/tfjs/runtime.js': '9e8bf788fe935bea77e4591fd5c0c7499f11e7075d97787df26c1368e3cc5c15',
      'vendor/tfjs/tfjs-backend-wasm-simd.wasm': '77ebb28a6d34f371dbbf2086b7f2de8994acd8ea5a3cf1fa24d2c26c840cac7b',
      'vendor/tfjs/tfjs-backend-wasm.wasm': '70a5d516060464e5269f01c74bac1772d6b8ab6cb612acf16b5cdaf61f78d892',
      'vendor/blazeface/blazeface-back.json': 'a765f7b2a6c1d841ecc0b0686e5f51b141b39b7bcdf2888542dc9d9fc4384a87',
      'vendor/blazeface/blazeface-back.bin': 'dc9a97fdc50bc43216554bdd69aa3e7b9361a519ee7bdd996a2f69a98a6f9b72'
    }
  }, {
    id: 'denoise', icon: 'sparkles', bytes: 124406, name: 'Шумоподавление', size: '~0,1 МБ',
    desc: 'Нужен для «Убрать шум» на вкладке «Видео». Нейросеть RNNoise, работает на устройстве.',
    files: ['vendor/rnnoise/rnnoise.js', 'vendor/rnnoise/rnnoise.wasm'],
    sha: {
      'vendor/rnnoise/rnnoise.js': '83a86f528a0f4d5c61a84be40dac9f15e5d114f24971bd5953f7f21879bc9bdf',
      'vendor/rnnoise/rnnoise.wasm': '677147b9248aedc0a00de79dc090d1ecead37c08c8bb773a790da16109d2c487'
    }
  }, {
    id: 'speech', icon: 'copy', bytes: 60087090, name: 'Распознавание речи', size: '~60 МБ',
    desc: 'Нужен для «Распознать речь» в подписях: автосубтитры. Модель Whisper tiny, работает на устройстве, звук никуда не уходит.',
    files: [
      'vendor/whisper/models/Xenova/whisper-tiny/added_tokens.json',
      'vendor/whisper/models/Xenova/whisper-tiny/config.json',
      'vendor/whisper/models/Xenova/whisper-tiny/generation_config.json',
      'vendor/whisper/models/Xenova/whisper-tiny/merges.txt',
      'vendor/whisper/models/Xenova/whisper-tiny/normalizer.json',
      'vendor/whisper/models/Xenova/whisper-tiny/onnx/decoder_model_merged_quantized.onnx',
      'vendor/whisper/models/Xenova/whisper-tiny/onnx/encoder_model_quantized.onnx',
      'vendor/whisper/models/Xenova/whisper-tiny/preprocessor_config.json',
      'vendor/whisper/models/Xenova/whisper-tiny/processor_config.json',
      'vendor/whisper/models/Xenova/whisper-tiny/special_tokens_map.json',
      'vendor/whisper/models/Xenova/whisper-tiny/tokenizer.json',
      'vendor/whisper/models/Xenova/whisper-tiny/tokenizer_config.json',
      'vendor/whisper/models/Xenova/whisper-tiny/vocab.json',
      'vendor/whisper/ort-wasm-simd-threaded.mjs',
      'vendor/whisper/ort-wasm-simd-threaded.wasm',
      'vendor/whisper/transformers.min.js'
    ],
    sha: {
      'vendor/whisper/models/Xenova/whisper-tiny/added_tokens.json': 'ce949fe720c14311cb6c446e69cfe340dc669d7b006077a6feed6ae571dd7e88',
      'vendor/whisper/models/Xenova/whisper-tiny/config.json': '2b2e4e519084e0ea028b19b153f95202735a971870d6844aa26e559edd292e94',
      'vendor/whisper/models/Xenova/whisper-tiny/generation_config.json': '68ac791fcb4999461a313472125042934656240ba1cba7d1c2627fcbb19ac24c',
      'vendor/whisper/models/Xenova/whisper-tiny/merges.txt': '2df2990a395e35e8dfbc7511e08c12d56018d8d04691e0133e5d63b21e154dc6',
      'vendor/whisper/models/Xenova/whisper-tiny/normalizer.json': 'bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd',
      'vendor/whisper/models/Xenova/whisper-tiny/onnx/decoder_model_merged_quantized.onnx': '6c0c125986b007d2e3734bec84c18bda0152071b90b87fadac6d7764499927a0',
      'vendor/whisper/models/Xenova/whisper-tiny/onnx/encoder_model_quantized.onnx': 'fd9d995b9dcb0520f0dbf6cf68651af639fc385f594d9d876e69ca2802dc438e',
      'vendor/whisper/models/Xenova/whisper-tiny/preprocessor_config.json': 'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d',
      'vendor/whisper/models/Xenova/whisper-tiny/processor_config.json': 'c0bf2ef5d6acab18933e7f406f5ca5b641a96e3c072d5fae7dbf786152607f68',
      'vendor/whisper/models/Xenova/whisper-tiny/special_tokens_map.json': 'e67ae3a0aaa99abcd9f187138e12db1f65c16a14761c50ef10eef2c174a7a691',
      'vendor/whisper/models/Xenova/whisper-tiny/tokenizer.json': '27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566',
      'vendor/whisper/models/Xenova/whisper-tiny/tokenizer_config.json': '2a4c4281cf9f51ac6ccc406fdc711a087afe6530f671fa7b80953edc498275ce',
      'vendor/whisper/models/Xenova/whisper-tiny/vocab.json': '50d6a919f0a0601d56a04eb583c780d18553aa388254ba3158eb6a00f13e2c1a',
      'vendor/whisper/ort-wasm-simd-threaded.mjs': 'c57ca56328877353a575e51bbca6f18450027d6c9bf2307a2cb2c41363b4de9f',
      'vendor/whisper/ort-wasm-simd-threaded.wasm': '06ba057753da3847e4c24f02d91ab133455b0817c69a44993a9a53a2146df9e3',
      'vendor/whisper/transformers.min.js': '8b5a3171f8876bab2b1820a7d65eb87628e3d30bb5ea85b9dd398e76eb34decb'
    }
  }];
  var abs = function (p) { return new URL(p, location.href).href; };
  /* Компоненты лежат в файловой системе сайта (OPFS, папка aspect-video-components), а не в кэше сайта: их не сносит обновление версии.
     Service worker отдаёт их оттуда. Где OPFS нет (старый Safari), остаётся кэш сайта. */
  var COMP_DIR = 'aspect-video-components';
  var HAS_OPFS = !!(navigator.storage && navigator.storage.getDirectory && window.FileSystemFileHandle && FileSystemFileHandle.prototype.createWritable);
  var fname = function (p) { return encodeURIComponent(p); };
  async function cdir(create) { return (await navigator.storage.getDirectory()).getDirectoryHandle(COMP_DIR, { create: !!create }); }
  async function opfsSize(p) { try { return (await (await (await cdir()).getFileHandle(fname(p))).getFile()).size; } catch (e) { return -1; } }
  async function opfsDel(p) { try { await (await cdir()).removeEntry(fname(p)); } catch (e) { /* файла нет */ } }
  async function swCaches() {
    if (!('caches' in window)) return [];
    var keys = (await caches.keys()).filter(function (k) { return /^aspect-video-v\d+/.test(k); }).sort();
    return keys.length ? [await caches.open(keys[keys.length - 1])] : [];
  }
  /* 'ok' | 'part' | 'none' и где лежит: 'opfs' | 'cache' */
  /* комплект полный, если есть все файлы, кроме одного из двух wasm (второй нужен только на части устройств) */
  function compComplete(c, have) {
    var wasm = c.files.filter(function (f) { return /\.wasm$/.test(f); }), rest = c.files.filter(function (f) { return !/\.wasm$/.test(f); });
    return rest.every(function (f) { return have.indexOf(f) >= 0; }) && (!wasm.length || wasm.some(function (f) { return have.indexOf(f) >= 0; }));
  }
  async function compInfo(c) {
    var inO = [], inC = [], i, cs = await swCaches();
    if (HAS_OPFS) for (i = 0; i < c.files.length; i++) if ((await opfsSize(c.files[i])) > 0) inO.push(c.files[i]);
    if (cs.length) for (i = 0; i < c.files.length; i++) if (await cs[0].match(abs(c.files[i]), { ignoreSearch: true })) inC.push(c.files[i]);
    var okO = compComplete(c, inO), okC = compComplete(c, inC), any = inO.length || inC.length;
    return { st: okO || okC ? 'ok' : any ? 'part' : 'none', where: okO || inO.length >= inC.length ? 'opfs' : 'cache' };
  }
  /* Раньше файлы клали в кэш сайта: переносим в OPFS, чтобы они пережили обновление */
  async function migrateComps() {
    if (!HAS_OPFS) return;
    await opfsDel('js/faces-worker.js');          // скрипт воркера теперь всегда берётся из версии сайта
    try {
      var cs = await swCaches(); if (!cs.length) return;
      for (var k = 0; k < COMPS.length; k++) for (var j = 0; j < COMPS[k].files.length; j++) {
        var f = COMPS[k].files[j];
        if ((await opfsSize(f)) > 0) continue;
        var hit = await cs[0].match(abs(f), { ignoreSearch: true });
        if (hit && hit.ok) { await writeOpfs(f, hit); await cs[0].delete(abs(f), { ignoreSearch: true }); }
      }
    } catch (e) { /* перенос необязателен */ }
  }
  async function writeOpfs(p, res, onBytes) {
    var fh = await (await cdir(true)).getFileHandle(fname(p), { create: true }), w = await fh.createWritable(), got = 0;
    try {
      if (res.body && res.body.getReader) { var rd = res.body.getReader(); for (;;) { var r = await rd.read(); if (r.done) break; await w.write(r.value); got += r.value.length; if (onBytes) onBytes(r.value.length); } }
      else { var b = await res.blob(); await w.write(b); got = b.size; }
      if (!got) throw new Error('пустой файл ' + p);
      await w.close();
    } catch (e) { try { await w.abort(); } catch (e2) { /* уже закрыт */ } await opfsDel(p); throw e; }   // кусков не оставляем
    return got;
  }
  /* SHA-256 файла из OPFS: подменённый или битый файл не должен остаться в хранилище */
  async function sha256Of(p) {
    var buf = await (await (await cdir()).getFileHandle(fname(p))).getFile().then(function (f) { return f.arrayBuffer(); });
    var h = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(h), function (x) { return x.toString(16).padStart(2, '0'); }).join('');
  }
  /* состояние идущих скачиваний: id → { done, total, idx, n, file, t0, last, speed, phase, ctrl } */
  var DL = {}, REF = {};
  var STATUS = { ok: ['Готово', 'ok'], part: ['Не полностью', 'part'], none: ['Не скачано', 'none'], busy: ['Скачивание', 'busy'] };
  function baseName(p) { return p.split('/').pop(); }
  function paintComp(c) {
    var r = REF[c.id], d = DL[c.id]; if (!r) return;
    r.row.classList.toggle('busy', !!d);
    if (!d) return;
    var frac = d.total ? Math.min(0.99, d.done / d.total) : 0, left = d.speed > 1000 ? (d.total - d.done) / d.speed : 0;
    r.bar.style.width = (d.phase === 'check' || d.phase === 'wait' ? Math.max(frac, 0.02) : frac) * 100 + '%';
    r.bar.parentNode.setAttribute('aria-valuenow', String(Math.round(frac * 100)));
    r.pct.textContent = Math.round(frac * 100) + '%';
    var line = d.phase === 'check' ? 'Проверяю подлинность: ' + baseName(d.file) : d.phase === 'wait' ? 'Подключаюсь…' : fmtBytes(d.done) + ' из ' + fmtBytes(d.total) + (d.speed > 1000 ? ' · ' + fmtBytes(d.speed) + '/с' : '') + (left > 1 ? ' · осталось ~' + Math.floor(left / 60) + ':' + String(Math.round(left % 60) % 60).padStart(2, '0') : '');
    r.pline.textContent = line;
    r.pfile.textContent = Math.min(d.idx + 1, d.n) + '/' + d.n + ' · ' + baseName(d.file);
  }
  async function drawComps() {
    var box = $('#compList'), mine = (drawComps.seq = (drawComps.seq || 0) + 1), frag = document.createDocumentFragment(), refs = {}, have = 0, tot = 0;
    if (!drawComps.migrated) { drawComps.migrated = true; await migrateComps(); }
    for (var i = 0; i < COMPS.length; i++) {
      var c = COMPS[i], inf = await compInfo(c), st = inf.st, busy = !!DL[c.id];
      if (st === 'ok') have++; tot += c.bytes || 0;
      var row = el('article', 'comp-card ' + (busy ? 'busy' : st));
      var ic = el('div', 'comp-ic'); ic.appendChild(svgIcon(c.icon || 'box'));
      var head = el('div', 'comp-head'), title = el('div', 'comp-title');
      var meta = el('div', 'comp-meta');
      var pill = el('span', 'comp-pill ' + (busy ? 'busy' : st), (busy ? STATUS.busy : STATUS[st])[0]);
      meta.append(el('span', 'comp-size', c.size), pill); title.append(el('b', '', c.name), meta); head.append(ic, title);
      var desc = el('p', 'comp-desc', c.desc);
      var where = el('small', 'comp-where', st === 'ok' ? 'Работает без интернета' + (inf.where === 'opfs' ? ' · хранится в памяти сайта, обновление его не стирает' : '') : st === 'part' ? 'Часть файлов осталась. Скачай заново, чтобы всё работало без интернета.' : 'С интернетом работает и так: файлы подгрузятся при первом использовании.');
      var prog = el('div', 'comp-prog');
      var track = el('div', 'bar'); track.setAttribute('role', 'progressbar'); track.setAttribute('aria-label', 'Скачивание: ' + c.name); track.setAttribute('aria-valuemin', '0'); track.setAttribute('aria-valuemax', '100'); track.setAttribute('aria-valuenow', '0');
      var bar = el('i'); track.appendChild(bar);
      var ptop = el('div', 'comp-ptop'), pline = el('span', 'comp-pline', '…'), pct = el('b', 'mono', '0%'); ptop.append(pline, pct);
      var pfile = el('small', 'comp-pfile', '');
      prog.append(ptop, track, pfile); prog.setAttribute('role', 'status');
      var acts = el('div', 'comp-acts');
      var dl = el('button', 'btn btn-tonal btn-sm', st === 'ok' ? 'Скачать заново' : 'Скачать'); dl.type = 'button';
      var cancel = el('button', 'btn btn-outlined btn-sm', 'Отменить'); cancel.type = 'button';
      var rm = el('button', 'btn btn-outlined btn-sm danger', 'Удалить'); rm.type = 'button'; rm.disabled = st === 'none';
      dl.addEventListener('click', (function (cc) { return function () { downloadComp(cc); }; })(c));
      cancel.addEventListener('click', (function (cc) { return function () { if (DL[cc.id] && DL[cc.id].ctrl) DL[cc.id].ctrl.abort(); }; })(c));
      rm.addEventListener('click', (function (cc) { return async function () { await removeComp(cc); toast('Удалено: ' + cc.name); drawComps(); drawStorage(); }; })(c));
      acts.append(dl, cancel, rm);
      var body = el('div', 'comp-body'); body.append(head, desc, where, prog, acts);
      row.append(body); frag.appendChild(row);
      refs[c.id] = { row: row, bar: bar, pct: pct, pline: pline, pfile: pfile };
    }
    if (mine === drawComps.seq) {                    // поздний старый вызов не затирает свежий
      REF = refs; box.replaceChildren(frag);
      var sum = $('#compSum'); if (sum) sum.textContent = 'Скачано: ' + have + ' из ' + COMPS.length;
      COMPS.forEach(paintComp);
    }
  }
  async function downloadComp(c) {
    if (DL[c.id]) return;
    var d = DL[c.id] = { done: 0, total: c.bytes || 1, idx: 0, n: c.files.length, file: c.files[0], t0: Date.now(), last: Date.now(), speed: 0, phase: 'wait', ctrl: new AbortController() };
    var onBytes = function (n) {
      d.done += n; d.acc = (d.acc || 0) + n; d.phase = 'get'; var now = Date.now(), dt = (now - d.last) / 1000;
      if (dt >= 0.5) { var inst = d.acc / dt; d.speed = d.speed ? d.speed * 0.7 + inst * 0.3 : inst; d.acc = 0; d.last = now; paintComp(c); }
    };
    drawComps();
    try {
      var okList = [], bad = '', cs = HAS_OPFS ? [] : await swCaches();
      if (!HAS_OPFS && !cs.length) { toast('Сайт ещё не установлен для офлайна. Открой его по https и подожди минуту.', true); return; }
      for (var i = 0; i < c.files.length; i++) {
        d.idx = i; d.file = c.files[i]; d.phase = 'wait'; paintComp(c);
        try {
          var r = await fetch(abs(c.files[i]), { cache: 'reload', signal: d.ctrl.signal });
          if (!r.ok) continue;
          if (HAS_OPFS) {
            var before = d.done;
            await writeOpfs(c.files[i], r, onBytes);
            d.phase = 'check'; paintComp(c);
            if (c.sha && c.sha[c.files[i]] && window.crypto && crypto.subtle && (await sha256Of(c.files[i])) !== c.sha[c.files[i]]) {
              await opfsDel(c.files[i]); bad = c.files[i]; d.done = before; continue;
            }
          } else { await cs[0].put(abs(c.files[i]), r); d.done += 1; }
          okList.push(c.files[i]);
        } catch (e) { if (e && e.name === 'AbortError') throw e; /* один из wasm может отсутствовать, это не ошибка */ }
      }
      var ok = okList.length;
      if (HAS_OPFS && ok && navigator.storage.persist) { try { await navigator.storage.persist(); } catch (e3) { /* браузер решит сам */ } }
      if (bad) { toast('Файл не прошёл проверку подлинности и не сохранён: ' + bad, true); return; }
      var full = compComplete(c, okList);
      toast(full ? 'Скачано: ' + c.name : 'Скачано не всё. Проверь соединение и повтори.', !full);
    } catch (e) {
      if (e && e.name === 'AbortError') toast('Скачивание остановлено: ' + c.name);
      else { logError(e, 'компоненты'); toast('Не получилось скачать: ' + (e && e.message), true); }
    } finally { delete DL[c.id]; drawComps(); drawStorage(); }
  }
  async function removeComp(c) {
    var cs = await swCaches();
    var sweep = async function () {
      for (var j = 0; j < c.files.length; j++) {
        if (HAS_OPFS) await opfsDel(c.files[j]);
        for (var i = 0; i < cs.length; i++) await cs[i].delete(abs(c.files[j]), { ignoreSearch: true });
      }
    };
    await sweep();
    await new Promise(function (r) { setTimeout(r, 700); });   // файл, который грузился в этот момент, мог лечь в хранилище уже после удаления
    await sweep();
  }

  /* ---------- Место на устройстве ---------- */
  async function opfsInfo() {
    if (!AV.hasOpfs()) return null;
    var n = 0, size = 0;
    try {
      var root = await navigator.storage.getDirectory();
      for await (var e of root.values()) { if (e.kind === 'file') { n++; size += (await e.getFile()).size; } }
    } catch (err) { /* нет доступа */ }
    return { n: n, size: size };
  }
  async function drawStorage() {
    var out = $('#storageOut'); out.replaceChildren();
    var add = function (a, b) { var r = el('div', 'sp-row'); r.append(el('span', '', a), el('b', '', b)); out.append(r); };
    try {
      var est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
      if (est) { add('Занято сайтом', fmtBytes(est.usage || 0)); add('Свободно для записи', fmtBytes(Math.max(0, (est.quota || 0) - (est.usage || 0)))); }
      var o = await opfsInfo();
      if (o) add('Временные файлы записи', o.n ? o.n + ' шт., ' + fmtBytes(o.size) : 'нет');
      var cs = await swCaches(), nf = 0;
      if (cs.length) nf = (await cs[0].keys()).length;
      add('Файлов сайта в кэше', cs.length ? String(nf) : 'кэша пока нет');
      if (HAS_OPFS) {
        var cn = 0, cb = 0;
        try { var d = await cdir(); for await (var ent of d.values()) { if (ent.kind === 'file') { cn++; cb += (await ent.getFile()).size; } } } catch (e4) { /* папки ещё нет */ }
        add('Компоненты в памяти сайта', cn ? cn + ' шт., ' + fmtBytes(cb) : 'нет');
      }
    } catch (e) { out.textContent = 'Не удалось получить данные.'; }
  }
  $('#storageRefresh').addEventListener('click', drawStorage);
  $('#tmpClear').addEventListener('click', async function () {
    var inUse = window.AVApp && window.AVApp.results().some(function (r) { return r.streamed; });
    if (inUse && !confirm('Готовые видео из списка перестанут скачиваться. Удалить временные файлы?')) return;
    await AV.cleanOpfs(); toast('Временные файлы удалены'); drawStorage();
  });
  document.addEventListener('avtab', function (e) { if (e.detail === 'components') { drawComps(); drawStorage(); } });
  if (window.AVTab === 'components') { drawComps(); drawStorage(); }
})();
