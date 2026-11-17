/* Тест продолжения после сбоя: node tests/resume.js <папка-сайта> <a.webm> <b.webm> <c.webm>
   Запускает сохранение трёх видео, после первого готового «ломает» вкладку (перезагрузка), затем продолжает. */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [root, f1, f2, f3] = process.argv.slice(2);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/json', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.json': 'application/json', '.bin': 'application/octet-stream' };
const srv = http.createServer((q, r) => {
  let p = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); r.end(d); });
}).listen(8773, async () => {
  const b = await chromium.launch(process.env.AV_CHROME ? { executablePath: process.env.AV_CHROME } : process.env.AV_CHANNEL ? { channel: process.env.AV_CHANNEL } : {});
  const ctx = await b.newContext({ viewport: { width: 430, height: 900 }, locale: 'ru-RU' });
  await ctx.addInitScript(() => { try { localStorage.setItem('aspect-video-onboarded', '1'); } catch (e) { /* ничего */ } });
  const pg = await ctx.newPage(); const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  try {
    await pg.goto('http://localhost:8773/index.html');
    await pg.setInputFiles('#fileInput', [f1, f2, f3]);
    await pg.waitForFunction(() => window.AVApp.Q().length === 3, null, { timeout: 20000 });
    await pg.waitForTimeout(500);
    await pg.click('#settingsTabs [data-tab="export"]');
    await pg.click('[data-group="short"] [data-val="480"]');
    await pg.evaluate(() => { window.AVApp.Q()[1].caps = [{ text: 'Подпись', start: 0.2, end: 1.5 }]; window.AVApp.Q()[2].start = 0.5; });
    await pg.click('#saveAllBtn');
    await pg.waitForFunction(() => window.AVApp.results().length >= 1, null, { timeout: 60000 });
    await pg.waitForTimeout(1200);
    const before = await pg.evaluate(() => window.AVApp.results().length);
    ok(before >= 1 && before < 3, 'после первого готового видео вкладка «ломается» (готово ' + before + ' из 3)');
    await pg.reload();                                  // имитация сбоя или закрытия вкладки
    await pg.waitForSelector('#resumeBar:not([hidden])', { timeout: 10000 });
    const txt = await pg.textContent('#resumeText');
    console.log('баннер:', txt);
    ok(/готово \d из 3/.test(txt), 'после запуска виден баннер продолжения');
    await pg.click('#resumeGo');
    await pg.waitForFunction(() => window.AVApp.results().length >= 3, null, { timeout: 120000 });
    await pg.waitForFunction(() => document.querySelector('#progress').hidden, null, { timeout: 60000 });
    const res = await pg.evaluate(() => window.AVApp.results().map(r => ({ n: r.name, s: r.blob.size, e: r.engine })));
    console.log(JSON.stringify(res));
    ok(res.length === 3 && res.every(r => r.s > 3000), 'все три видео в списке, пустых нет');
    ok(res.some(r => r.e === 'restored'), 'готовое видео восстановлено из хранилища, а не сделано заново');
    ok(new Set(res.map(r => r.n)).size === 3, 'имена файлов разные');
    const q = await pg.evaluate(() => ({ start: window.AVApp.Q()[2].start, caps: window.AVApp.Q()[1].caps.length }));
    ok(Math.abs(q.start - 0.5) < 0.01 && q.caps === 1, 'настройки (фрагмент, подпись) восстановились');
    await pg.reload(); await pg.waitForTimeout(800);
    ok(await pg.locator('#resumeBar').isHidden(), 'после успешного завершения журнал удалён');
    /* «Забыть» */
    await pg.setInputFiles('#fileInput', [f1, f2]); await pg.waitForFunction(() => window.AVApp.Q().length === 2, null, { timeout: 15000 });
    await pg.click('#saveAllBtn'); await pg.waitForFunction(() => window.AVApp.results().length >= 1, null, { timeout: 60000 });
    await pg.waitForTimeout(800); await pg.reload();
    await pg.waitForSelector('#resumeBar:not([hidden])', { timeout: 10000 });
    await pg.click('#resumeDrop'); await pg.waitForTimeout(500); await pg.reload(); await pg.waitForTimeout(800);
    ok(await pg.locator('#resumeBar').isHidden(), '«Забыть» удаляет журнал');
  } catch (e) { console.log('EXC', e.message); fails++; }
  console.log('errors:', JSON.stringify(errs));
  if (errs.length) fails++;
  console.log(fails ? 'FAILED ' + fails : 'ALL OK');
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
});
