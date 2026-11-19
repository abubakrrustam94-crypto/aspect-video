/* Дымовой тест: node tests/smoke.js <папка-сайта> <a.webm> <b.webm> <face.webm> <папка-для-результатов>
   Нужен playwright (глобально или в node_modules). Проверяет загрузку, вкладки, очередь, экспорт (в память и на диск),
   лица, «О программе». */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [root, fa, fb, ff, outDir] = process.argv.slice(2);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const mime = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/json', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.json': 'application/json', '.bin': 'application/octet-stream' };
const srv = http.createServer((q, r) => {
  let p = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); r.end(d); });
}).listen(8766, async () => {
  const b = await chromium.launch(Object.assign({ args: ['--autoplay-policy=no-user-gesture-required'] }, process.env.AV_CHROME ? { executablePath: process.env.AV_CHROME } : process.env.AV_CHANNEL ? { channel: process.env.AV_CHANNEL } : {}));
  /* первое посещение: мини-обучение */
  {
    const c0 = await b.newContext({ viewport: { width: 430, height: 900 }, locale: 'ru-RU' }); const p0 = await c0.newPage();
    await p0.goto('http://localhost:8766/index.html');
    await p0.waitForSelector('#onboard:not([hidden])', { timeout: 4000 }).catch(() => {});
    ok(await p0.locator('#onboard').isVisible(), 'обучение показывается новичку');
    await p0.click('#onbNext'); await p0.click('#onbNext');
    ok((await p0.textContent('#onbNext')) === 'Понятно', 'последний шаг обучения');
    await p0.click('#onbNext');
    ok(await p0.locator('#onboard').isHidden() && (await p0.evaluate(() => localStorage.getItem('aspect-video-onboarded'))) === '1', 'обучение закрывается и запоминается');
    await p0.reload(); await p0.waitForTimeout(900);
    ok(await p0.locator('#onboard').isHidden(), 'повторно обучение не показывается');
    await c0.close();
  }
  const ctx = await b.newContext({ viewport: { width: 430, height: 900 }, acceptDownloads: true, locale: 'ru-RU' });
  await ctx.addInitScript(() => { try { localStorage.setItem('aspect-video-onboarded', '1'); } catch (e) { /* ничего */ } });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const dump = async (name, href) => { const buf = await pg.evaluate(async h => Array.from(new Uint8Array(await (await fetch(h)).arrayBuffer())), href); fs.writeFileSync(path.join(outDir, name), Buffer.from(buf)); };
  try {
    await pg.goto('http://localhost:8766/index.html');
    ok(await pg.locator('#uploadZone').isVisible(), 'экран загрузки виден');
    ok(await pg.locator('#previewCard').isHidden() && await pg.locator('#toolbar').isHidden(), 'превью и кнопки сохранения скрыты до загрузки');
    ok(await pg.locator('#settingsTabs').isVisible(), 'вкладки видны до загрузки видео');
    await pg.click('#settingsTabs [data-tab="about"]'); ok(await pg.locator('#cardAbout').isVisible(), 'О программе открывается до загрузки видео');
    await pg.click('#settingsTabs [data-tab="frame"]');

    /* загрузка двух видео */
    await pg.setInputFiles('#fileInput', [fa, fb]);
    await pg.waitForSelector('#previewCard:not([hidden])', { timeout: 10000 });
    await pg.waitForFunction(() => window.AVApp.Q().length === 2, null, { timeout: 10000 });
    await pg.waitForTimeout(600);
    ok((await pg.locator('.q-item').count()) === 2, 'в очереди 2 видео');
    ok(/640×360 → /.test(await pg.textContent('#info')), 'инфо о размерах: ' + (await pg.textContent('#info')));

    /* вкладки */
    for (const t of ['frame', 'video', 'wm', 'export', 'about']) {
      await pg.click(`#settingsTabs [data-tab="${t}"]`);
      const vis = await pg.evaluate(t2 => Array.from(document.querySelectorAll('#colSettings .card[data-tab]')).filter(c => !c.hidden).every(c => c.dataset.tab === t2) && document.querySelectorAll('#colSettings .card[data-tab="' + t2 + '"]:not([hidden])').length > 0, t);
      ok(vis, 'вкладка ' + t + ' показывает свои карточки');
    }

    /* настройки: сценарий, зеркало, знак, поворот, скорость, затухание */
    await pg.click('#settingsTabs [data-tab="frame"]');
    await pg.click('#scenarios .chip:first-child');
    ok(await pg.evaluate(() => document.querySelector('#presets .chip.active').dataset.id) === '9:16', 'сценарий поставил 9:16');
    await pg.selectOption('#fileInput', []).catch(() => {});
    await pg.click('[data-group="mode"] [data-val="mirror"]');
    await pg.click('#settingsTabs [data-tab="wm"]');
    await pg.check('[data-key="wmOn"]', { force: true }).catch(async () => { await pg.click('[data-key="wmOn"] + .track'); });
    await pg.click('#wmTileChip .chip');
    await pg.click('#settingsTabs [data-tab="video"]');
    await pg.click('[data-group="speed"] [data-val="2"]');
    await pg.fill('[data-key="fadeIn"]', '0.5').catch(() => {});
    await pg.evaluate(() => { const r = document.querySelector('[data-key="fadeIn"]'); r.value = 0.5; r.dispatchEvent(new Event('input', { bubbles: true })); });
    await pg.click('#rotR'); await pg.click('#rotL');
    await pg.waitForTimeout(400);
    await pg.screenshot({ path: path.join(outDir, 'tab-video.png'), fullPage: true });
    await pg.click('#settingsTabs [data-tab="wm"]'); await pg.screenshot({ path: path.join(outDir, 'tab-wm.png'), fullPage: true });
    await pg.click('#settingsTabs [data-tab="frame"]'); await pg.screenshot({ path: path.join(outDir, 'tab-frame.png'), fullPage: true });

    /* настройки сохраняются между перезагрузками */
    const saved = await pg.evaluate(() => JSON.parse(localStorage.getItem('aspect-video-v1')));
    ok(saved.mode === 'mirror' && saved.speed === 2 && saved.wmPos === 'tile', 'настройки записаны в localStorage');

    /* экспорт: «Сохранить все» через запись на диск (порог 0) */
    await pg.evaluate(() => { AV.streamFrom = 0; });
    await pg.click('#settingsTabs [data-tab="export"]');
    await pg.click('[data-group="short"] [data-val="480"]');
    await pg.click('#saveAllBtn');
    await pg.waitForFunction(() => window.AVApp.results().length === 2, null, { timeout: 90000 }).catch(() => {});
    const res = await pg.evaluate(() => window.AVApp.results().map(r => ({ name: r.name, size: r.blob.size, ext: r.ext, streamed: r.streamed, w: r.o.w, h: r.o.h, warn: r.warnings })));
    console.log(JSON.stringify(res));
    ok(res.length === 2, 'экспорт очереди: 2 результата');
    if (res.length) {
      ok(res.every(r => r.w === 480 && r.h === 854), 'размер 480×854 у всех');
      ok(res.every(r => r.ext === 'mp4'), 'контейнер MP4');
      ok(res.some(r => r.streamed), 'большой путь: запись на диск (OPFS) сработала');
      const hrefs = await pg.$$eval('#resultList a', as => as.map(a => a.href));
      for (let i = 0; i < hrefs.length; i++) await dump('out' + i + '.mp4', hrefs[i]);
    }
    await pg.screenshot({ path: path.join(outDir, 'after-export.png'), fullPage: true });
    const leftovers = await pg.evaluate(async () => { const r = await navigator.storage.getDirectory(); const n = []; for await (const k of r.keys()) n.push(k); return n.length; });
    console.log('файлов в OPFS после экспорта:', leftovers);

    /* кадр как картинка */
    await pg.click('#settingsTabs [data-tab="video"]');
    const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 8000 }).catch(() => null), pg.click('#snapPng')]);
    ok(!!dl, 'кадр сохраняется как PNG: ' + (dl && dl.suggestedFilename()));

    /* лица: новое видео, режим «Обрезать» + «Следить за лицом» */
    await pg.click('#removeAll').catch(() => {});
    await pg.evaluate(() => { while (window.AVApp.Q().length > 1) document.querySelectorAll('.q-x')[0].click(); });
    await pg.setInputFiles('#fileInput', [ff]);
    await pg.waitForFunction(() => window.AVApp.Q().length === 2, null, { timeout: 10000 });
    await pg.evaluate(() => window.AVApp.select(1));
    await pg.waitForTimeout(700);
    await pg.click('#settingsTabs [data-tab="frame"]');
    await pg.click('[data-group="mode"] [data-val="crop"]');
    await pg.evaluate(() => { const c = document.querySelector('[data-key="faceTrack"]'); c.checked = true; c.dispatchEvent(new Event('input', { bubbles: true })); });
    await pg.waitForFunction(() => { const q = window.AVApp.Q()[1]; return q && (q.track || q.noFace); }, null, { timeout: 60000 }).catch(() => {});
    const face = await pg.evaluate(() => { const q = window.AVApp.Q()[1]; return { track: q.track && q.track.length, first: q.track && q.track[0], no: q.noFace, st: document.querySelector('#faceStatus').textContent }; });
    console.log(JSON.stringify(face));
    ok(face.track > 0, 'лицо найдено, точек дорожки: ' + face.track);
    await pg.waitForTimeout(300);
    await pg.screenshot({ path: path.join(outDir, 'faces.png'), fullPage: false });


    /* наборы настроек */
    await pg.click('#settingsTabs [data-tab="frame"]');
    await pg.click('#presets .chip[data-id="1:1"]');
    await pg.fill('#presetName', 'Мой набор'); await pg.click('#presetSave');
    ok((await pg.locator('#presetList .preset').count()) === 1, 'набор сохранён');
    await pg.click('#presets .chip[data-id="16:9"]');
    await pg.click('#presetList .preset .chip');
    ok((await pg.evaluate(() => document.querySelector('#presets .chip.active').dataset.id)) === '1:1', 'набор применяется (формат вернулся к 1:1)');
    await pg.reload(); await pg.waitForTimeout(500);
    ok((await pg.locator('#presetList .preset').count()) === 1, 'набор пережил перезагрузку');
    await pg.click('#presetList .preset-x');
    ok((await pg.locator('#presetList .preset').count()) === 0, 'набор удалён');

    /* поиск по настройкам */
    await pg.fill('#setSearch', 'водян');
    ok(await pg.locator('.card[data-tab="wm"]').first().isVisible() && await pg.locator('.card[data-tab="frame"]').first().isHidden(), 'поиск «водян» показывает карточку знака с другой вкладки');
    await pg.fill('#setSearch', 'яяяя');
    ok(await pg.locator('#setNone').isVisible(), 'поиск без результата сообщает об этом');
    await pg.click('#setSearchClear');
    ok(await pg.locator('.card[data-tab="frame"]').first().isVisible(), 'после очистки поиска вернулась вкладка');

    /* закрепление и сворачивание */
    await pg.click('#settingsTabs [data-tab="export"]');
    await pg.click('.card[data-cid="export-1"] .pin-btn');
    await pg.click('#settingsTabs [data-tab="video"]');
    ok(await pg.locator('.card[data-cid="export-1"]').isVisible(), 'закреплённая карточка видна на другой вкладке');
    await pg.click('.card[data-cid="export-1"] .pin-btn');
    ok(await pg.locator('.card[data-cid="export-1"]').isHidden(), 'после открепления карточка исчезла с чужой вкладки');
    await pg.click('.card[data-cid="video-1"] .card-fold');
    ok(await pg.locator('.card[data-cid="video-1"] #start').isHidden(), 'карточка сворачивается');
    await pg.click('.card[data-cid="video-1"] .card-fold');
    ok(await pg.locator('.card[data-cid="video-1"] #start').isVisible(), 'карточка разворачивается');

    /* тема и акцент */
    await pg.click('#settingsTabs [data-tab="about"]');
    const pr0 = await pg.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-primary'));
    await pg.click('#accentRow .accent-dot[data-id="green"]');
    const pr1 = await pg.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-primary'));
    ok(pr0 !== pr1, 'акцент меняет основной цвет');
    await pg.click('#themeSeg [data-mode="light"]');
    ok((await pg.getAttribute('html', 'data-theme')) === 'light', 'тема «Светлая» из оформления');
    await pg.click('#themeSeg [data-mode="auto"]');

    /* компоненты */
    await pg.click('#settingsTabs [data-tab="components"]');
    await pg.waitForSelector('#compList .comp-card', { timeout: 5000 });
    await pg.click('#compList .comp-card .btn-tonal');
    await pg.waitForFunction(() => /Работает без интернета/.test(document.querySelector('#compList').textContent), null, { timeout: 20000 }).catch(() => {});
    ok(/Работает без интернета/.test(await pg.textContent('#compList')), 'модель лиц скачана в память сайта');
    const where = await pg.evaluate(async () => {
      const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('aspect-video-components'); let n = 0;
      for await (const e of d.values()) n++;
      let inCache = 0; for (const k of await caches.keys()) { const c = await caches.open(k); for (const r of await c.keys()) if (/blazeface|tfjs\//.test(r.url)) inCache++; }
      return { n, inCache };
    });
    ok(where.n === 5 && where.inCache === 0, 'файлы лежат в OPFS (' + where.n + '), в кэше сайта их нет (' + where.inCache + ')');
    const viaSw = await pg.evaluate(async () => { const r = await fetch('vendor/blazeface/blazeface-back.json'); return { ok: r.ok, type: r.headers.get('content-type'), n: (await r.text()).length }; });
    ok(viaSw.ok && /json/.test(viaSw.type) && viaSw.n > 100, 'service worker отдаёт модель из OPFS');
    await pg.click('#compList .comp-card .danger');
    await pg.waitForFunction(() => /Не скачано/.test(document.querySelector('#compList').textContent), null, { timeout: 8000 }).catch(() => {});
    { const t = await pg.textContent('#compList'); ok(/Не скачано/.test(t), 'модель лиц удалена' + (/Не скачано/.test(t) ? '' : ' :: ' + t.replace(/\s+/g, ' ').slice(0, 300))); }
    ok((await pg.locator('#storageOut .sp-row').count()) >= 2, 'место на устройстве показано');

    /* О программе */
    await pg.click('#settingsTabs [data-tab="about"]');
    ok((await pg.textContent('#appVersion')) === "v2.7.1", 'версия показана');
    await pg.click('#wnOpenBtn');
    await pg.waitForSelector('#wnList .wn-rel', { timeout: 5000 });
    ok((await pg.locator('#wnList .wn-rel').count()) >= 2, 'что нового: записей ' + (await pg.locator('#wnList .wn-rel').count()));
    await pg.click('#wnClose');
    await pg.click('#howBtn'); ok((await pg.locator('#howList .how-item').count()) === 5, 'как это работает: 5 пунктов'); await pg.click('#howClose');
    await pg.click('#speedBtn');
    await pg.waitForFunction(() => document.querySelector('#speedOut .sp-sum'), null, { timeout: 60000 }).catch(() => {});
    console.log('speed:', (await pg.textContent('#speedOut')).replace(/\s+/g, ' ').slice(0, 300));
    ok(await pg.locator('#speedOut .sp-sum').count() === 1, 'проверка скорости отработала');
    await pg.evaluate(() => { window.__opened = null; window.open = (u) => { window.__opened = u; return null; }; });
    await pg.click('#reportBtn');
    ok(/github\.com\/.+\/aspect-video\/issues\/new/.test(await pg.evaluate(() => window.__opened || '')), 'сообщить о проблеме открывает GitHub issues');
    await pg.screenshot({ path: path.join(outDir, 'tab-about.png'), fullPage: true });
    await pg.click('#resetAll'); ok(await pg.locator('#resetNote').isVisible(), 'сброс просит подтверждение');

    /* тема */
    const th0 = await pg.getAttribute('html', 'data-theme');
    await pg.click('#themeBtn'); ok((await pg.getAttribute('html', 'data-theme')) !== th0, 'тема переключается: ' + th0 + ' → ' + (await pg.getAttribute('html', 'data-theme')));
    await pg.screenshot({ path: path.join(outDir, 'light.png'), fullPage: false });
  } catch (e) { console.log('EXC', e.message); fails++; }
  console.log('errors:', errs.slice(0, 8));
  console.log(fails ? 'FAILED ' + fails : 'ALL OK');
  await b.close(); srv.close();
});
