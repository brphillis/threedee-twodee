import { describe, expect, it } from 'vitest';
import { createImage, type RgbaImage, validateSprites } from '../src/index.ts';

function sprite(fill: (x: number, y: number) => boolean, w = 8, h = 8, alpha = 255): RgbaImage {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (fill(x, y)) img.rgba.set([10, 20, 30, alpha], (y * w + x) * 4);
  return img;
}
const centred = sprite((x, y) => x >= 2 && x < 6 && y >= 2 && y < 7);
const input = (sprites: RgbaImage[], extra: Partial<Parameters<typeof validateSprites>[0]> = {}) =>
  validateSprites({
    assetId: 'props/x',
    type: 'prop',
    frame: { width: 8, height: 8 },
    groundMargin: 1,
    sprites: sprites.map((image, i) => ({ key: `idle/s/${i}`, image })),
    sheets: [{ name: 'x', width: 8, height: 8, expectedWidth: 8, expectedHeight: 8 }],
    acceptance: {},
    ...extra,
  });
const statusOf = (report: ReturnType<typeof validateSprites>, id: string) =>
  report.checks.find((c) => c.id === id)?.status;

describe('validateSprites', () => {
  it('passes a well-formed sprite', () => {
    const report = input([centred]);
    expect(report.status).toBe('pass');
    expect(report.checks.map((c) => c.id)).toEqual([
      'sprite-size',
      'binary-alpha',
      'not-blank',
      'inside-frame',
      'grounded',
      'isolated-pixels',
      'sheet-size',
    ]);
  });

  it('fails blank, wrongly sized and semi-transparent sprites', () => {
    expect(statusOf(input([createImage(8, 8)]), 'not-blank')).toBe('fail');
    expect(statusOf(input([createImage(4, 8)]), 'sprite-size')).toBe('fail');
    expect(statusOf(input([sprite(() => true, 8, 8, 100)]), 'binary-alpha')).toBe('fail');
  });

  it('warns about sprites on the frame edge and sprites floating above the ground line', () => {
    expect(statusOf(input([sprite((x) => x === 0)]), 'inside-frame')).toBe('warn');
    const floating = input([sprite((x, y) => x === 3 && y < 3)]);
    expect(statusOf(floating, 'grounded')).toBe('warn');
    expect(floating.status).toBe('warn');
    expect(statusOf(input([sprite((x, y) => x === 3 && y < 3)], { type: 'effect' }), 'grounded')).toBeUndefined();
  });

  it('enforces acceptance limits', () => {
    expect(statusOf(input([centred], { acceptance: { minAlphaCoverage: 0.5 } }), 'coverage')).toBe('fail');
    expect(statusOf(input([centred], { acceptance: { maxColors: 1 } }), 'max-colors')).toBe('pass');
    const two = sprite((x, y) => x >= 2 && x < 6 && y >= 2 && y < 7);
    two.rgba.set([99, 0, 0, 255], (3 * 8 + 3) * 4);
    expect(statusOf(input([two], { acceptance: { maxColors: 1 } }), 'max-colors')).toBe('fail');
  });

  it('fails sprites with colours outside the palette', () => {
    const ok = input([centred], { allowedColours: ['#0A141E'] });
    expect(statusOf(ok, 'palette')).toBe('pass');
    const off = sprite((x, y) => x >= 2 && x < 6 && y >= 2 && y < 7);
    off.rgba.set([255, 0, 0, 255], (3 * 8 + 3) * 4);
    const bad = input([off], { allowedColours: ['#0a141e'] });
    expect(statusOf(bad, 'palette')).toBe('fail');
    expect(bad.checks.find((c) => c.id === 'palette')?.details).toEqual({ colours: { 'idle/s/0': ['#ff0000'] } });
    expect(statusOf(input([centred], { allowedColours: null }), 'palette')).toBeUndefined();
  });

  describe('jitter', () => {
    // A 4 x 5 block whose left edge moves by the given offsets, frame by frame.
    const walk = (offsets: number[]) =>
      offsets.map((dx) => sprite((x, y) => x >= 1 + dx && x < 5 + dx && y >= 2 && y < 7, 12, 8));
    const run = (offsets: number[], extra: Partial<Parameters<typeof validateSprites>[0]> = {}) => {
      const images = walk(offsets);
      const keys = images.map((_, i) => `walk/s/${i}`);
      return validateSprites({
        assetId: 'chars/x',
        type: 'character',
        frame: { width: 12, height: 8 },
        groundMargin: 1,
        sprites: images.map((image, i) => ({ key: keys[i] as string, image })),
        sheets: [{ name: 'x', width: 12, height: 8, expectedWidth: 12, expectedHeight: 8 }],
        acceptance: {},
        sequences: [{ clip: 'walk', direction: 's', keys, motion: false }],
        ...extra,
      });
    };

    it('passes steady frames and warns about 3 px jumps by default', () => {
      expect(statusOf(run([0, 1, 2, 1, 0]), 'jitter')).toBe('pass');
      const jumpy = run([0, 3, 0, 3]);
      const c = jumpy.checks.find((k) => k.id === 'jitter');
      expect(c?.status).toBe('warn');
      expect(c?.frames).toEqual(['walk/s/1', 'walk/s/2', 'walk/s/3']);
      expect(c?.details).toEqual({ jumps: { 'walk/s/1': 3, 'walk/s/2': 3, 'walk/s/3': 3 } });
    });

    it('fails when acceptance.maxJitter is set, and skips clips that move on purpose', () => {
      expect(statusOf(run([0, 3, 0], { acceptance: { maxJitter: 2 } }), 'jitter')).toBe('fail');
      expect(statusOf(run([0, 3, 0], { acceptance: { maxJitter: 3 } }), 'jitter')).toBe('pass');
      const keys = ['walk/s/0', 'walk/s/1', 'walk/s/2'];
      expect(
        statusOf(
          run([0, 3, 0], {
            acceptance: { maxJitter: 2 },
            sequences: [{ clip: 'walk', direction: 's', keys, motion: true }],
          }),
          'jitter',
        ),
      ).toBe('pass');
    });

    it('is not reported for single-frame clips', () => {
      expect(
        statusOf(
          run([0], { sequences: [{ clip: 'walk', direction: 's', keys: ['walk/s/0'], motion: false }] }),
          'jitter',
        ),
      ).toBeUndefined();
    });

    it('fails frames whose size drifts from the clip median when maxBoundsDrift is set', () => {
      const images = [4, 4, 7, 4].map((w) => sprite((x, y) => x >= 1 && x < 1 + w && y >= 2 && y < 7, 12, 8));
      const keys = images.map((_, i) => `walk/s/${i}`);
      const report = (maxBoundsDrift?: number) =>
        validateSprites({
          assetId: 'chars/x',
          type: 'character',
          frame: { width: 12, height: 8 },
          groundMargin: 1,
          sprites: images.map((image, i) => ({ key: keys[i] as string, image })),
          sheets: [{ name: 'x', width: 12, height: 8, expectedWidth: 12, expectedHeight: 8 }],
          acceptance: maxBoundsDrift === undefined ? {} : { maxBoundsDrift },
          sequences: [{ clip: 'walk', direction: 's', keys, motion: true }],
        });
      expect(statusOf(report(), 'bounds-drift')).toBeUndefined();
      expect(report(2).checks.find((c) => c.id === 'bounds-drift')?.frames).toEqual(['walk/s/2']);
      expect(statusOf(report(3), 'bounds-drift')).toBe('pass');
    });
  });

  it('warns about isolated pixels', () => {
    const stray = sprite((x, y) => (x >= 2 && x < 6 && y >= 2 && y < 7) || (x === 7 && y === 0));
    const report = input([stray]);
    expect(statusOf(report, 'isolated-pixels')).toBe('warn');
    expect(report.checks.find((c) => c.id === 'isolated-pixels')?.details).toEqual({ counts: { 'idle/s/0': 1 } });
    expect(statusOf(input([stray], { acceptance: { maxOrphans: 0 } }), 'isolated-pixels')).toBe('fail');
    expect(statusOf(input([stray], { acceptance: { maxOrphans: 1 } }), 'isolated-pixels')).toBe('pass');
  });

  it('reports what cleanup changed when it is on', () => {
    expect(input([centred]).checks.find((c) => c.id === 'cleanup')).toBeUndefined();
    expect(input([centred], { cleanup: { removed: 3, recoloured: 1 } }).checks.find((c) => c.id === 'cleanup')).toEqual(
      {
        id: 'cleanup',
        status: 'pass',
        message: 'Cleanup removed 3 and recoloured 1 stray pixel(s) across all sprites.',
        details: { removed: 3, recoloured: 1 },
      },
    );
  });

  it('checks that cells lie inside their sheets and that every planned frame appears once', () => {
    const cells = [
      { key: 'idle/s/0', sheet: 0, x: 0, y: 0, w: 8, h: 8 },
      { key: 'idle/s/1', sheet: 0, x: 4, y: 0, w: 8, h: 8 },
    ];
    const report = input([centred], { cells, expectedKeys: ['idle/s/0', 'idle/s/1', 'idle/s/2'] });
    expect(report.checks.find((c) => c.id === 'cells-in-bounds')).toMatchObject({
      status: 'fail',
      frames: ['idle/s/1'],
    });
    expect(report.checks.find((c) => c.id === 'frame-count')).toMatchObject({
      status: 'fail',
      details: { missing: ['idle/s/2'], extra: [] },
    });
    const ok = input([centred], { cells: [cells[0] as (typeof cells)[number]], expectedKeys: ['idle/s/0'] });
    expect(statusOf(ok, 'cells-in-bounds')).toBe('pass');
    expect(statusOf(ok, 'frame-count')).toBe('pass');
    expect(
      statusOf(input([centred], { cells: [cells[0] as (typeof cells)[number]], extrude: 1 }), 'cells-in-bounds'),
    ).toBe('fail');
  });

  it('checks the sheet size', () => {
    expect(
      statusOf(
        input([centred], { sheets: [{ name: 'x', width: 8, height: 8, expectedWidth: 16, expectedHeight: 8 }] }),
        'sheet-size',
      ),
    ).toBe('fail');
  });
});
