/* Тест v2.11.0: node tests/block9.js <папка-сайта> <папка-фикстур>
   Сцены (scenes.webm), режим «Только речь» (noisy.webm, speech.webm), заметный объект (objmove.webm), замер скорости. */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [root, fx] = process.argv.slice(2);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/json', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, r) => {
  let p = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); r.end(d); });
}).listen(8789, async () => {
  const b = await chromium.launch(process.env.AV_CHROME ? { executablePath: process.env.AV_CHROME } : process.env.AV_CHANNEL ? { channel: process.env.AV_CHANNEL } : {});
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, locale: 'ru-RU' });
  await ctx.addInitScript(() => { try { localStorage.setItem('aspect-video-onboarded', '1'); localStorage.setItem('aspect-video-seen', '2.11.0'); } catch (e) { /* ничего */ } });
  const pg = await ctx.newPage(); const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  const open = async f => { await pg.reload(); await pg.waitForSelector('#uploadBtn'); await pg.setInputFiles('#fileInput', path.join(fx, f)); await pg.waitForSelector('#previewCard:not([hidden])', { timeout: 30000 }); await pg.waitForTimeout(800); };
  const tab = t => pg.click(`#settingsTabs [data-tab="${t}"]`);
  const q0 = () => pg.evaluate(() => { const it = AVApp.Q()[0]; return { cuts: it.cuts, start: it.start, end: it.end, track: it.track, scenes: it.scenes }; });
  try {
    await pg.goto('http://localhost:8789/index.html'); await pg.waitForSelector('#uploadBtn');
    // сцены
    await open('scenes.webm'); await tab('video');
    await pg.click('#scRun'); await pg.waitForFunction(() => document.querySelector('#scRun').textContent === 'Найти сцены' && document.querySelectorAll('#scList .sc-row').length > 0, null, { timeout: 60000 });
    let sc = (await q0()).scenes;
    ok(sc && sc.length === 3, 'найдено 3 сцены: ' + (sc ? sc.map(s => s.start.toFixed(2) + '-' + s.end.toFixed(2)).join(' | ') : 'нет'));
    ok(sc && Math.abs(sc[1].start - 3) < 0.3 && Math.abs(sc[2].start - 6) < 0.3, 'границы около 3 и 6 секунд');
    await pg.click('#sc1', { force: true }); await pg.click('#scKeep');
    let st = await q0();
    ok(st.cuts && st.cuts.length === 2 && Math.abs(st.cuts[0][1] - 3) < 0.3 && Math.abs(st.cuts[1][0] - 6) < 0.3, 'оставлены сцены 1 и 3 (вырезана средняя): ' + JSON.stringify(st.cuts));
    await pg.click('#scSplit');
    const qn = await pg.evaluate(() => AVApp.Q().length);
    ok(qn === 3, 'после «Разрезать» в очереди видео: ' + qn);
    ok(await pg.evaluate(() => AVApp.Q().slice(1).every(i => i.url && i.end > i.start && !i.cuts)), 'у новых видео свои границы');
    // речь
    await open('noisy.webm'); await tab('video');
    const r1 = await pg.evaluate(async () => { const it = AVApp.Q()[0]; const an = await AV.analyzeAudio(it.file, it.dur); return { en: AV.soundIntervals(an, 0.7, 0.12), sp: AV.speechIntervals(an, 0.7, 0.12), dur: it.dur }; });
    const covers = (iv, a, b) => iv.some(x => x[0] < b && x[1] > a);
    ok(covers(r1.en, 9.5, 11.5), 'по громкости шум в конце считается звуком');
    ok(!covers(r1.sp, 9.5, 11.5) && r1.sp.length > 0, 'режим речи: шум в конце не считается, речь осталась ' + JSON.stringify(r1.sp.map(x => x.map(v => +v.toFixed(1)))));
    await pg.click('#silCut'); await pg.waitForFunction(() => !document.querySelector('#silCut').disabled, null, { timeout: 30000 }); await pg.waitForTimeout(300);
    st = await q0(); ok(st.end < 9.5, 'кнопка «Вырезать паузы» срезала шум в конце: end=' + (+st.end).toFixed(1));
    await open('speech.webm');
    const r2 = await pg.evaluate(async () => { const it = AVApp.Q()[0]; const an = await AV.analyzeAudio(it.file, it.dur); return AV.speechIntervals(an, 0.7, 0.12).reduce((s, x) => s + x[1] - x[0], 0); });
    ok(r2 > 5, 'на настоящей речи интервалов набирается ' + r2.toFixed(1) + ' с');
    await open('tone.webm');
    const r3 = await pg.evaluate(async () => { const it = AVApp.Q()[0]; const an = await AV.analyzeAudio(it.file, it.dur); return AV.speechIntervals(an, 0.7, 0.12).length; });
    ok(r3 === 0, 'ровный тон не считается речью');
    // заметный объект
    await open('objmove.webm');
    await pg.evaluate(() => { set('rw', 9); set('rh', 16); set('mode', 'crop'); set('trackObj', true); set('faceTrack', true); });
    await pg.waitForFunction(() => AVApp.Q()[0].track || AVApp.Q()[0].noFace, null, { timeout: 60000 });
    const tr = (await q0()).track;
    ok(tr && tr.length > 5, 'дорожка объекта построена');
    ok(tr && tr[0].x < 0.4 && tr[tr.length - 1].x > 0.6, 'камера идёт за квадратом слева направо: ' + (tr ? tr[0].x.toFixed(2) + ' → ' + tr[tr.length - 1].x.toFixed(2) : ''));
    // замер скорости
    await tab('export'); await pg.click('#benchRun');
    await pg.waitForFunction(() => /кадров\/с в 720p|не получился|недоступен|нет аппаратного/.test(document.querySelector('#benchStatus').textContent), null, { timeout: 90000 });
    const bs = await pg.textContent('#benchStatus'); const bh = await pg.textContent('#benchHint');
    ok(/около \d+ кадров\/с в 720p/.test(bs), 'замер выполнен: ' + bs);
    ok(/сохранится примерно за/.test(bh), 'оценка для видео: ' + bh.slice(0, 100));
  } catch (e) { ok(false, 'исключение: ' + e.message.split('\n')[0]); }
  ok(errs.length === 0, 'нет ошибок страницы ' + errs.join(' | '));
  await b.close(); srv.close(); console.log(fails ? 'FAILED ' + fails : 'ALL OK'); process.exit(fails ? 1 : 0);
});
