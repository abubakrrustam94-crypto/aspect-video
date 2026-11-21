/* Тест v2.13.0: node tests/block10.js <папка-сайта> <папка-фикстур>
   Виды подписей (подсветка слов), приближение двумя пальцами, двойное нажатие, подбор настроек по замеру, знакомство. */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [root, fx] = process.argv.slice(2);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/json', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, r) => {
  let p = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); r.end(d); });
}).listen(8790, async () => {
  const b = await chromium.launch(process.env.AV_CHROME ? { executablePath: process.env.AV_CHROME } : process.env.AV_CHANNEL ? { channel: process.env.AV_CHANNEL } : {});
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, locale: 'ru-RU' });
  await ctx.addInitScript(() => { try { localStorage.setItem('aspect-video-onboarded', '1'); localStorage.setItem('aspect-video-seen', '2.13.0'); } catch (e) { /* ничего */ } });
  const pg = await ctx.newPage(); const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  try {
    await pg.goto('http://localhost:8790/index.html'); await pg.waitForSelector('#uploadBtn');
    await pg.setInputFiles('#fileInput', path.join(fx, 'scenes.webm')); await pg.waitForSelector('#previewCard:not([hidden])', { timeout: 30000 }); await pg.waitForTimeout(1200);
    // подписи
    const cap = await pg.evaluate(() => {
      const cv = document.createElement('canvas'); cv.width = 600; cv.height = 200; const g = cv.getContext('2d');
      const caps = [{ text: 'один два три четыре пять шесть', start: 0, end: 6 }];
      function red(t, look, font) {
        g.fillStyle = '#000'; g.fillRect(0, 0, 600, 200);
        AV.drawCaptions(g, 600, 200, caps, { pos: 'mid', size: 12, color: '#ffffff', box: false, look, font, hi: '#ff0000' }, t);
        const d = g.getImageData(0, 0, 600, 200).data; let n = 0, sx = 0, any = 0;
        for (let y = 0; y < 200; y++) for (let x = 0; x < 600; x++) { const i = (y * 600 + x) * 4; if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) { n++; sx += x; } if (d[i] + d[i + 1] + d[i + 2] > 300) any++; }
        return { n, cx: n ? sx / n : 0, any };
      }
      return { k0: red(0.3, 'karaoke', 'sans'), k1: red(5.7, 'karaoke', 'sans'), cl: red(0.3, 'classic', 'sans'), sh: red(0.3, 'shadow', 'serif'), mo: red(0.3, 'classic', 'mono') };
    });
    ok(cap.k0.n > 50 && cap.k1.n > 50, 'подсвеченное слово видно: ' + cap.k0.n + ' / ' + cap.k1.n + ' точек');
    ok(cap.k1.cx > cap.k0.cx + 150, 'подсветка идёт слева направо: ' + Math.round(cap.k0.cx) + ' → ' + Math.round(cap.k1.cx));
    ok(cap.cl.n === 0 && cap.cl.any > 200, 'обычный вид без подсветки, текст виден');
    ok(cap.sh.any > 200 && cap.mo.any > 200, 'вид с тенью и другие шрифты рисуются');
    ok(cap.mo.any !== cap.cl.any, 'шрифт меняет вид текста');
    // приближение
    await pg.evaluate(() => { set('mode', 'crop'); });
    await pg.waitForTimeout(300);
    const dw1 = await pg.evaluate(() => AV.layout.dw);
    const fire = (type, id, x, y) => pg.evaluate(([type, id, x, y]) => { const e = new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: 'touch' }); document.getElementById('preview').dispatchEvent(e); }, [type, id, x, y]);
    const box = await pg.locator('#preview').boundingBox(), cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await fire('pointerdown', 1, cx - 50, cy); await fire('pointerdown', 2, cx + 50, cy);
    await fire('pointermove', 1, cx - 100, cy); await fire('pointermove', 2, cx + 100, cy);
    await fire('pointerup', 1, cx - 100, cy); await fire('pointerup', 2, cx + 100, cy);
    await pg.waitForTimeout(300);
    const z = await pg.evaluate(() => S.cropZoom), dw2 = await pg.evaluate(() => AV.layout.dw);
    ok(Math.abs(z - 2) < 0.15, 'щипок приблизил кадр: ' + z);
    ok(dw2 > dw1 * 1.7, 'кадр в превью стал крупнее: ' + Math.round(dw1) + ' → ' + Math.round(dw2));
    await pg.evaluate(() => { set('cropZoom', 1); set('mode', 'blur'); });
    // двойное нажатие
    await pg.evaluate(() => { document.getElementById('video').currentTime = 1; });
    await pg.waitForTimeout(400);
    const t0 = await pg.evaluate(() => document.getElementById('video').currentTime);
    await fire('pointerdown', 5, box.x + box.width * 0.8, cy); await fire('pointerup', 5, box.x + box.width * 0.8, cy);
    await fire('pointerdown', 6, box.x + box.width * 0.8, cy); await fire('pointerup', 6, box.x + box.width * 0.8, cy);
    await pg.waitForTimeout(400);
    const t1 = await pg.evaluate(() => document.getElementById('video').currentTime);
    ok(Math.abs(t1 - (t0 + 5)) < 0.5, 'двойное нажатие справа перематывает вперёд на 5 с: ' + t0.toFixed(1) + ' → ' + t1.toFixed(1));
    await pg.waitForTimeout(700);
    await fire('pointerdown', 7, box.x + box.width * 0.2, cy); await fire('pointerup', 7, box.x + box.width * 0.2, cy);
    await fire('pointerdown', 8, box.x + box.width * 0.2, cy); await fire('pointerup', 8, box.x + box.width * 0.2, cy);
    await pg.waitForTimeout(400);
    const t2 = await pg.evaluate(() => document.getElementById('video').currentTime);
    ok(t2 < t1 - 4, 'двойное нажатие слева перематывает назад: ' + t1.toFixed(1) + ' → ' + t2.toFixed(1));
    // подбор настроек
    await pg.evaluate(() => { localStorage.setItem('av-bench', JSON.stringify({ fps: 1.5, at: Date.now(), cores: 4 })); set('short', 1080); set('fps', 60); });
    await pg.click('#settingsTabs [data-tab="export"]'); await pg.waitForTimeout(400);
    ok(await pg.isVisible('#benchApply'), 'для медленного устройства есть кнопка «Применить»: ' + (await pg.textContent('#benchApply')));
    await pg.click('#benchApply'); await pg.waitForTimeout(300);
    const cfg = await pg.evaluate(() => ({ s: S.short, f: S.fps }));
    ok(cfg.s <= 720 && cfg.f <= 30, 'применено: ' + cfg.s + 'p, ' + cfg.f + ' кадров/с');
    await pg.evaluate(() => { localStorage.setItem('av-bench', JSON.stringify({ fps: 400, at: Date.now(), cores: 8 })); set('fps', 30); set('short', 720); });
    await pg.waitForTimeout(300);
    ok(!(await pg.isVisible('#benchApply')) && /подходят/.test(await pg.textContent('#benchRec')), 'на быстром устройстве кнопки нет, настройки подходят');
    // знакомство
    await pg.click('#helpBtn'); await pg.waitForSelector('#onboard:not([hidden])');
    ok(/1 \/ 7/.test(await pg.textContent('#onbStep')), 'знакомство из 7 шагов: ' + (await pg.textContent('#onbStep')));
    for (let i = 0; i < 6; i++) await pg.click("#onbNext");
    ok(/7 \/ 7/.test(await pg.textContent('#onbStep')), 'шаги листаются до конца');
  } catch (e) { ok(false, 'исключение: ' + e.message.split('\n')[0]); }
  ok(errs.length === 0, 'нет ошибок страницы ' + errs.join(' | '));
  await b.close(); srv.close(); console.log(fails ? 'FAILED ' + fails : 'ALL OK'); process.exit(fails ? 1 : 0);
});
