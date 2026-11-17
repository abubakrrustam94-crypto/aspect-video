/* Согласованность версий и офлайн-списка: node tests/version.js <папка-сайта>
   APP_VERSION (core.js), VERSION (sw.js), meta av-version (index.html) и верхняя запись changelog-data.js должны совпадать;
   каждый файл, который подключает index.html или который подгружается позже, должен быть в CORE service worker, иначе офлайн сломается. */
const fs = require('fs'), path = require('path');
const root = process.argv[2]; let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const rd = f => fs.readFileSync(path.join(root, f), 'utf8');
const core = /APP_VERSION = '([^']+)'/.exec(rd('js/core.js'))[1], sw = /VERSION = 'aspect-video-v([^']+)'/.exec(rd('sw.js'))[1];
const meta = /name="av-version" content="([^"]+)"/.exec(rd('index.html'))[1], top = /"v":\s*"([^"]+)"/.exec(rd('js/changelog-data.js'))[1];
const cl = new RegExp('^## ' + core.replace(/\./g, '\\.') + ' ', 'm').test(rd('CHANGELOG.md'));
ok(core === sw && core === meta && core === top, 'версии совпадают: core ' + core + ', sw ' + sw + ', meta ' + meta + ', changelog-data ' + top);
ok(cl, 'в CHANGELOG.md есть запись ' + core);
const coreList = [...rd('sw.js').match(/const CORE = \[([\s\S]*?)\];/)[1].matchAll(/'\.\/([^']*)'/g)].map(m => m[1]);
const html = rd('index.html'), refs = new Set([...html.matchAll(/(?:src|href)="((?:js|css|vendor|icons)\/[^"]+)"/g)].map(m => m[1]));
['manifest.webmanifest', 'js/changelog-data.js', 'js/faces-worker.js'].forEach(f => refs.add(f));
fs.readdirSync(path.join(root, 'vendor/mp4box')).filter(f => /\.mjs$/.test(f)).forEach(f => refs.add('vendor/mp4box/' + f));
fs.readdirSync(path.join(root, 'fonts')).forEach(f => refs.add('fonts/' + f));
refs.delete('icons/icon-192.png'); refs.add('icons/icon-192.png');
refs.forEach(f => { if (!/^vendor\/(tfjs|blazeface)\//.test(f)) ok(coreList.indexOf(f) >= 0, 'в офлайн-списке: ' + f); });
coreList.forEach(f => { if (f) ok(fs.existsSync(path.join(root, f)), 'файл из списка существует: ' + f); });
ok(!/<script>[^<]/.test(html) && !/<script>\s*\n/.test(html), 'в index.html нет встроенных скриптов (CSP их не разрешает)');
ok(!/innerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(['core', 'render', 'faces', 'analyze', 'decode', 'audio', 'session', 'export', 'app', 'extras', 'about', 'i18n', 'heal'].map(n => rd('js/' + n + '.js')).join('\n')), 'в коде нет innerHTML, eval и document.write');
console.log(fails ? 'FAILED ' + fails : 'ALL OK'); process.exit(fails ? 1 : 0);
