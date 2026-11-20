'use strict';
/* Aspect Studio Video — данные о файле.
   AV.readMeta(file, hint) читает то, что есть в самом файле: кодеки, размер кадра, частоту, битрейт, дату съёмки, координаты,
   название, модель устройства, программу. MP4/MOV разбираются через mp4box и просмотр блока moov, WebM — простым разбором EBML.
   Файл никуда не отправляется. Всё, чего нет в файле, остаётся пустым: ничего не придумываем.
   AV.stampMp4 меняет дату создания в готовом MP4. AV.renderInfo рисует вкладку «Данные». */
(function () {
  var AV = (window.AV = window.AV || {});
  var EPOCH_1904 = 2082844800;

  var CODECS = [
    [/^avc[13]/i, 'H.264'], [/^(hvc1|hev1)/i, 'H.265 (HEVC)'], [/^av01/i, 'AV1'], [/^vp0?9/i, 'VP9'], [/^vp0?8/i, 'VP8'],
    [/^(apch|apcn|apcs|apco|ap4h|ap4x)/i, 'ProRes'], [/^mp4a/i, 'AAC'], [/^opus/i, 'Opus'], [/^(ac-3|ec-3)/i, 'Dolby'], [/^(\.mp3|mp3)/i, 'MP3']
  ];
  AV.codecName = function (c) {
    c = String(c || ''); if (!c) return '';
    for (var i = 0; i < CODECS.length; i++) if (CODECS[i][0].test(c)) return CODECS[i][1];
    return c.split('.')[0];
  };

  function validDate(d) { return d instanceof Date && !isNaN(d) && d.getFullYear() >= 1995 && d.getTime() < Date.now() + 864e5; }
  function latin(u8) { var s = '', i; for (i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return s; }
  function utf8(u8) { try { return new TextDecoder('utf-8', { fatal: false }).decode(u8).replace(/\0+$/g, '').trim(); } catch (e) { return ''; } }
  function be32(u8, o) { return ((u8[o] << 24) | (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3]) >>> 0; }

  /* ISO 6709: «+55.7558+037.6173/» или «+55.7558+037.6173+150.000/» */
  function parseGps(s) {
    var m = /([+-]\d{1,3}\.\d{2,})([+-]\d{1,3}\.\d{2,})(?:[+-]\d+(?:\.\d+)?)?\//.exec(s || '');
    if (!m) return null;
    var la = parseFloat(m[1]), lo = parseFloat(m[2]);
    if (!(Math.abs(la) <= 90 && Math.abs(lo) <= 180) || (la === 0 && lo === 0)) return null;
    return { lat: la, lon: lo, text: Math.abs(la).toFixed(4) + '° ' + (la >= 0 ? 'с. ш.' : 'ю. ш.') + ', ' + Math.abs(lo).toFixed(4) + '° ' + (lo >= 0 ? 'в. д.' : 'з. д.') };
  }

  /* Находим блок moov среди верхних блоков файла, читая только заголовки */
  async function findBox(file, type) {
    var off = 0, guard = 0;
    while (off + 8 <= file.size && guard++ < 4000) {
      var h = new Uint8Array(await file.slice(off, off + 16).arrayBuffer()), size = be32(h, 0), t = String.fromCharCode(h[4], h[5], h[6], h[7]), hs = 8;
      if (size === 1) { if (h.length < 16) return null; size = be32(h, 8) * 4294967296 + be32(h, 12); hs = 16; }
      else if (size === 0) size = file.size - off;
      if (size < hs) return null;
      if (t === type) return { off: off, size: size, hs: hs };
      off += size;
    }
    return null;
  }
  /* Текстовый блок QuickTime/Android в udta: размер(4) имя(4) длина(2) язык(2) текст */
  /* iTunes-вид: внутри блока ©nam лежит блок data (4 размер, «data», 4 флага, 4 язык, дальше текст) */
  function atomData(u8, nameBytes) {
    for (var i = 4; i + 24 < u8.length; i++) {
      if (u8[i] === nameBytes[0] && u8[i + 1] === nameBytes[1] && u8[i + 2] === nameBytes[2] && u8[i + 3] === nameBytes[3] &&
          u8[i + 8] === 0x64 && u8[i + 9] === 0x61 && u8[i + 10] === 0x74 && u8[i + 11] === 0x61) {
        var ds = be32(u8, i + 4);
        if (ds > 16 && ds < 4096 && i + 4 + ds <= u8.length) return utf8(u8.subarray(i + 20, i + 4 + ds));
      }
    }
    return '';
  }
  /* 3GPP «loci»: долгота и широта числами 16.16 после названия места */
  function lociGps(u8) {
    for (var i = 4; i + 30 < u8.length; i++) {
      if (u8[i] === 0x6C && u8[i + 1] === 0x6F && u8[i + 2] === 0x63 && u8[i + 3] === 0x69) {
        var p = i + 4 + 4 + 2;
        while (p < u8.length && u8[p] !== 0) p++;
        p += 2;                                           // конец названия и роль
        if (p + 8 > u8.length) continue;
        var lo = (be32(u8, p) | 0) / 65536, la = (be32(u8, p + 4) | 0) / 65536;
        if (Math.abs(la) <= 90 && Math.abs(lo) <= 180 && (la !== 0 || lo !== 0)) return { lat: la, lon: lo, text: Math.abs(la).toFixed(4) + '° ' + (la >= 0 ? 'с. ш.' : 'ю. ш.') + ', ' + Math.abs(lo).toFixed(4) + '° ' + (lo >= 0 ? 'в. д.' : 'з. д.') };
      }
    }
    return null;
  }
  function atomText(u8, nameBytes) {
    for (var i = 4; i + 8 < u8.length; i++) {
      if (u8[i] === nameBytes[0] && u8[i + 1] === nameBytes[1] && u8[i + 2] === nameBytes[2] && u8[i + 3] === nameBytes[3]) {
        var size = be32(u8, i - 4), len = (u8[i + 4] << 8) | u8[i + 5];
        if (size >= 12 && size < 4096 && len > 0 && i + 8 + len <= u8.length) return utf8(u8.subarray(i + 8, i + 8 + len));
      }
    }
    return '';
  }
  /* Метаданные в «mdta»-виде (так пишут iPhone и ffmpeg): блок keys с именами и ilst со значениями по номеру */
  function mdtaPairs(u8) {
    var out = {}, names = [], i, k = -1, l = -1;
    function find(t) { for (var j = 4; j + 4 < u8.length; j++) if (u8[j] === t.charCodeAt(0) && u8[j + 1] === t.charCodeAt(1) && u8[j + 2] === t.charCodeAt(2) && u8[j + 3] === t.charCodeAt(3)) return j; return -1; }
    k = find('keys'); l = find('ilst');
    if (k < 0 || l < 0) return out;
    var cnt = be32(u8, k + 8), p = k + 12;
    for (i = 0; i < cnt && p + 8 < u8.length; i++) { var sz = be32(u8, p); if (sz < 8) break; names.push(utf8(u8.subarray(p + 8, p + sz))); p += sz; }
    var end = l - 4 + be32(u8, l - 4); p = l + 4;
    while (p + 8 < end && p + 8 < u8.length) {
      var isz = be32(u8, p), idx = be32(u8, p + 4);
      if (isz < 16) break;
      var d = p + 8, dsz = be32(u8, d);
      if (dsz >= 16 && d + dsz <= u8.length && names[idx - 1]) out[names[idx - 1]] = utf8(u8.subarray(d + 16, d + dsz));
      p += isz;
    }
    return out;
  }
  var A9 = 0xA9, N_XYZ = [A9, 0x78, 0x79, 0x7A], N_NAM = [A9, 0x6E, 0x61, 0x6D], N_MAK = [A9, 0x6D, 0x61, 0x6B], N_MOD = [A9, 0x6D, 0x6F, 0x64], N_SWR = [A9, 0x73, 0x77, 0x72], N_TOO = [A9, 0x74, 0x6F, 0x6F];

  async function readMp4(file, m) {
    var mp = await AV.openMp4(file), info = mp.info, v = info.videoTracks[0], a = info.audioTracks[0];
    m.container = /quicktime|qt/i.test(info.brands && info.brands.join(' ') || '') || /\.mov$/i.test(file.name || '') ? 'MOV' : 'MP4';
    var created = info.created; if (typeof created === 'number') created = new Date((created - EPOCH_1904) * 1000);
    if (validDate(created)) m.created = created;
    if (info.timescale && info.duration) m.dur = info.duration / info.timescale;
    if (v) {
      var sec = v.timescale && v.duration ? v.duration / v.timescale : m.dur;
      m.v = { codec: AV.codecName(v.codec), raw: v.codec, w: v.video && v.video.width, h: v.video && v.video.height, fps: v.nb_samples && sec ? v.nb_samples / sec : 0, bitrate: v.bitrate || 0 };
      var mx = v.matrix ? Array.prototype.slice.call(Object.values(v.matrix)).map(function (x) { return x / 65536; }) : null;
      if (mx) { var th = Math.atan2(mx[1] || 0, mx[0] === undefined ? 1 : mx[0]); m.rot = ((Math.round(th / (Math.PI / 2)) * 90) % 360 + 360) % 360; }
    }
    if (a) m.a = { codec: AV.codecName(a.codec), raw: a.codec, ch: a.audio && a.audio.channel_count, sr: a.audio && a.audio.sample_rate, bitrate: a.bitrate || 0 };
    /* координаты, название, устройство: смотрим внутрь moov (обычно это пара сотен килобайт) */
    try {
      var box = await findBox(file, 'moov');
      if (box && box.size <= 16 * 1048576) {
        var u8 = new Uint8Array(await file.slice(box.off, box.off + box.size).arrayBuffer());
        var g = parseGps(latin(u8)) || parseGps(atomText(u8, N_XYZ)) || lociGps(u8);
        if (g) m.gps = g;
        var kv = mdtaPairs(u8);
        if (!m.gps) { var g2 = parseGps(kv['com.apple.quicktime.location.ISO6709'] || kv['location'] || kv['location-eng'] || ''); if (g2) m.gps = g2; }
        m.title = atomText(u8, N_NAM) || atomData(u8, N_NAM) || kv['title'] || kv['com.apple.quicktime.title'] || '';
        m.make = atomText(u8, N_MAK) || atomData(u8, N_MAK) || kv['com.apple.quicktime.make'] || kv['make'] || '';
        m.model = atomText(u8, N_MOD) || atomData(u8, N_MOD) || kv['com.apple.quicktime.model'] || kv['model'] || '';
        m.software = atomText(u8, N_SWR) || atomData(u8, N_SWR) || atomData(u8, N_TOO) || atomText(u8, N_TOO) || kv['com.apple.quicktime.software'] || kv['encoder'] || '';
      }
    } catch (e) { /* не вышло заглянуть: поля останутся пустыми */ }
  }

  /* WebM: ищем нужные элементы в начале файла (Info лежит там) */
  function ebmlFind(u8, id, text) {
    for (var i = 0; i + id.length < u8.length; i++) {
      var ok = true; for (var k = 0; k < id.length; k++) if (u8[i + k] !== id[k]) { ok = false; break; }
      if (!ok) continue;
      var p = i + id.length, b = u8[p], len = 0, n = 1;
      while (n <= 8 && !(b & (0x80 >> (n - 1)))) n++;
      if (n > 8) continue;
      len = b & ((0x80 >> (n - 1)) - 1);
      for (var j = 1; j < n; j++) len = len * 256 + u8[p + j];
      p += n; if (len > 0 && len < 100000 && p + len <= u8.length) {
        var r = u8.subarray(p, p + len);
        if (text) { var bad = false; for (var q = 0; q < r.length; q++) if (r[q] < 32 || r[q] === 127) { bad = true; break; } if (bad || utf8(r).indexOf('\ufffd') >= 0) continue; }
        return r;
      }
    }
    return null;
  }
  async function readWebm(file, m, hint) {
    var u8 = new Uint8Array(await file.slice(0, 262144).arrayBuffer()), t, d;
    m.container = /\.mkv$/i.test(file.name || '') ? 'MKV' : 'WebM';
    var s = latin(u8);
    var vc = /V_(VP9|VP8|AV1|MPEG4\/ISO\/AVC)/.exec(s), ac = /A_(OPUS|VORBIS|AAC)/.exec(s);
    m.v = { codec: vc ? ({ VP9: 'VP9', VP8: 'VP8', AV1: 'AV1', 'MPEG4/ISO/AVC': 'H.264' })[vc[1]] : '', w: hint && hint.vw, h: hint && hint.vh, fps: 0, bitrate: 0 };
    if (ac) m.a = { codec: ({ OPUS: 'Opus', VORBIS: 'Vorbis', AAC: 'AAC' })[ac[1]], ch: 0, sr: 0, bitrate: 0 };
    if (hint && hint.dur) m.dur = hint.dur;
    d = ebmlFind(u8, [0x44, 0x61]);                                       // DateUTC: наносекунды от 2001-01-01
    if (d && d.length === 8) {
      var hi = (d[0] << 24 | d[1] << 16 | d[2] << 8 | d[3]) | 0, lo = be32(d, 4), ms = (hi * 4294967296 + lo) / 1e6, dt = new Date(Date.UTC(2001, 0, 1) + ms);
      if (validDate(dt)) m.created = dt;
    }
    t = ebmlFind(u8, [0x7B, 0xA9], true); if (t) m.title = utf8(t);
    t = ebmlFind(u8, [0x57, 0x41], true) || ebmlFind(u8, [0x4D, 0x80], true); if (t) m.software = utf8(t);
  }

  AV.readMeta = async function (file, hint) {
    var m = { name: file.name, size: file.size, container: '', v: null, a: null, dur: (hint && hint.dur) || 0, rot: 0, created: null, gps: null, title: '', make: '', model: '', software: '' };
    try {
      if (AV.looksLikeMp4(file)) await readMp4(file, m);
      else await readWebm(file, m, hint);
    } catch (e) { m.error = (e && e.message) || 'не удалось прочитать'; }
    if (!m.container) m.container = ((/\.([a-z0-9]+)$/i.exec(file.name || '') || [])[1] || '').toUpperCase();
    if (!m.v && hint) m.v = { codec: '', w: hint.vw, h: hint.vh, fps: 0, bitrate: 0 };
    if (m.v && hint && !m.v.w) { m.v.w = hint.vw; m.v.h = hint.vh; }
    if (m.dur && file.size && m.v && !m.v.bitrate && !m.a) m.v.bitrate = file.size * 8 / m.dur;
    return m;
  };

  /* ---------- Дата создания в готовом MP4 ---------- */
  /* Проходит по блокам moov → mvhd / trak → tkhd / mdia → mdhd и пишет время создания и изменения.
     read(off, len) → Uint8Array, write(off, bytes), size — размер файла. secs — секунды от 1970; 0 — «неизвестно» (1904). */
  AV.stampMp4 = async function (read, write, size, secs) {
    var t = secs ? secs + EPOCH_1904 : 0, n = 0;
    async function box(off, end, depth) {
      while (off + 8 <= end) {
        var h = await read(off, 16), sz = be32(h, 0), ty = String.fromCharCode(h[4], h[5], h[6], h[7]), hs = 8;
        if (sz === 1) { sz = be32(h, 8) * 4294967296 + be32(h, 12); hs = 16; } else if (sz === 0) sz = end - off;
        if (sz < hs || off + sz > end) return;
        if (ty === 'moov' || ty === 'trak' || ty === 'mdia') await box(off + hs, off + sz, depth + 1);
        else if (ty === 'mvhd' || ty === 'tkhd' || ty === 'mdhd') {
          var ver = (await read(off + hs, 1))[0], bytes;
          if (ver === 1) { bytes = new Uint8Array(16); for (var i = 0; i < 2; i++) { var o = i * 8; bytes[o + 4] = (t >>> 24) & 255; bytes[o + 5] = (t >>> 16) & 255; bytes[o + 6] = (t >>> 8) & 255; bytes[o + 7] = t & 255; bytes[o] = bytes[o + 1] = bytes[o + 2] = bytes[o + 3] = 0; } await write(off + hs + 4, bytes); }
          else { bytes = new Uint8Array([t >>> 24 & 255, t >>> 16 & 255, t >>> 8 & 255, t & 255, t >>> 24 & 255, t >>> 16 & 255, t >>> 8 & 255, t & 255]); await write(off + hs + 4, bytes); }
          n++;
        }
        off += sz;
      }
    }
    await box(0, size, 0);
    return n;
  };


  /* ---------- Запись названия и координат в готовый MP4 (блок udta внутри moov) ---------- */
  function u32(n) { return [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255]; }
  function qtText(tag, text) {                           // ©nam / ©xyz в виде QuickTime: длина, язык, текст
    var tb = new TextEncoder().encode(text).subarray(0, 60000), n = 12 + tb.length, o = new Uint8Array(n);
    o.set(u32(n), 0); o.set([0xA9, tag.charCodeAt(0), tag.charCodeAt(1), tag.charCodeAt(2)], 4);
    o[8] = (tb.length >> 8) & 255; o[9] = tb.length & 255; o[10] = 0x55; o[11] = 0xC4; o.set(tb, 12);
    return o;
  }
  function iso6709(g) {
    var la = g.lat, lo = g.lon;
    return (la >= 0 ? '+' : '-') + Math.abs(la).toFixed(4).padStart(7, '0') + (lo >= 0 ? '+' : '-') + Math.abs(lo).toFixed(4).padStart(8, '0') + '/';
  }
  /* title — строка, gps — {lat, lon} или null. Возвращает готовый блок udta или null, если писать нечего */
  AV.metaUdta = function (title, gps) {
    var parts = [];
    title = String(title || '').trim();
    if (title) parts.push(qtText('nam', title));
    if (gps && isFinite(gps.lat) && isFinite(gps.lon)) parts.push(qtText('xyz', iso6709(gps)));
    if (!parts.length) return null;
    var n = 8; parts.forEach(function (p) { n += p.length; });
    var o = new Uint8Array(n), at = 8; o.set(u32(n), 0); o.set([0x75, 0x64, 0x74, 0x61], 4);
    parts.forEach(function (p) { o.set(p, at); at += p.length; });
    return o;
  };
  function topBoxes(u8) {
    var list = [], off = 0;
    while (off + 8 <= u8.length) {
      var sz = be32(u8, off), ty = String.fromCharCode(u8[off + 4], u8[off + 5], u8[off + 6], u8[off + 7]), hs = 8;
      if (sz === 1) { sz = be32(u8, off + 8) * 4294967296 + be32(u8, off + 12); hs = 16; } else if (sz === 0) sz = u8.length - off;
      if (sz < hs || off + sz > u8.length) break;
      list.push({ off: off, size: sz, hs: hs, type: ty }); off += sz;
    }
    return list;
  }
  /* Файл в памяти: добавляет udta в конец moov. Если moov стоит перед данными, сдвигает указатели stco/co64.
     Возвращает новый Uint8Array или null (moov не найден, 64-битный заголовок и прочее необычное: файл остаётся как есть). */
  AV.addUdta = function (u8, udta) {
    if (!udta) return null;
    var top = topBoxes(u8), moov = null, i;
    for (i = 0; i < top.length; i++) if (top[i].type === 'moov') moov = top[i];
    if (!moov || moov.hs !== 8) return null;
    var add = udta.length, out = new Uint8Array(u8.length + add), end = moov.off + moov.size;
    out.set(u8.subarray(0, end), 0); out.set(udta, end); out.set(u8.subarray(end), end + add);
    var nsz = moov.size + add; out.set(u32(nsz), moov.off);
    if (end < u8.length) {                                // за moov есть данные: смещаем указатели на них
      var dv = new DataView(out.buffer);
      (function walk(off, stop) {
        while (off + 8 <= stop) {
          var sz = dv.getUint32(off), ty = String.fromCharCode(out[off + 4], out[off + 5], out[off + 6], out[off + 7]);
          if (sz < 8 || off + sz > stop) return;
          if (ty === 'trak' || ty === 'mdia' || ty === 'minf' || ty === 'stbl') walk(off + 8, off + sz);
          else if (ty === 'stco') { var n = dv.getUint32(off + 12); for (var k = 0; k < n; k++) { var p = off + 16 + k * 4; if (dv.getUint32(p) >= end) dv.setUint32(p, dv.getUint32(p) + add); } }
          else if (ty === 'co64') { var n2 = dv.getUint32(off + 12); for (var k2 = 0; k2 < n2; k2++) { var p2 = off + 16 + k2 * 8, v = dv.getUint32(p2) * 4294967296 + dv.getUint32(p2 + 4); if (v >= end) { v += add; dv.setUint32(p2, Math.floor(v / 4294967296)); dv.setUint32(p2 + 4, v >>> 0); } } }
          off += sz;
        }
      })(moov.off + 8, moov.off + nsz);
    }
    return out;
  };
  /* Файл на диске: работает, только когда moov последний (так пишет потоковая запись). Возвращает { off, bytes } для записи с позиции off, либо null. */
  AV.udtaTail = async function (read, size, udta) {
    if (!udta) return null;
    var off = 0, last = null, guard = 0;
    while (off + 8 <= size && guard++ < 4000) {
      var h = await read(off, 16), sz = be32(h, 0), ty = String.fromCharCode(h[4], h[5], h[6], h[7]);
      if (sz === 1 || sz === 0) { if (sz === 0 && off + 8 <= size) sz = size - off; else return null; }
      if (sz < 8 || off + sz > size) return null;
      last = { off: off, size: sz, type: ty }; off += sz;
    }
    if (!last || last.type !== 'moov' || last.off + last.size !== size) return null;
    var old = await read(last.off, last.size), bytes = new Uint8Array(old.length + udta.length);
    bytes.set(old, 0); bytes.set(udta, old.length); bytes.set(u32(bytes.length), 0);
    return { off: last.off, bytes: bytes };
  };

  /* ---------- Вкладка «Данные» ---------- */
  function fmtDate(d) { return d.toLocaleString(document.documentElement.lang === 'en' ? 'en-GB' : 'ru-RU', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  function fmtRate(b) { return b >= 1e6 ? (b / 1e6).toFixed(1).replace('.', ',') + ' Мбит/с' : Math.round(b / 1000) + ' Кбит/с'; }
  AV.metaRows = function (m) {
    var r = [];
    r.push(['Имя файла', m.name]);
    r.push(['Размер', fmtBytes(m.size)]);
    if (m.container) r.push(['Контейнер', m.container]);
    if (m.dur) r.push(['Длительность', fmtTime(m.dur)]);
    if (m.v) {
      if (m.v.w) r.push(['Кадр', m.v.w + '×' + m.v.h + (m.rot ? ' · поворот ' + m.rot + '°' : '')]);
      if (m.v.codec) r.push(['Видео', m.v.codec + (m.v.fps ? ' · ' + (Math.round(m.v.fps * 100) / 100).toString().replace('.', ',') + ' к/с' : '') + (m.v.bitrate ? ' · ' + fmtRate(m.v.bitrate) : '')]);
      else if (m.v.fps) r.push(['Частота кадров', Math.round(m.v.fps * 100) / 100 + ' к/с']);
    }
    r.push(['Звук', m.a ? [m.a.codec, m.a.ch ? (m.a.ch === 1 ? 'моно' : m.a.ch === 2 ? 'стерео' : m.a.ch + ' канала') : '', m.a.sr ? Math.round(m.a.sr / 100) / 10 + ' кГц' : ''].filter(Boolean).join(' · ') || 'есть' : 'нет']);
    r.push(['Дата съёмки', m.created ? fmtDate(m.created) : 'не указана']);
    r.push(['Место съёмки', m.gps ? m.gps.text : 'не указано']);
    var dev = [m.make, m.model].filter(Boolean).join(' '); if (dev) r.push(['Устройство', dev]);
    if (m.software) r.push(['Программа', m.software]);
    if (m.title) r.push(['Название', m.title]);
    return r;
  };
  /* Что получится в результате: то, чем управляет человек, и то, что не переносится */
  AV.metaAfter = function (m, st) {
    var r = [], pre = AV.codecName;
    if (m.gps && st.mGps) r.push(['Место съёмки', 'записано в MP4', '']);
    else r.push([m.gps ? 'Место съёмки' : 'Координаты', m.gps ? 'удалено' : 'не записываются', m.gps ? 'good' : '']);
    var dm = st.dateMode || 'src';
    if (dm === 'none') r.push(['Дата создания', 'не записывается', 'good']);
    else if (dm === 'now') r.push(['Дата создания', 'сегодняшняя', '']);
    else r.push(['Дата создания', m.created ? 'как в исходнике: ' + fmtDate(m.created) : 'в исходнике её нет, будет сегодняшняя', m.created ? '' : 'warn']);
    r.push(['Устройство и программа', 'не переносятся', '']);
    if (st.mTitle && String(st.mTitle).trim()) r.push(['Название', 'записано в MP4: ' + String(st.mTitle).trim(), '']);
    else r.push(['Название', m.title ? 'не переносится' : 'не записывается', '']);
    if (m.rot) r.push(['Поворот ' + m.rot + '°', 'применён к картинке', 'good']);
    r.push(['Звук', !m.a ? 'нет в исходнике' : st.mute ? 'убран' : (st.norm ? 'выровнен' : 'без изменений') + (st.denoise ? ', без шума' : ''), '']);
    return r;
  };
  AV.renderInfo = function (it) {
    var box = $('#infoBody'); if (!box) return;
    var m = it && it.meta;
    if (!it) { box.replaceChildren(el('p', 'note', 'Добавьте видео, и здесь появятся сведения о файле.')); return; }
    if (!m) { box.replaceChildren(el('p', 'note', 'Читаю файл…')); return; }
    var frag = document.createDocumentFragment();
    if (m.gps) {
      var w = el('div', 'info-warn'); w.setAttribute('role', 'note');
      w.append(svgIcon('shield'), el('div', '', ''));
      w.lastChild.append(el('b', '', 'В исходнике есть координаты съёмки'), el('span', '', m.gps.text + ' ' + (S.mGps ? 'Они будут записаны в готовый MP4. Если отправляете файл другим людям, помните об этом.' : 'В готовое видео они не попадут: файл создаётся заново без них. Если отправляете исходник, помните об этом.')));
      frag.appendChild(w);
    }
    var dl = el('dl', 'info-list');
    AV.metaRows(m).forEach(function (r) { dl.append(el('dt', '', r[0]), el('dd', '', r[1])); });
    frag.appendChild(dl);
    box.replaceChildren(frag);
    var ab = $('#infoAfter'); if (ab) {
      var ul = el('ul', 'info-after');
      AV.metaAfter(m, S).forEach(function (r) { var li = el('li', r[2] || ''); li.append(el('span', '', r[0]), el('b', '', r[1])); ul.appendChild(li); });
      ab.replaceChildren(ul);
    }
    var cp = $('#infoCopy'); if (cp) cp.disabled = false;
  };
  AV.metaText = function (m) { return AV.metaRows(m).map(function (r) { return r[0] + ': ' + r[1]; }).join('\n'); };
})();
