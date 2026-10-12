import type { PixelImage } from './pixels';

export const MAX_PIXELS = 16_777_216;
export const MAX_SIDE = 8192;
export const MAX_LAYER_PIXELS = 67_108_864;
export const MAX_LAYERS = 32;

export type Layer = {
  id: string;
  name: string;
  kind: 'original' | 'patch' | 'generated';
  generation?: {
    provider: string;
    model: string;
    prompt: string;
    references: { name: string; image: string }[];
  };
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  visible: boolean;
  opacity: number;
};
export type EditorDocument = {
  id: string;
  revision: string;
  name: string;
  width: number;
  height: number;
  layers: Layer[];
  selection: Uint8ClampedArray;
  source: { name: string; mime: string; bytes: Uint8Array };
};
export type History = {
  past: EditorDocument[];
  present: EditorDocument | null;
  future: EditorDocument[];
};
export const emptyHistory: History = { past: [], present: null, future: [] };

export function commit(history: History, document: EditorDocument): History {
  return {
    past: history.present ? [...history.past, history.present].slice(-20) : [],
    present: { ...document, revision: crypto.randomUUID() },
    future: [],
  };
}
export function undo(history: History): History {
  if (!history.present || !history.past.length) return history;
  return {
    past: history.past.slice(0, -1),
    present: history.past.at(-1)!,
    future: [history.present, ...history.future],
  };
}
export function redo(history: History): History {
  if (!history.present || !history.future.length) return history;
  return {
    past: [...history.past, history.present],
    present: history.future[0],
    future: history.future.slice(1),
  };
}
export function canvas(width: number, height: number): HTMLCanvasElement {
  const result = document.createElement('canvas');
  result.width = width;
  result.height = height;
  return result;
}
export function context(surface: HTMLCanvasElement): CanvasRenderingContext2D {
  const result = surface.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
  if (!result) throw new Error('This device does not support the image canvas.');
  return result;
}
export function assertDimensions(width: number, height: number): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_SIDE ||
    height > MAX_SIDE ||
    width * height > MAX_PIXELS
  ) {
    throw new Error(
      'This version supports images up to 16 megapixels and 8,192 pixels per side. Resize this image before opening it.',
    );
  }
}
export async function decodeImage(blob: Blob): Promise<HTMLCanvasElement> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This image could not be decoded. Try a PNG, JPEG, or WebP file.');
  }
  try {
    assertDimensions(bitmap.width, bitmap.height);
    const result = canvas(bitmap.width, bitmap.height);
    context(result).drawImage(bitmap, 0, 0);
    return result;
  } finally {
    bitmap.close();
  }
}
export async function importImage(file: File): Promise<EditorDocument> {
  if (!/\.(png|jpe?g|webp)$/i.test(file.name))
    throw new Error('Open a PNG, JPEG, or WebP image, or an .expand project.');
  if (file.size > 64_000_000) throw new Error('Choose an image smaller than 64 MB.');
  const surface = await decodeImage(file);
  return {
    id: crypto.randomUUID(),
    revision: crypto.randomUUID(),
    name: file.name.replace(/\.[^.]+$/, ''),
    width: surface.width,
    height: surface.height,
    layers: [
      {
        id: crypto.randomUUID(),
        name: 'Original image',
        kind: 'original',
        canvas: surface,
        x: 0,
        y: 0,
        visible: true,
        opacity: 1,
      },
    ],
    selection: new Uint8ClampedArray(surface.width * surface.height),
    source: {
      name: file.name,
      mime: file.type || 'application/octet-stream',
      bytes: new Uint8Array(await file.arrayBuffer()),
    },
  };
}
export function composite(
  doc: EditorDocument,
  opacity?: { id: string; value: number },
): HTMLCanvasElement {
  const result = canvas(doc.width, doc.height),
    ctx = context(result);
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    ctx.globalAlpha = opacity?.id === layer.id ? opacity.value : layer.opacity;
    ctx.drawImage(layer.canvas, layer.x, layer.y);
  }
  ctx.globalAlpha = 1;
  return result;
}
export function pixelsToCanvas(image: PixelImage): HTMLCanvasElement {
  const result = canvas(image.width, image.height);
  context(result).putImageData(
    new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
    0,
    0,
  );
  return result;
}
export function maskToCanvas(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  color = [118, 220, 204],
): HTMLCanvasElement {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < mask.length; i++) {
    data[i * 4] = color[0];
    data[i * 4 + 1] = color[1];
    data[i * 4 + 2] = color[2];
    data[i * 4 + 3] = mask[i];
  }
  return pixelsToCanvas({ width, height, data });
}
export function toPng(surface: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    surface.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The image could not be encoded.'))),
      'image/png',
    ),
  );
}
export function assertLayerBudget(doc: EditorDocument, newPixels: number): void {
  if (
    doc.layers.length >= MAX_LAYERS ||
    doc.layers.reduce((sum, layer) => sum + layer.canvas.width * layer.canvas.height, newPixels) >
      MAX_LAYER_PIXELS
  ) {
    throw new Error(
      'This project has reached the layer memory limit. Export a copy or remove an edit before adding another.',
    );
  }
}
