import { PIXEL_PASSES } from '@td2d/schema';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  BASE_SETTINGS,
  bayerMatrix,
  bleedEdges,
  boxDownscale,
  cleanupOrphans,
  createImage,
  encodeIndexedPng,
  flipHorizontal,
  hexToRgb,
  isolatedPixels,
  mapToPalette,
  opaqueColours,
  outline,
  Palette,
  PIXEL_PASS_REGISTRY,
  packRgb,
  passOrder,
  passSignature,
  posterize,
  processFrame,
  processFrames,
  type RgbaImage,
  rgbToOklab,
  thresholdAlpha,
} from '../src/index.ts';

function image(width: number, height: number, pixels: [number, number, number, number][]): RgbaImage {
  return { width, height, rgba: Uint8Array.from(pixels.flat()) };
}
const px = (img: RgbaImage, x: number, y: number) =>
  Array.from(img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));
const alphaAt = (img: RgbaImage, x: number, y: number) => img.rgba[(y * img.width + x) * 4 + 3];
/** An image with an opaque rectangle of one colour. */
function rect(
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgb: [number, number, number] = [200, 80, 40],
): RgbaImage {
  const img = createImage(w, h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) img.rgba.set([...rgb, 255], (y * w + x) * 4);
  return img;
}
/** A smooth gradient sphere-like blob, many distinct colours. */
function gradient(w: number, h: number): RgbaImage {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x - w / 2) / (w / 2);
      const dy = (y - h / 2) / (h / 2);
      if (dx * dx + dy * dy > 0.9) continue;
      img.rgba.set([Math.round((x / w) * 255), Math.round((y / h) * 255), 128, 255], (y * w + x) * 4);
    }
  }
  return img;
}
const settings = (extra: Partial<typeof BASE_SETTINGS.pixel>) => ({ ...BASE_SETTINGS.pixel, ...extra });

