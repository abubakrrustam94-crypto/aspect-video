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
  var KEEP = ['rw', 'rh', 'mode', 'color', 'rot', 'flipH', 'flipV', 'speed', 'fadeIn', 'fadeOut', 'mute', 'vol', 'norm', 'short', 'fps', 'quality',
    'nameTpl', 'translit', 'counter', 'wmOn', 'wmType', 'wmText', 'wmColor', 'wmShadow', 'wmOpacity', 'wmSize', 'wmPos', 'wmMargin', 'wmAngle', 'wmWhen', 'wmSec',
    'capPos', 'capSize', 'capColor', 'capBox', 'stab', 'format', 'faceMode'];
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
    ['save', 'Сохрани результат', 'Кнопка внизу соберёт видео. Всё работает на твоём устройстве, ничего не отправляется.']
  ];
  var step = 0, opener = null;
  function onbRender() {
    var s = STEPS[step];
    $('#onbIc').replaceChildren(svgIcon(s[0]));
    $('#onbTitle').textContent = s[1]; $('#onbText').textContent = s[2];
    $('#onbDots').replaceChildren.apply($('#onbDots'), STEPS.map(function (_, i) { return el('i', i === step ? 'on' : ''); }));
    $('#onbNext').textContent = step === STEPS.length - 1 ? 'Понятно' : 'Далее';
    $('#onbSkip').hidden = step === STEPS.length - 1;
  }
  function onbOpen() { opener = document.activeElement; step = 0; onbRender(); $('#onboard').hidden = false; $('#onbNext').focus(); }
  function onbClose() { $('#onboard').hidden = true; ls.set(ONB_KEY, '1'); if (opener && opener.focus) opener.focus(); }
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
    id: 'faces', name: 'Поиск лиц', size: '~1,7 МБ',
    desc: 'Нужен для «Следить за лицом» в режиме «Обрезать». Модель BlazeFace, работает на устройстве.',
    files: ['vendor/tfjs/runtime.js', 'vendor/tfjs/tfjs-backend-wasm-simd.wasm', 'vendor/tfjs/tfjs-backend-wasm.wasm', 'vendor/blazeface/blazeface-back.json', 'vendor/blazeface/blazeface-back.bin'],
    sha: {
      'vendor/tfjs/runtime.js': '9e8bf788fe935bea77e4591fd5c0c7499f11e7075d97787df26c1368e3cc5c15',
      'vendor/tfjs/tfjs-backend-wasm-simd.wasm': '77ebb28a6d34f371dbbf2086b7f2de8994acd8ea5a3cf1fa24d2c26c840cac7b',
      'vendor/tfjs/tfjs-backend-wasm.wasm': '70a5d516060464e5269f01c74bac1772d6b8ab6cb612acf16b5cdaf61f78d892',
      'vendor/blazeface/blazeface-back.json': 'a765f7b2a6c1d841ecc0b0686e5f51b141b39b7bcdf2888542dc9d9fc4384a87',
      'vendor/blazeface/blazeface-back.bin': 'dc9a97fdc50bc43216554bdd69aa3e7b9361a519ee7bdd996a2f69a98a6f9b72'
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
  async function compState(c) { return (await compInfo(c)).st; }
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
  async function writeOpfs(p, res) {
    var fh = await (await cdir(true)).getFileHandle(fname(p), { create: true }), w = await fh.createWritable(), got = 0;
    try {
      if (res.body && res.body.getReader) { var rd = res.body.getReader(); for (;;) { var r = await rd.read(); if (r.done) break; await w.write(r.value); got += r.value.length; } }
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
  async function drawComps() {
    var box = $('#compList'), mine = (drawComps.seq = (drawComps.seq || 0) + 1), frag = document.createDocumentFragment();
    if (!drawComps.migrated) { drawComps.migrated = true; await migrateComps(); }
    for (var i = 0; i < COMPS.length; i++) {
      var c = COMPS[i], inf = await compInfo(c), st = inf.st;
      var row = el('div', 'comp-row'), info = el('div', 'comp-info');
      info.append(el('b', '', c.name + ' · ' + c.size), el('small', '', c.desc),
        el('small', 'comp-st' + (st === 'ok' ? ' ok' : ''), st === 'ok' ? 'Скачано: работает без интернета' + (inf.where === 'opfs' ? ' (в памяти сайта, не в кэше)' : '') : st === 'part' ? 'Скачано не полностью' : 'Не скачано: подгрузится при первом использовании'));
      var acts = el('div', 'res-acts');
      var dl = el('button', 'btn btn-tonal btn-sm', st === 'ok' ? 'Скачать заново' : 'Скачать'); dl.type = 'button';
      dl.addEventListener('click', (function (cc, btn) { return async function () { btn.disabled = true; btn.textContent = 'Скачиваю…'; await downloadComp(cc); drawComps(); }; })(c, dl));
      var rm = el('button', 'btn btn-outlined btn-sm danger', 'Удалить'); rm.type = 'button'; rm.disabled = st === 'none';
      rm.addEventListener('click', (function (cc) { return async function () { await removeComp(cc); toast('Удалено: ' + cc.name); drawComps(); drawStorage(); }; })(c));
      acts.append(dl, rm); row.append(info, acts); frag.appendChild(row);
    }
    if (mine === drawComps.seq) box.replaceChildren(frag);   // поздний старый вызов не затирает свежий
  }
  async function downloadComp(c) {
    try {
      var okList = [], bad = '', cs = HAS_OPFS ? [] : await swCaches();
      if (!HAS_OPFS && !cs.length) { toast('Сайт ещё не установлен для офлайна. Открой его по https и подожди минуту.', true); return; }
      for (var i = 0; i < c.files.length; i++) {
        try {
          var r = await fetch(abs(c.files[i]), { cache: 'reload' });
          if (!r.ok) continue;
          if (HAS_OPFS) {
            await writeOpfs(c.files[i], r);
            if (c.sha && c.sha[c.files[i]] && window.crypto && crypto.subtle && (await sha256Of(c.files[i])) !== c.sha[c.files[i]]) {
              await opfsDel(c.files[i]); bad = c.files[i]; continue;
            }
          } else await cs[0].put(abs(c.files[i]), r);
          okList.push(c.files[i]);
        } catch (e) { /* один из wasm может отсутствовать, это не ошибка */ }
      }
      var ok = okList.length;
      if (HAS_OPFS && ok && navigator.storage.persist) { try { await navigator.storage.persist(); } catch (e3) { /* браузер решит сам */ } }
      if (bad) { toast('Файл не прошёл проверку подлинности и не сохранён: ' + bad, true); drawStorage(); return; }
      var full = compComplete(c, okList);
      toast(full ? 'Скачано: ' + c.name : 'Скачано не всё. Проверь соединение и повтори.', !full);
    } catch (e) { logError(e, 'компоненты'); toast('Не получилось скачать: ' + (e && e.message), true); }
    drawStorage();
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
