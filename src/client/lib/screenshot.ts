import { ocrBase } from "../../shared/ocr";
import { checkImageBytes, imageHeaderBytes, maxImagePixels, ScreenshotError } from "./image-check";

export interface ScreenshotText {
  text: string;
  qrTexts: string[];
}

const maxOcrSide = 2400;
const smallSide = 1000;
const readTimeoutMs = 90_000;

function darkShare(data: Uint8ClampedArray): number {
  let dark = 0;
  let sampled = 0;
  for (let index = 0; index < data.length; index += 4 * 16) {
    const luminance = 0.2126 * data[index]! + 0.7152 * data[index + 1]! + 0.0722 * data[index + 2]!;
    dark += luminance < 110 ? 1 : 0;
    sampled += 1;
  }
  return sampled === 0 ? 0 : dark / sampled;
}

function invert(data: Uint8ClampedArray): void {
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 255 - data[index]!;
    data[index + 1] = 255 - data[index + 1]!;
    data[index + 2] = 255 - data[index + 2]!;
  }
}

function withTimeout<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) => setTimeout(() => reject(new ScreenshotError("Reading the screenshot took too long. Try a smaller crop.")), milliseconds)),
  ]);
}

export async function readScreenshot(file: Blob, onProgress: (share: number) => void): Promise<ScreenshotText> {
  const check = checkImageBytes(new Uint8Array(await file.slice(0, imageHeaderBytes).arrayBuffer()), file.size);
  if (!check.ok) {
    throw new ScreenshotError(check.reason);
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ScreenshotError("This image could not be read. Take a new screenshot and try again.");
  }
  let cleanup: (() => void) | null = null;
  try {
    if (bitmap.width * bitmap.height > maxImagePixels) {
      throw new ScreenshotError("This image is too large to read safely. Crop the screenshot to the message and try again.");
    }
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest < smallSide ? 2 : Math.min(1, maxOcrSide / longest);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      throw new ScreenshotError("This browser cannot read screenshots. Type or paste the text instead.");
    }
    context.drawImage(bitmap, 0, 0, width, height);
    const image = context.getImageData(0, 0, width, height);

    const { default: jsQR } = await import("jsqr");
    const qr = jsQR(image.data, width, height, { inversionAttempts: "attemptBoth" });
    const qrTexts = qr?.data ? [qr.data] : [];

    if (darkShare(image.data) > 0.5) {
      invert(image.data);
      context.putImageData(image, 0, 0);
    }

    const { createWorker, OEM } = await import("tesseract.js");
    const starting = createWorker("eng", OEM.LSTM_ONLY, {
      workerPath: `${ocrBase}/worker.min.js`,
      corePath: `${ocrBase}/core`,
      langPath: `${ocrBase}/lang`,
      workerBlobURL: false,
      cacheMethod: "none",
      gzip: true,
      logger: (message: { status: string; progress: number }) => {
        if (message.status === "recognizing text") {
          onProgress(message.progress);
        }
      },
    });
    cleanup = () => {
      void starting.then((worker) => worker.terminate()).catch(() => undefined);
    };
    const worker = await withTimeout(starting, readTimeoutMs);
    const result = await withTimeout(worker.recognize(canvas), readTimeoutMs);
    return { text: result.data.text, qrTexts };
  } finally {
    bitmap.close();
    cleanup?.();
  }
}