describe('boxDownscale', () => {
  it('averages opaque blocks exactly', () => {
    const src = image(2, 2, [
      [0, 0, 0, 255],
      [255, 255, 255, 255],
      [100, 50, 0, 255],
      [0, 50, 100, 255],
    ]);
    expect(px(boxDownscale(src, 2), 0, 0)).toEqual([89, 89, 89, 255]);
  });

  it('ignores the colour of transparent pixels, so edges never darken', () => {
    const src = image(2, 2, [
      [200, 100, 50, 255],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    expect(px(boxDownscale(src, 2), 0, 0)).toEqual([200, 100, 50, 64]);
  });

  it('weights colours by alpha', () => {
    const wide = image(2, 2, [
      [255, 0, 0, 255],
      [0, 0, 255, 85],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    expect(px(boxDownscale(wide, 2), 0, 0)).toEqual([191, 0, 64, 85]);
  });

  it('keeps fully transparent blocks transparent black and rejects uneven sizes', () => {
    expect(px(boxDownscale(createImage(4, 4), 4), 0, 0)).toEqual([0, 0, 0, 0]);
    expect(() => boxDownscale(createImage(5, 4), 2)).toThrow(/cannot be divided/);
  });

  it('is a copy at factor 1', () => {
    const src = image(1, 1, [[1, 2, 3, 4]]);
    const out = boxDownscale(src, 1);
    expect(out.rgba).toEqual(src.rgba);
    expect(out.rgba).not.toBe(src.rgba);
  });
});

describe('thresholdAlpha', () => {
  it('makes alpha binary around the threshold and clears transparent colour', () => {
    const out = thresholdAlpha(
      image(3, 1, [
        [9, 9, 9, 127],
        [9, 9, 9, 128],
        [9, 9, 9, 255],
      ]),
      128,
    );
    expect([px(out, 0, 0), px(out, 1, 0), px(out, 2, 0)]).toEqual([
      [0, 0, 0, 0],
      [9, 9, 9, 255],
      [9, 9, 9, 255],
    ]);
  });
});

describe('bleedEdges', () => {
  it('copies the nearest opaque colour into transparent pixels without changing alpha', () => {
    const src = image(4, 1, [
      [10, 20, 30, 255],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [200, 0, 0, 255],
    ]);
    const out = bleedEdges(src);
    expect([px(out, 1, 0), px(out, 2, 0)]).toEqual([
      [10, 20, 30, 0],
      [200, 0, 0, 0],
    ]);
  });

  it('fills the whole image and leaves an empty image alone', () => {
    const src = createImage(5, 5);
    src.rgba.set([1, 2, 3, 255], (2 * 5 + 2) * 4);
    expect(px(bleedEdges(src), 0, 0)).toEqual([1, 2, 3, 0]);
    expect(bleedEdges(createImage(2, 2)).rgba.every((v) => v === 0)).toBe(true);
  });
});

describe('flipHorizontal and posterize', () => {
  it('mirrors columns', () => {
    const src = image(3, 1, [
      [1, 0, 0, 255],
      [2, 0, 0, 255],
      [3, 0, 0, 0],
    ]);
    expect([px(flipHorizontal(src), 0, 0), px(flipHorizontal(src), 2, 0)]).toEqual([
      [3, 0, 0, 0],
      [1, 0, 0, 255],
    ]);
  });

  it('quantises channels to evenly spaced levels and leaves transparent pixels alone', () => {
    const src = image(2, 1, [
      [100, 200, 30, 255],
      [100, 200, 30, 0],
    ]);
    const out = posterize(src, 3);
    expect(px(out, 0, 0)).toEqual([128, 255, 0, 255]);
    expect(px(out, 1, 0)).toEqual([100, 200, 30, 0]);
    expect(opaqueColours(posterize(gradient(32, 32), 2)).length).toBeLessThanOrEqual(8);
  });
});

describe('Oklab and Palette', () => {
  it('converts sRGB white and black to the Oklab reference values', () => {
    const white = rgbToOklab(255, 255, 255);
    expect(white[0]).toBeCloseTo(1, 3);
    expect(Math.abs(white[1])).toBeLessThan(1e-3);
    expect(Math.abs(white[2])).toBeLessThan(1e-3);
    expect(rgbToOklab(0, 0, 0)[0]).toBeCloseTo(0, 6);
    // Reference value for pure red from the Oklab definition.
    const red = rgbToOklab(255, 0, 0);
    expect(red[0]).toBeCloseTo(0.628, 2);
    expect(red[1]).toBeCloseTo(0.225, 2);
    expect(red[2]).toBeCloseTo(0.126, 2);
  });

  it('finds the perceptually nearest colour, not the nearest in RGB', () => {
    const palette = Palette.fromHex(['#000000', '#ffffff', '#ff0000', '#0000ff']);
    expect(palette.toHex()[palette.nearestIndex(250, 20, 20)]).toBe('#ff0000');
    expect(palette.toHex()[palette.nearestIndex(30, 30, 30)]).toBe('#000000');
    // Mid grey 119 is perceptually closer to white than to black in Oklab lightness terms? It is closer to black in RGB.
    const grey = Palette.fromHex(['#000000', '#ffffff']);
    expect(grey.nearest(119, 119, 119)).toBe(0xffffff);
    expect(grey.nearest(80, 80, 80)).toBe(0x000000);
  });

  it('removes duplicate colours and rejects an empty palette', () => {
    expect(Palette.fromHex(['#ABCDEF', '#abcdef']).colors).toEqual([0xabcdef]);
    expect(() => Palette.fromHex([])).toThrow(/at least one colour/);
  });

  it('builds an automatic palette of at most n colours, deterministically, sorted dark to light', () => {
    const img = gradient(48, 48);
    expect(opaqueColours(img).length).toBeGreaterThan(100);
    const a = Palette.fromImages([img], 16);
    const b = Palette.fromImages([img], 16);
    expect(a.colors.length).toBeLessThanOrEqual(16);
    expect(a.colors.length).toBeGreaterThan(8);
    expect(a.colors).toEqual(b.colors);
    const lightness = a.colors.map((c) => rgbToOklab((c >> 16) & 255, (c >> 8) & 255, c & 255)[0]);
    expect(lightness).toEqual([...lightness].sort((x, y) => x - y));
  });

  it('keeps the exact colours when there are already few enough', () => {
    const img = rect(4, 4, 0, 0, 2, 4, [10, 20, 30]);
    img.rgba.set([200, 100, 0, 255], (0 * 4 + 3) * 4);
    expect(Palette.fromImages([img], 16).toHex()).toEqual(['#0a141e', '#c86400']);
    expect(Palette.fromImages([createImage(2, 2)], 4).colors).toEqual([0]);
  });
});

describe('mapToPalette and dithering', () => {
  const palette = Palette.fromHex(['#000000', '#555555', '#aaaaaa', '#ffffff']);

  it('snaps every opaque pixel into the palette and leaves transparent pixels alone', () => {
    const src = gradient(24, 24);
    const out = mapToPalette(src, palette, 'none', 0.5);
    expect(opaqueColours(out).every((c) => palette.toHex().includes(c))).toBe(true);
    for (let i = 3; i < src.rgba.length; i += 4) expect(out.rgba[i]).toBe(src.rgba[i]);
  });

  it('builds normalised Bayer matrices with every threshold once', () => {
    for (const n of [2, 4, 8] as const) {
      const m = bayerMatrix(n);
      const flat = m.flat().sort((a, b) => a - b);
      expect(flat).toEqual(Array.from({ length: n * n }, (_, i) => (i + 0.5) / (n * n)));
    }
    expect(bayerMatrix(2)).toEqual([
      [0.125, 0.625],
      [0.875, 0.375],
    ]);
  });

  it('dithers a flat in-between colour into a fixed pattern of two palette colours', () => {
    const flat = rect(8, 8, 0, 0, 8, 8, [128, 128, 128]);
    const plain = mapToPalette(flat, palette, 'none', 1);
    expect(opaqueColours(plain)).toHaveLength(1);
    const dithered = mapToPalette(flat, palette, 'bayer-4', 1);
    expect(opaqueColours(dithered).sort()).toEqual(['#555555', '#aaaaaa']);
    // The pattern repeats every 4 pixels and is the same on every run.
    for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) expect(px(dithered, x, y)).toEqual(px(dithered, x + 4, y));
    expect(mapToPalette(flat, palette, 'bayer-4', 1).rgba).toEqual(dithered.rgba);
  });

  it('does not crawl: a pixel keeps its colour when other pixels change', () => {
    const a = rect(8, 8, 0, 0, 8, 8, [128, 128, 128]);
    const b = rect(8, 8, 0, 0, 8, 8, [128, 128, 128]);
    b.rgba.set([0, 0, 0, 0], 0);
    const da = mapToPalette(a, palette, 'bayer-8', 0.7);
    const db = mapToPalette(b, palette, 'bayer-8', 0.7);
    for (let p = 1; p < 64; p++)
      expect(Array.from(db.rgba.subarray(p * 4, p * 4 + 4))).toEqual(Array.from(da.rgba.subarray(p * 4, p * 4 + 4)));
  });

  it('uses no dithering at strength 0', () => {
    const flat = rect(8, 8, 0, 0, 8, 8, [128, 128, 128]);
    expect(mapToPalette(flat, palette, 'bayer-4', 0).rgba).toEqual(mapToPalette(flat, palette, 'none', 0).rgba);
  });
});

describe('outline', () => {
  const black = 0x1a1c2c;
  it('draws an exact one-pixel ring outside the silhouette with 8-connectivity', () => {
    const src = rect(9, 9, 3, 3, 6, 6);
    const out = outline(src, { side: 'outside', width: 1 }, black);
    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 9; x++) {
        const inside = x >= 3 && x < 6 && y >= 3 && y < 6;
        const ring = !inside && x >= 2 && x < 7 && y >= 2 && y < 7;
        if (inside) expect(px(out, x, y)).toEqual([200, 80, 40, 255]);
        else if (ring) expect(px(out, x, y)).toEqual([0x1a, 0x1c, 0x2c, 255]);
        else expect(alphaAt(out, x, y)).toBe(0);
      }
    }
  });

  it('leaves the corners out with 4-connectivity and grows with width', () => {
    const src = rect(9, 9, 3, 3, 6, 6);
    const four = outline(src, { side: 'outside', width: 1, connectivity: 4 }, black);
    expect(alphaAt(four, 2, 2)).toBe(0);
    expect(alphaAt(four, 2, 3)).toBe(255);
    const two = outline(src, { side: 'outside', width: 2 }, black);
    expect(alphaAt(two, 1, 1)).toBe(255);
    expect(alphaAt(two, 0, 0)).toBe(0);
  });

  it('recolours the edge pixels for an inside outline and keeps the silhouette', () => {
    const src = rect(9, 9, 2, 2, 7, 7);
    const out = outline(src, { side: 'inside', width: 1 }, black);
    expect(px(out, 2, 2)).toEqual([0x1a, 0x1c, 0x2c, 255]);
    expect(px(out, 4, 4)).toEqual([200, 80, 40, 255]);
    expect(alphaAt(out, 1, 1)).toBe(0);
    let opaque = 0;
    for (let p = 0; p < 81; p++) if (out.rgba[p * 4 + 3] !== 0) opaque++;
    expect(opaque).toBe(25);
  });

  it('treats the image border as transparent', () => {
    const out = outline(rect(3, 3, 0, 0, 3, 3), { side: 'inside', width: 1 }, black);
    expect(px(out, 1, 1)).toEqual([200, 80, 40, 255]);
    expect(px(out, 0, 1)).toEqual([0x1a, 0x1c, 0x2c, 255]);
  });
});

describe('cleanupOrphans and isolatedPixels', () => {
  it('counts and removes pixels with no opaque neighbour', () => {
    const src = rect(8, 8, 0, 0, 3, 3);
    src.rgba.set([1, 1, 1, 255], (6 * 8 + 6) * 4);
    expect(isolatedPixels(src)).toBe(1);
    const result = cleanupOrphans(src, 'remove');
    expect(result.removed).toBe(1);
    expect(alphaAt(result.image, 6, 6)).toBe(0);
    expect(isolatedPixels(result.image)).toBe(0);
    expect(cleanupOrphans(src, 'off').image).toBe(src);
  });

  it('removes thin spurs with a higher neighbour count', () => {
    const src = rect(8, 8, 0, 0, 3, 3);
    src.rgba.set([200, 80, 40, 255], (1 * 8 + 3) * 4);
    expect(cleanupOrphans(src, 'remove', 1).removed).toBe(0);
    const strict = cleanupOrphans(src, 'remove', 2);
    expect(alphaAt(strict.image, 3, 1)).toBe(0);
    // Corners of the block have two neighbours and stay.
    expect(alphaAt(strict.image, 0, 0)).toBe(255);
  });

  it('recolours a lone off-colour pixel to its neighbours colour', () => {
    const src = rect(5, 5, 0, 0, 5, 5);
    src.rgba.set([0, 255, 0, 255], (2 * 5 + 2) * 4);
    const result = cleanupOrphans(src, 'recolour');
    expect(result.recoloured).toBe(1);
    expect(px(result.image, 2, 2)).toEqual([200, 80, 40, 255]);
    expect(opaqueColours(result.image)).toEqual(['#c85028']);
  });
});

describe('passOrder', () => {
  it('uses the default order and validates a custom order', () => {
    expect(passOrder(BASE_SETTINGS.pixel)).toEqual([
      'downscale',
      'alphaThreshold',
      'posterize',
      'palette',
      'outline',
      'cleanup',
      'bleed',
    ]);
    expect(passOrder(settings({ passes: ['downscale', 'alphaThreshold', 'outline', 'palette', 'bleed'] }))).toEqual([
      'downscale',
      'alphaThreshold',
      'outline',
      'palette',
      'bleed',
    ]);
    expect(() => passOrder(settings({ passes: ['alphaThreshold', 'downscale'] }))).toThrow(
      /must start with "downscale"/,
    );
    expect(() => passOrder(settings({ passes: ['downscale', 'palette'] }))).toThrow(/include "alphaThreshold"/);
    expect(() => passOrder(settings({ passes: ['downscale', 'alphaThreshold', 'bleed', 'bleed'] }))).toThrow(/twice/);
  });
});

describe('pass registry', () => {
  it('has one entry per pass, keyed by its id', () => {
    expect(Object.keys(PIXEL_PASS_REGISTRY).sort()).toEqual([...PIXEL_PASSES].sort());
    for (const [id, pass] of Object.entries(PIXEL_PASS_REGISTRY)) {
      expect(pass.id).toBe(id);
      expect(pass.version).toBeGreaterThanOrEqual(1);
      expect(pass.description.length).toBeGreaterThan(10);
    }
  });

  it('signs the enabled passes in order, so the cache key changes with them', () => {
    expect(passSignature(BASE_SETTINGS.pixel)).toEqual(['downscale@2', 'alphaThreshold@1', 'bleed@1']);
    expect(
      passSignature(
        settings({ palette: 'auto:8', outline: { color: '#000000', side: 'outside', width: 1 }, bleed: false }),
      ),
    ).toEqual(['downscale@2', 'alphaThreshold@1', 'palette@1', 'outline@1']);
    expect(
      passSignature(
        settings({
          cleanup: { orphans: true, minNeighbours: 1 },
          passes: ['downscale', 'alphaThreshold', 'cleanup', 'bleed'],
        }),
      ),
    ).toEqual(['downscale@2', 'alphaThreshold@1', 'cleanup@1', 'bleed@1']);
  });
});

describe('processFrames', () => {
  it('runs downscale, threshold and bleed in order with the default settings', () => {
    const render = createImage(8, 8);
    for (let y = 4; y < 8; y++) for (let x = 0; x < 8; x++) render.rgba.set([50, 100, 150, 255], (y * 8 + x) * 4);
    const sprite = processFrame(render, 4, BASE_SETTINGS.pixel);
    expect([sprite.width, sprite.height]).toEqual([2, 2]);
    expect(px(sprite, 0, 1)).toEqual([50, 100, 150, 255]);
    expect(px(sprite, 0, 0)).toEqual([50, 100, 150, 0]);
    expect(opaqueColours(sprite)).toEqual(['#326496']);
  });

  it('auto:16 gives at most 16 colours shared by every frame', () => {
    const frames = [0, 1, 2].map((i) => ({
      key: `idle/s/${i}`,
      clip: 'idle',
      image: boxUp(gradientShifted(32, 32, i * 20), 2),
    }));
    const result = processFrames(frames, 2, settings({ palette: 'auto:16' }), null);
    const palette = result.palettes['*'] as readonly string[];
    expect(palette.length).toBeLessThanOrEqual(16);
    const used = new Set([...result.sprites.values()].flatMap((s) => opaqueColours(s)));
    expect(used.size).toBeLessThanOrEqual(16);
    for (const c of used) expect(palette).toContain(c);
  });

  it('builds one palette per clip with paletteScope clip', () => {
    const frames = [
      { key: 'a/s/0', clip: 'a', image: rect(4, 4, 0, 0, 4, 4, [255, 0, 0]) },
      { key: 'b/s/0', clip: 'b', image: rect(4, 4, 0, 0, 4, 4, [0, 0, 255]) },
    ];
    const result = processFrames(frames, 1, settings({ palette: 'auto:4', paletteScope: 'clip' }), null);
    expect(result.palettes).toEqual({ a: ['#ff0000'], b: ['#0000ff'] });
  });

  it('keeps sprites inside a fixed palette, outline included when snapped', () => {
    const pico = [
      '#000000',
      '#1d2b53',
      '#7e2553',
      '#008751',
      '#ab5236',
      '#5f574f',
      '#c2c3c7',
      '#fff1e8',
      '#ff004d',
      '#ffa300',
      '#ffec27',
      '#00e436',
      '#29adff',
      '#83769c',
      '#ff77a8',
      '#ffccaa',
    ];
    const result = processFrames(
      [{ key: 'idle/s/0', clip: 'idle', image: boxUp(gradient(16, 16), 4) }],
      4,
      settings({
        palette: 'fixed:pico-8',
        dither: 'bayer-4',
        ditherStrength: 0.35,
        outline: { color: '#101010', side: 'outside', width: 1, snapToPalette: true },
      }),
      pico,
    );
    const sprite = result.sprites.get('idle/s/0') as RgbaImage;
    expect(opaqueColours(sprite).every((c) => pico.includes(c))).toBe(true);
    // The outline colour is snapped to its nearest palette colour, so the ring stays in the palette.
    const snapped = Palette.fromHex(pico).nearest(0x10, 0x10, 0x10);
    expect(px(sprite, 0, 8)).toEqual([(snapped >> 16) & 255, (snapped >> 8) & 255, snapped & 255, 255]);
    expect(result.palettes['*']).toEqual(pico);
    expect(() =>
      processFrames(
        [{ key: 'k', clip: 'c', image: createImage(4, 4) }],
        1,
        settings({ palette: 'fixed:pico-8' }),
        null,
      ),
    ).toThrow(/not resolved/);
  });

  it('applies posterize, outline and cleanup in the configured order', () => {
    const src = rect(12, 12, 4, 4, 8, 8, [100, 200, 30]);
    src.rgba.set([100, 200, 30, 255], (0 * 12 + 11) * 4);
    const result = processFrames(
      [{ key: 'k', clip: 'c', image: src }],
      1,
      settings({
        posterize: 3,
        outline: { color: '#000000', side: 'outside', width: 1 },
        cleanup: { orphans: 'remove', minNeighbours: 1 },
      }),
      null,
    );
    const out = result.sprites.get('k') as RgbaImage;
    expect(px(out, 5, 5)).toEqual([128, 255, 0, 255]);
    expect(px(out, 3, 3)).toEqual([0, 0, 0, 255]);
    // The stray pixel got an outline first, so it was no longer alone when cleanup ran.
    expect(result.removed).toBe(0);
    const cleanFirst = processFrames(
      [{ key: 'k', clip: 'c', image: src }],
      1,
      settings({
        outline: { color: '#000000', side: 'outside', width: 1 },
        cleanup: { orphans: 'remove', minNeighbours: 1 },
        passes: ['downscale', 'alphaThreshold', 'cleanup', 'outline', 'bleed'],
      }),
      null,
    );
    expect(cleanFirst.removed).toBe(1);
    expect(alphaAt(cleanFirst.sprites.get('k') as RgbaImage, 11, 0)).toBe(0);
  });

  it('is deterministic', () => {
    const frames = [{ key: 'k', clip: 'c', image: boxUp(gradient(32, 48), 4) }];
    const s = settings({
      palette: 'auto:12',
      dither: 'bayer-2',
      outline: { color: '#1a1c2c', side: 'outside', width: 1 },
    });
    const a = processFrames(frames, 4, s, null);
    const b = processFrames(frames, 4, s, null);
    expect((a.sprites.get('k') as RgbaImage).rgba).toEqual((b.sprites.get('k') as RgbaImage).rgba);
    expect(a.palettes).toEqual(b.palettes);
  });

  it('processes a 32 x 48 frame from a 128 x 192 render in under 5 ms', () => {
    const frames = Array.from({ length: 16 }, (_, i) => ({
      key: `walk/s/${i}`,
      clip: 'walk',
      image: boxUp(gradientShifted(32, 48, i * 4), 4),
    }));
    const s = settings({
      palette: 'auto:16',
      dither: 'bayer-4',
      outline: { color: '#1a1c2c', side: 'outside', width: 1 },
      cleanup: { orphans: 'remove', minNeighbours: 1 },
    });
    processFrames(frames, 4, s, null);
    const runs: number[] = [];
    for (let r = 0; r < 5; r++) {
      const start = performance.now();
      processFrames(frames, 4, s, null);
      runs.push((performance.now() - start) / frames.length);
    }
    expect(Math.min(...runs)).toBeLessThan(5);
  });
});

describe('encodeIndexedPng', () => {
  async function decode(png: Buffer) {
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, rgba: new Uint8Array(data) };
  }

  it('round-trips a palette image exactly, transparent colours included', async () => {
    const src = bleedEdges(
      mapToPalette(gradient(20, 20), Palette.fromHex(['#000000', '#7e2553', '#29adff', '#ffec27']), 'bayer-2', 0.5),
    );
    const encoded = encodeIndexedPng(src) as NonNullable<ReturnType<typeof encodeIndexedPng>>;
    expect(encoded.bitDepth).toBe(4);
    expect(encoded.png.subarray(25, 26)[0]).toBe(3);
    const back = await decode(encoded.png);
    expect([back.width, back.height]).toEqual([20, 20]);
    expect(back.rgba).toEqual(src.rgba);
  });

  it('picks the smallest bit depth and honours the palette order', async () => {
    const two = rect(3, 1, 0, 0, 3, 1, [255, 255, 255]);
    const one = encodeIndexedPng(two) as NonNullable<ReturnType<typeof encodeIndexedPng>>;
    expect([one.entries, one.bitDepth]).toEqual([1, 1]);
    const ordered = rect(2, 1, 0, 0, 1, 1, [255, 0, 0]);
    ordered.rgba.set([0, 0, 255, 255], 4);
    const enc = encodeIndexedPng(ordered, [packRgb(...hexToRgb('#0000ff')), 0xff0000]) as NonNullable<
      ReturnType<typeof encodeIndexedPng>
    >;
    const plte = enc.png.indexOf('PLTE');
    expect(Array.from(enc.png.subarray(plte + 4, plte + 10))).toEqual([0, 0, 255, 255, 0, 0]);
    expect((await decode(enc.png)).rgba).toEqual(ordered.rgba);
  });

  it('shares one transparent entry when the twins do not fit, and refuses partial alpha or too many colours', async () => {
    const many = createImage(200, 1);
    for (let x = 0; x < 200; x++) many.rgba.set([x, 0, 0, x < 150 ? 255 : 0], x * 4);
    const enc = encodeIndexedPng(many) as NonNullable<ReturnType<typeof encodeIndexedPng>>;
    expect(enc.entries).toBe(151);
    const back = await decode(enc.png);
    for (let x = 0; x < 150; x++) expect(px(back, x, 0)).toEqual([x, 0, 0, 255]);
    for (let x = 150; x < 200; x++) expect(alphaAt(back, x, 0)).toBe(0);
    expect(encodeIndexedPng(image(1, 1, [[1, 2, 3, 100]]))).toBeNull();
    const huge = createImage(300, 1);
    for (let x = 0; x < 300; x++) huge.rgba.set([x & 255, x >> 8, 0, 255], x * 4);
    expect(encodeIndexedPng(huge)).toBeNull();
  });

  it('is deterministic and smaller than the RGBA encoding for palette art', async () => {
    const src = mapToPalette(
      gradient(64, 64),
      Palette.fromHex(['#000000', '#555555', '#aaaaaa', '#ffffff']),
      'none',
      0,
    );
    const a = encodeIndexedPng(src) as NonNullable<ReturnType<typeof encodeIndexedPng>>;
    const b = encodeIndexedPng(src) as NonNullable<ReturnType<typeof encodeIndexedPng>>;
    expect(a.png).toEqual(b.png);
    const rgba = await sharp(Buffer.from(src.rgba), { raw: { width: 64, height: 64, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(a.png.length).toBeLessThan(rgba.length);
  });
});

/** Nearest-neighbour upscale so a downscale by the same factor gives the input back. */
function boxUp(img: RgbaImage, factor: number): RgbaImage {
  const out = createImage(img.width * factor, img.height * factor);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const from = (Math.floor(y / factor) * img.width + Math.floor(x / factor)) * 4;
      out.rgba.set(img.rgba.subarray(from, from + 4), (y * out.width + x) * 4);
    }
  }
  return out;
}
function gradientShifted(w: number, h: number, shift: number): RgbaImage {
  const img = gradient(w, h);
  for (let i = 0; i < img.rgba.length; i += 4) if (img.rgba[i + 3] !== 0) img.rgba[i + 2] = (128 + shift) & 255;
  return img;
}
