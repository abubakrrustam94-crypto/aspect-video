/* Тест английского интерфейса: node tests/i18n.js <папка-сайта> <видео>
   Открывает сайт с английским языком браузера и проверяет, что на экране нет русских букв (кроме названия языка «Русский»),
   затем переключает на русский и обратно. Заодно проверяет составные строки (прогресс, уведомления). */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [root, video] = process.argv.slice(2);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/json', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.json': 'application/json', '.bin': 'application/octet-stream' };
const srv = http.createServer((q, r) => {
  let p = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); r.end(d); });
}).listen(8774, async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 430, height: 900 }, locale: 'en-US' });
  await ctx.addInitScript(() => { try { localStorage.setItem('aspect-video-onboarded', '1'); } catch (e) { /* ничего */ } });
  const pg = await ctx.newPage(); const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  /* всё русское, что видно в DOM: текстовые узлы и подписи */
  const leftovers = () => pg.evaluate(() => {
    const out = [], CY = /[А-Яа-яЁё]/;
    const w = document.createTreeWalker(document.body, 1 | 4);
    let n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 3) { const p = n.parentNode.nodeName; if (p !== 'SCRIPT' && p !== 'STYLE' && !n.parentNode.closest('[data-i18n-skip]') && CY.test(n.nodeValue)) out.push(n.nodeValue.trim().slice(0, 70)); }
      else for (const a of ['aria-label', 'title', 'placeholder', 'alt']) { const v = n.getAttribute(a); if (v && CY.test(v)) out.push(a + ': ' + v.slice(0, 70)); }
    }
    return out.filter(x => x !== 'Русский');
  });
  try {
    await pg.goto('http://localhost:8774/index.html'); await pg.waitForTimeout(500);
    ok((await pg.evaluate(() => document.documentElement.lang)) === 'en', 'язык страницы en при английском браузере');
    ok(/Aspect ratio|Frame/.test(await pg.textContent('#settingsTabs')), 'вкладки переведены: ' + (await pg.textContent('#settingsTabs')).replace(/\s+/g, ' ').trim());
    for (const t of ['frame', 'video', 'wm', 'export', 'components', 'about']) {
      await pg.click(`#settingsTabs [data-tab="${t}"]`); await pg.waitForTimeout(150);
      const l = await leftovers();
      ok(l.length === 0, 'вкладка ' + t + ': русского текста нет' + (l.length ? ' → ' + JSON.stringify(l.slice(0, 6)) : ''));
    }
    /* окна */
    await pg.click('#helpBtn'); await pg.waitForTimeout(300);
    let l = await leftovers(); ok(l.length === 0, 'окно «Как это работает»: русского нет' + (l.length ? ' → ' + JSON.stringify(l.slice(0, 6)) : ''));
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
    /* загрузка видео: превью, очередь, подписи, статусы */
    await pg.setInputFiles('#fileInput', video);
    await pg.waitForSelector('#previewCard:not([hidden])', { timeout: 15000 }); await pg.waitForTimeout(800);
    for (const t of ['frame', 'video', 'wm', 'export']) { await pg.click(`#settingsTabs [data-tab="${t}"]`); }
    await pg.click('#settingsTabs [data-tab="wm"]'); await pg.click('#capAdd'); await pg.waitForTimeout(200);
    l = await leftovers(); ok(l.length === 0, 'с видео и подписью: русского нет' + (l.length ? ' → ' + JSON.stringify(l.slice(0, 8)) : ''));
    await pg.click('#settingsTabs [data-tab="export"]'); await pg.waitForTimeout(150);
    console.log('оценка:', (await pg.textContent('#estNote')).trim());
    ok(!/[А-Яа-я]/.test(await pg.textContent('#estNote')) && /fps/.test(await pg.textContent('#estNote')), 'оценка размера переведена, числа с точкой');
    /* сохранение: прогресс и результат */
    await pg.click('#saveBtn');
    await pg.waitForFunction(() => document.querySelector('#progress').hidden === false, null, { timeout: 15000 }).catch(() => {});
    let sawProgress = '';
    for (let i = 0; i < 40; i++) { const t = await pg.textContent('#progress').catch(() => ''); if (/Frame|frame/.test(t)) { sawProgress = t.replace(/\s+/g, ' ').trim(); break; } await pg.waitForTimeout(100); }
    console.log('прогресс:', sawProgress);
    ok(/Frame \d+ of \d+/.test(sawProgress), 'составная строка прогресса переведена');
    await pg.waitForFunction(() => document.querySelector('#progress').hidden, null, { timeout: 120000 });
    await pg.waitForTimeout(500);
    l = await leftovers(); ok(l.length === 0, 'после сохранения: русского нет' + (l.length ? ' → ' + JSON.stringify(l.slice(0, 8)) : ''));
    /* переключение языка */
    await pg.click('#settingsTabs [data-tab="about"]');
    await pg.click('[data-group="lang"] [data-val="ru"]'); await pg.waitForTimeout(300);
    ok((await pg.evaluate(() => document.documentElement.lang)) === 'ru', 'выбран русский: lang=ru');
    ok(/Кадр/.test(await pg.textContent('#settingsTabs')), 'вкладки снова русские');
    ok((await pg.evaluate(() => document.title)) === 'Aspect Studio Video', 'заголовок вернулся');
    ok((await pg.evaluate(() => /[a-z]{4,} [a-z]{4,}/.test(document.querySelector('#cardAbout').textContent))) === false, 'в карточке «О программе» нет английского текста');
    await pg.click('[data-group="lang"] [data-val="en"]'); await pg.waitForTimeout(300);
    ok(/Frame/.test(await pg.textContent('#settingsTabs')), 'и обратно на английский');
    await pg.reload(); await pg.waitForTimeout(500);
    ok((await pg.evaluate(() => document.documentElement.lang)) === 'en', 'выбор языка сохраняется');
    await pg.click('[data-group="lang"] [data-val="auto"]').catch(() => {});
  } catch (e) { console.log('EXC', e.message); fails++; }
  console.log('errors:', JSON.stringify(errs));
  if (errs.length) fails++;
  console.log(fails ? 'FAILED ' + fails : 'ALL OK');
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
});
