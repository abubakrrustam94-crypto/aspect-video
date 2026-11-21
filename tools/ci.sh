#!/usr/bin/env bash
# Все проверки сайта одной командой: tools/ci.sh [браузер]
#   без аргумента — Chromium из Playwright; "chrome" — установленный Google Chrome (H.264 и т. д.).
# Нужны: node, playwright, ffmpeg/ffprobe; для доступности ещё axe-core (npm i axe-core).
set -u
cd "$(dirname "$0")/.."
S=$PWD; FX=$S/tests/fixtures; OUT=${TMPDIR:-/tmp}/av-out; mkdir -p "$OUT"
[ "${1:-}" = chrome ] && export AV_CHANNEL=chrome
fail=0
run() { echo "=== $1"; shift; "$@" || { echo "!!! упало: $*"; fail=1; }; }

# Длинный ролик для проверки звука по частям делаем на месте: он слишком большой для репозитория
if [ ! -f "$FX/long45.mp4" ]; then
  ffmpeg -v error -y -f lavfi -i color=c=gray:s=160x90:r=1:d=2700 -f lavfi -i sine=f=440:r=48000:d=2700 \
    -c:v libx264 -g 30 -pix_fmt yuv420p -c:a libopus -strict -2 -shortest "$FX/long45.mp4"
fi

run version  node tests/version.js "$S"
run hashes   node tests/hashes.js "$S"
run smoke    node tests/smoke.js "$S" "$FX/a.webm" "$FX/b.webm" "$FX/face.webm" "$OUT"
run i18n     node tests/i18n.js "$S" "$FX/a.webm"
run block1   node tests/block1.js "$S" "$FX" "$OUT"
run block2   node tests/block2.js "$S" "$FX/tone.webm" "$FX/shaky.webm" "$FX/subs.srt" "$OUT"
run block2b  node tests/block2b.js "$S" "$FX" "$OUT"
run block3   node tests/block3.js "$S" "$FX" "$OUT"
run block5   node tests/block5.js "$S" "$FX" "$OUT"
run block6   node tests/block6.js "$S" "$FX" "$OUT"
run block7   node tests/block7.js "$S" "$FX" "$OUT"
run block8   node tests/block8.js "$S" "$FX" "$OUT"
run block9   node tests/block9.js "$S" "$FX"
run components node tests/components.js "$S" "$FX"
run chaos    node tests/chaos.js "$S" "$FX" "$OUT"
run resume   node tests/resume.js "$S" "$FX/a.webm" "$FX/b.webm" "$FX/in.webm"
[ -d node_modules/axe-core ] && run a11y env NODE_PATH="$S/node_modules" node tests/a11y.js "$S" "$FX/a.webm"
[ "${1:-}" = chrome ] && run chrome node tests/chrome.js "$S" "$FX" "$OUT"
exit $fail
