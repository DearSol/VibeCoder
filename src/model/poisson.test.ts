import { describe, expect, it } from 'vitest';
import { poissonBlend } from './poisson';
import { rectangleMask, type PixelImage } from './pixels';

function solid(width: number, height: number, value: number): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([value, value, value, 255], i * 4);
  return { width, height, data };
}
describe('Poisson seam blending', () => {
  it('accepts a separate source image for future generated-content blending', () => {
    const destination = solid(12, 12, 70),
      source = solid(8, 8, 150);
    source.data.set([210, 210, 210, 255], (4 * 8 + 4) * 4);
    const mask = rectangleMask(12, 12, { x: 4, y: 4 }, { x: 8, y: 8 });
    const result = poissonBlend(destination, mask, -2, -2, { source });
    const center = ((6 - result.y) * result.width + 6 - result.x) * 4;
    expect(result.data[center]).toBeCloseTo(130, 0);
  });
  it('matches a constant destination boundary despite different source brightness', () => {
    const image = solid(30, 14, 70);
    for (let y = 0; y < 14; y++)
      for (let x = 15; x < 30; x++) image.data.set([190, 180, 170, 255], (y * 30 + x) * 4);
    const mask = rectangleMask(30, 14, { x: 3, y: 3 }, { x: 11, y: 11 });
    const result = poissonBlend(image, mask, 15, 0);
    expect(result.residual).toBeLessThanOrEqual(0.12);
    for (let i = 0; i < result.data.length; i += 4)
      expect([...result.data.slice(i, i + 4)]).toEqual([70, 70, 70, 255]);
  });
  it('preserves a source texture feature while matching destination tones', () => {
    const image = solid(30, 14, 70);
    for (let y = 0; y < 14; y++)
      for (let x = 15; x < 30; x++) image.data.set([150, 150, 150, 255], (y * 30 + x) * 4);
    image.data.set([210, 210, 210, 255], (7 * 30 + 22) * 4);
    const mask = rectangleMask(30, 14, { x: 3, y: 3 }, { x: 11, y: 11 });
    const result = poissonBlend(image, mask, 15, 0);
    const center = ((7 - result.y) * result.width + 7 - result.x) * 4;
    expect(result.data[center]).toBeCloseTo(130, 0);
    expect(result.data[0]).toBeCloseTo(70, 0);
  });
  it('keeps holes protected and does not mutate the original pixels', () => {
    const image = solid(30, 14, 80),
      original = image.data.slice();
    const mask = rectangleMask(30, 14, { x: 3, y: 3 }, { x: 10, y: 10 });
    mask[6 * 30 + 6] = 0;
    mask[3 * 30 + 3] = 90;
    const result = poissonBlend(image, mask, 15, 0);
    expect(result.data[((6 - result.y) * result.width + 6 - result.x) * 4 + 3]).toBe(0);
    expect(result.data[3]).toBe(90);
    expect(image.data).toEqual(original);
  });
  it('rejects an unconstrained full-image solve and transparent boundaries', () => {
    const image = solid(6, 6, 80);
    expect(() => poissonBlend(image, new Uint8ClampedArray(36).fill(255), 0, 0)).toThrow(
      'boundary',
    );
    const mask = rectangleMask(6, 6, { x: 2, y: 2 }, { x: 4, y: 4 });
    image.data[(1 * 6 + 2) * 4 + 3] = 0;
    expect(() => poissonBlend(image, mask, 0, 0)).toThrow('opaque');
  });
  it('reports a failed solve rather than accepting an unconverged seam', () => {
    const image = solid(30, 14, 70);
    const mask = rectangleMask(30, 14, { x: 3, y: 3 }, { x: 10, y: 10 });
    expect(() => poissonBlend(image, mask, 15, 0, { maxIterations: 0 })).toThrow(
      'did not converge',
    );
  });
});
