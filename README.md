# Aspect Studio Video

Меняет формат видео без обрезки (Reels, Shorts, 4:5, YouTube и другие). Всё работает в браузере: видео никуда не загружается.
Без фреймворков и сборщиков: обычный HTML, CSS и JS. Работает в Termux (`python -m http.server`) и на GitHub Pages.

- Сохранение: WebCodecs (H.264 + AAC) → MP4 через `vendor/mp4-muxer.js`. Запасной режим: MediaRecorder в реальном времени.
- Лица: BlazeFace (`vendor/blazeface`, `vendor/tfjs`, `js/faces-worker.js`).
- Тест: `node tests/smoke.js <сайт> <a.webm> <b.webm> <face.webm> <папка-результатов>` (нужен playwright).
- Тест блока 2: `node tests/block2.js <сайт> <tone.webm> <shaky.webm> <subs.srt> <папка-результатов>` (6 с со звуком и тишиной посередине, дрожащее видео, SRT).
- Тест блока 3: `node tests/block3.js <сайт> <папка-фикстур> <папка-результатов>` (быстрое чтение кадров против перемотки, звук по частям, поворот, moov в конце, 45 минут звука). Фикстуры делаются ffmpeg: tone264.mp4, tonevp9.mp4, tone264rot.mp4 (`-display_rotation 90 -c copy`), tone264end.mp4 (без faststart), long45.mp4.
- Тест продолжения после сбоя: `node tests/resume.js <сайт> <a> <b> <c>`.
- Тест английского интерфейса: `node tests/i18n.js <сайт> <видео>` (ищет оставшийся русский текст). Для axe на английском: `AV_LOCALE=en-US node tests/a11y.js ...`. Остальные тесты запускаются с языком ru-RU.
- Новый русский текст надо добавлять и в `js/i18n-en.js` (ключ — русская строка; составные строки переводятся по частям, пробелы по краям важны).
- При каждом обновлении: поднять версию в `js/core.js` (`APP_VERSION`), в `sw.js` (`VERSION`), добавить запись в `js/changelog-data.js` и `CHANGELOG.md`.

## Безопасность

- В `index.html` задана политика CSP через `<meta>` (GitHub Pages не даёт ставить заголовки). Если добавляешь новый внешний адрес, шрифт или встроенный скрипт, её нужно расширить, иначе браузер заблокирует запрос.
- Хэши библиотек: `vendor/SHA256SUMS`; хэши компонентов: `COMPS[].sha` в `js/extras.js`. После замены библиотеки: `(find vendor -type f ! -name SHA256SUMS | sort | xargs sha256sum > vendor/SHA256SUMS)`, затем скопировать новые хэши в `extras.js` и запустить `node tests/hashes.js <сайт>`.
- На GitHub включи двухфакторную защиту и защиту ветки `main`: взлом репозитория опаснее любой дыры в коде.
- Заголовки HSTS, COOP/COEP, X-Frame-Options и Permissions-Policy на GitHub Pages недоступны (`<meta>` их не принимает); нужен хостинг с файлом `_headers`, например Cloudflare Pages.
