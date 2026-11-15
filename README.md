# Aspect Studio Video

Меняет формат видео без обрезки (Reels, Shorts, 4:5, YouTube и другие). Всё работает в браузере: видео никуда не загружается.
Без фреймворков и сборщиков: обычный HTML, CSS и JS. Работает в Termux (`python -m http.server`) и на GitHub Pages.

- Сохранение: WebCodecs (H.264 + AAC) → MP4 через `vendor/mp4-muxer.js`. Запасной режим: MediaRecorder в реальном времени.
- Лица: BlazeFace (`vendor/blazeface`, `vendor/tfjs`, `js/faces-worker.js`).
- Тест: `node tests/smoke.js <сайт> <a.webm> <b.webm> <face.webm> <папка-результатов>` (нужен playwright).
- Тест блока 2: `node tests/block2.js <сайт> <tone.webm> <shaky.webm> <subs.srt> <папка-результатов>` (6 с со звуком и тишиной посередине, дрожащее видео, SRT).
- При каждом обновлении: поднять версию в `js/core.js` (`APP_VERSION`), в `sw.js` (`VERSION`), добавить запись в `js/changelog-data.js` и `CHANGELOG.md`.
