import { describe, expect, it } from 'vitest';
import {
  autoGroundMargin,
  autoPixelsPerUnit,
  directionList,
  flipHorizontal,
  frameFit,
  type RgbaImage,
} from '../src/index.ts';

/** Corners of a box resting on the ground. */
function boxCorners(w: number, h: number, d: number): Float64Array {
  const out: number[] = [];
  for (const x of [-w / 2, w / 2]) for (const y of [0, h]) for (const z of [-d / 2, d / 2]) out.push(x, y, z);
  return Float64Array.from(out);
}
const DIRECTIONS = directionList('d8');
const YAWS = DIRECTIONS.map((d) => d.yaw);
const dimetric = { pitch: 30, yawOffset: 45 };

describe('direction sets', () => {
  it('spaces counted directions evenly from a start yaw and names them by angle', () => {
    expect(directionList({ count: 6 })).toEqual([0, 60, 120, 180, 240, 300].map((yaw) => ({ name: `a${yaw}`, yaw })));
    expect(directionList({ count: 2, start: 90 }).map((d) => d.name)).toEqual(['a90', 'a270']);
  });

  it('keeps compass sets in their documented order', () => {
    expect(DIRECTIONS.map((d) => `${d.name}:${d.yaw}`)).toEqual([
      's:0',
      'sw:45',
      'w:90',
      'nw:135',
      'n:180',
      'ne:225',
      'e:270',
      'se:315',
    ]);
  });
});

describe('ground margin and frame fit', () => {
  it.each([16, 24, 32, 48, 64, 128])(
    'keeps a %d px frame grounded exactly at the pivot row for scales 8 to 64',
    (size) => {
      const corners = boxCorners(1, 1, 1);
      for (const ppu of [8, 16, 24, 32, 48, 64]) {
        const frame = { width: size, height: size };
        const margin = autoGroundMargin(corners, YAWS, { frame, supersample: 4, pixelsPerUnit: ppu, camera: dimetric });
        expect(Number.isInteger(margin)).toBe(true);
        for (const fit of frameFit(corners, DIRECTIONS, {
          frame,
          supersample: 4,
          pixelsPerUnit: ppu,
          camera: { ...dimetric, groundMargin: margin },
        })) {
          // The lowest corner is at least one pixel above the bottom edge, and below the pivot line.
          expect(fit.maxY, `${size}px at ${ppu} ppu`).toBeLessThanOrEqual(size - 1 + 1e-9);
          expect(fit.maxY).toBeGreaterThan(size - margin);
          expect(fit.minX + fit.maxX).toBeCloseTo(size, 6);
        }
      }
    },
  );

  it('fits pixelsPerUnit to the largest whole value that keeps the model inside the frame', () => {
    const corners = boxCorners(1, 1, 1);
    const scene = {
      frame: { width: 32, height: 32 },
      supersample: 4,
      camera: { ...dimetric, groundMargin: 'auto' as const },
    };
    const ppu = autoPixelsPerUnit(corners, YAWS, scene);
    const inside = (p: number) => {
      const margin = autoGroundMargin(corners, YAWS, { ...scene, pixelsPerUnit: p, camera: dimetric });
      return frameFit(corners, DIRECTIONS, {
        ...scene,
        pixelsPerUnit: p,
        camera: { ...dimetric, groundMargin: margin },
      }).every((f) => f.minX >= 1 - 1e-9 && f.maxX <= 31 + 1e-9 && f.minY >= 1 - 1e-9 && f.maxY <= 31 + 1e-9);
    };
    expect(ppu).toBeGreaterThan(10);
    expect(inside(ppu)).toBe(true);
    expect(inside(ppu + 1)).toBe(false);
  });

  it('reserves room for an outside outline', () => {
    const corners = boxCorners(1, 1, 1);
    const scene = { frame: { width: 32, height: 32 }, supersample: 4, pixelsPerUnit: 12, camera: dimetric };
    expect(autoGroundMargin(corners, YAWS, scene, 1)).toBe(autoGroundMargin(corners, YAWS, scene) + 1);
    const fit = {
      frame: { width: 32, height: 32 },
      supersample: 4,
      camera: { ...dimetric, groundMargin: 'auto' as const },
    };
    const padded = autoPixelsPerUnit(corners, YAWS, fit, 1);
    expect(padded).toBeLessThan(autoPixelsPerUnit(corners, YAWS, fit));
    // With the pad, the model and a one-pixel ring around it still stay a pixel clear of every edge.
    const margin = autoGroundMargin(corners, YAWS, { ...fit, pixelsPerUnit: padded, camera: dimetric }, 1);
    for (const f of frameFit(corners, DIRECTIONS, {
      ...fit,
      pixelsPerUnit: padded,
      camera: { ...dimetric, groundMargin: margin },
    })) {
      expect(f.minX - 1).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(f.maxX + 1).toBeLessThanOrEqual(31 + 1e-9);
      expect(f.minY - 1).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(f.maxY + 1).toBeLessThanOrEqual(31 + 1e-9);
    }
  });

  it('respects a fixed ground margin when fitting, and never goes below 1', () => {
    const corners = boxCorners(1, 1, 1);
    const fixed = autoPixelsPerUnit(corners, YAWS, {
      frame: { width: 32, height: 32 },
      supersample: 4,
      camera: { ...dimetric, groundMargin: 2 },
    });
    expect(fixed).toBeLessThan(19);
    expect(
      autoPixelsPerUnit(boxCorners(100, 100, 100), YAWS, {
        frame: { width: 8, height: 8 },
        supersample: 4,
        camera: { ...dimetric, groundMargin: 'auto' },
      }),
    ).toBe(1);
  });
});

describe('flipHorizontal', () => {
  it('mirrors rows left to right', () => {
    const img: RgbaImage = { width: 3, height: 1, rgba: Uint8Array.from([1, 1, 1, 255, 2, 2, 2, 255, 3, 3, 3, 0]) };
    expect(Array.from(flipHorizontal(img).rgba)).toEqual([3, 3, 3, 0, 2, 2, 2, 255, 1, 1, 1, 255]);
    expect(flipHorizontal(flipHorizontal(img)).rgba).toEqual(img.rgba);
  });
});
