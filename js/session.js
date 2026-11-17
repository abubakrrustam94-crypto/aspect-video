'use strict';
/* Aspect Studio Video — продолжение после сбоя или закрытой вкладки.
   Перед сохранением очереди пишем журнал в IndexedDB: какие видео, какие у них настройки (фрагмент, паузы, подписи),
   какие группы уже готовы. Исходные файлы копируем туда же, если места хватает (иначе после сбоя попросим выбрать их заново).
   Готовые видео лежат в OPFS и переживают перезапуск. Журнал удаляется, когда сохранение закончилось или его отменили.
   Недоделанное видео продолжить нельзя: поток кодирования не восстановить, оно пойдёт заново. Готовые пропускаются. */
(function () {
  var AV = (window.AV = window.AV || {});
  var DB = 'aspect-video-session', STORE = 'kv', MAX_COPY = 700 * 1048576;
  var chain = Promise.resolve(), rec = null;

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
        var t = db.transaction(STORE, mode), st = t.objectStore(STORE), out = fn(st);
        t.oncomplete = function () { db.close(); res(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { db.close(); rej(t.error); };
        t.onabort = function () { db.close(); rej(t.error || new Error('отменено')); };
      });
    });
  }
  function queue(fn) {                                 // записи идут по очереди и не роняют приложение
    chain = chain.then(fn).catch(function (e) { if (window.logError) window.logError(e, 'журнал сохранения'); });
    return chain;
  }
  function keepNames() {
    AV.keepNames = rec ? rec.done.map(function (d) { return d.opfs; }).filter(Boolean) : [];
  }
  function putMeta() { var copy = JSON.parse(JSON.stringify(rec)); return tx('readwrite', function (st) { st.put(copy, 'meta'); }); }

  AV.session = {
    /* Возвращает журнал прошлого запуска или null */
    load: async function () {
      try {
        var m = await tx('readonly', function (st) { return st.get('meta'); });
        if (m && m.v === 1 && m.items && m.items.length && m.groups) { rec = m; keepNames(); return m; }
      } catch (e) { /* журнала нет */ }
      rec = null; keepNames(); return null;
    },
    /* Файлы из журнала: массив File (или null там, где копии нет) */
    files: async function (m) {
      var out = [];
      for (var i = 0; i < m.items.length; i++) {
        var f = null;
        if (m.savedFiles && m.savedFiles.indexOf(i) >= 0) {
          try { f = await tx('readonly', function (st) { return st.get('file:' + i); }); } catch (e) { f = null; }
        }
        out.push(f && f.size === m.items[i].size ? f : null);
      }
      return out;
    },
    /* Новое сохранение: items — элементы очереди, groups — списки индексов в items */
    begin: function (items, groups) {
      rec = {
        v: 1, ts: Date.now(), groups: groups, done: [], savedFiles: [],
        items: items.map(function (it) {
          return { name: it.name, size: it.file.size, type: it.file.type, lastModified: it.file.lastModified,
            start: it.start, end: it.end, cuts: it.cuts, caps: it.caps, tap: it.tap, rot: it.rot, fh: it.fh, fv: it.fv };
        })
      };
      keepNames();
      var files = items.map(function (it) { return it.file; }), total = files.reduce(function (a, f) { return a + f.size; }, 0);
      return queue(async function () {
        await tx('readwrite', function (st) { st.clear(); });
        await putMeta();
        var canCopy = total <= MAX_COPY;
        if (canCopy && navigator.storage && navigator.storage.estimate) {
          var q = await navigator.storage.estimate();
          if (q && q.quota && q.quota - (q.usage || 0) < total * 2 + 400 * 1048576) canCopy = false;
        }
        if (!canCopy) return;
        for (var i = 0; i < files.length; i++) {
          if (!rec) return;
          try {
            await tx('readwrite', function (st) { st.put(files[i], 'file:' + i); });
            rec.savedFiles.push(i); await putMeta();
          } catch (e) { return; }                      // места нет: останется только описание
        }
      });
    },
    /* Продолжаем найденный журнал */
    adopt: function (m) { rec = m; keepNames(); },
    /* Группа готова. info: { name, opfs, ext, w, h, size, warnings, fmt } */
    done: function (gi, info) {
      if (!rec) return Promise.resolve();
      rec.done = rec.done.filter(function (d) { return d.gi !== gi; });
      rec.done.push(Object.assign({ gi: gi }, info)); keepNames();
      return queue(putMeta);
    },
    doneSet: function () { return rec ? rec.done.map(function (d) { return d.gi; }) : []; },
    clear: function () {
      rec = null; keepNames();
      return queue(function () { return tx('readwrite', function (st) { st.clear(); }); });
    },
    active: function () { return !!rec; }
  };
  AV.keepNames = [];
})();
