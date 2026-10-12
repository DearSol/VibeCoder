export type Point = { x: number; y: number };
export type Bounds = { x: number; y: number; width: number; height: number };
export type SelectionMode = 'replace' | 'add' | 'subtract';
export type PixelImage = { width: number; height: number; data: Uint8ClampedArray };

export function selectionBounds(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
): Bounds | null {
  let left = width,
    top = height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }
  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

export function rectangleMask(
  width: number,
  height: number,
  a: Point,
  b: Point,
): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(width * height);
  // Marquee edges snap to the pixel grid. Browser pointer coordinates lose a few
  // fractional bits; floor/ceil would expand an exact selection after zooming.
  const left = Math.max(0, Math.min(width, Math.round(Math.min(a.x, b.x))));
  const top = Math.max(0, Math.min(height, Math.round(Math.min(a.y, b.y))));
  const right = Math.max(0, Math.min(width, Math.round(Math.max(a.x, b.x))));
  const bottom = Math.max(0, Math.min(height, Math.round(Math.max(a.y, b.y))));
  for (let y = top; y < bottom; y++) mask.fill(255, y * width + left, y * width + right);
  return mask;
}

export function ellipseMask(width: number, height: number, a: Point, b: Point): Uint8ClampedArray {
  const mask = rectangleMask(width, height, a, b);
  const left = Math.round(Math.min(a.x, b.x)),
    top = Math.round(Math.min(a.y, b.y));
  const rx = Math.abs(Math.round(b.x) - Math.round(a.x)) / 2;
  const ry = Math.abs(Math.round(b.y) - Math.round(a.y)) / 2;
  if (!rx || !ry) return new Uint8ClampedArray(mask.length);
  for (let y = Math.max(0, top); y < Math.min(height, top + ry * 2); y++)
    for (let x = Math.max(0, left); x < Math.min(width, left + rx * 2); x++)
      if (((x + 0.5 - left - rx) / rx) ** 2 + ((y + 0.5 - top - ry) / ry) ** 2 > 1)
        mask[y * width + x] = 0;
  return mask;
}

/** Scanline rasterization uses pixel centers and the even/odd fill rule. */
export function polygonMask(width: number, height: number, points: Point[]): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(width * height);
  if (points.length < 3) return mask;
  const top = Math.max(0, Math.floor(Math.min(...points.map((p) => p.y))));
  const bottom = Math.min(height, Math.ceil(Math.max(...points.map((p) => p.y))));
  for (let y = top; y < bottom; y++) {
    const intersections: number[] = [],
      scan = y + 0.5;
    for (let i = 0; i < points.length; i++) {
      const a = points[i],
        b = points[(i + 1) % points.length];
      if (a.y > scan !== b.y > scan)
        intersections.push(a.x + ((scan - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i + 1 < intersections.length; i += 2) {
      const left = Math.max(0, Math.ceil(intersections[i] - 0.5));
      const right = Math.min(width, Math.ceil(intersections[i + 1] - 0.5));
      if (right > left) mask.fill(255, y * width + left, y * width + right);
    }
  }
  return mask;
}

/** Snap a magnetic-lasso point to nearby color edges; flat areas keep the pointer location. */
export function snapToEdge(image: PixelImage, point: Point, radius = 10): Point {
  let best = point,
    bestScore = 28;
  const { width, height, data } = image;
  for (
    let y = Math.max(1, Math.round(point.y) - radius);
    y <= Math.min(height - 2, Math.round(point.y) + radius);
    y++
  )
    for (
      let x = Math.max(1, Math.round(point.x) - radius);
      x <= Math.min(width - 2, Math.round(point.x) + radius);
      x++
    ) {
      const distance = Math.hypot(x + 0.5 - point.x, y + 0.5 - point.y);
      if (distance > radius) continue;
      let gradient = 0;
      for (let channel = 0; channel < 3; channel++) {
        const i = (y * width + x) * 4 + channel;
        gradient += Math.hypot(
          data[i + 4] - data[i - 4],
          data[i + width * 4] - data[i - width * 4],
        );
      }
      const score = gradient / 3 - distance * 12;
      if (score > bestScore) {
        bestScore = score;
        best = { x: x + 0.5, y: y + 0.5 };
      }
    }
  return best;
}

export function combineMasks(
  base: Uint8ClampedArray,
  stroke: Uint8ClampedArray,
  mode: SelectionMode,
): Uint8ClampedArray {
  if (base.length !== stroke.length) throw new Error('Selection dimensions do not match.');
  if (mode === 'replace') return stroke.slice();
  const result = new Uint8ClampedArray(base.length);
  for (let i = 0; i < base.length; i++) {
    result[i] = mode === 'add' ? Math.max(base[i], stroke[i]) : Math.min(base[i], 255 - stroke[i]);
  }
  return result;
}

/** Paint a continuous capsule, including the gaps between pointer events. */
export function paintMask(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  from: Point,
  to: Point,
  radius: number,
): void {
  const left = Math.max(0, Math.floor(Math.min(from.x, to.x) - radius));
  const right = Math.min(width - 1, Math.ceil(Math.max(from.x, to.x) + radius));
  const top = Math.max(0, Math.floor(Math.min(from.y, to.y) - radius));
  const bottom = Math.min(height - 1, Math.ceil(Math.max(from.y, to.y) + radius));
  const dx = to.x - from.x,
    dy = to.y - from.y;
  const length = dx * dx + dy * dy;
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const px = x + 0.5,
        py = y + 0.5;
      const t = length
        ? Math.max(0, Math.min(1, ((px - from.x) * dx + (py - from.y) * dy) / length))
        : 0;
      if ((px - from.x - t * dx) ** 2 + (py - from.y - t * dy) ** 2 <= radius ** 2)
        mask[y * width + x] = 255;
    }
  }
}

