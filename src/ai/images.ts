import { canvas, context, decodeImage, type EditorDocument } from '../model/document';
import { selectionBounds, type Bounds } from '../model/pixels';

export const AI_SIZE = 1024;
export function contextBounds(width: number, height: number, selection: Bounds): Bounds {
  const side = Math.min(
    Math.max(width, height),
    Math.max(256, Math.max(selection.width, selection.height) * 2),
  );
  const x = Math.min(
    Math.max(0, Math.floor(selection.x + selection.width / 2 - side / 2)),
    Math.max(0, width - side),
  );
  const y = Math.min(
    Math.max(0, Math.floor(selection.y + selection.height / 2 - side / 2)),
    Math.max(0, height - side),
  );
  return { x, y, width: side, height: side };
}
export function prepareEdit(doc: EditorDocument, visible: HTMLCanvasElement) {
  const selected = selectionBounds(doc.selection, doc.width, doc.height);
  if (!selected) throw new Error('Select the area you want to edit first.');
  const region = contextBounds(doc.width, doc.height, selected);
  const image = canvas(AI_SIZE, AI_SIZE),
    ctx = context(image);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, AI_SIZE, AI_SIZE);
  ctx.drawImage(visible, region.x, region.y, region.width, region.height, 0, 0, AI_SIZE, AI_SIZE);
  const nativeMask = canvas(doc.width, doc.height);
  const pixels = context(nativeMask).createImageData(doc.width, doc.height);
  for (let i = 0; i < doc.selection.length; i++) {
    pixels.data[i * 4] = pixels.data[i * 4 + 1] = pixels.data[i * 4 + 2] = 255;
    pixels.data[i * 4 + 3] = doc.selection[i] ? 255 : 0;
  }
  context(nativeMask).putImageData(pixels, 0, 0);
  const guide = canvas(AI_SIZE, AI_SIZE),
    guideCtx = context(guide);
  guideCtx.fillStyle = '#000';
  guideCtx.fillRect(0, 0, AI_SIZE, AI_SIZE);
  guideCtx.imageSmoothingEnabled = false;
  guideCtx.drawImage(
    nativeMask,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    AI_SIZE,
    AI_SIZE,
  );
  const mask = canvas(AI_SIZE, AI_SIZE),
    maskCtx = context(mask);
  const data = guideCtx.getImageData(0, 0, AI_SIZE, AI_SIZE);
  for (let i = 0; i < data.data.length; i += 4) data.data[i + 3] = data.data[i] ? 0 : 255;
  maskCtx.putImageData(data, 0, 0);
  return {
    region,
    image: image.toDataURL('image/png'),
    mask: mask.toDataURL('image/png'),
    guide: guide.toDataURL('image/png'),
  };
}
export async function loadResult(dataUrl: string, region: Bounds, doc: EditorDocument) {
  const image = await decodeImage(await (await fetch(dataUrl)).blob());
  if (Math.abs(image.width / image.height - 1) > 0.01)
    throw new Error(
      'The model returned a different aspect ratio. The result was not applied because its placement would be unreliable.',
    );
  const result = canvas(doc.width, doc.height);
  context(result).drawImage(image, region.x, region.y, region.width, region.height);
  return context(result).getImageData(0, 0, doc.width, doc.height);
}
export async function referenceImage(file: File) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 20_000_000)
    throw new Error('Use PNG, JPEG, or WebP references smaller than 20 MB each.');
  const image = await decodeImage(file);
  const scale = Math.min(1, AI_SIZE / Math.max(image.width, image.height));
  const resized = canvas(
    Math.max(1, Math.round(image.width * scale)),
    Math.max(1, Math.round(image.height * scale)),
  );
  context(resized).drawImage(image, 0, 0, resized.width, resized.height);
  return { name: file.name.slice(0, 200), image: resized.toDataURL('image/png') };
}
