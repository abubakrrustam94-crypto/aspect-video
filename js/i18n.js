'use strict';
/* Aspect Studio Video — язык интерфейса.
   Тексты в разметке и коде остаются русскими. В английском режиме все текстовые узлы и подписи (aria-label, title, placeholder, alt)
   переводятся по словарю js/i18n-en.js, в том числе те, что приложение вставляет позже (уведомления, статусы, список изменений).
   Составные строки ('Кадр ' + n + ' из ' + m) переводятся по частям. Если перевода нет, остаётся русский текст.
   Выбор: настройка «Язык» (Авто / Русский / English). «Авто» смотрит на язык браузера. */
(function () {
  var CYR = /[А-Яа-яЁё]/, ATTRS = ['aria-label', 'title', 'placeholder', 'alt', 'content'];
  var RU_LIKE = ['ru', 'be', 'uk', 'kk', 'ky', 'tg', 'uz', 'hy', 'az', 'mo'];
  var EN = window.I18N_EN || {}, KEYS = null, cache = new Map(), lang = 'ru';
  var tstore = new WeakMap(), astore = new WeakMap(), obs = null;

  function resolve() {
    var v = typeof S !== 'undefined' ? S.lang : undefined;
    if (v === 'ru' || v === 'en') return v;
    var n = String((navigator.languages && navigator.languages[0]) || navigator.language || 'ru').toLowerCase().split('-')[0];
    return RU_LIKE.indexOf(n) >= 0 ? 'ru' : 'en';
  }
  function keys() {
    if (!KEYS) KEYS = Object.keys(EN).filter(function (k) { return k.length >= 3; }).sort(function (a, b) { return b.length - a.length; });
    return KEYS;
  }
  /* русский → английский. Пробелы по краям сохраняются */
  function tr(str) {
    if (!str || !CYR.test(str)) return str;
    var hit = cache.get(str); if (hit !== undefined) return hit;
    var lead = /^\s*/.exec(str)[0], trail = /\s*$/.exec(str)[0], core = str.trim().replace(/\s+/g, ' '), out;
    if (EN[core] !== undefined) out = lead + EN[core] + trail;
    else {
      out = str;
      var ks = keys();
      for (var i = 0; i < ks.length && CYR.test(out); i++) if (out.indexOf(ks[i]) >= 0) out = out.split(ks[i]).join(EN[ks[i]]);
    }
    out = out.replace(/(\d) с(?![А-Яа-яЁё])/g, '$1 s').replace(/(\d),(\d)/g, '$1.$2');
    if (cache.size > 3000) cache.clear();
    cache.set(str, out);
    return out;
  }
  window.t = function (s) { return lang === 'en' ? tr(s) : s; };

  function skipEl(n) {
    var p = n.parentNode;
    return !p || p.nodeName === 'SCRIPT' || p.nodeName === 'STYLE' || p.nodeName === 'NOSCRIPT' || (p.closest && !!p.closest('[data-i18n-skip]'));   // журнал для разработчика остаётся русским
  }
  function doText(n) {
    if (skipEl(n)) return;
    var v = n.nodeValue, st = tstore.get(n);
    if (st && st.en === v) return;                      // это наш собственный перевод
    if (!CYR.test(v)) { if (st) tstore.delete(n); return; }
    var en = tr(v);
    tstore.set(n, { ru: v, en: en });
    if (en !== v) n.nodeValue = en;
  }
  function doAttr(el, a) {
    var v = el.getAttribute(a);
    if (v === null) return;
    if (el.nodeName === 'META' && !(el.getAttribute('name') === 'description')) return;
    var m = astore.get(el) || {}, st = m[a];
    if (st && st.en === v) return;
    if (!CYR.test(v)) { if (st) { delete m[a]; } return; }
    var en = tr(v);
    m[a] = { ru: v, en: en }; astore.set(el, m);
    if (en !== v) el.setAttribute(a, en);
  }
  function walk(root) {
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) ATTRS.forEach(function (a) { if (root.hasAttribute(a)) doAttr(root, a); });
    var w = document.createTreeWalker(root, 1 | 4), n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 3) doText(n);
      else ATTRS.forEach(function (a) { if (n.hasAttribute(a)) doAttr(n, a); });
    }
  }
  function restoreAll() {
    var w = document.createTreeWalker(document.documentElement, 1 | 4), n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 3) {
        var st = tstore.get(n);
        if (st && st.en === n.nodeValue) n.nodeValue = st.ru;
        tstore.delete(n);
      } else {
        var m = astore.get(n);
        if (m) Object.keys(m).forEach(function (a) { if (n.getAttribute(a) === m[a].en) n.setAttribute(a, m[a].ru); });
        astore.delete(n);
      }
    }
  }
  var ruTitle = document.title;
  function start() {
    if (obs) return;
    obs = new MutationObserver(function (recs) {
      recs.forEach(function (r) {
        if (r.type === 'characterData') doText(r.target);
        else if (r.type === 'attributes') doAttr(r.target, r.attributeName);
        else r.addedNodes.forEach(walk);
      });
    });
    obs.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  function stop() { if (obs) { obs.disconnect(); obs = null; } }

  function apply() {
    var want = resolve();
    document.documentElement.lang = want;
    if (want === lang && (want === 'ru' ? !obs : !!obs)) return;
    lang = want;
    if (lang === 'en') {
      walk(document.documentElement); document.title = tr(ruTitle); start();
    } else {
      stop(); restoreAll(); document.title = ruTitle;
    }
    document.dispatchEvent(new CustomEvent('avlang', { detail: lang }));
  }
  window.AVLang = { get: function () { return lang; }, apply: apply, tr: tr };
  apply();
  if (typeof onSet === 'function') onSet(function (k) { if (k === 'lang' || k === '*') apply(); });
})();
