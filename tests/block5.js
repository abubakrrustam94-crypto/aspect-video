/* Тест блока 3 (v2.5.0): node tests/block5.js <папка-сайта> <папка-фикстур> <папка-результатов>
   Фикстура: tone.webm.
   Проверяет лимит размера файла, предложение установки и журнал скорости. */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [root, fx, outDir] = process.argv.slice(2);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/json', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.json': 'application/json', '.bin': 'application/octet-stream' };
const srv = http.createServer((q, r) => {
  let p = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); r.end(d); });
}).listen(8785, async () => {
  const b = await chromium.launch(process.env.AV_CHROME ? { executablePath: process.env.AV_CHROME } : process.env.AV_CHANNEL ? { channel: process.env.AV_CHANNEL } : {});
  const ctx = await b.newContext({ viewport: { width: 430, height: 900 }, locale: 'ru-RU' });
  await ctx.addInitScript(() => { try { localStorage.setItem('aspect-video-onboarded', '1'); } catch (e) { /* ничего */ } });
  const pg = await ctx.newPage(); const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  const dump = async (name, href) => { const buf = await pg.evaluate(async h => Array.from(new Uint8Array(await (await fetch(h)).arrayBuffer())), href); fs.writeFileSync(path.join(outDir, name), Buffer.from(buf)); };
  const lastResult = () => pg.evaluate(() => { const r = window.AVApp.results()[0]; return r && { name: r.name, size: r.blob.size, ext: r.ext, url: r.url, warn: r.warnings, engine: r.engine }; });
  const save = async () => { await pg.click('#saveBtn'); await pg.waitForFunction(() => document.querySelector('#progress').hidden, null, { timeout: 180000 }); await pg.waitForTimeout(300); };
  const open = async f => { await pg.reload(); await pg.waitForSelector('#uploadBtn'); await pg.setInputFiles('#fileInput', path.join(fx, f)); await pg.waitForSelector('#previewCard:not([hidden])', { timeout: 15000 }); await pg.waitForTimeout(600); };
  const prep = async () => { await pg.click('#settingsTabs [data-tab="frame"]'); await pg.click('#scenarios button >> nth=0'); await pg.click('#settingsTabs [data-tab="export"]'); await pg.click('[data-group="short"] [data-val="480"]'); await pg.click('#fmtCard [data-val="webm"]'); };
  try {
    await pg.goto('http://localhost:8785/index.html'); await pg.waitForSelector('#uploadBtn');
    // 1. лимит размера
    await open('tone.webm'); await prep(); await save();
    const free = await lastResult(); ok(free && free.size > 0, 'без лимита: ' + (free && free.size) + ' байт');
    await open('tone.webm'); await prep();
    await pg.click('[data-group="target"] [data-val="10"]');
    ok(/МБ|MB/.test(await pg.textContent('#estNote')), 'в оценке виден размер при лимите 10 МБ: ' + (await pg.textContent('#estNote')).trim());
    ok(await pg.evaluate(() => S.target) === 10, 'настройка target сохранилась');
    await pg.evaluate(() => { S.target = 0.5; set('fps', S.fps); });        // дробный лимит только для проверки: 6 с в 0,5 МБ
    await save(); const lim = await lastResult();
    ok(lim && lim.size <= 0.5 * 1048576 * 1.12, 'файл уложился в лимит 0,5 МБ: ' + (lim && lim.size) + ' байт (без лимита ' + free.size + ')');
    ok(lim && lim.size < free.size, 'лимит действительно уменьшил файл');
    await pg.evaluate(() => { S.target = 0.0005; set('fps', S.fps); });     // заведомо невыполнимо: должно быть предупреждение
    ok(/слишком длинное|too long/.test(await pg.textContent('#memWarn')) && await pg.$eval('#memWarn', e => !e.hidden), 'при невыполнимом лимите есть предупреждение');
    await pg.evaluate(() => { S.target = 0; set('fps', S.fps); });
    // 2. журнал скорости
    ok(/\d/.test(await pg.textContent('#perfCount')) && +(await pg.textContent('#perfCount')) >= 1, 'в журнале скорости есть записи после сохранений: ' + await pg.textContent('#perfCount'));
    ok(/× реального времени/.test(await pg.textContent('#perfText')), 'в журнале видно, во сколько раз быстрее реального времени');
    await pg.reload(); await pg.waitForSelector('#uploadBtn');
    ok(+(await pg.textContent('#perfCount')) >= 1, 'журнал скорости переживает перезагрузку');
    await pg.evaluate(() => { for (let i = 0; i < 30; i++) AV.perfAdd({ fmt: 'mp4', w: 1, h: 1, dur: 1, ms: 10, eng: 'x' }); });
    ok(+(await pg.textContent('#perfCount')) === 20, 'журнал держит не больше 20 записей');
    await pg.evaluate(() => localStorage.setItem('aspect-video-perf', '{"ломаный json'));
    await pg.reload(); await pg.waitForSelector('#uploadBtn'); ok(+(await pg.textContent('#perfCount')) === 0, 'испорченный журнал не ломает страницу');
    await pg.evaluate(() => AV.perfAdd({ fmt: 'mp4', w: 1, h: 1, dur: 1, ms: 10 })); await pg.click('#settingsTabs [data-tab="about"]'); await pg.click('#perfBox summary'); await pg.click('#perfClear');
    ok(+(await pg.textContent('#perfCount')) === 0, 'журнал очищается');
    // 3. установка
    const fake = () => pg.evaluate(() => { window.__prompted = 0; const e = new Event('beforeinstallprompt', { cancelable: true }); e.prompt = async () => { window.__prompted++; }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e); });
    await pg.reload(); await pg.waitForSelector('#uploadBtn'); await pg.evaluate(() => localStorage.removeItem('aspect-video-install'));
    await open('tone.webm'); await prep(); await fake();
    ok(await pg.$eval('#installBar', e => e.hidden), 'до сохранения предложения установки нет');
    await save(); ok(await pg.$eval('#installBar', e => !e.hidden), 'после сохранения предложена установка');
    await pg.click('#installGo'); ok(await pg.evaluate(() => window.__prompted) === 1 && await pg.$eval('#installBar', e => e.hidden), '«Установить» вызывает системное окно');
    await save(); await fake(); await pg.evaluate(() => AV.afterSave()); await pg.click('#installNo');
    ok(await pg.$eval('#installBar', e => e.hidden), '«Не сейчас» скрывает предложение');
    await fake(); await pg.evaluate(() => AV.afterSave()); ok(await pg.$eval('#installBar', e => e.hidden), 'после отказа предложение не возвращается');
    ok(errs.length === 0, 'ошибок страницы нет ' + errs.join('|'));
  } catch (e) { console.log('FAIL исключение: ' + e.message); fails++; }
  await b.close(); srv.close();
  console.log(fails ? fails + ' FAIL' : 'ALL OK'); process.exit(fails ? 1 : 0);
});
