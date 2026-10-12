import { describe, expect, it } from 'vitest';
import { ellipseMask, polygonMask, rectangleMask, snapToEdge } from './pixels';
import { expansionGeometry } from './expand';
describe('grouped selection tools and expansion geometry', () => {
  it('rasterizes a polygon on pixel centers and clips to the document', () => {
    const polygon = polygonMask(12, 10, [
      { x: -2, y: 2 },
      { x: 8, y: 2 },
      { x: 8, y: 6 },
      { x: -2, y: 6 },
    ]);
    expect(polygon).toEqual(rectangleMask(12, 10, { x: -2, y: 2 }, { x: 8, y: 6 }));
    const triangle = polygonMask(10, 10, [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 0, y: 8 },
    ]);
    expect(triangle[1 * 10 + 1]).toBe(255);
    expect(triangle[6 * 10 + 6]).toBe(0);
  });
  it('keeps ellipse corners unselected while retaining its center', () => {
    const ellipse = ellipseMask(12, 12, { x: 2, y: 2 }, { x: 10, y: 10 });
    expect(ellipse[2 * 12 + 2]).toBe(0);
    expect(ellipse[6 * 12 + 6]).toBe(255);
    expect(ellipse[1 * 12 + 6]).toBe(0);
  });
  it('snaps to a strong nearby color edge and leaves flat areas alone', () => {
    const data = new Uint8ClampedArray(30 * 20 * 4);
    for (let y = 0; y < 20; y++)
      for (let x = 0; x < 30; x++)
        data.set(x < 15 ? [0, 0, 0, 255] : [255, 255, 255, 255], (y * 30 + x) * 4);
    expect(snapToEdge({ width: 30, height: 20, data }, { x: 12, y: 10 }, 5).x).toBe(14.5);
    expect(snapToEdge({ width: 30, height: 20, data }, { x: 2, y: 10 }, 3)).toEqual({
      x: 2,
      y: 10,
    });
  });
  it('preserves exact original dimensions and validates proposed expansion limits', () => {
    expect(expansionGeometry(64, 48, { left: 12, right: 4, top: 8, bottom: 0 })).toEqual({
      width: 80,
      height: 56,
    });
    expect(() => expansionGeometry(64, 48, { left: -1, right: 0, top: 0, bottom: 0 })).toThrow(
      'nonnegative',
    );
    expect(() => expansionGeometry(8192, 48, { left: 1, right: 0, top: 0, bottom: 0 })).toThrow(
      '16 megapixels',
    );
  });
});
