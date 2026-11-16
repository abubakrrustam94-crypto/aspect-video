/* Тест блока 3 (v2.2.1): node tests/block3.js <папка-сайта> <папка-фикстур> <папка-результатов>
   Фикстуры в папке: tone264.mp4, tonevp9.mp4, tone264rot.mp4, tone264end.mp4, long45.mp4 (45 мин, звук Opus).
   Проверяет быстрое чтение кадров (скорость и совпадение с перемоткой), звук по частям, поворот и moov в конце файла. */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [root, fx, outDir] = process.argv.slice(2);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/json', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.json': 'application/json', '.bin': 'application/octet-stream' };
const srv = http.createServer((q, r) => {
  let p = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); r.end(d); });
}).listen(8771, async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 430, height: 900 }, locale: 'ru-RU' });
  await ctx.addInitScript(() => { try { localStorage.setItem('aspect-video-onboarded', '1'); } catch (e) { /* ничего */ } });
  const pg = await ctx.newPage(); const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  const dump = async (name, href) => { const buf = await pg.evaluate(async h => Array.from(new Uint8Array(await (await fetch(h)).arrayBuffer())), href); fs.writeFileSync(path.join(outDir, name), Buffer.from(buf)); };
  const lastResult = () => pg.evaluate(() => { const r = window.AVApp.results()[0]; return r && { name: r.name, size: r.blob.size, ext: r.ext, url: r.url, warn: r.warnings, engine: r.engine }; });
  const save = async () => { await pg.click('#saveBtn'); await pg.waitForFunction(() => document.querySelector('#progress').hidden, null, { timeout: 180000 }); await pg.waitForTimeout(300); };
  async function exportWith(file, flags, tag, fmt) {
    await pg.reload(); await pg.waitForSelector('#uploadBtn');
    await pg.evaluate(f => { window.AV_NOFAST = f.nofast; window.AV_NOSTREAM = f.nostream; }, flags);
    await pg.setInputFiles('#fileInput', path.join(fx, file));
    await pg.waitForSelector('#previewCard:not([hidden])', { timeout: 15000 }); await pg.waitForTimeout(600);
    await pg.click('#settingsTabs [data-tab="frame"]'); await pg.click('#scenarios button >> nth=0');
    await pg.click('#settingsTabs [data-tab="export"]'); await pg.click('[data-group="short"] [data-val="480"]');
    if (fmt) await pg.click('#fmtCard [data-val="' + fmt + '"]');
    const t0 = Date.now(); await save(); const ms = Date.now() - t0;
    const r = await lastResult(); if (r) await dump(tag + '.' + r.ext, r.url);
    return { r, ms };
  }
  const sh = (cmd) => require('child_process').execSync(cmd, { encoding: 'utf8', shell: '/bin/bash' });
  try {
    await pg.goto('http://localhost:8771/index.html');
    for (const f of ['tonevp9.mp4', 'tone264rot.mp4', 'tone264end.mp4']) {
      const fast = await exportWith(f, {}, f + '_fast'), slow = await exportWith(f, { nofast: true, nostream: true }, f + '_slow');
      console.log(f, 'fast', fast.ms, 'мс', fast.r && fast.r.engine, '| slow', slow.ms, 'мс', slow.r && slow.r.engine);
      ok(fast.r && /decoder/.test(fast.r.engine || ''), f + ': быстрый путь включился (' + (fast.r && fast.r.engine) + ')');
      ok(slow.r && /seek/.test(slow.r.engine || ''), f + ': запасной путь работает');
      if (!fast.r || !slow.r) continue;
      const a = path.join(outDir, f + '_fast.' + fast.r.ext), s2 = path.join(outDir, f + '_slow.' + slow.r.ext);
      const da = +sh(`ffprobe -v error -show_entries format=duration -of csv=p=0 ${a}`), ds = +sh(`ffprobe -v error -show_entries format=duration -of csv=p=0 ${s2}`);
      ok(Math.abs(da - ds) < 0.15, f + ': длительность совпадает ' + da + ' и ' + ds);
      const ss = sh(`ffmpeg -hide_banner -i ${a} -i ${s2} -lavfi ssim -f null - 2>&1 | grep -o "All:[0-9.]*" | tail -1`).trim();
      const v = parseFloat(ss.split(':')[1]);
      ok(v > 0.93, f + ': картинка близка к запасному пути, SSIM ' + ss);
      ok(fast.ms < slow.ms, f + ': быстрый путь быстрее (' + fast.ms + ' против ' + slow.ms + ' мс)');
    }
    const lv = (f) => { const o = sh(`ffmpeg -hide_banner -i ${path.join(outDir, f)} -vn -af volumedetect -f null - 2>&1 | grep mean_volume || true`); const m = /mean_volume: (-?[0-9.]+)/.exec(o); return m ? +m[1] : null; };
    const wf = await exportWith('tonevp9.mp4', {}, 'aud_fast', 'webm'), ws = await exportWith('tonevp9.mp4', { nofast: true, nostream: true }, 'aud_slow', 'webm');
    console.log('движки звука', wf.r && wf.r.engine, '|', ws.r && ws.r.engine);
    ok(wf.r && /audio-stream/.test(wf.r.engine), 'звук читается по частям (AudioDecoder)');
    ok(ws.r && /audio-buffer/.test(ws.r.engine), 'запасной путь звука целиком');
    const la = lv('aud_fast.webm'), ls = lv('aud_slow.webm');
    console.log('уровень звука fast/slow', la, ls);
    ok(la !== null && ls !== null && Math.abs(la - ls) < 1.5, 'звук по частям совпадает по громкости с запасным путём: ' + la + ' и ' + ls);
    /* анализ 45 минут звука по частям: быстро и без падения */
    await pg.reload(); await pg.waitForSelector('#uploadBtn');
    await pg.setInputFiles('#fileInput', path.join(fx, 'long45.mp4'));
    await pg.waitForSelector('#previewCard:not([hidden])', { timeout: 20000 }); await pg.waitForTimeout(800);
    await pg.click('#settingsTabs [data-tab="video"]');
    const t1 = Date.now(); await pg.click('#silEdge');
    await pg.waitForFunction(() => /Убрано|Тишины не нашлось|не нашлось звука|слишком|Не удалось/.test(document.querySelector('#silStatus').textContent), null, { timeout: 120000 });
    const msA = Date.now() - t1;
    console.log('анализ 45 минут звука:', msA, 'мс:', await pg.textContent('#silStatus'));
    ok(msA < 90000, '45 минут звука разобраны по частям за ' + msA + ' мс');
    ok(!/слишком длинный|Не удалось/.test(await pg.textContent('#silStatus')), 'лимит длины для MP4 не сработал');
  } catch (e) { console.log('EXC', e.message); fails++; }
  console.log('errors:', JSON.stringify(errs));
  if (errs.length) fails++;
  console.log(fails ? 'FAILED ' + fails : 'ALL OK');
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
});
