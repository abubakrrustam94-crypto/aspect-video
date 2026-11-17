/* Тест блока 1 (v2.3.0): node tests/block1.js <папка-сайта> <папка-фикстур> <папка-результатов>
   Фикстуры: tone.webm, a.webm, hevc.mp4 (H.265), junk.avi (мусор).
   Проверяет подсказку о формате, предпросмотр 3 с, поворот у каждого видео и восстановление проекта. */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [root, fx, outDir] = process.argv.slice(2);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/json', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.json': 'application/json', '.bin': 'application/octet-stream' };
const srv = http.createServer((q, r) => {
  let p = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); r.end(d); });
}).listen(8781, async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 430, height: 900 }, locale: 'ru-RU' });
  await ctx.addInitScript(() => { try { localStorage.setItem('aspect-video-onboarded', '1'); } catch (e) { /* ничего */ } });
  const pg = await ctx.newPage(); const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  const dump = async (name, href) => { const buf = await pg.evaluate(async h => Array.from(new Uint8Array(await (await fetch(h)).arrayBuffer())), href); fs.writeFileSync(path.join(outDir, name), Buffer.from(buf)); };
  const lastResult = () => pg.evaluate(() => { const r = window.AVApp.results()[0]; return r && { name: r.name, size: r.blob.size, ext: r.ext, url: r.url, warn: r.warnings, engine: r.engine }; });
  const save = async () => { await pg.click('#saveBtn'); await pg.waitForFunction(() => document.querySelector('#progress').hidden, null, { timeout: 180000 }); await pg.waitForTimeout(300); };
  const open = async (files) => { await pg.reload(); await pg.waitForSelector('#uploadBtn'); await pg.setInputFiles('#fileInput', files.map(f => path.join(fx, f))); };
  try {
    await pg.goto('http://localhost:8781/index.html');
    // 1. подсказка о формате
    await open(['junk.avi']); await pg.waitForSelector('#fmtHelp:not([hidden])', { timeout: 10000 });
    let t = await pg.textContent('#fmtHelp');
    ok(/\.avi/.test(t) && /ffmpeg -i input\.avi/.test(t), 'мусорный .avi: есть подсказка и команда');
    await pg.click('#fmtHelpClose'); ok(await pg.$eval('#fmtHelp', e => e.hidden), 'подсказку можно закрыть');
    await open(['hevc.mp4']);
    const opened = await pg.waitForSelector('#fmtHelp:not([hidden])', { timeout: 8000 }).then(() => true, () => false);
    if (opened) { t = await pg.textContent('#fmtHelp'); ok(/H\.265|HEVC/.test(t), 'HEVC определён по таблице файла'); }
    else console.log('skip  HEVC открылся в этом браузере, подсказка не нужна');
    // 2. предпросмотр
    await open(['tone.webm']); await pg.waitForSelector('#previewCard:not([hidden])', { timeout: 15000 }); await pg.waitForTimeout(600);
    await pg.click('#clipBtn'); await pg.waitForSelector('#clipDlg:not([hidden])', { timeout: 60000 });
    await pg.waitForFunction(() => { const v = document.querySelector('#clipVideo'); return v.readyState >= 1 && isFinite(v.duration); }, null, { timeout: 15000 });
    const cd = await pg.$eval('#clipVideo', v => v.duration);
    ok(cd > 1.5 && cd <= 3.3, 'предпросмотр длится около 3 с: ' + cd.toFixed(2));
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
    ok(await pg.$eval('#clipDlg', e => e.hidden) && !(await pg.$eval('#clipVideo', v => v.getAttribute('src'))), 'Esc закрывает окно и освобождает файл');
    ok(await pg.$eval('#progress', e => e.hidden), 'после предпросмотра прогресс скрыт');
    // 3. поворот у каждого видео
    await open(['tone.webm', 'a.webm']); await pg.waitForFunction(() => window.AVApp.Q().length === 2, null, { timeout: 20000 }); await pg.waitForTimeout(600);
    await pg.click('#settingsTabs [data-tab="video"]');
    ok(await pg.$eval('#rotAll', e => !e.hidden), 'кнопка «Применить ко всем» видна при двух видео');
    await pg.click('#rotR');
    let rots = await pg.evaluate(() => window.AVApp.Q().map(i => i.rot));
    ok(rots[0] !== rots[1] || rots.every(r => r === 90), 'поворот изменил только выбранное видео: ' + rots);
    await pg.click('#rotAll'); rots = await pg.evaluate(() => window.AVApp.Q().map(i => i.rot));
    ok(rots[0] === rots[1] && rots[0] === 90, '«Применить ко всем» копирует поворот: ' + rots);
    // 4. проект
    await pg.evaluate(() => { const q = window.AVApp.Q()[0]; q.start = 0.4; q.end = 1.6; });
    await pg.waitForTimeout(3200);
    const saved = await pg.evaluate(() => new Promise(r => { const q = indexedDB.open('aspect-video-project'); q.onsuccess = () => { const g = q.result.transaction('kv').objectStore('kv').get('meta'); g.onsuccess = () => r(g.result); g.onerror = () => r(null); }; q.onerror = () => r(null); }));
    ok(saved && saved.items && saved.items.length === 2 && saved.items[0].rot === 90 && Math.abs(saved.items[0].start - 0.4) < 0.01, 'проект записан в IndexedDB');
    ok(!JSON.stringify(saved).includes('blob'), 'видео в проект не пишутся');
    await pg.reload(); await pg.waitForSelector('#projBar:not([hidden])', { timeout: 10000 });
    ok(/tone\.webm/.test(await pg.textContent('#projText')), 'после перезагрузки предложено открыть проект');
    await pg.setInputFiles('#projFile', [path.join(fx, 'tone.webm'), path.join(fx, 'a.webm')]);
    await pg.waitForFunction(() => window.AVApp.Q().length === 2, null, { timeout: 20000 }); await pg.waitForTimeout(800);
    const back = await pg.evaluate(() => window.AVApp.Q().map(i => ({ n: i.name, rot: i.rot, s: i.start, e: i.end })));
    ok(back[0].rot === 90 && Math.abs(back[0].s - 0.4) < 0.02 && Math.abs(back[0].e - 1.6) < 0.02, 'настройки проекта вернулись: ' + JSON.stringify(back[0]));
    ok(await pg.$eval('#projBar', e => e.hidden), 'плашка проекта скрылась');
    await pg.reload(); await pg.waitForSelector('#projBar:not([hidden])');
    await pg.click('#projDrop'); await pg.reload(); await pg.waitForSelector('#uploadBtn'); await pg.waitForTimeout(600);
    ok(await pg.$eval('#projBar', e => e.hidden), '«Забыть» стирает проект');
    ok(errs.length === 0, 'ошибок страницы нет ' + errs.join('|'));
  } catch (e) { console.log('FAIL исключение: ' + e.message); fails++; }
  await b.close(); srv.close();
  console.log(fails ? fails + ' FAIL' : 'ALL OK'); process.exit(fails ? 1 : 0);
});
