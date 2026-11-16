'use strict';
/* Aspect Studio Video — чтение звука.
   Для MP4/MOV звук декодируется по частям (AudioDecoder + mp4box): память не растёт с длиной ролика, поэтому
   часовые видео не упираются в лимит. Для остальных форматов (WebM, MKV…) единственный путь в браузере —
   decodeAudioData целиком, у него остаются ограничения по размеру файла и длине.
   AV.openAudio(file, dur) → { sr, ch, kind, open(startSec) → reader } или { reason }.
   reader.next() → Promise<{ ch: [Float32Array…], pos: номер первого сэмпла при частоте sr } | null>, блоки идут подряд. */
(function () {
  var AV = (window.AV = window.AV || {});
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ---------- Целиком (запасной путь) ---------- */
  async function decodeWhole(file, dur) {
    if (file.size > 800 * 1048576) return { reason: 'Файл слишком большой, чтобы перенести звук (не MP4: звук приходится распаковывать целиком).' };
    if (dur * 48000 * 2 * 4 > 480 * 1048576) return { reason: 'Ролик слишком длинный, чтобы перенести звук (не MP4: звук приходится распаковывать целиком).' };
    var buf = null, ac = null;
    try {
      var ab = await file.arrayBuffer(), Ctx = window.AudioContext || window.webkitAudioContext;
      ac = new Ctx();
      buf = await new Promise(function (res, rej) {
        var p = ac.decodeAudioData(ab, res, rej);
        if (p && p.then) p.then(res, rej);
      });
    } catch (e) { buf = null; }
    if (ac && ac.close) { try { ac.close(); } catch (e2) { /* ничего */ } }
    if (!buf || !buf.length) return { reason: 'В видео нет звука или его не удалось прочитать.' };
    var chans = [];
    for (var c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
    return {
      sr: buf.sampleRate, ch: chans.length, kind: 'buffer', length: buf.length,
      open: function (startSec) {
        var pos = Math.max(0, Math.floor(startSec * buf.sampleRate)), BLK = buf.sampleRate;
        return {
          next: async function () {
            if (pos >= buf.length) return null;
            var n = Math.min(BLK, buf.length - pos), blk = { pos: pos, ch: chans.map(function (d) { return d.subarray(pos, pos + n); }) };
            pos += n; return blk;
          },
          close: function () { /* нечего освобождать */ }
        };
      }
    };
  }

  /* ---------- По частям (MP4/MOV) ---------- */
  async function openStream(file) {
    if (typeof AudioDecoder === 'undefined' || typeof EncodedAudioChunk === 'undefined') throw new Error('нет AudioDecoder');
    var mp = await AV.openMp4(file), tr = mp.info.audioTracks[0];
    if (!tr) throw new Error('нет звуковой дорожки');
    var samples = mp.isf.getTrackSamplesInfo(tr.id);
    if (!samples || !samples.length) throw new Error('звуковые кадры не найдены');
    var entry = mp.isf.getTrackById(tr.id).mdia.minf.stbl.stsd.entries[0];
    var codec = /^opus$/i.test(tr.codec) ? 'opus' : tr.codec;
    var cfg = { codec: codec, sampleRate: tr.audio.sample_rate, numberOfChannels: tr.audio.channel_count };
    try {
      var d = entry.esds && entry.esds.esd && entry.esds.esd.descs[0] && entry.esds.esd.descs[0].descs[0];
      if (d && d.data && d.data.length) cfg.description = new Uint8Array(d.data);
    } catch (e0) { /* без описания */ }
    var sup = await AudioDecoder.isConfigSupported(cfg);
    if (!sup || !sup.supported) throw new Error('звуковой кодек ' + tr.codec + ' не поддерживается');
    var N = samples.length, st = new Float64Array(N), i;
    for (i = 0; i < N; i++) st[i] = samples[i].cts / samples[i].timescale;
    var sr = tr.audio.sample_rate, nch = tr.audio.channel_count;
    var win = null;
    async function read(off, size) {
      if (!win || off < win.start || off + size > win.start + win.buf.byteLength) {
        win = { start: off, buf: await file.slice(off, Math.min(file.size, off + Math.max(size, 2 * 1048576))).arrayBuffer() };
      }
      return new Uint8Array(win.buf, off - win.start, size);
    }
    return {
      sr: sr, ch: nch, kind: 'stream', codec: tr.codec,
      open: function (startSec) {
        var k = 0;
        while (k < N - 1 && st[k + 1] <= startSec) k++;
        k = Math.max(0, k - 2);                          // немного раньше: декодеру нужен разгон
        var out = [], err = null, ended = false, flushing = false, fed = k, closed = false;
        var dec = new AudioDecoder({
          output: function (ad) {
            try {
              var n = ad.numberOfFrames, chs = [], c;
              for (c = 0; c < ad.numberOfChannels; c++) { var a = new Float32Array(n); ad.copyTo(a, { planeIndex: c, format: 'f32-planar' }); chs.push(a); }
              out.push({ pos: Math.round((ad.timestamp / 1e6) * ad.sampleRate), ch: chs });
            } catch (e) { err = e; }
            ad.close();
          },
          error: function (e) { err = e; }
        });
        dec.configure(cfg);
        return {
          next: async function () {
            var waited = 0;
            for (;;) {
              if (err) throw err;
              if (out.length) return out.shift();
              if (ended) return null;
              var n = 0;
              while (fed < N && n < 12 && dec.decodeQueueSize < 12 && out.length < 6) {
                var s = samples[fed], data = await read(s.offset, s.size);
                dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round(st[fed] * 1e6), duration: Math.round((s.duration / s.timescale) * 1e6), data: data }));
                fed++; n++;
              }
              if (fed >= N && !flushing) { flushing = true; dec.flush().then(function () { ended = true; }, function (e) { err = err || e; ended = true; }); }
              if (!n) { await sleep(2); waited += 2; if (waited > 10000) throw new Error('звуковой декодер завис'); } else waited = 0;
            }
          },
          close: function () { if (!closed) { closed = true; try { dec.close(); } catch (e) { /* уже закрыт */ } } }
        };
      }
    };
  }

  /* Открывает звук файла: по частям, если можно; иначе целиком. Кэш по файлу делает вызывающий код. */
  AV.openAudio = async function (file, dur, opt) {
    opt = opt || {};
    if (opt.stream !== false && AV.looksLikeMp4 && AV.looksLikeMp4(file)) {
      try { return await openStream(file); }
      catch (e) {
        if (/нет звуковой дорожки/.test((e && e.message) || '')) return { reason: 'В видео нет звука или его не удалось прочитать.' };
        if (window.logError && !/нет звуковой дорожки|не поддерживается/.test((e && e.message) || '')) window.logError(e, 'звук по частям');
      }
    }
    return decodeWhole(file, dur);
  };
})();
