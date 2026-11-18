/* Проверка доступности: node tests/a11y.js <папка-сайта> <video.webm> ; нужен playwright и axe-core (NODE_PATH) */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const axeSrc = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const [root, vid] = process.argv.slice(2);
const mime = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/json', '.woff2': 'font/woff2' };
const srv = http.createServer((q, r) => { let p = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); r.end(d); }); }).listen(8767, async () => {
  const b = await chromium.launch(process.env.AV_CHROME ? { executablePath: process.env.AV_CHROME } : process.env.AV_CHANNEL ? { channel: process.env.AV_CHANNEL } : {}); let total = 0;
  const run = async (pg, label) => {
    await pg.evaluate(src => { if (!window.axe) (0, eval)(src); }, axeSrc);
    const r = await pg.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] })).violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, t: v.nodes.slice(0, 3).map(n => n.target.join(' ') + ' | ' + (n.any[0] ? n.any[0].message : (n.failureSummary || '')).slice(0, 140)) })));
    r.forEach(v => { total++; console.log(`[${label}] ${v.impact} ${v.id} ×${v.n}\n   ` + v.t.join('\n   ')); });
    if (!r.length) console.log(`[${label}] нарушений нет`);
  };
  for (const scheme of ['dark', 'light']) {
    const ctx = await b.newContext({ viewport: { width: 430, height: 900 }, colorScheme: scheme, locale: process.env.AV_LOCALE || 'ru-RU' });
    await ctx.addInitScript(() => { try { localStorage.setItem('aspect-video-onboarded', '1'); } catch (e) {} });
    const pg = await ctx.newPage(); await pg.goto('http://localhost:8767/index.html');
    for (const t of ['frame', 'video', 'wm', 'export', 'components', 'about']) { await pg.click(`#settingsTabs [data-tab="${t}"]`); await pg.waitForTimeout(150); await run(pg, scheme + ' без видео ' + t); }
    await pg.setInputFiles('#fileInput', [vid]); await pg.waitForSelector('#previewCard:not([hidden])'); await pg.waitForTimeout(700);
    await pg.click('#settingsTabs [data-tab="frame"]'); await run(pg, scheme + ' с видео frame');
    await pg.click('#settingsTabs [data-tab="about"]'); await pg.click('#wnOpenBtn'); await pg.waitForTimeout(300); await run(pg, scheme + ' окно «Что нового»'); await pg.click('#wnClose');
    await pg.click('#onbBtn'); await pg.waitForTimeout(900); await run(pg, scheme + ' обучение'); await pg.click('#onbSkip').catch(() => {});
    await ctx.close();
  }
  console.log(total ? 'НАРУШЕНИЙ: ' + total : 'ВСЁ ЧИСТО'); await b.close(); srv.close();
});
