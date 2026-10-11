import { selectionBounds, type PixelImage } from './pixels';

export const MAX_POISSON_AREA = 262_144;
export type PoissonResult = PixelImage & {
  x: number;
  y: number;
  iterations: number;
  residual: number;
};

/**
 * Source-gradient Poisson cloning with fixed destination boundary conditions.
 * Red/black SOR solves each color channel. Alpha is supplied by the approved mask;
 * compositing this sparse layer cannot modify pixels outside that mask.
 */
export function poissonBlend(
  image: PixelImage,
  mask: Uint8ClampedArray,
  dx: number,
  dy: number,
  options: {
    source?: PixelImage;
    maxIterations?: number;
    tolerance?: number;
    progress?: (iteration: number, max: number) => void;
  } = {},
): PoissonResult {
  const { width, height, data } = image;
  const source = options.source ?? image;
  const sw = source.width,
    sh = source.height,
    sd = source.data;
  if (
    !Number.isInteger(sw) ||
    !Number.isInteger(sh) ||
    sw < 1 ||
    sh < 1 ||
    sd.length !== sw * sh * 4
  )
    throw new Error('The source image dimensions are invalid.');
  if (mask.length !== width * height || data.length !== width * height * 4)
    throw new Error('Image and mask dimensions do not match.');
  const bounds = selectionBounds(mask, width, height);
  if (!bounds) throw new Error('Select an area before blending.');
  if (bounds.width * bounds.height > MAX_POISSON_AREA)
    throw new Error(
      'For Poisson blending, keep the selection bounds within 262,144 pixels (for example, 512 × 512). Use a smaller repair or Feather for larger areas.',
    );
  dx = Math.round(dx);
  dy = Math.round(dy);
  if (
    bounds.x + dx < 0 ||
    bounds.y + dy < 0 ||
    bounds.x + bounds.width + dx > sw ||
    bounds.y + bounds.height + dy > sh
  )
    throw new Error('Keep the sample inside the image.');
  const index = new Int32Array(bounds.width * bounds.height).fill(-1);
  const points: number[] = [],
    red: number[] = [],
    black: number[] = [];
  for (let y = 0; y < bounds.height; y++)
    for (let x = 0; x < bounds.width; x++) {
      const p = (bounds.y + y) * width + bounds.x + x;
      if (!mask[p]) continue;
      const i = points.length;
      index[y * bounds.width + x] = i;
      points.push(p);
      ((x + y) % 2 ? black : red).push(i);
    }
  const values = new Float64Array(points.length * 3),
    rhs = new Float64Array(points.length * 3);
  const neighbors = new Int32Array(points.length * 4).fill(-1),
    degree = new Uint8Array(points.length);
  let boundaryFound = false;
  const directions = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  for (let i = 0; i < points.length; i++) {
    const p = points[i],
      x = p % width,
      y = Math.floor(p / width),
      sp = ((y + dy) * sw + x + dx) * 4;
    if (data[p * 4 + 3] !== 255 || sd[sp + 3] !== 255)
      throw new Error(
        'Poisson blending currently needs opaque image areas. Use Feather for transparent content.',
      );
    for (let c = 0; c < 3; c++) values[i * 3 + c] = data[p * 4 + c];
    for (let d = 0; d < 4; d++) {
      const [ox, oy] = directions[d],
        nx = x + ox,
        ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      degree[i]++;
      const np = ny * width + nx;
      const lx = nx - bounds.x,
        ly = ny - bounds.y;
      const ni =
        lx >= 0 && ly >= 0 && lx < bounds.width && ly < bounds.height
          ? index[ly * bounds.width + lx]
          : -1;
      neighbors[i * 4 + d] = ni;
      if (ni < 0) {
        boundaryFound = true;
        if (data[np * 4 + 3] !== 255)
          throw new Error(
            'Poisson blending needs an opaque boundary. Use Feather for transparent content.',
          );
      }
      const sx = nx + dx,
        sy = ny + dy;
      const sourceNeighbor = sx >= 0 && sy >= 0 && sx < sw && sy < sh ? (sy * sw + sx) * 4 : sp;
      if (sd[sourceNeighbor + 3] !== 255)
        throw new Error(
          'Poisson blending needs an opaque sample boundary. Use Feather for transparent content.',
        );
      for (let c = 0; c < 3; c++)
        rhs[i * 3 + c] += sd[sp + c] - sd[sourceNeighbor + c] + (ni < 0 ? data[np * 4 + c] : 0);
    }
  }
  if (!boundaryFound)
    throw new Error(
      'Leave some unselected image around the repair so Poisson blending has a boundary to match.',
    );
  const max = options.maxIterations ?? 2500,
    tolerance = options.tolerance ?? 0.12;
  let residual = Infinity,
    iterations = 0;
  for (; iterations < max; iterations++) {
    for (const group of [red, black])
      for (const i of group) {
        for (let c = 0; c < 3; c++) {
          let sum = rhs[i * 3 + c];
          for (let d = 0; d < 4; d++) {
            const n = neighbors[i * 4 + d];
            if (n >= 0) sum += values[n * 3 + c];
          }
          values[i * 3 + c] += 1.8 * (sum / degree[i] - values[i * 3 + c]);
        }
      }
    if (iterations % 20 === 0 || iterations === max - 1) {
      residual = 0;
      for (let i = 0; i < points.length; i++)
        for (let c = 0; c < 3; c++) {
          let sum = rhs[i * 3 + c];
          for (let d = 0; d < 4; d++) {
            const n = neighbors[i * 4 + d];
            if (n >= 0) sum += values[n * 3 + c];
          }
          residual = Math.max(residual, Math.abs(degree[i] * values[i * 3 + c] - sum));
        }
      options.progress?.(iterations + 1, max);
      if (residual <= tolerance) {
        iterations++;
        break;
      }
    }
  }
  if (residual > tolerance)
    throw new Error('Poisson blending did not converge. Try a smaller repair or Feather blending.');
  const output = new Uint8ClampedArray(bounds.width * bounds.height * 4);
  for (let i = 0; i < points.length; i++) {
    const p = points[i],
      local = ((Math.floor(p / width) - bounds.y) * bounds.width + (p % width) - bounds.x) * 4;
    for (let c = 0; c < 3; c++) output[local + c] = Math.round(values[i * 3 + c]);
    output[local + 3] = mask[p];
  }
  return { ...bounds, data: output, iterations, residual };
}
