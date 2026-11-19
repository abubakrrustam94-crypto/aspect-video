/* Тест v2.8.0: node tests/block7.js <папка-сайта> <папка-фикстур> <папка-результатов>
   Вкладка «Данные»: чтение метаданных (meta.mp4, meta_atoms.mp4, a.webm), предупреждение о координатах,
   дата создания в результате (ffprobe): «как в исходнике», «без даты». */
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
}).listen(8787, async () => {
  const b = await chromium.launch(process.env.AV_CHROME ? { executablePath: process.env.AV_CHROME } : process.env.AV_CHANNEL ? { channel: process.env.AV_CHANNEL } : {});
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, locale: 'ru-RU' });
  await ctx.addInitScript(() => { try { localStorage.setItem('aspect-video-onboarded', '1'); } catch (e) { /* ничего */ } });
  const pg = await ctx.newPage(); const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  const open = async f => { await pg.reload(); await pg.waitForSelector('#uploadBtn'); await pg.setInputFiles('#fileInput', path.join(fx, f)); await pg.waitForSelector('#previewCard:not([hidden])', { timeout: 30000 }); await pg.waitForTimeout(800); };
  const tab = t => pg.click(`#settingsTabs [data-tab="${t}"]`);
  const save = async () => { await pg.click('#saveBtn'); await pg.waitForFunction(() => document.querySelector('#progress').hidden, null, { timeout: 120000 }); await pg.waitForTimeout(300); };
  const dump = async (name) => { const buf = await pg.evaluate(async () => { const r = window.AVApp.results()[0]; return Array.from(new Uint8Array(await r.blob.arrayBuffer())); }); const f = path.join(outDir, name); fs.writeFileSync(f, Buffer.from(buf)); return f; };
  const created = (f) => { const r = cp.spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format_tags=creation_time', '-of', 'default=nw=1:nk=1', f], { encoding: 'utf8' }); return (r.stdout || '').trim(); };
  try {
    await pg.goto('http://localhost:8787/index.html'); await pg.waitForSelector('#uploadBtn');
    // 1. чтение
    await open('meta.mp4'); await tab('info');
    const txt = await pg.textContent('#infoCard');
    ok(/Тест метаданных/.test(txt) && /ACME/.test(txt) && /Phone9/.test(txt), 'название и устройство показаны');
    ok(/55\.7558/.test(txt) && /37\.6173/.test(txt), 'координаты показаны');
    ok(/2025/.test(txt), 'дата съёмки показана');
    ok(await pg.$eval('#infoCard', e => !!e.querySelector('.info-warn')) || await pg.$('#infoCard .info-warn') !== null || /координат/i.test(await pg.textContent('#infoAfterCard')), 'предупреждение о координатах');
    const m2 = await pg.evaluate(async () => { const r = await fetch('tests/fixtures/meta_atoms.mp4').catch(() => null); return !!r; });
    await open('meta_atoms.mp4'); await tab('info');
    const t2 = await pg.textContent('#infoCard');
    ok(/Android style/.test(t2) && /55\.7558/.test(t2), 'iTunes-блок и loci читаются');
    await open('a.webm'); await tab('info');
    const t3 = await pg.textContent('#infoCard');
    ok(/WebM/.test(t3) && !/[\u0000-\u0008]/.test(t3), 'WebM читается без мусора');
    // 2. дата в результате
    await open('meta.mp4'); await tab('export');
    await pg.evaluate(() => { set('dateMode', 'src'); });
    await save(); const f1 = await dump('date-src.mp4');
    ok(/^2025-03-14T09:26:53/.test(created(f1)), 'дата как в исходнике: ' + created(f1));
    ok(await pg.$('.res-card .res-check') !== null, 'на карточке результата есть строка проверки');
    await pg.evaluate(() => { set('dateMode', 'none'); });
    await save(); const f2 = await dump('date-none.mp4');
    const c2 = created(f2); ok(!/^20(2[5-9]|[3-9])/.test(c2) || c2 === '', 'без даты: «' + c2 + '»');
    // 3. отчёт
    await tab('info');
    const rep = await pg.evaluate(() => AV.metaText(AVApp.Q()[0].meta).length);
    ok(rep > 20, 'отчёт для копирования собран: ' + rep);
  } catch (e) { ok(false, 'исключение: ' + e.message); }
  ok(errs.length === 0, 'нет ошибок страницы ' + errs.join(' | '));
  await b.close(); srv.close(); console.log(fails ? 'FAILED ' + fails : 'ALL OK'); process.exit(fails ? 1 : 0);
});