/** Distance-based inward feathering never expands the approved mask. */
export function featherMask(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): Uint8ClampedArray {
  if (radius <= 0) return mask;
  const distances = new Float32Array(mask.length);
  const diagonal = Math.SQRT2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      distances[i] = Math.min(
        x ? distances[i - 1] + 1 : 1,
        y ? distances[i - width] + 1 : 1,
        x && y ? distances[i - width - 1] + diagonal : 1,
        y && x < width - 1 ? distances[i - width + 1] + diagonal : 1,
      );
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (!mask[i]) continue;
      distances[i] = Math.min(
        distances[i],
        x < width - 1 ? distances[i + 1] + 1 : 1,
        y < height - 1 ? distances[i + width] + 1 : 1,
        x < width - 1 && y < height - 1 ? distances[i + width + 1] + diagonal : 1,
        x && y < height - 1 ? distances[i + width - 1] + diagonal : 1,
      );
    }
  }
  const result = new Uint8ClampedArray(mask.length);
  for (let i = 0; i < mask.length; i++)
    result[i] = Math.round(mask[i] * Math.min(1, distances[i] / (radius + 1)));
  return result;
}

/** Sample visible source pixels, storing only the selected destination bounds. */
export function createPatch(
  source: PixelImage,
  mask: Uint8ClampedArray,
  dx: number,
  dy: number,
): (PixelImage & { x: number; y: number }) | null {
  const { width, height } = source;
  if (mask.length !== width * height || source.data.length !== width * height * 4)
    throw new Error('Image and mask dimensions do not match.');
  const bounds = selectionBounds(mask, width, height);
  if (!bounds) return null;
  dx = Math.round(dx);
  dy = Math.round(dy);
  if (
    bounds.x + dx < 0 ||
    bounds.y + dy < 0 ||
    bounds.x + bounds.width + dx > width ||
    bounds.y + bounds.height + dy > height
  ) {
    throw new Error('The sample area must stay inside the image.');
  }
  const data = new Uint8ClampedArray(bounds.width * bounds.height * 4);
  for (let y = 0; y < bounds.height; y++) {
    for (let x = 0; x < bounds.width; x++) {
      const targetX = bounds.x + x,
        targetY = bounds.y + y;
      const coverage = mask[targetY * width + targetX];
      if (!coverage) continue;
      const src = ((targetY + dy) * width + targetX + dx) * 4;
      const dest = (y * bounds.width + x) * 4;
      data[dest] = source.data[src];
      data[dest + 1] = source.data[src + 1];
      data[dest + 2] = source.data[src + 2];
      data[dest + 3] = Math.round((source.data[src + 3] * coverage) / 255);
    }
  }
  return { ...bounds, data };
}
