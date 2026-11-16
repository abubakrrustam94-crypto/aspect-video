/* Проверка целостности: node tests/hashes.js <папка-сайта>
   1) все файлы из vendor/SHA256SUMS совпадают с хэшами; 2) хэши компонентов в js/extras.js совпадают с файлами.
   Обновить список после замены библиотеки: (cd <сайт> && find vendor -type f ! -name SHA256SUMS | sort | xargs sha256sum > vendor/SHA256SUMS) и скопировать новые хэши в COMPS (extras.js). */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = process.argv[2]; let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const h = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex');
const sums = fs.readFileSync(path.join(root, 'vendor/SHA256SUMS'), 'utf8').trim().split('\n').map(l => l.split(/\s+/));
ok(sums.length > 8, 'в списке vendor ' + sums.length + ' файлов');
sums.forEach(([x, f]) => ok(h(f) === x, 'vendor: ' + f));
const ex = fs.readFileSync(path.join(root, 'js/extras.js'), 'utf8'), re = /'((?:vendor|js)\/[^']+)':\s*'([0-9a-f]{64})'/g; let m, n = 0;
while ((m = re.exec(ex))) { n++; ok(h(m[1]) === m[2], 'компонент: ' + m[1]); }
ok(n >= 5, 'хэшей компонентов: ' + n);
console.log(fails ? 'FAILED ' + fails : 'ALL OK'); process.exit(fails ? 1 : 0);
