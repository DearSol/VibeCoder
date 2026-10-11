import { describe, expect, it } from 'vitest';
import {
  combineMasks,
  createPatch,
  featherMask,
  paintMask,
  rectangleMask,
  selectionBounds,
} from './pixels';

describe('selection and patch invariants', () => {
  it('does not expand marquee edges due to zoomed pointer quantization', () => {
    const mask = rectangleMask(
      64,
      48,
      { x: 15.9999961853, y: 15.9999980927 },
      { x: 24.0000076294, y: 24.0000000001 },
    );
    expect(selectionBounds(mask, 64, 48)).toEqual({ x: 16, y: 16, width: 8, height: 8 });
    expect(mask.filter(Boolean)).toHaveLength(64);
  });
  it('clips reverse-drawn selections to document coordinates', () => {
    const mask = rectangleMask(8, 6, { x: 5, y: 4 }, { x: -3, y: 1 });
    expect(selectionBounds(mask, 8, 6)).toEqual({ x: 0, y: 1, width: 5, height: 3 });
    expect(mask.filter(Boolean)).toHaveLength(15);
  });
  it('subtracts protected holes that survive sampling and feathering', () => {
    const outer = rectangleMask(8, 8, { x: 1, y: 1 }, { x: 7, y: 7 });
    const hole = rectangleMask(8, 8, { x: 3, y: 3 }, { x: 5, y: 5 });
    const mask = combineMasks(outer, hole, 'subtract');
    const feathered = featherMask(mask, 8, 8, 2);
    const data = new Uint8ClampedArray(8 * 8 * 4).fill(255);
    const patch = createPatch({ width: 8, height: 8, data }, feathered, 0, 0)!;
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        if (!mask[y * 8 + x]) expect(feathered[y * 8 + x]).toBe(0);
      }
    expect(patch.data[((3 - patch.y) * patch.width + 3 - patch.x) * 4 + 3]).toBe(0);
    expect(feathered[1 * 8 + 1]).toBeGreaterThan(0);
    expect(feathered[1 * 8 + 1]).toBeLessThan(255);
  });
  it('paints continuously between distant brush events', () => {
    const mask = new Uint8ClampedArray(20 * 10);
    paintMask(mask, 20, 10, { x: 2, y: 5 }, { x: 18, y: 5 }, 2);
    for (let x = 2; x < 18; x++) expect(mask[5 * 20 + x]).toBe(255);
    expect(mask[0]).toBe(0);
  });
  it('samples the requested offset and preserves partial alpha', () => {
    const data = new Uint8ClampedArray(6 * 4 * 4);
    for (let i = 0; i < 24; i++) data.set([i, 80, 90, 128], i * 4);
    const mask = new Uint8ClampedArray(24);
    mask[7] = 128;
    const patch = createPatch({ width: 6, height: 4, data }, mask, 2, 1)!;
    expect(patch).toMatchObject({ x: 1, y: 1, width: 1, height: 1 });
    expect([...patch.data]).toEqual([15, 80, 90, 64]);
    expect(() => createPatch({ width: 6, height: 4, data }, mask, 10, 0)).toThrow('sample area');
  });
});
