#!/usr/bin/env node
/**
 * Vision assets are large and come from elsewhere, so they are fetched
 * rather than committed. Run once after install:
 *
 *   node tools/fetch-vision-assets.mjs
 *
 * WASM comes out of the installed @mediapipe/tasks-vision package.
 * Models come from Google's model CDN, Apache-2.0, ~12 MB total.
 * Both land in public/vision and are git-ignored.
 */
import { mkdir, copyFile, writeFile, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const WASM_SRC = 'node_modules/@mediapipe/tasks-vision/wasm';
const OUT = 'public/vision';

const MODELS = [
  ['face_landmarker.task',
   'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'],
  ['gesture_recognizer.task',
   'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task'],
];

const WASM = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];

const exists = (p) => stat(p).then(() => true, () => false);

await mkdir(`${OUT}/wasm`, { recursive: true });
await mkdir(`${OUT}/models`, { recursive: true });

for (const f of WASM) {
  const src = `${WASM_SRC}/${f}`;
  if (!(await exists(src))) {
    console.error(`missing ${src} — run npm install first`);
    process.exit(1);
  }
  await copyFile(src, `${OUT}/wasm/${f}`);
  console.log(`wasm  ${f}`);
}

for (const [name, url] of MODELS) {
  const dest = `${OUT}/models/${name}`;
  if (await exists(dest)) { console.log(`model ${name} (already here)`); continue; }
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`model ${name} failed: ${res.status}`);
    process.exit(1);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  console.log(`model ${name}`);
}

await writeFile(`${OUT}/ASSETS.md`, `# Vision assets

Fetched by \`node tools/fetch-vision-assets.mjs\`, not committed.

- \`wasm/\` — copied from the installed @mediapipe/tasks-vision package (Apache-2.0)
- \`models/\` — MediaPipe face_landmarker and gesture_recognizer, float16
  (Apache-2.0, Google). See https://ai.google.dev/edge/mediapipe/solutions/vision

If these are absent the vision layer says so and everything else keeps working.
`);
console.log('vision assets ready');
