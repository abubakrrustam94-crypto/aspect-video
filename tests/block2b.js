/* Тест блока 2 (v2.4.0): node tests/block2b.js <папка-сайта> <папка-фикстур> <папка-результатов>
   Фикстуры: tone.webm (−22 LUFS), tone264rot.mp4 (поворот 90).
   Проверяет измеритель LUFS, выравнивание громкости, умный фон, горячие клавиши и поворот. */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [root, fx, outDir] = process.argv.slice(2);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/json', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.json': 'application/json', '.bin': 'application/octet-stream' };
const srv = http.createServer((q, r) => {
  let p = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); r.end(d); });
}).listen(8782, async () => {
  const b = await chromium.launch(process.env.AV_CHROME ? { executablePath: process.env.AV_CHROME } : process.env.AV_CHANNEL ? { channel: process.env.AV_CHANNEL } : {});
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
    await pg.goto('http://localhost:8782/index.html'); await pg.waitForSelector('#uploadBtn');
    // 1. измеритель LUFS на синусе: 997 Гц, −20 dBFS в обоих каналах = −20,0 LUFS (так в BS.1770)
    const lf = await pg.evaluate(() => {
      const res = {};
      for (const sr of [48000, 44100]) {
        const n = sr * 5, a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = 0.1 * Math.sin(2 * Math.PI * 997 * i / sr);
        const m = AV.lufsMeter(sr); m.push(a, a, 0, n); res['sine' + sr] = m.result();
        const b = new Float32Array(n * 2); b.set(a);                 // 5 с звука и 5 с тишины: порог должен отбросить тишину
        const m2 = AV.lufsMeter(sr); m2.push(b, b, 0, n * 2); res['gated' + sr] = m2.result();
      }
      const z = new Float32Array(48000); const m3 = AV.lufsMeter(48000); m3.push(z, z, 0, z.length); res.silence = m3.result();
      return res;
    });
    console.log(JSON.stringify(lf));
    ok(Math.abs(lf.sine48000 + 20.0) < 0.15 && Math.abs(lf.sine44100 + 20.0) < 0.15, 'LUFS синуса −20 dBFS: ' + lf.sine48000.toFixed(2) + ' и ' + lf.sine44100.toFixed(2));
    ok(Math.abs(lf.gated48000 + 20.0) < 0.3, 'тишина не занижает громкость: ' + lf.gated48000.toFixed(2));
    ok(lf.silence === -Infinity, 'тишина даёт −∞');
    // 2. умный фон: сверху красное, снизу синее
    const sm = await pg.evaluate(() => {
      const s = document.createElement('canvas'); s.width = 160; s.height = 90; const g = s.getContext('2d');
      g.fillStyle = '#f00'; g.fillRect(0, 0, 160, 45); g.fillStyle = '#00f'; g.fillRect(0, 45, 160, 45);
      const c = document.createElement('canvas'); c.width = 90; c.height = 160; const x = c.getContext('2d');
      AV.drawFrame(x, 90, 160, s, 160, 90, { mode: 'smart' });
      const t = x.getImageData(45, 50, 1, 1).data, b = x.getImageData(45, 110, 1, 1).data, out = x.getImageData(45, 2, 1, 1).data;
      return { t: Array.from(t), b: Array.from(b), out: Array.from(out) };
    });
    ok(sm.t[0] > 100 && sm.t[2] < 60, 'умный фон сверху красный у кадра: ' + sm.t);
    ok(sm.b[2] > 100 && sm.b[0] < 60, 'умный фон снизу синий у кадра: ' + sm.b);
    ok(sm.out[0] < sm.t[0], 'к краю экрана темнеет: ' + sm.out + ' против ' + sm.t);
    // 3. сохранение с выравниванием: ожидаем около −14 LUFS
    const open = async f => { await pg.reload(); await pg.waitForSelector('#uploadBtn'); await pg.setInputFiles('#fileInput', path.join(fx, f)); await pg.waitForSelector('#previewCard:not([hidden])', { timeout: 15000 }); await pg.waitForTimeout(600); };
    await open('tone.webm');
    await pg.click('#settingsTabs [data-tab="frame"]'); await pg.click('#scenarios button >> nth=0');
    await pg.click('[data-group="mode"] [data-val="smart"]');
    await pg.click('#settingsTabs [data-tab="export"]'); await pg.click('[data-group="short"] [data-val="480"]'); await pg.click('#fmtCard [data-val="webm"]');
    await pg.click('#settingsTabs [data-tab="video"]'); await pg.click('.switch:has([data-key="norm"])');
    await save(); const r = await lastResult(); ok(r && r.size > 1000, 'сохранение с умным фоном и выравниванием прошло');
    if (r) {
      await dump('norm.' + r.ext, r.url);
      const ff = sh('ffmpeg -nostats -i ' + path.join(outDir, 'norm.' + r.ext) + ' -af ebur128=peak=true -f null - 2>&1 | grep -A20 Summary');
      const li = +/I:\s+(-?[\d.]+) LUFS/.exec(ff)[1], pk = +/Peak:\s+(-?[\d.]+) dBFS/.exec(ff)[1];
      ok(li > -15.5 && li < -12.5, 'громкость после выравнивания ' + li + ' LUFS (была −22,1)');
      ok(pk < 0.2, 'пик не выше 0 дБ: ' + pk);
    }
    // 4. горячие клавиши
    await open('tone.webm');
    await pg.click('body', { position: { x: 5, y: 5 } });
    const t0 = await pg.evaluate(() => document.querySelector('video, #video') && (document.querySelector('#video') || document.querySelector('video')).currentTime);
    await pg.keyboard.press('ArrowRight'); await pg.waitForTimeout(300);
    const t1 = await pg.evaluate(() => (document.querySelector('#video') || document.querySelector('video')).currentTime);
    ok(Math.abs(t1 - t0 - 1 / 30) < 0.02, '→ сдвигает на кадр: ' + (t1 - t0).toFixed(3));
    await pg.keyboard.press('Shift+ArrowRight'); await pg.waitForTimeout(400);
    const t2 = await pg.evaluate(() => (document.querySelector('#video') || document.querySelector('video')).currentTime);
    ok(Math.abs(t2 - t1 - 1) < 0.05, 'Shift+→ сдвигает на секунду: ' + (t2 - t1).toFixed(3));
    await pg.keyboard.press('i'); const s1 = await pg.evaluate(() => window.AVApp.Q()[0].start);
    await pg.keyboard.press('ArrowRight'); await pg.keyboard.press('Shift+ArrowRight'); await pg.waitForTimeout(400); await pg.keyboard.press('o');
    const e1 = await pg.evaluate(() => window.AVApp.Q()[0].end);
    ok(Math.abs(s1 - t2) < 0.05 && e1 > s1 + 0.9, 'I и O ставят границы обрезки: ' + s1.toFixed(2) + '–' + e1.toFixed(2));
    await pg.focus('[data-key="wmText"]').catch(() => {});
    await pg.click('#settingsTabs [data-tab="wm"]'); await pg.fill('[data-key="wmText"]', 'sio').catch(() => {});
    const before = await pg.evaluate(() => window.AVApp.Q()[0].start);
    await pg.keyboard.press('i'); const after = await pg.evaluate(() => window.AVApp.Q()[0].start);
    ok(before === after, 'в поле ввода клавиши не срабатывают');
    await pg.click('body', { position: { x: 5, y: 5 } }); await pg.keyboard.press('s');
    await pg.waitForFunction(() => window.AVApp.results().length > 0 || !document.querySelector('#progress').hidden, null, { timeout: 15000 }).then(() => ok(true, 'S запускает сохранение'), () => ok(false, 'S запускает сохранение'));
    await pg.waitForFunction(() => document.querySelector('#progress').hidden, null, { timeout: 120000 });
    // 5. поворот: быстрый путь и перемотка дают одну и ту же картинку
    const fastR = await (async () => { await pg.reload(); await pg.waitForSelector('#uploadBtn'); await pg.evaluate(() => { window.AV_NOFAST = false; window.AV_NOSTREAM = false; }); await pg.setInputFiles('#fileInput', path.join(fx, 'tone264rot.mp4')); await pg.waitForSelector('#previewCard:not([hidden])', { timeout: 15000 }); await pg.waitForTimeout(600); await pg.click('#settingsTabs [data-tab="export"]'); await pg.click('[data-group="short"] [data-val="480"]'); await pg.click('#fmtCard [data-val="webm"]'); await save(); const r2 = await lastResult(); await dump('rot_fast.' + r2.ext, r2.url); return r2; })();
    const slowR = await (async () => { await pg.reload(); await pg.waitForSelector('#uploadBtn'); await pg.evaluate(() => { window.AV_NOFAST = true; window.AV_NOSTREAM = true; }); await pg.setInputFiles('#fileInput', path.join(fx, 'tone264rot.mp4')); await pg.waitForSelector('#previewCard:not([hidden])', { timeout: 15000 }); await pg.waitForTimeout(600); await pg.click('#settingsTabs [data-tab="export"]'); await pg.click('[data-group="short"] [data-val="480"]'); await pg.click('#fmtCard [data-val="webm"]'); await save(); const r3 = await lastResult(); await dump('rot_slow.' + r3.ext, r3.url); return r3; })();
    ok(/decoder/.test(fastR.engine || ''), 'повёрнутое видео: быстрый путь включён (' + fastR.engine + ')');
    const ps = sh('ffmpeg -nostats -i ' + path.join(outDir, 'rot_fast.' + fastR.ext) + ' -i ' + path.join(outDir, 'rot_slow.' + slowR.ext) + ' -lavfi "[0:v]select=eq(n\\,10),setpts=PTS-STARTPTS[a];[1:v]select=eq(n\\,10),setpts=PTS-STARTPTS[b];[a][b]psnr" -f null - 2>&1 | grep "PSNR"');
    const m = /average:([\d.]+|inf)/.exec(ps), psnr = m ? (m[1] === 'inf' ? 99 : +m[1]) : 0;
    ok(psnr > 20, 'кадр с быстрого пути совпадает с кадром с перемотки, PSNR ' + psnr);
    const dim = (f) => sh('ffprobe -v error -select_streams v -show_entries stream=width,height -of csv=p=0 ' + f).trim();
    ok(dim(path.join(outDir, 'rot_fast.' + fastR.ext)) === dim(path.join(outDir, 'rot_slow.' + slowR.ext)), 'размеры совпадают: ' + dim(path.join(outDir, 'rot_fast.' + fastR.ext)));
    ok(errs.length === 0, 'ошибок страницы нет ' + errs.join('|'));
  } catch (e) { console.log('FAIL исключение: ' + e.message); fails++; }
  await b.close(); srv.close();
  console.log(fails ? fails + ' FAIL' : 'ALL OK'); process.exit(fails ? 1 : 0);
});
