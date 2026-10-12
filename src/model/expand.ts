import { assertDimensions, canvas, context, type EditorDocument } from './document';

export type Margins = { left: number; right: number; top: number; bottom: number };
export const emptyMargins: Margins = { left: 0, right: 0, top: 0, bottom: 0 };
export function expansionGeometry(width: number, height: number, margins: Margins) {
  if (Object.values(margins).some((value) => !Number.isInteger(value) || value < 0))
    throw new Error('Expansion margins must be whole, nonnegative pixels.');
  const next = {
    width: width + margins.left + margins.right,
    height: height + margins.top + margins.bottom,
  };
  assertDimensions(next.width, next.height);
  return next;
}
export function expansionDocument(doc: EditorDocument, margins: Margins): EditorDocument {
  const { width, height } = expansionGeometry(doc.width, doc.height, margins);
  const original = canvas(width, height);
  context(original).drawImage(doc.layers[0].canvas, margins.left, margins.top);
  const selection = new Uint8ClampedArray(width * height).fill(255);
  for (let y = margins.top; y < margins.top + doc.height; y++)
    selection.fill(0, y * width + margins.left, y * width + margins.left + doc.width);
  return {
    ...doc,
    width,
    height,
    selection,
    layers: doc.layers.map((layer, index) =>
      index === 0
        ? { ...layer, canvas: original, x: 0, y: 0 }
        : { ...layer, x: layer.x + margins.left, y: layer.y + margins.top },
    ),
  };
}
