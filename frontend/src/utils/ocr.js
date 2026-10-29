const BASE_URL = import.meta.env.BASE_URL;

function stageForStatus(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized.includes('core')) return 'engine';
  if (normalized.includes('language')) return 'language';
  if (normalized.includes('initializ')) return 'initialize';
  if (normalized.includes('recogniz')) return 'recognize';
  return 'prepare';
}

async function localImageSource(source) {
  if (typeof source !== 'string') throw new Error('OCR_IMAGE_INVALID');
  if (source.startsWith('data:image/')) return source;
  let url = source;
  const parsed = new URL(source, window.location.origin);
  if (parsed.origin !== window.location.origin) throw new Error('OCR_IMAGE_EXTERNAL_URL');
  url = parsed.href;
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error('OCR_IMAGE_LOAD_FAILED');
  return response.blob();
}

export async function recognizeImagesLocally(images, language, onProgress = () => {}) {
  if (!images.length) throw new Error('OCR_NO_IMAGES');

  const { createWorker } = await import('tesseract.js');
  const root = `${BASE_URL}ocr`;
  const worker = await createWorker(language.split('+'), 1, {
    workerPath: `${root}/worker.min.js`,
    corePath: `${root}/core`,
    langPath: `${root}/lang`,
    workerBlobURL: false,
    cacheMethod: 'write',
    logger: ({ status, progress }) => onProgress({ stage: stageForStatus(status), progress: Number.isFinite(progress) ? progress : 0 })
  });

  try {
    const output = [];
    for (let index = 0; index < images.length; index += 1) {
      onProgress({ stage: 'recognize', progress: 0, imageIndex: index, imageCount: images.length });
      const image = await localImageSource(images[index]);
      const result = await worker.recognize(image);
      const text = result.data.text.trim();
      if (text) output.push(text);
    }
    const text = output.join('\n\n').trim();
    if (!text) throw new Error('OCR_NO_TEXT');
    return text;
  } finally {
    await worker.terminate();
  }
}
