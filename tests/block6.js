/* Тест v2.7.0: node tests/block6.js <папка-сайта> <папка-фикстур> <папка-результатов>
   Фикстуры: noisy.webm (речь + белый шум), speech.webm (речь), motion.mp4 (H.264 без звука, движение).
   Проверяет шумоподавление, плавное замедление, автосубтитры (Whisper) и список компонентов. */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), cp = require('child_process');
const [root, fx, outDir] = process.argv.slice(2);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/json', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.json': 'application/json' };
const srv = http.createServer((q, r) => {
  let p = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); r.end(d); });
}).listen(8786, async () => {
  const b = await chromium.launch(process.env.AV_CHROME ? { executablePath: process.env.AV_CHROME } : process.env.AV_CHANNEL ? { channel: process.env.AV_CHANNEL } : {});
  const ctx = await b.newContext({ viewport: { width: 430, height: 900 }, locale: 'ru-RU' });
  await ctx.addInitScript(() => { try { localStorage.setItem('aspect-video-onboarded', '1'); } catch (e) { /* ничего */ } });
  const pg = await ctx.newPage(); const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  const dump = async (name, href) => { const buf = await pg.evaluate(async h => Array.from(new Uint8Array(await (await fetch(h)).arrayBuffer())), href); fs.writeFileSync(path.join(outDir, name), Buffer.from(buf)); return path.join(outDir, name); };
  const lastResult = () => pg.evaluate(() => { const r = window.AVApp.results()[0]; return r && { name: r.name, size: r.blob.size, ext: r.ext, url: r.url, warn: r.warnings, engine: r.engine }; });
  const save = async () => { await pg.click('#saveBtn'); await pg.waitForFunction(() => document.querySelector('#progress').hidden, null, { timeout: 280000 }); await pg.waitForTimeout(300); };
  const open = async f => { await pg.reload(); await pg.waitForSelector('#uploadBtn'); await pg.setInputFiles('#fileInput', path.join(fx, f)); await pg.waitForSelector('#previewCard:not([hidden])', { timeout: 30000 }); await pg.waitForTimeout(600); };
  const tab = t => pg.click(`#settingsTabs [data-tab="${t}"]`);
  const ff = (args) => cp.spawnSync('ffmpeg', ['-v', 'info', '-nostats', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const rmsOf = (f) => { const r = ff(['-ss', '9', '-t', '3', '-i', f, '-map', '0:a', '-af', 'astats=metadata=0', '-f', 'null', '-']); const m = /Overall[\s\S]*?RMS level dB:\s*(-?[\d.inf]+)/.exec(r.stderr); return m ? parseFloat(m[1]) : NaN; };
  try {
    await pg.goto('http://localhost:8786/index.html'); await pg.waitForSelector('#uploadBtn');
    // 1. компоненты в списке
    await open('tone.webm'); await tab('components'); await pg.waitForSelector('#compList .comp-card');
    await pg.waitForFunction(() => document.querySelectorAll('#compList .comp-card').length >= 3);
    const names = await pg.$$eval('#compList .comp-title b', e => e.map(x => x.textContent));
    ok(names.length === 3 && names.some(n => /Шумоподавление/.test(n)) && names.some(n => /Распознавание речи/.test(n)), 'в списке три компонента: ' + names.join(' | '));

    // 2. интерполяция кадров: движущийся квадрат
    const ip = await pg.evaluate(() => {
      const mk = (x, w = 640, h = 360, noise = 0) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = '#202020'; g.fillRect(0, 0, w, h);
        if (noise) { for (let by = 0; by < h; by += 16) for (let bx = 0; bx < w; bx += 16) { const v = Math.floor(Math.random() * 255); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(bx, by, 16, 16); } return c; }
        g.fillStyle = '#fff'; g.fillRect(x, 140, 60, 60); g.fillStyle = '#f00'; g.fillRect(x + 10, 150, 20, 20); return c; };
      const centroid = (cv) => { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let sx = 0, n = 0; for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) { if (d[(y * cv.width + x) * 4 + 1] > 200) { sx += x; n++; } } return n ? sx / n : -1; };
      const ipo = AV.makeInterp(640), A = mk(40), B = mk(64);
      return ipo.pair(0, async () => A, async () => B).then(() => {
        const mid = ipo.frame(0.5), q1 = ipo.frame(0.25), cut = ipo.cut;
        const r = { mid: centroid(mid), q1: centroid(q1), a: centroid(A), b: centroid(B), cut };
        const ip2 = AV.makeInterp(640); return ip2.pair(0, async () => mk(0, 640, 360, 1), async () => mk(0, 640, 360, 1)).then(() => { r.cutNoise = ip2.cut; return r; });
      });
    });
    ok(Math.abs(ip.mid - (ip.a + ip.b) / 2) < 8, 'кадр посередине: квадрат на ' + ip.mid.toFixed(1) + ' (ждём ' + ((ip.a + ip.b) / 2).toFixed(1) + ')');
    ok(Math.abs(ip.q1 - (ip.a + (ip.b - ip.a) * 0.25)) < 8, 'кадр на 25%: квадрат на ' + ip.q1.toFixed(1));
    ok(ip.cut === false && ip.cutNoise === true, 'смена плана определяется: обычная пара ' + ip.cut + ', шум ' + ip.cutNoise);

    // 3. шумоподавление: модуль и сохранение
    const dn = await pg.evaluate(async () => {
      const M = await AV.loadDenoise(), d = AV.makeDenoiser(M), n = 48000 * 3, x = new Float32Array(n);
      for (let i = 0; i < n; i++) x[i] = (Math.random() * 2 - 1) * 0.05;
      const before = Math.sqrt(x.reduce((s, v) => s + v * v, 0) / n);
      d.process(x.subarray(0, 24000)); d.process(x.subarray(24000));
      const tail = x.subarray(24000), after = Math.sqrt(tail.reduce((s, v) => s + v * v, 0) / tail.length);
      d.close(); return { before, after, len: x.length };
    });
    ok(dn.after < dn.before * 0.7 && dn.len === 144000, 'шум в чистом виде стал тише: ' + dn.before.toFixed(4) + ' → ' + dn.after.toFixed(4));
    const prepWebm = async () => { await tab('export'); await pg.click('[data-group="format"] [data-val="webm"]'); await tab('video'); };
    await open('noisy.webm'); await prepWebm(); await save();
    const plain = await lastResult(); const fPlain = await dump('noisy_plain.webm', plain.url);
    await open('noisy.webm'); await prepWebm(); await pg.click('.switch:has([data-key="denoise"])'); await save();
    const clean = await lastResult(); const fClean = await dump('noisy_clean.webm', clean.url);
    const r1 = rmsOf(fPlain), r2 = rmsOf(fClean);
    console.log('RMS звука: без обработки ' + r1 + ' дБ, с шумоподавлением ' + r2 + ' дБ');
    ok(isFinite(r1) && isFinite(r2) && r2 < r1 - 6, 'в конце ролика (там один шум) с шумоподавлением тише минимум на 6 дБ: ' + (r1 - r2).toFixed(1) + ' дБ');
    const speechRms = (f) => { const r = ff(['-ss', '0.5', '-t', '6', '-i', f, '-map', '0:a', '-af', 'astats=metadata=0', '-f', 'null', '-']); const m = /Overall[\s\S]*?RMS level dB:\s*(-?[\d.inf]+)/.exec(r.stderr); return m ? parseFloat(m[1]) : NaN; };
    const s2 = speechRms(fClean); console.log('речь после шумоподавления: ' + s2 + ' дБ (до ' + speechRms(fPlain) + ')');
    ok(s2 > -45, 'речь осталась слышна (громче −45 дБ)');
    ok(!(clean.warn || []).some(w => /Шумоподавление не включилось/.test(w)), 'предупреждений о шумоподавлении нет');

    // 4. плавное замедление: на настоящем MP4
    const dupes = (f) => { const r = cp.spawnSync('ffmpeg', ['-v', 'error', '-i', f, '-vf', 'scale=64:36,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 28 }); const buf = r.stdout, fs2 = 64 * 36, n = Math.floor(buf.length / fs2); let d = 0;
      for (let i = 1; i < n; i++) { let s = 0; for (let k = 0; k < fs2; k++) s += Math.abs(buf[i * fs2 + k] - buf[(i - 1) * fs2 + k]); if (s / fs2 < 0.35) d++; } return { n, d }; };
    const slow = async (smooth) => { await open('motion.mp4'); await tab('video'); await pg.click('[data-group="speed"] [data-val="0.5"]'); if (smooth) { ok(await pg.$eval('#smoothRow', e => !e.hidden), 'переключатель плавности виден при 0,5×'); await pg.click('.switch:has([data-key="smooth"])'); }
      await tab('export'); await pg.click('[data-group="format"] [data-val="mp4"]'); await save(); const r = await lastResult(); return { r, f: await dump('slow_' + smooth + '.' + r.ext, r.url) }; };
    const p0 = await slow(false), p1 = await slow(true);
    const d0 = dupes(p0.f), d1 = dupes(p1.f);
    console.log('повторы кадров: обычное ' + d0.d + ' из ' + d0.n + ', плавное ' + d1.d + ' из ' + d1.n + ' · ' + p1.r.engine);
    ok(d0.d > d0.n * 0.35, 'обычное замедление повторяет кадры: ' + d0.d + ' из ' + d0.n);
    ok(d1.d < d0.d * 0.3, 'плавное замедление почти не повторяет кадры: ' + d1.d + ' из ' + d1.n);
    ok(!(p1.r.warn || []).some(w => /Плавное замедление не сработало/.test(w)), 'предупреждения о неработающей плавности нет');
    await open('motion.mp4'); await tab('video'); await pg.click('[data-group="speed"] [data-val="1"]');
    ok(await pg.$eval('#smoothRow', e => e.hidden), 'при 1× переключатель плавности скрыт');
    await open('tone.webm'); await tab('video'); await pg.click('[data-group="speed"] [data-val="0.5"]'); await pg.evaluate(() => set('smooth', true));
    await tab('export'); await save(); const fb = await lastResult();
    ok((fb.warn || []).some(w => /Плавное замедление не сработало/.test(w)), 'WebM без быстрого чтения: честное предупреждение, видео сохранено');
    await pg.evaluate(() => set('smooth', false));

    // 5. автосубтитры
    await open('speech.webm'); await tab('wm');
    await pg.selectOption('#capLang', 'en');
    const t0 = Date.now(); await pg.click('#capAuto');
    await pg.waitForFunction(() => document.querySelector('#progress').hidden === false, null, { timeout: 10000 }).catch(() => {});
    await pg.waitForFunction(() => document.querySelector('#progress').hidden, null, { timeout: 280000 });
    const caps = await pg.evaluate(() => window.AVApp.Q()[0].caps.map(c => ({ t: c.text, s: +c.start.toFixed(2), e: +c.end.toFixed(2) })));
    console.log('Whisper за ' + ((Date.now() - t0) / 1000).toFixed(0) + ' с:', JSON.stringify(caps));
    const all = caps.map(c => c.t).join(' ').toLowerCase();
    ok(caps.length >= 1, 'подписи появились: ' + caps.length);
    ok(['hello', 'everyone', 'aspect', 'ratio', 'video', 'cropping', 'talk'].filter(w => all.includes(w)).length >= 3, 'в тексте узнаются слова из фразы: «' + all + '»');
    ok(caps.every(c => c.s >= 0 && c.e > c.s && c.e <= 8.5), 'время подписей в пределах ролика');
    ok(await pg.$eval('#progress', e => e.hidden) && !(await pg.$eval('#saveBtn', e => e.disabled)), 'после распознавания экран свободен');
    // тишина и тон: не падает
    await open('tone.webm'); await tab('wm'); await pg.click('#capAuto');
    await pg.waitForFunction(() => document.querySelector('#progress').hidden === false, null, { timeout: 10000 }).catch(() => {});
    await pg.waitForFunction(() => document.querySelector('#progress').hidden, null, { timeout: 280000 });
    ok(true, 'тон без речи: распознавание завершилось без падения');
    ok(errs.length === 0, 'ошибок страницы нет ' + JSON.stringify(errs));
  } catch (e) { console.log('FAIL исключение: ' + (e.stack || e)); fails++; }
  await b.close(); srv.close();
  console.log(fails ? 'FAILED ' + fails : 'ALL OK'); process.exit(fails ? 1 : 0);
});
