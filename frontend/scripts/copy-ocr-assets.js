import { mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(frontendRoot, 'public', 'ocr');
const coreRoot = path.resolve(frontendRoot, '..', 'node_modules', 'tesseract.js-core');
const workerPath = path.resolve(frontendRoot, '..', 'node_modules', 'tesseract.js', 'dist', 'worker.min.js');

await Promise.all([
  mkdir(path.join(publicRoot, 'core'), { recursive: true }),
  mkdir(path.join(publicRoot, 'lang'), { recursive: true })
]);

await copyFile(workerPath, path.join(publicRoot, 'worker.min.js'));

for (const file of [
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js'
]) {
  await copyFile(path.join(coreRoot, file), path.join(publicRoot, 'core', file));
}

for (const language of ['eng', 'chi_sim']) {
  const source = path.resolve(frontendRoot, '..', 'node_modules', '@tesseract.js-data', language, '4.0.0_best_int', `${language}.traineddata.gz`);
  await copyFile(source, path.join(publicRoot, 'lang', `${language}.traineddata.gz`));
}

console.info('Prepared local Tesseract.js worker, core and English/Simplified Chinese language data.');
