export const ocrVersion = "7.0.0";
export const ocrBase = `/ocr/${ocrVersion}`;

export const ocrFiles = {
  "worker.min.js": "tesseract.js/dist/worker.min.js",
  "core/tesseract-core-relaxedsimd-lstm.wasm.js": "tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js",
  "core/tesseract-core-simd-lstm.wasm.js": "tesseract.js-core/tesseract-core-simd-lstm.wasm.js",
  "core/tesseract-core-lstm.wasm.js": "tesseract.js-core/tesseract-core-lstm.wasm.js",
  "lang/eng.traineddata.gz": "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
  "licenses/tesseract.js.txt": "tesseract.js/LICENSE.md",
  "licenses/tesseract.js-core.txt": "tesseract.js-core/LICENSE",
  "licenses/jsqr.txt": "jsqr/LICENSE",
} as const;
