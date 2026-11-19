/* Воркер распознавания речи: Whisper tiny (ONNX, 8 бит) на transformers.js, WebAssembly, всё на устройстве.
   Файлы лежат в vendor/whisper (компонент «Распознавание речи»). Модуль-воркер: запускается как new Worker(url, {type:'module'}). */
import { pipeline, env } from '../vendor/whisper/transformers.min.js';

const BASE = new URL('../vendor/whisper/', self.location.href).href;
env.allowRemoteModels = false; env.allowLocalModels = true; env.localModelPath = '../vendor/whisper/models/';   // именно относительный путь: с http-адресом библиотека не находит preprocessor_config.json
env.useBrowserCache = false; env.useWasmCache = false;
env.backends.onnx.wasm.wasmPaths = { mjs: BASE + 'ort-wasm-simd-threaded.mjs', wasm: BASE + 'ort-wasm-simd-threaded.wasm' };
env.backends.onnx.wasm.numThreads = 1;                 // без cross-origin isolation потоков не будет

let asr = null;
async function init() {
  if (asr) return;
  asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', { dtype: 'q8', device: 'wasm' });
}
self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') { await init(); self.postMessage({ id: m.id, ok: true }); }
    else if (m.type === 'run') {
      await init();
      const opt = { return_timestamps: true, task: 'transcribe', chunk_length_s: 30 };
      if (m.lang) opt.language = m.lang;
      const r = await asr(m.audio, opt);
      const chunks = (r.chunks || []).map(c => ({ text: String(c.text || ''), s: c.timestamp[0], e: c.timestamp[1] }));
      if (!chunks.length && r.text) chunks.push({ text: String(r.text), s: 0, e: m.audio.length / 16000 });
      self.postMessage({ id: m.id, ok: true, chunks });
    }
  } catch (err) { self.postMessage({ id: m.id, ok: false, error: String((err && err.message) || err) }); }
};
