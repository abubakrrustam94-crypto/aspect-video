'use strict';
/* Aspect Studio Video — ядро: константы, настройки, журнал ошибок, уведомления. */
const APP_VERSION = '2.1.0';
const STORE_KEY = 'aspect-video-v1';
const ERRLOG_KEY = 'aspect-video-errlog', ERRLOG_MAX = 30;
const SEEN_KEY = 'aspect-video-seen', COUNT_KEY = 'aspect-video-count', THEME_KEY = 'aspect-video-theme', TAB_KEY = 'aspect-video-tab';
const PRESETS_KEY = 'aspect-video-presets', ACCENT_KEY = 'aspect-video-accent', ONB_KEY = 'aspect-video-onboarded', PIN_KEY = 'aspect-video-pins', FOLD_KEY = 'aspect-video-folds';
const REPO = 'https://github.com/abubakrrustam94-crypto/aspect-video';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* без хранилища */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* без хранилища */ } }
};
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/* ---------- Журнал ошибок: хранится только в этом браузере ---------- */
const errLog = (() => {
  try { const a = JSON.parse(ls.get(ERRLOG_KEY) || '[]'); return Array.isArray(a) ? a.slice(-ERRLOG_MAX) : []; } catch (e) { return []; }
})();
function logError(err, where) {
  try {
    const msg = String(err && err.stack ? err.stack : (err && err.message) || err).slice(0, 600);
    const last = errLog[errLog.length - 1];
    if (last && last.m === msg) { last.n = (last.n || 1) + 1; last.t = Date.now(); }
    else errLog.push({ t: Date.now(), w: where || '', m: msg, n: 1 });
    while (errLog.length > ERRLOG_MAX) errLog.shift();
    ls.set(ERRLOG_KEY, JSON.stringify(errLog));
    if (typeof renderErrLog === 'function') renderErrLog();
  } catch (e) { /* журнал не должен ронять страницу */ }
}
window.addEventListener('error', ev => logError(ev.error || ev.message, 'error'));
window.addEventListener('unhandledrejection', ev => logError(ev.reason, 'promise'));

/* ---------- Настройки ---------- */
const DEF = {
  rw: 9, rh: 16, mode: 'blur', color: '#000000', faceTrack: false,
  rot: 0, flipH: false, flipV: false, speed: 1, fadeIn: 0, fadeOut: 0,
  mute: false, vol: 100, norm: false,
  short: 1080, fps: 30, quality: 0.12,
  nameTpl: '{name}_{ratio}', translit: true, counter: false, toFolder: false,
  wmOn: false, wmType: 'text', wmText: '@mychannel', wmColor: '#ffffff', wmShadow: true,
  wmOpacity: 70, wmSize: 5, wmPos: 'br', wmMargin: 3, wmAngle: -25, wmWhen: 'all', wmSec: 5
};
const S = Object.assign({}, DEF);
(function load() {
  try {
    const o = JSON.parse(ls.get(STORE_KEY) || '{}');
    Object.keys(DEF).forEach(k => { if (k in o && typeof o[k] === typeof DEF[k]) S[k] = o[k]; });
  } catch (e) { /* битые данные: остаются значения по умолчанию */ }
})();
const listeners = [];
function onSet(fn) { listeners.push(fn); }
function save() { const o = {}; Object.keys(DEF).forEach(k => { o[k] = S[k]; }); ls.set(STORE_KEY, JSON.stringify(o)); }
function set(key, val, silent) {
  S[key] = val; save();
  if (!silent) listeners.forEach(fn => fn(key, val));
}
function setMany(obj) {
  Object.keys(obj).forEach(k => { S[k] = obj[k]; });
  save(); listeners.forEach(fn => fn('*', null));
}

/* ---------- Уведомления ---------- */
let toastTimer = 0;
function toast(msg, isErr, opts) {
  const t = $('#toast'); if (!t) return;
  t.textContent = msg;
  t.classList.toggle('error', !!isErr);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), (opts && opts.ms) || (isErr ? 5200 : 2600));
}

/* ---------- Мелочи ---------- */
function fmtBytes(b) {
  if (b >= 1073741824) return (b / 1073741824).toFixed(2) + ' ГБ';
  if (b >= 1048576) return (b / 1048576).toFixed(1) + ' МБ';
  return Math.max(1, Math.round(b / 1024)) + ' КБ';
}
function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), sec = s - m * 60;
  return m + ':' + (sec < 9.95 ? '0' : '') + sec.toFixed(1);
}
const DEV_MEM = navigator.deviceMemory || 4;

/* Модули, которые нужны не сразу, подгружаются по первому обращению */
const lazyP = {};
function lazyLoad(name) {
  return lazyP[name] || (lazyP[name] = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'js/' + name + '.js';
    s.onload = () => res();
    s.onerror = () => { delete lazyP[name]; s.remove(); rej(new Error('Не загрузился файл ' + name + '.js. Проверь соединение и повтори.')); };
    document.head.appendChild(s);
  }));
}
