'use strict';
/* Aspect Studio Video — архив ZIP без сжатия (видео уже сжато, поэтому «store»).
   AV.makeZip([{ name, blob }]) → Promise<Blob>. Файлы читаются кусками, в памяти держится один кусок, итог собирается как Blob из частей.
   Без ZIP64: общий размер до 4 ГБ, иначе бросается ошибка (вызывающий код предлагает скачать файлы по одному). */
(function () {
  var AV = (window.AV = window.AV || {});
  var TABLE = null;
  function crcTable() {
    if (TABLE) return TABLE;
    TABLE = new Uint32Array(256);
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; TABLE[n] = c >>> 0; }
    return TABLE;
  }
  function crcUpdate(crc, u8) {
    var t = crcTable(), c = crc;
    for (var i = 0; i < u8.length; i++) c = t[(c ^ u8[i]) & 255] ^ (c >>> 8);
    return c >>> 0;
  }
  AV.crc32Blob = async function (blob, onChunk) {
    var crc = 0xFFFFFFFF, CH = 4 * 1048576;
    for (var off = 0; off < blob.size; off += CH) {
      crc = crcUpdate(crc, new Uint8Array(await blob.slice(off, Math.min(blob.size, off + CH)).arrayBuffer()));
      if (onChunk) onChunk(Math.min(blob.size, off + CH));
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  };
  function dosTime(d) {
    return { t: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), d: (((d.getFullYear() - 1980) & 127) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
  }
  function uniq(name, used) {
    var base = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180) || 'video', n = base, i = 1, m = /^(.*?)(\.[^.]*)?$/.exec(base);
    while (used[n.toLowerCase()]) n = m[1] + '_' + (++i) + (m[2] || '');
    used[n.toLowerCase()] = 1; return n;
  }
  AV.makeZip = async function (files, onProgress) {
    var total = 0, i;
    for (i = 0; i < files.length; i++) total += files[i].blob.size;
    if (total > 4000000000 || files.length > 65000) throw new Error('Для одного архива слишком много данных: скачайте видео по одному.');
    var enc = new TextEncoder(), used = {}, parts = [], central = [], off = 0, tm = dosTime(new Date()), done = 0;
    for (i = 0; i < files.length; i++) {
      var f = files[i], nb = enc.encode(uniq(f.name, used)), size = f.blob.size, base = done;
      var crc = await AV.crc32Blob(f.blob, function (n) { if (onProgress) onProgress((base + n) / Math.max(1, total)); });
      done += size;
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, tm.t, true); lh.setUint16(12, tm.d, true); lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
      lh.setUint16(26, nb.length, true); lh.setUint16(28, 0, true);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, tm.t, true); ch.setUint16(14, tm.d, true); ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
      ch.setUint16(28, nb.length, true); ch.setUint32(42, off, true);
      central.push(ch, nb);
      parts.push(lh, nb, f.blob);
      off += 30 + nb.length + size;
    }
    var cdSize = 0; central.forEach(function (c) { cdSize += c.byteLength !== undefined ? c.byteLength : c.length; });
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
    return new Blob(parts.concat(central, [end]), { type: 'application/zip' });
  };
})();
