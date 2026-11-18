/* Проверка устойчивости (v2.5.4): node tests/chaos.js <папка-сайта> <папка-фикстур> <папка-результатов>
   Фикстуры: tone.webm, a.webm.
   Подсовывает странные файлы и испорченные данные в хранилища и смотрит, что сайт не падает. */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [root, fx, outDir] = process.argv.slice(2);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/json', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.json': 'application/json', '.bin': 'application/octet-stream' };
const srv = http.createServer((q, r) => {
  let p = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); r.end(d); });
}).listen(8795, async () => {
  const b = await chromium.launch(process.env.AV_CHROME ? { executablePath: process.env.AV_CHROME } : process.env.AV_CHANNEL ? { channel: process.env.AV_CHANNEL } : {});
  const ctx = await b.newContext({ viewport: { width: 430, height: 900 }, locale: 'ru-RU' });
  await ctx.addInitScript(() => { try { localStorage.setItem('aspect-video-onboarded', '1'); } catch (e) { /* ничего */ } });
  const pg = await ctx.newPage(); const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  const dump = async (name, href) => { const buf = await pg.evaluate(async h => Array.from(new Uint8Array(await (await fetch(h)).arrayBuffer())), href); fs.writeFileSync(path.join(outDir, name), Buffer.from(buf)); };
  const lastResult = () => pg.evaluate(() => { const r = window.AVApp.results()[0]; return r && { name: r.name, size: r.blob.size, ext: r.ext, url: r.url, warn: r.warnings, engine: r.engine }; });
  const save = async () => { await pg.click('#saveBtn'); await pg.waitForFunction(() => document.querySelector('#progress').hidden, null, { timeout: 180000 }); await pg.waitForTimeout(300); };
  const fs2 = require('fs'), os = require('os');
  const tmp = fs2.mkdtempSync(path.join(os.tmpdir(), 'avchaos-'));
  const mk = (n, buf) => { const p = path.join(tmp, n); fs2.writeFileSync(p, buf); return p; };
  const fresh = async () => { await pg.reload(); await pg.waitForSelector('#uploadBtn'); await pg.waitForTimeout(300); };
  try {
    await pg.goto('http://localhost:8795/index.html'); await pg.waitForSelector('#uploadBtn');
    // 1. странные файлы
    const odd = [mk('empty.mp4', Buffer.alloc(0)), mk('text.mp4', Buffer.from('это не видео\n'.repeat(500))), mk('<b>x"\'.mkv', Buffer.from('MKV?')), mk('trunc.mp4', fs2.readFileSync(path.join(fx, 'tone264.mp4')).subarray(0, 700)), mk('noext', Buffer.alloc(2048, 7))];
    for (const f of odd) {
      await fresh(); await pg.setInputFiles('#fileInput', f); await pg.waitForTimeout(1500);
      ok(await pg.$eval('#previewCard', e => e.hidden), path.basename(f) + ': видео не открылось, а страница жива');
      const html = await pg.evaluate(() => document.body.innerHTML.includes('<b>x'));
      ok(!html, path.basename(f) + ': имя файла не попало в разметку');
    }
    // 2. смесь нормального и битого
    await fresh(); await pg.setInputFiles('#fileInput', [odd[0], path.join(fx, 'tone.webm'), odd[1]]);
    await pg.waitForSelector('#previewCard:not([hidden])', { timeout: 15000 });
    ok(await pg.evaluate(() => window.AVApp.Q().length) === 1, 'из трёх файлов открылся один нормальный');
    // 3. клавиши без видео и во время работы
    await fresh(); for (const k of ['ArrowLeft', 'ArrowRight', 'Shift+ArrowLeft', 'i', 'o', 's', ' ', 'Escape', 'Tab']) await pg.keyboard.press(k);
    // 4. испорченные хранилища
    await pg.evaluate(() => {
      const bad = ['null', '123', '"x"', '[null,1,{"ms":"x"}]', '[{"t":1,"ms":1e999,"dur":-5,"w":"a","h":{},"fmt":{}}]', '{"__proto__":{"polluted":1}}', '\u0000\ud800', 'x'.repeat(200000)];
      bad.forEach((v, i) => { localStorage.setItem(i % 2 ? 'aspect-video-perf' : 'aspect-video-install', v); });
      localStorage.setItem('aspect-video-perf', bad[3]);
    });
    await fresh(); ok(!(await pg.evaluate(() => ({}).polluted)), 'прототип не загрязнён');
    await pg.evaluate(() => localStorage.setItem('aspect-video-perf', '[{"t":1,"ms":1e999,"dur":-5,"w":"a","h":{},"fmt":{}}]'));
    await fresh(); ok(await pg.$eval('#perfText', e => e.children.length > 0), 'журнал скорости переживает мусорные записи');
    // 5. испорченный проект в IndexedDB
    const poison = async (val) => pg.evaluate(v => new Promise(r => { const q = indexedDB.open('aspect-video-project', 1); q.onupgradeneeded = () => q.result.createObjectStore('kv'); q.onsuccess = () => { const t = q.result.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, 'meta'); t.oncomplete = () => { q.result.close(); r(); }; }; }), val);
    const evil = [
      'строка', 42, null, { v: 1, items: 'x' }, { v: 1, items: [null, 1, 'a'] }, { v: 1, items: [{ name: '<img src=x onerror=alert(1)>', size: 5, start: -1, end: 'a', caps: 'x', cuts: [[5, 1], 'z'], rot: 45, fh: 1 }] },
      { v: 1, items: Array.from({ length: 5000 }, (_, i) => ({ name: 'f' + i, size: i })) }, { v: 1, items: [{ name: 'a', size: 1, caps: Array.from({ length: 9000 }, () => ({ text: 'x'.repeat(5000), start: 0, end: 1 })) }] },
      JSON.parse('{"v":1,"__proto__":{"x":1},"items":[{"name":"p","size":3,"__proto__":{"polluted":2}}]}')
    ];
    for (let i = 0; i < evil.length; i++) {
      await poison(evil[i]); await fresh(); await pg.waitForTimeout(400);
      const shown = !(await pg.$eval('#projBar', e => e.hidden));
      const txt = shown ? await pg.textContent('#projText') : '';
      ok(!(await pg.evaluate(() => ({}).polluted)) && (await pg.evaluate(() => document.querySelectorAll('#projBar img, #projBar [onerror], body > img').length)) === 0, 'испорченный проект №' + i + ': ' + (shown ? 'показан безопасно (' + txt.length + ' симв.)' : 'отброшен'));
    }
    await pg.evaluate(() => AV.project.clear());
    // 6. двойной щелчок по предпросмотру и отмена
    await fresh(); await pg.setInputFiles('#fileInput', path.join(fx, 'tone.webm')); await pg.waitForSelector('#previewCard:not([hidden])', { timeout: 15000 }); await pg.waitForTimeout(500);
    await pg.click('#clipBtn'); await pg.click('#clipBtn', { force: true, timeout: 1000 }).catch(() => {});
    await pg.waitForSelector('#clipDlg:not([hidden])', { timeout: 60000 });
    ok(await pg.evaluate(() => document.querySelectorAll('#clipDlg').length) === 1, 'окно предпросмотра одно');
    await pg.keyboard.press('Escape');
    // 7. лимит размера с нулевой/крошечной обрезкой
    await pg.evaluate(() => { const q = window.AVApp.Q()[0]; q.start = 1; q.end = 1.2; S.target = 10; set('fps', S.fps); });
    ok(await pg.$eval('#estNote', e => !/NaN|Infinity/.test(e.textContent)), 'оценка размера без NaN при коротком отрезке');
    // 6б. встраивание в чужую страницу
    const evilSrv = require('http').createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<iframe id=victim src="http://localhost:8795/index.html" width=400 height=600></iframe>'); }).listen(8797);
    await pg.goto('http://127.0.0.1:8797/'); evilSrv.close();
    await pg.waitForTimeout(2500);
    const inner = pg.frames().find(f => f.url().startsWith('http://localhost:8795'));
    const guarded = inner ? await inner.evaluate(() => document.documentElement.hidden).catch(() => true) : true;
    console.log('guard:', pg.frames().map(f => f.url()).join(' '), pg.url(), inner ? 'frame found, hidden=' + guarded : 'frame missing'); ok(!!inner && guarded, 'сайт во встроенной рамке скрыт или вырвался из неё');
    await pg.goto('http://localhost:8795/index.html'); await pg.waitForSelector('#uploadBtn');
    ok(errs.filter(e => !/ошибка быстрого чтения|Не открылся файл|не открылся|Failed to execute|decode/i.test(e)).length === 0, 'неожиданных ошибок страницы нет: ' + errs.join(' | ').slice(0, 300));
  } catch (e) { console.log('FAIL исключение: ' + e.message); fails++; }
  fs2.rmSync(tmp, { recursive: true, force: true });
  await b.close(); srv.close();
  console.log(fails ? fails + ' FAIL' : 'ALL OK'); process.exit(fails ? 1 : 0);
});
