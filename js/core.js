'use strict';
/* Защита от встраивания в чужую страницу (clickjacking): CSP через meta не умеет frame-ancestors, поэтому проверяем сами */
if (window.top !== window.self) { document.documentElement.hidden = true; try { window.top.location.href = window.location.href; } catch (e) { /* браузер не разрешил, страница уже скрыта */ } }
/* Aspect Studio Video — ядро: константы, настройки, журнал ошибок, уведомления. */
const APP_VERSION = '2.10.0';
const STORE_KEY = 'aspect-video-v1';
const ERRLOG_KEY = 'aspect-video-errlog', ERRLOG_MAX = 30;
const SEEN_KEY = 'aspect-video-seen', COUNT_KEY = 'aspect-video-count', THEME_KEY = 'aspect-video-theme', TAB_KEY = 'aspect-video-tab';
const PRESETS_KEY = 'aspect-video-presets', ACCENT_KEY = 'aspect-video-accent', ONB_KEY = 'aspect-video-onboarded', PIN_KEY = 'aspect-video-pins', FOLD_KEY = 'aspect-video-folds';
const INSTALL_KEY = 'aspect-video-install', PERF_KEY = 'aspect-video-perf';
const REPO = 'https://github.com/abubakrrustam94-crypto/aspect-video';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* без хранилища */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* без хранилища */ } }
};
/* значок из спрайта (создаём узлы напрямую) */
function svgIcon(id) {
  const NS = 'http://www.w3.org/2000/svg', s = document.createElementNS(NS, 'svg'), u = document.createElementNS(NS, 'use');
  s.setAttribute('class', 'ic'); s.setAttribute('aria-hidden', 'true'); u.setAttribute('href', '#i-' + id); s.appendChild(u);
  return s;
}
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
    /* имена файлов пользователя в журнал не попадают: журнал можно отправить разработчику */
    const msg = String(err && err.stack ? err.stack : (err && err.message) || err).replace(/«[^»]*»/g, '«…»').slice(0, 600);
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
  mute: false, vol: 100, dateMode: 'src', mTitle: '', mGps: false, norm: false, denoise: false, smooth: false,
  short: 1080, fps: 30, quality: 0.12, target: 0,
  nameTpl: '{name}_{ratio}', translit: true, counter: false, toFolder: false,
  wmOn: false, wmType: 'text', wmText: '@mychannel', wmColor: '#ffffff', wmShadow: true,
  wmOpacity: 70, wmSize: 5, wmPos: 'br', wmMargin: 3, wmAngle: -25, wmWhen: 'all', wmSec: 5,
  capPos: 'bot', capSize: 5, capColor: '#ffffff', capBox: true,
  stab: 0, format: 'mp4', faceMode: 'largest', concat: false,
  lang: 'auto'
};
/* Значения настроек приходят из недоверенных мест (localStorage, сохранённые наборы, ручная правка): проверяем тип, границы и список допустимых.
   Иначе, например, speed = 0 или fps = 0 подвесят экспорт, а лишние ключи вроде __proto__ испортят объект настроек. */
const SPEC = (() => {
  const I = (lo, hi) => ({ t: 'int', lo, hi }), N = (lo, hi) => ({ t: 'num', lo, hi }), E = list => ({ t: 'enum', list }), H = { t: 'hex' }, T = n => ({ t: 'str', n });
  return {
    rw: I(1, 100), rh: I(1, 100), mode: E(['blur', 'mirror', 'color', 'smart', 'crop']), color: H,
    rot: E([0, 90, 180, 270]), speed: E([0.5, 0.75, 1, 1.5, 2]), dateMode: E(['src', 'now', 'none']), fadeIn: N(0, 3), fadeOut: N(0, 3), vol: N(0, 200),
    short: E([0, 480, 720, 1080, 1440, 2160]), fps: E([24, 30, 60]), quality: E([0.07, 0.12, 0.2]), target: N(0, 5000),
    wmType: E(['text', 'image']), wmColor: H, wmOpacity: N(10, 100), wmSize: N(2, 20), wmMargin: N(0, 15), wmAngle: N(-60, 60), wmSec: N(1, 30),
    wmPos: E(['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br', 'tile']), wmWhen: E(['all', 'first']),
    capPos: E(['top', 'mid', 'bot']), capSize: N(2, 12), capColor: H,
    stab: E([0, 1, 2]), format: E(['mp4', 'webm', 'gif']), faceMode: E(['largest', 'left', 'right', 'center', 'tap']), lang: E(['auto', 'ru', 'en']),
    wmText: T(100), nameTpl: T(120), mTitle: T(120)
  };
})();
/* Возвращает допустимое значение или undefined, если ключ чужой или значение не годится */
function cleanVal(k, v) {
  if (!Object.prototype.hasOwnProperty.call(DEF, k)) return undefined;
  if (typeof v !== typeof DEF[k]) return undefined;
  const sp = SPEC[k];
  if (!sp) return v;
  if (sp.t === 'enum') return sp.list.indexOf(v) >= 0 ? v : undefined;
  if (sp.t === 'hex') return /^#[0-9a-f]{6}$/i.test(v) ? v : undefined;
  if (sp.t === 'str') return v.slice(0, sp.n);
  if (!isFinite(v)) return undefined;
  const c = Math.min(sp.hi, Math.max(sp.lo, v));
  return sp.t === 'int' ? Math.round(c) : c;
}
const S = Object.assign({}, DEF);
(function load() {
  try {
    const o = JSON.parse(ls.get(STORE_KEY) || '{}');
    Object.keys(DEF).forEach(k => { if (Object.prototype.hasOwnProperty.call(o, k)) { const v = cleanVal(k, o[k]); if (v !== undefined) S[k] = v; } });
  } catch (e) { /* битые данные: остаются значения по умолчанию */ }
})();
const listeners = [];
function onSet(fn) { listeners.push(fn); }
function save() { const o = {}; Object.keys(DEF).forEach(k => { o[k] = S[k]; }); ls.set(STORE_KEY, JSON.stringify(o)); }
function set(key, val, silent) {
  const v = cleanVal(key, val);
  if (v === undefined) return;                      // чужой ключ или недопустимое значение
  S[key] = v; save();
  if (!silent) listeners.forEach(fn => fn(key, val));
}
function setMany(obj) {
  Object.keys(obj).forEach(k => { const v = cleanVal(k, obj[k]); if (v !== undefined) S[k] = v; });
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
  s = Math.round(s * 10) / 10;                 // сначала округляем, иначе 59,96 превращалось в «0:60.0»
  const m = Math.floor(s / 60), sec = s - m * 60;
  return m + ':' + (sec < 10 ? '0' : '') + sec.toFixed(1);
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
