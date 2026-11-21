/* Тест v2.12.0: node tests/block8.js <папка-сайта> <папка-фикстур> <папка-результатов>
   Полоса обрезки (края, перемотка), свой лимит размера, ZIP-архив (unzip -t и сверка содержимого). */
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
}).listen(8788, async () => {
  const b = await chromium.launch(process.env.AV_CHROME ? { executablePath: process.env.AV_CHROME } : process.env.AV_CHANNEL ? { channel: process.env.AV_CHANNEL } : {});
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, locale: 'ru-RU' });
  await ctx.addInitScript(() => { try { localStorage.setItem('aspect-video-onboarded', '1'); localStorage.setItem('aspect-video-seen', '2.12.0'); } catch (e) { /* ничего */ } });
  const pg = await ctx.newPage(); const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  const tab = t => pg.click(`#settingsTabs [data-tab="${t}"]`);
  try {
    await pg.goto('http://localhost:8788/index.html'); await pg.waitForSelector('#uploadBtn');
    await pg.setInputFiles('#fileInput', path.join(fx, 'a.webm')); await pg.waitForSelector('#previewCard:not([hidden])', { timeout: 30000 }); await pg.waitForTimeout(1500);
    // полоса обрезки
    await tab('video'); await pg.waitForTimeout(500);
    const box = await pg.locator('#tl').boundingBox();
    ok(box && box.width > 200 && box.height > 30, 'полоса обрезки видна ' + (box ? Math.round(box.width) + '×' + Math.round(box.height) : ''));
    const drawn = await pg.evaluate(() => { const c = document.getElementById('tlStrip'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s > 0; });
    ok(drawn, 'на полосе нарисованы кадры');
    const dur = await pg.evaluate(() => +document.getElementById('start').max);
    const y = box.y + box.height / 2;
    await pg.mouse.move(box.x + 2, y); await pg.mouse.down(); await pg.mouse.move(box.x + box.width * 0.3, y, { steps: 6 }); await pg.mouse.up();
    let st = await pg.evaluate(() => +document.getElementById('start').value);
    ok(Math.abs(st - dur * 0.3) < dur * 0.06, 'левый край перетащен: ' + st.toFixed(2) + ' из ' + dur.toFixed(2));
    await pg.mouse.move(box.x + box.width - 2, y); await pg.mouse.down(); await pg.mouse.move(box.x + box.width * 0.8, y, { steps: 6 }); await pg.mouse.up();
    let en = await pg.evaluate(() => +document.getElementById('end').value);
    ok(Math.abs(en - dur * 0.8) < dur * 0.06, 'правый край перетащен: ' + en.toFixed(2));
    await pg.mouse.click(box.x + box.width * 0.55, y);
    const ct = await pg.evaluate(() => document.getElementById('previewVideo') ? document.getElementById('previewVideo').currentTime : -1);
    const lbl = await pg.textContent('#startLbl');
    ok(lbl !== '0:00.0', 'подпись начала обновилась: ' + lbl);
    const w = await pg.evaluate(() => document.querySelector('.tl-l').style.width);
    ok(parseFloat(w) > 20, 'затемнение слева ' + w);
    // свой лимит
    await tab('export'); await pg.fill('#targetMb', '8'); await pg.waitForTimeout(300);
    const tg = await pg.evaluate(() => S.target);
    ok(tg === 8, 'свой лимит принят: ' + tg);
    ok(/Уложится в 8 МБ/.test(await pg.textContent('#fitNote')), 'строка про качество: ' + (await pg.textContent('#fitNote')));
    await pg.fill('#targetMb', ''); await pg.waitForTimeout(200);
    ok((await pg.evaluate(() => S.target)) === 0, 'пустое поле снимает лимит');
    await pg.fill('#targetMb', '0.2'); await pg.waitForTimeout(200);
    ok((await pg.evaluate(() => S.target)) === 0, 'значение меньше 1 МБ не принимается');
    // архив
    const res = await pg.evaluate(async () => {
      const mk = (n, len) => { const u = new Uint8Array(len); for (let i = 0; i < len; i++) u[i] = (i * 7 + n) & 255; return u; };
      const files = [{ name: 'один.mp4', blob: new Blob([mk(1, 100000)]) }, { name: 'один.mp4', blob: new Blob([mk(2, 7000000)]) }, { name: 'a:b?c.webm', blob: new Blob([mk(3, 5)]) }];
      const z = await AV.makeZip(files); return Array.from(new Uint8Array(await z.arrayBuffer()));
    });
    const zf = path.join(outDir, 'test.zip'); fs.writeFileSync(zf, Buffer.from(res));
    const t = cp.spawnSync('unzip', ['-t', zf], { encoding: 'utf8' });
    ok(/No errors detected/.test(t.stdout), 'unzip -t: без ошибок ' + (t.stderr || '').slice(0, 80));
    const l = cp.spawnSync('unzip', ['-Z1', zf], { encoding: 'utf8' }).stdout.trim().split('\n');
    ok(l.length === 3 && new Set(l).size === 3, 'имена без повторов: ' + l.join(' | '));
    const f2 = cp.spawnSync('unzip', ['-p', zf, l[1]], { maxBuffer: 1 << 26 }).stdout;
    ok(f2.length === 7000000 && f2[10] === ((10 * 7 + 2) & 255), 'содержимое второго файла сходится');
    // кнопка архива в интерфейсе: два результата
    await pg.fill('#targetMb', '');
    for (let k = 0; k < 2; k++) {
      await pg.click('#saveBtn'); await pg.waitForFunction(() => document.querySelector('#progress').hidden, null, { timeout: 120000 }); await pg.waitForTimeout(400);
    }
    ok(await pg.isVisible('#zipAll'), 'кнопка «Скачать архивом» появилась при двух результатах');
    const dl = pg.waitForEvent('download', { timeout: 60000 });
    await pg.click('#zipAll'); const d = await dl; const zp = path.join(outDir, 'ui.zip'); await d.saveAs(zp);
    const t2 = cp.spawnSync('unzip', ['-t', zp], { encoding: 'utf8' });
    ok(/No errors detected/.test(t2.stdout) && /\.zip$/.test(d.suggestedFilename()), 'архив из интерфейса: ' + d.suggestedFilename());
    await pg.click('#clearResults'); await pg.waitForTimeout(300);
    ok(!(await pg.isVisible('#zipAll')), 'после очистки кнопка скрыта');
  } catch (e) { ok(false, 'исключение: ' + e.message.split('\n')[0]); }
  ok(errs.length === 0, 'нет ошибок страницы ' + errs.join(' | '));
  await b.close(); srv.close(); console.log(fails ? 'FAILED ' + fails : 'ALL OK'); process.exit(fails ? 1 : 0);
});
