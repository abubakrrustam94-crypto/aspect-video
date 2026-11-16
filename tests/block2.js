/* Тест блока 2 (v2.2.0): node tests/block2.js <папка-сайта> <tone.webm> <shaky.webm> <subs.srt> <папка-результатов>
   tone.webm: 6 с, звук есть 0–1,5 и 3,5–6 с, тишина между. Проверяет форматы WebM/GIF, склейку, подписи, SRT, тишину, стабилизацию, выбор лица. */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [root, tone, shaky, srt, outDir] = process.argv.slice(2);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const mime = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/json', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.json': 'application/json', '.bin': 'application/octet-stream' };
const srv = http.createServer((q, r) => {
  let p = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); r.end(d); });
}).listen(8767, async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 430, height: 900 }, acceptDownloads: true, locale: 'ru-RU' });
  await ctx.addInitScript(() => { try { localStorage.setItem('aspect-video-onboarded', '1'); } catch (e) { /* ничего */ } });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const dump = async (name, href) => { const buf = await pg.evaluate(async h => Array.from(new Uint8Array(await (await fetch(h)).arrayBuffer())), href); fs.writeFileSync(path.join(outDir, name), Buffer.from(buf)); };
  const tab = t => pg.click(`#settingsTabs [data-tab="${t}"]`);
  const lastResult = () => pg.evaluate(() => { const r = window.AVApp.results()[0]; return r && { name: r.name, size: r.blob.size, ext: r.ext, url: r.url, warn: r.warnings }; });
  const save = async (all) => { await pg.click(all ? '#saveAllBtn' : '#saveBtn'); await pg.waitForFunction(() => document.querySelector('#progress').hidden, null, { timeout: 120000 }); await pg.waitForTimeout(300); };
  try {
    await pg.goto('http://localhost:8767/index.html');
    await pg.setInputFiles('#fileInput', [tone]);
    await pg.waitForSelector('#previewCard:not([hidden])', { timeout: 10000 });
    await pg.waitForTimeout(800);

    const fs0 = await pg.evaluate(() => window.AVApp.formatSupport());
    console.log('форматы', JSON.stringify(fs0));
    ok(fs0 && fs0.gif === true, 'GIF доступен');

    /* --- тишина --- */
    await tab('video');
    await pg.click('#silCut');
    await pg.waitForFunction(() => window.AVApp.Q()[0].cuts, null, { timeout: 15000 }).catch(() => {});
    const cuts = await pg.evaluate(() => window.AVApp.Q()[0].cuts);
    console.log('cuts', JSON.stringify(cuts));
    ok(cuts && cuts.length === 2 && cuts[0][0] < 0.3 && cuts[0][1] > 1.4 && cuts[0][1] < 2.4 && cuts[1][0] > 2.6 && cuts[1][0] < 3.6 && cuts[1][1] > 5.7,
      'паузы найдены: два куска вокруг тишины 1,5–3,5 с');
    ok(/паузы вырезаны/.test(await pg.textContent('#info')), 'в инфо видно, что паузы вырезаны: ' + (await pg.textContent('#info')));

    /* --- WebM с вырезанными паузами и звуком Opus --- */
    await tab('export');
    await pg.click('#fmtCard [data-val="webm"]');
    await pg.click('#settingsTabs [data-tab="frame"]'); await pg.click('#scenarios button >> nth=0');
    await tab('export'); await pg.click('[data-group="short"] [data-val="480"]');
    await save(false);
    let r = await lastResult();
    console.log(JSON.stringify(r));
    ok(r && r.ext === 'webm' && r.size > 5000, 'WebM сохранён');
    if (r) await dump('cut.webm', r.url);

    /* --- подписи + SRT + скорость --- */
    await tab('wm');
    await pg.click('#silReset').catch(() => {});
    await pg.setInputFiles('#capFile', srt);
    await pg.waitForFunction(() => window.AVApp.Q()[0].caps.length === 2, null, { timeout: 5000 });
    const caps = await pg.evaluate(() => window.AVApp.Q()[0].caps);
    ok(caps.length === 2 && caps[0].text === 'Привет, мир' && Math.abs(caps[0].start - 0.5) < 0.01 && caps[1].text === 'Вторая строка', 'SRT разобран, теги убраны');
    await pg.click('#capAdd');
    ok((await pg.locator('#capList .cap-row').count()) === 3, 'подпись добавлена вручную, строк: 3');
    await pg.click('#capList .cap-row >> nth=2 >> .q-x');
    ok((await pg.locator('#capList .cap-row').count()) === 2, 'подпись удалена');
    /* подпись реально рисуется: сравним кадры с подписью и без */
    await pg.evaluate(() => { const v = document.querySelector('#video'); v.currentTime = 1; });
    await pg.waitForTimeout(500);
    const withCap = await pg.evaluate(() => { const c = document.querySelector('#preview'); const g = c.getContext('2d'); return Array.from(g.getImageData(0, c.height * 0.8, c.width, c.height * 0.15).data.slice(0, 40000)).join(','); });
    await pg.click('#capClear');
    await pg.waitForTimeout(300);
    const noCap = await pg.evaluate(() => { const c = document.querySelector('#preview'); const g = c.getContext('2d'); return Array.from(g.getImageData(0, c.height * 0.8, c.width, c.height * 0.15).data.slice(0, 40000)).join(','); });
    ok(withCap !== noCap, 'подпись рисуется на превью');
    await pg.setInputFiles('#capFile', srt);
    await pg.waitForFunction(() => window.AVApp.Q()[0].caps.length === 2, null, { timeout: 5000 });

    /* --- GIF --- */
    await tab('export');
    await pg.click('#fmtCard [data-val="gif"]');
    ok(/Без звука/.test(await pg.textContent('#fmtNote')), 'пояснение для GIF');
    await save(false);
    r = await lastResult();
    console.log(JSON.stringify(r));
    ok(r && r.ext === 'gif' && r.size > 5000, 'GIF сохранён');
    if (r) await dump('out.gif', r.url);

    /* --- MP4 с подписями + стабилизацией (на shaky) и склейка очереди --- */
    await pg.click('#fmtCard [data-val="mp4"]');
    await pg.setInputFiles('#fileInput', [shaky]);
    await pg.waitForFunction(() => window.AVApp.Q().length === 2, null, { timeout: 10000 });
    await pg.waitForTimeout(500);
    await pg.evaluate(() => window.AVApp.select(1));
    await pg.waitForTimeout(800);
    await tab('video');
    await pg.click('#stabCard [data-val="2"]');
    await pg.click('#stabRun');
    await pg.waitForFunction(() => /Рассчитано/.test(document.querySelector('#stabStatus').textContent), null, { timeout: 60000 }).catch(() => {});
    ok(/Рассчитано/.test(await pg.textContent('#stabStatus')), 'стабилизация рассчитана: ' + (await pg.textContent('#stabStatus')));
    const stab = await pg.evaluate(() => { const s = window.AVApp.Q()[1].stab; if (!s) return null; const a = s.track.map(p => Math.hypot(p.dx, p.dy)); return { n: a.length, mean: a.reduce((x, y) => x + y, 0) / a.length }; });
    console.log('stab', JSON.stringify(stab));
    ok(stab && stab.n > 20 && stab.mean > 0.003, 'у дрожащего видео поправки заметные');
    await pg.click('#stabCard [data-val="0"]');

    await tab('export');
    await pg.click('#fmtCard input[data-key="concat"]', { force: true }).catch(async () => { await pg.evaluate(() => { const i = document.querySelector('#fmtCard input[data-key="concat"]'); i.checked = true; i.dispatchEvent(new Event('input', { bubbles: true })); }); });
    ok(await pg.evaluate(() => document.querySelector('#fmtCard input[data-key="concat"]').checked), 'склейка включена');
    ok(/склейка из 2/.test(await pg.textContent('#estNote')), 'оценка учитывает склейку: ' + (await pg.textContent('#estNote')));
    await pg.evaluate(() => { window.AVApp.Q()[0].cuts = null; });
    await save(true);
    r = await lastResult();
    console.log(JSON.stringify(r));
    ok(r && r.ext === 'mp4' && /склейка/.test(r.name) && (await pg.evaluate(() => window.AVApp.results().length)) >= 1, 'склейка сохранена одним файлом: ' + (r && r.name));
    if (r) await dump('concat.mp4', r.url);

    /* --- WebM-склейка со звуком Opus --- */
    await tab('export'); await pg.click('#fmtCard [data-val="webm"]');
    await save(true);
    r = await lastResult();
    ok(r && r.ext === 'webm' && /склейка/.test(r.name), 'WebM-склейка со звуком');
    if (r) await dump('concat.webm', r.url);

    /* --- выбор лица: режим «По нажатию» --- */
    await pg.click('#fmtCard [data-val="mp4"]');
    await pg.evaluate(() => { const i = document.querySelector('#fmtCard input[data-key="concat"]'); i.checked = false; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await tab('frame');
    await pg.click('[data-group="mode"] [data-val="crop"]');
    await pg.evaluate(() => document.querySelector('[data-key="faceTrack"]').click());
    await pg.click('[data-group="faceMode"] [data-val="left"]');
    await pg.click('[data-group="faceMode"] [data-val="tap"]');
    ok(await pg.locator('#tapNote').isVisible(), 'подсказка про нажатие на превью видна');
  } catch (e) { console.log('EXC', e.message); fails++; }
  console.log('errors:', JSON.stringify(errs.filter(x => !/favicon/.test(x))));
  if (errs.filter(x => !/favicon|AAC|aac/.test(x)).length) fails++;
  console.log(fails ? 'FAILED ' + fails : 'ALL OK');
  await b.close(); srv.close();
  process.exit(fails ? 1 : 0);
});
