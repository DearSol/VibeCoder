import { zip, unzip, strToU8, strFromU8, type Zippable } from 'fflate';
import {
  assertDimensions,
  canvas,
  context,
  decodeImage,
  maskToCanvas,
  MAX_LAYER_PIXELS,
  MAX_LAYERS,
  toPng,
  type EditorDocument,
  type Layer,
} from '../model/document';

const MAX_ARCHIVE_BYTES = 180_000_000;
type Manifest = {
  format: 'expand-studio';
  version: 1;
  id: string;
  name: string;
  width: number;
  height: number;
  source: { name: string; mime: string; asset: string };
  selection: string;
  layers: {
    id: string;
    name: string;
    kind: Layer['kind'];
    asset: string;
    x: number;
    y: number;
    visible: boolean;
    opacity: number;
  }[];
};

export async function saveProject(doc: EditorDocument): Promise<Uint8Array> {
  const files: Zippable = {};
  const manifest: Manifest = {
    format: 'expand-studio',
    version: 1,
    id: doc.id,
    name: doc.name,
    width: doc.width,
    height: doc.height,
    source: { name: doc.source.name, mime: doc.source.mime, asset: 'assets/source' },
    selection: 'assets/selection.png',
    layers: [],
  };
  files['assets/source'] = [doc.source.bytes, { level: 0 }];
  for (const [index, layer] of doc.layers.entries()) {
    const asset = `assets/layer-${index}.png`;
    files[asset] = [new Uint8Array(await (await toPng(layer.canvas)).arrayBuffer()), { level: 0 }];
    manifest.layers.push({
      id: layer.id,
      name: layer.name,
      kind: layer.kind,
      asset,
      x: layer.x,
      y: layer.y,
      visible: layer.visible,
      opacity: layer.opacity,
    });
  }
  files[manifest.selection] = [
    new Uint8Array(
      await (
        await toPng(maskToCanvas(doc.selection, doc.width, doc.height, [255, 255, 255]))
      ).arrayBuffer(),
    ),
    { level: 0 },
  ];
  files['manifest.json'] = strToU8(JSON.stringify(manifest));
  return new Promise((resolve, reject) =>
    zip(files, { level: 1 }, (error, data) => (error ? reject(error) : resolve(data))),
  );
}

function validateManifest(value: unknown): Manifest {
  if (!value || typeof value !== 'object') throw new Error('This is not an Expand Studio project.');
  const m = value as Manifest;
  if (m.format !== 'expand-studio') throw new Error('This is not an Expand Studio project.');
  if (m.version !== 1)
    throw new Error(
      'This project uses a different format version. Open it in a compatible version of Expand Studio.',
    );
  assertDimensions(m.width, m.height);
  if (
    typeof m.id !== 'string' ||
    typeof m.name !== 'string' ||
    !m.source ||
    typeof m.source.name !== 'string' ||
    typeof m.source.mime !== 'string' ||
    m.source.asset !== 'assets/source' ||
    m.selection !== 'assets/selection.png'
  )
    throw new Error('Project metadata is incomplete.');
  if (!Array.isArray(m.layers) || !m.layers.length || m.layers.length > MAX_LAYERS)
    throw new Error('The project has an unsupported layer count.');
  const ids = new Set<string>();
  for (const [index, layer] of m.layers.entries()) {
    if (
      !layer ||
      typeof layer.id !== 'string' ||
      ids.has(layer.id) ||
      typeof layer.name !== 'string' ||
      layer.asset !== `assets/layer-${index}.png` ||
      !['original', 'patch'].includes(layer.kind) ||
      typeof layer.visible !== 'boolean' ||
      !Number.isFinite(layer.opacity) ||
      layer.opacity < 0 ||
      layer.opacity > 1 ||
      !Number.isInteger(layer.x) ||
      !Number.isInteger(layer.y) ||
      layer.x < 0 ||
      layer.y < 0 ||
      layer.x >= m.width ||
      layer.y >= m.height
    )
      throw new Error('The project contains invalid layer metadata.');
    if ((index === 0) !== (layer.kind === 'original'))
      throw new Error(
        'The project must contain one original image at the bottom of the layer stack.',
      );
    ids.add(layer.id);
  }
  return m;
}

export async function loadProject(file: File): Promise<EditorDocument> {
  if (file.size > MAX_ARCHIVE_BYTES)
    throw new Error('This project is too large for this version (180 MB maximum).');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let total = 0,
    entries = 0;
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(
      bytes,
      {
        filter: (entry) => {
          total += entry.originalSize;
          entries++;
          if (total > MAX_ARCHIVE_BYTES || entry.originalSize > 70_000_000 || entries > 40)
            throw new Error('This project exceeds the supported archive limits.');
          return true;
        },
      },
      (error, data) =>
        error ? reject(new Error('The project archive is damaged or unsupported.')) : resolve(data),
    );
  });
  if (!files['manifest.json'] || files['manifest.json'].length > 1_000_000)
    throw new Error('The project manifest is missing or invalid.');
  let manifest: Manifest;
  try {
    manifest = validateManifest(JSON.parse(strFromU8(files['manifest.json'])));
  } catch (error) {
    throw error instanceof SyntaxError ? new Error('The project manifest is damaged.') : error;
  }
  const read = (path: string) => {
    if (!files[path]) throw new Error(`The project is missing ${path}.`);
    return files[path];
  };
  const layers: Layer[] = [];
  let layerPixels = 0;
  for (const entry of manifest.layers) {
    const surface = await decodeImage(
      new Blob([new Uint8Array(read(entry.asset))], { type: 'image/png' }),
    );
    layerPixels += surface.width * surface.height;
    if (
      layerPixels > MAX_LAYER_PIXELS ||
      entry.x + surface.width > manifest.width ||
      entry.y + surface.height > manifest.height
    )
      throw new Error('The project layers exceed the document or memory limits.');
    if (
      entry.kind === 'original' &&
      (entry.x !== 0 ||
        entry.y !== 0 ||
        surface.width !== manifest.width ||
        surface.height !== manifest.height)
    )
      throw new Error('The original image does not match the document dimensions.');
    layers.push({ ...entry, canvas: surface });
  }
  const selectionImage = await decodeImage(
    new Blob([new Uint8Array(read(manifest.selection))], { type: 'image/png' }),
  );
  if (selectionImage.width !== manifest.width || selectionImage.height !== manifest.height)
    throw new Error('The selection dimensions do not match this project.');
  const rgba = context(selectionImage).getImageData(0, 0, manifest.width, manifest.height).data;
  const selection = new Uint8ClampedArray(manifest.width * manifest.height);
  for (let i = 0; i < selection.length; i++) selection[i] = rgba[i * 4 + 3];
  return {
    id: manifest.id,
    revision: crypto.randomUUID(),
    name: manifest.name,
    width: manifest.width,
    height: manifest.height,
    layers,
    selection,
    source: {
      name: manifest.source.name,
      mime: manifest.source.mime,
      bytes: read(manifest.source.asset),
    },
  };
}

export async function createDemo(): Promise<File> {
  const svg = await (await fetch('/demo.svg')).text();
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const surface = canvas(1600, 1100);
    context(surface).drawImage(image, 0, 0, surface.width, surface.height);
    return new File([await toPng(surface)], 'Dune study.png', { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(url);
  }
}
