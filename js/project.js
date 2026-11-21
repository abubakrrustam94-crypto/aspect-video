'use strict';
/* Aspect Studio Video — последний проект.
   Хранит в IndexedDB только описание: имена файлов, размеры, фрагмент, вырезанные паузы, подписи, поворот. Самих видео здесь нет
   (они остаются на устройстве, а при открытии проекта вы выбираете те же файлы). Запись идёт сама, когда что-то меняется;
   пустая очередь стирает проект. Настройки формата и качества и так хранятся отдельно, в localStorage. */
(function () {
  var AV = (window.AV = window.AV || {});
  var DB = 'aspect-video-project', STORE = 'kv', chain = Promise.resolve();

  function open() {
    return new Promise(function (res, rej) {
      if (!window.indexedDB) { rej(new Error('нет IndexedDB')); return; }
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(STORE); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error || new Error('IndexedDB')); };
      r.onblocked = function () { rej(new Error('IndexedDB занята')); };
    });
  }
  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(STORE, mode), out = fn(t.objectStore(STORE));
        t.oncomplete = function () { db.close(); res(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { db.close(); rej(t.error); };
        t.onabort = function () { db.close(); rej(t.error || new Error('отменено')); };
      });
    });
  }
  function queue(fn) {                                  // записи идут по очереди и не роняют приложение
    chain = chain.then(fn).catch(function (e) { if (window.logError) window.logError(e, 'проект'); });
    return chain;
  }
  /* Только допустимые поля нужных типов: данные из хранилища не доверяем */
  function clean(m) {
    if (!m || (m.v !== 1 && m.v !== 2) || !Array.isArray(m.items) || !m.items.length) return null;
    var items = [];
    for (var i = 0; i < Math.min(m.items.length, 50); i++) {
      var x = m.items[i];
      if (!x || typeof x.name !== 'string' || typeof x.size !== 'number') continue;
      var num = function (v) { return typeof v === 'number' && isFinite(v) && v >= 0 ? v : null; };
      var caps = Array.isArray(x.caps) ? x.caps.filter(function (c) { return c && typeof c.text === 'string' && num(c.start) !== null && num(c.end) !== null; })
        .slice(0, 500).map(function (c) { return { text: c.text.slice(0, 200), start: c.start, end: c.end }; }) : [];
      var cuts = Array.isArray(x.cuts) ? x.cuts.filter(function (c) { return Array.isArray(c) && num(c[0]) !== null && num(c[1]) !== null && c[1] > c[0]; }).slice(0, 500).map(function (c) { return [c[0], c[1]]; }) : null;
      var spd = Array.isArray(x.spd) ? x.spd.filter(function (r) { return r && num(r.start) !== null && num(r.end) !== null && r.end > r.start && num(r.speed) !== null && r.speed >= 0.1 && r.speed <= 8; })
        .slice(0, 100).map(function (r) { return { start: r.start, end: r.end, speed: r.speed }; }) : [];
      var tap = x.tap && num(x.tap.x) !== null && num(x.tap.y) !== null ? { x: Math.min(1, x.tap.x), y: Math.min(1, x.tap.y) } : null;
      items.push({
        name: x.name.slice(0, 300), size: x.size, start: num(x.start) || 0, end: num(x.end), cuts: cuts && cuts.length ? cuts : null, caps: caps, tap: tap, spd: spd,
        rot: [0, 90, 180, 270].indexOf(x.rot) >= 0 ? x.rot : 0, fh: x.fh === true, fv: x.fv === true
      });
    }
    return items.length ? { v: 2, ts: typeof m.ts === 'number' ? m.ts : 0, items: items } : null;
  }
  AV.project = {
    load: async function () { try { return clean(await tx('readonly', function (st) { return st.get('meta'); })); } catch (e) { return null; } },
    save: function (m) { var copy = JSON.parse(JSON.stringify(m)); return queue(function () { return tx('readwrite', function (st) { st.put(copy, 'meta'); }); }); },
    clear: function () { return queue(function () { return tx('readwrite', function (st) { st.clear(); }); }); },
    clean: clean,
    /* Файл проекта (.avproj): описание работы и настройки. Текст разбирается так же осторожно, как данные из хранилища. */
    toFile: function (items, settings) {
      return JSON.stringify({ app: 'aspect-studio-video', v: 2, ts: Date.now(), ver: typeof APP_VERSION === 'string' ? APP_VERSION : '', items: items, settings: settings }, null, 1);
    },
    parseFile: function (text) {
      var o; try { o = JSON.parse(text); } catch (e) { return null; }
      if (!o || o.app !== 'aspect-studio-video') return null;
      var m = clean(o); if (!m) return null;
      var st = {};
      if (o.settings && typeof o.settings === 'object') Object.keys(DEF).forEach(function (k) {
        if (k === 'mGps' || !Object.prototype.hasOwnProperty.call(o.settings, k)) return;
        var v = cleanVal(k, o.settings[k]); if (v !== undefined) st[k] = v;
      });
      m.settings = st; return m;
    }
  };
})();
