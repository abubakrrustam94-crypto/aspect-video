/* Тест v2.13.0: node tests/block11.js <папка-сайта> <папка-фикстур> <папка-результатов>
   Скорость кусками (длительность результата и звука), проект в файл, разбиение на части. */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), cp = require('child_process');
const [root, fx, outDir] = process.argv.slice(2);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/json', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml' };
fs.mkdirSync(outDir, { recursive: true });
const srv = http.createServer((q, r) => {
  let p = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); r.end(d); });
}).listen(8791, async () => {
  const b = await chromium.launch(process.env.AV_CHROME ? { executablePath: process.env.AV_CHROME } : process.env.AV_CHANNEL ? { channel: process.env.AV_CHANNEL } : {});
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, locale: 'ru-RU' });
  await ctx.addInitScript(() => { try { localStorage.setItem('aspect-video-onboarded', '1'); localStorage.setItem('aspect-video-seen', '2.13.0'); } catch (e) { /* ничего */ } });
  const pg = await ctx.newPage(); const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  const tab = t => pg.click(`#settingsTabs [data-tab="${t}"]`);
  try {
    await pg.goto('http://localhost:8791/index.html'); await pg.waitForSelector('#uploadBtn');
    await pg.setInputFiles('#fileInput', path.join(fx, 'a.webm')); await pg.waitForSelector('#previewCard:not([hidden])', { timeout: 30000 }); await pg.waitForTimeout(1500);
    await tab('video'); await pg.waitForTimeout(400);
    const dur = await pg.evaluate(() => window.AVApp.Q()[0].dur);
    // кусок
    await pg.evaluate(() => { document.getElementById('video').currentTime = 1; }); await pg.waitForTimeout(500);
    await pg.click('#spdAdd'); await pg.waitForTimeout(300);
    let spd = await pg.evaluate(() => window.AVApp.Q()[0].spd);
    ok(spd.length === 1 && Math.abs(spd[0].start - 1) < 0.15 && spd[0].speed === 0.5, 'кусок добавлен: ' + JSON.stringify(spd));
    const len = spd[0].end - spd[0].start;
    ok((await pg.$$('#spdList .sc-row')).length === 1, 'строка куска в списке');
    ok(await pg.isVisible('.tl-spd'), 'полоска куска на ленте');
    await pg.click('#spdAdd'); // тот же момент: отказ
    ok((await pg.evaluate(() => window.AVApp.Q()[0].spd.length)) === 1, 'повторный кусок в том же месте не создаётся');
    const exp = dur - len + len / 0.5;
    // экспорт
    await tab('export'); await pg.fill('#targetMb', ''); await pg.click('[data-group="format"] [data-val="webm"]');
    await pg.click('#saveBtn'); await pg.waitForFunction(() => window.AVApp.results().length === 1, null, { timeout: 120000 });
    await pg.waitForTimeout(500);
    const href = await pg.$eval('#resultList a', a => a.href);
    const buf = await pg.evaluate(async h => Array.from(new Uint8Array(await (await fetch(h)).arrayBuffer())), href);
    const f1 = path.join(outDir, 'spd.webm'); fs.writeFileSync(f1, Buffer.from(buf));
    const fd = +cp.spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f1], { encoding: 'utf8' }).stdout.trim();
    const dt = cp.spawnSync('ffmpeg', ['-v', 'info', '-i', f1, '-map', '0:a', '-f', 'null', '-'], { encoding: 'utf8' }).stderr.match(/time=(\d+):(\d+):([\d.]+)/g);
    const lt = dt ? dt[dt.length - 1].match(/(\d+):(\d+):([\d.]+)/) : null;
    const dv = fd, da = lt ? (+lt[1]) * 3600 + (+lt[2]) * 60 + (+lt[3]) : 0;
    ok(Math.abs(dv - exp) < 0.35, 'длина видео ' + dv.toFixed(2) + ' ожидалась ' + exp.toFixed(2));
    ok(Math.abs(da - exp) < 0.4, 'длина звука ' + da.toFixed(2) + ' ожидалась ' + exp.toFixed(2));
    // проект в файл
    await pg.evaluate(() => window.AVApp.Q()[0].caps.push({ start: 0.2, end: 1, text: 'Привет' }));
    await pg.click('[data-group="short"] [data-val="360"]').catch(() => {});
    const dl = pg.waitForEvent('download', { timeout: 20000 });
    await pg.click('#projSave'); const d = await dl; const pf = path.join(outDir, 'p.avproj'); await d.saveAs(pf);
    ok(/\.avproj$/.test(d.suggestedFilename()), 'файл проекта: ' + d.suggestedFilename());
    const pj = JSON.parse(fs.readFileSync(pf, 'utf8'));
    ok(pj.app === 'aspect-studio-video' && pj.items.length === 1 && pj.items[0].spd.length === 1 && pj.items[0].caps.length === 1 && pj.settings && !('mGps' in pj.settings), 'в файле: кусок, подпись, настройки без GPS');
    // заново: чистая страница
    await pg.goto('http://localhost:8791/index.html'); await pg.waitForSelector('#uploadBtn'); await pg.waitForTimeout(500);
    await tab('export');
    await pg.setInputFiles('#projLoadFile', pf); await pg.waitForTimeout(500);
    ok(await pg.isVisible('#projBar'), 'плашка проекта из файла показана');
    await pg.setInputFiles('#projFile', path.join(fx, 'a.webm')); await pg.waitForFunction(() => window.AVApp.Q().length === 1, null, { timeout: 20000 }); await pg.waitForTimeout(1200);
    const r2 = await pg.evaluate(() => { const i = window.AVApp.Q()[0]; return { spd: i.spd, caps: i.caps.length, short: S.short }; });
    ok(r2.spd.length === 1 && r2.spd[0].speed === 0.5 && r2.caps === 1, 'проект восстановлен: ' + JSON.stringify(r2));
    // плохие файлы
    const bad = path.join(outDir, 'bad.avproj'); fs.writeFileSync(bad, '{"app":"other","items":[]}');
    await pg.setInputFiles('#projLoadFile', bad); await pg.waitForTimeout(400);
    ok(/не файл проекта/.test(await pg.textContent('#toast').catch(() => '') || ''), 'чужой файл отклонён');
    const bad2 = path.join(outDir, 'bad2.avproj'); fs.writeFileSync(bad2, 'не json');
    await pg.setInputFiles('#projLoadFile', bad2); await pg.waitForTimeout(300);
    // части
    await tab('video');
    await pg.evaluate(() => { const i = window.AVApp.Q()[0]; i.spd = []; });
    await pg.fill('#partMin', '1'); await pg.click('#partGo'); await pg.waitForTimeout(300);
    ok(/короче 1 мин/.test(await pg.textContent('#partNote')), 'короткое видео не делится: ' + await pg.textContent('#partNote'));
    const parts = await pg.evaluate(() => {
      const i = window.AVApp.Q()[0]; i.dur = 150; i.end = 150; i.spd = [{ start: 0, end: 60, speed: 2 }];
      document.getElementById('partMin').value = '1'; document.getElementById('partGo').click();
      return window.AVApp.Q().slice(1).map(q => [q.name, +q.start.toFixed(2), +q.end.toFixed(2), q.spd.length]);
    });
    // 0–60 при 2× даёт 30 с, затем 90 с обычной скорости: всего 120 с, две части по 60 с: [0,90] и [90,150]
    console.log(JSON.stringify(parts));
    ok(parts.length === 2 && /_часть1/.test(parts[0][0]), 'частей: ' + parts.length);
    ok(parts[0][1] === 0 && Math.abs(parts[0][2] - 90) < 0.1 && Math.abs(parts[1][1] - 90) < 0.1 && Math.abs(parts[1][2] - 150) < 0.1 && parts[0][3] === 1 && parts[1][3] === 0, 'границы частей по длине результата');
  } catch (e) { ok(false, 'исключение: ' + e.message.split('\n')[0]); }
  ok(errs.length === 0, 'нет ошибок страницы ' + errs.join(' | '));
  await b.close(); srv.close(); console.log(fails ? 'FAILED ' + fails : 'ALL OK'); process.exit(fails ? 1 : 0);
});
