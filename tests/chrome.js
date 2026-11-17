/* Тест в настоящем Chrome (v2.5.0): AV_CHANNEL=chrome node tests/chrome.js <папка-сайта> <папка-фикстур> <папка-результатов>
   Фикстуры: tone264.mp4 (H.264 + AAC), tone264rot.mp4.
   Проверяет то, чего нет в Chromium без патентных кодеков: H.264 в MP4, быстрое чтение H.264, звук AAC.
   AV_REQUIRE_AAC=1 — считать отсутствие AAC ошибкой (на Linux Chrome кодировать AAC может не уметь). */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [root, fx, outDir] = process.argv.slice(2);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/json', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.json': 'application/json', '.bin': 'application/octet-stream' };
const srv = http.createServer((q, r) => {
  let p = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); r.end(d); });
}).listen(8786, async () => {
  const b = await chromium.launch(process.env.AV_CHROME ? { executablePath: process.env.AV_CHROME } : process.env.AV_CHANNEL ? { channel: process.env.AV_CHANNEL } : {});
  const ctx = await b.newContext({ viewport: { width: 430, height: 900 }, locale: 'ru-RU' });
  await ctx.addInitScript(() => { try { localStorage.setItem('aspect-video-onboarded', '1'); } catch (e) { /* ничего */ } });
  const pg = await ctx.newPage(); const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  const dump = async (name, href) => { const buf = await pg.evaluate(async h => Array.from(new Uint8Array(await (await fetch(h)).arrayBuffer())), href); fs.writeFileSync(path.join(outDir, name), Buffer.from(buf)); };
  const lastResult = () => pg.evaluate(() => { const r = window.AVApp.results()[0]; return r && { name: r.name, size: r.blob.size, ext: r.ext, url: r.url, warn: r.warnings, engine: r.engine }; });
  const save = async () => { await pg.click('#saveBtn'); await pg.waitForFunction(() => document.querySelector('#progress').hidden, null, { timeout: 180000 }); await pg.waitForTimeout(300); };
  const sh = (cmd) => require('child_process').execSync(cmd, { encoding: 'utf8', shell: '/bin/bash' });
  const probe = f => JSON.parse(sh('ffprobe -v error -show_entries stream=codec_type,codec_name,width,height -show_entries format=duration -of json ' + f));
  try {
    await pg.goto('http://localhost:8786/index.html'); await pg.waitForSelector('#uploadBtn');
    console.log('браузер:', await b.version());
    const caps = await pg.evaluate(async () => ({
      h264: (await VideoEncoder.isConfigSupported({ codec: 'avc1.640028', width: 640, height: 360, bitrate: 1e6 })).supported,
      dec: (await VideoDecoder.isConfigSupported({ codec: 'avc1.640028' })).supported,
      aac: (await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 })).supported
    }));
    console.log(JSON.stringify(caps));
    ok(caps.h264 && caps.dec, 'браузер кодирует и декодирует H.264');
    if (process.env.AV_REQUIRE_AAC) ok(caps.aac, 'браузер кодирует AAC'); else if (!caps.aac) console.log('skip  AAC в этом браузере не кодируется: проверка звука AAC пропущена');
    for (const f of ['tone264.mp4', 'tone264rot.mp4']) {
      await pg.reload(); await pg.waitForSelector('#uploadBtn');
      await pg.setInputFiles('#fileInput', path.join(fx, f)); await pg.waitForSelector('#previewCard:not([hidden])', { timeout: 15000 }); await pg.waitForTimeout(600);
      await pg.click('#settingsTabs [data-tab="frame"]'); await pg.click('#scenarios button >> nth=0');
      await pg.click('#settingsTabs [data-tab="export"]'); await pg.click('[data-group="short"] [data-val="480"]'); await pg.click('#fmtCard [data-val="mp4"]');
      await save(); const r = await lastResult(); ok(r && r.ext === 'mp4' && r.size > 1000, f + ': сохранён MP4 (' + (r && r.size) + ' байт)');
      if (!r) continue;
      ok(/decoder/.test(r.engine || ''), f + ': быстрый путь через VideoDecoder (' + r.engine + ')');
      await dump('chrome_' + f, r.url);
      const info = probe(path.join(outDir, 'chrome_' + f)), v = info.streams.find(s => s.codec_type === 'video'), a = info.streams.find(s => s.codec_type === 'audio');
      ok(v && v.codec_name === 'h264' && v.width === 480 && v.height === 854, f + ': видео H.264 ' + (v && v.width + '×' + v.height));
      ok(Math.abs(+info.format.duration - 6) < 0.3, f + ': длительность ' + info.format.duration);
      if (caps.aac) ok(a && a.codec_name === 'aac', f + ': звук AAC');
      else console.log('info  ' + f + ': звук в результате: ' + (a ? a.codec_name : 'нет') + (r.warn && r.warn.length ? ', предупреждения: ' + r.warn.join(' ') : ''));
    }
    ok(errs.length === 0, 'ошибок страницы нет ' + errs.join('|'));
  } catch (e) { console.log('FAIL исключение: ' + e.message); fails++; }
  await b.close(); srv.close();
  console.log(fails ? fails + ' FAIL' : 'ALL OK'); process.exit(fails ? 1 : 0);
});
