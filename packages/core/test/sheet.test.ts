import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AsepriteSheet, AsepriteSheetArray, PhaserAtlas, PixiSheet } from '@td2d/schema';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  asepriteExporter,
  BASE_SETTINGS,
  buildAsepriteSheet,
  buildGodotSpriteFrames,
  cellToFrame,
  compositePage,
  createImage,
  type ExportContext,
  encodeGif,
  layoutSheets,
  lzwEncode,
  phaserExporter,
  pixiExporter,
  type RgbaImage,
  type SheetLayout,
  type Td2dError,
} from '../src/index.ts';
import { tempDir } from './helpers/tmp.ts';

const frame = { width: 16, height: 24 };
const rows = [
  { clip: 'idle', direction: 's', keys: ['idle/s/000'] },
  { clip: 'idle', direction: 'w', keys: ['idle/w/000'] },
  { clip: 'walk', direction: 's', keys: ['walk/s/000', 'walk/s/001', 'walk/s/002'] },
  { clip: 'walk', direction: 'w', keys: ['walk/w/000', 'walk/w/001', 'walk/w/002'] },
];
const grid = { ...BASE_SETTINGS.sheet };

/** A sprite with a small opaque block whose place and colour depend on the key. */
function sprite(key: string, w = frame.width, h = frame.height): RgbaImage {
  const img = createImage(w, h);
  const n = [...key].reduce((a, c) => a + c.charCodeAt(0), 0);
  const x0 = 2 + (n % 5);
  const y0 = 4 + (n % 7);
  for (let y = y0; y < y0 + 8; y++)
    for (let x = x0; x < x0 + 6; x++) img.rgba.set([n % 256, (n * 7) % 256, (x * 20) % 256, 255], (y * w + x) * 4);
  // Edge bleed colour under a transparent pixel, which trimming may drop.
  img.rgba.set([9, 9, 9, 0], 0);
  return img;
}
const sprites = new Map(rows.flatMap((r) => r.keys).map((k) => [k, sprite(k)]));

describe('grid and strips layouts', () => {
  it('puts one row per clip and direction and one column per frame', () => {
    const layout = layoutSheets(rows, sprites, frame, grid, 'hero');
    expect(layout.pages).toEqual([{ name: 'hero', width: 48, height: 96 }]);
    expect(layout.cells.find((c) => c.key === 'walk/w/002')).toMatchObject({
      x: 32,
      y: 72,
      w: 16,
      h: 24,
      index: 2,
      page: 0,
      trimmed: false,
      offset: { x: 0, y: 0 },
    });
  });

  it('orders by direction first, flows down columns, pads, extrudes and rounds up to powers of two', () => {
    const byDirection = layoutSheets(rows, sprites, frame, { ...grid, order: 'direction-clip' }, 'hero');
    expect([...new Set(byDirection.cells.map((c) => `${c.direction}:${c.clip}`))]).toEqual([
      's:idle',
      's:walk',
      'w:idle',
      'w:walk',
    ]);
    const columns = layoutSheets(rows, sprites, frame, { ...grid, flow: 'columns' }, 'hero');
    expect(columns.pages[0]).toMatchObject({ width: 64, height: 72 });
    expect(columns.cells.find((c) => c.key === 'walk/s/001')).toMatchObject({ x: 32, y: 24 });
    const padded = layoutSheets(rows.slice(2, 3), sprites, frame, { ...grid, padding: 2, extrude: 1 }, 'hero');
    expect(padded.pages[0]).toMatchObject({ width: 3 * 18 + 2 * 2, height: 26 });
    expect(padded.cells.map((c) => c.x)).toEqual([1, 21, 41]);
    expect(layoutSheets(rows, sprites, frame, { ...grid, powerOfTwo: true }, 'hero').pages[0]).toMatchObject({
      width: 64,
      height: 128,
    });
  });

  it('splits by clip or direction, and makes one strip per sequence', () => {
    expect(
      layoutSheets(rows, sprites, frame, { ...grid, split: 'clip' }, 'hero').pages.map((p) => [
        p.name,
        p.width,
        p.height,
      ]),
    ).toEqual([
      ['hero-idle', 16, 48],
      ['hero-walk', 48, 48],
    ]);
    expect(
      layoutSheets(rows, sprites, frame, { ...grid, split: 'direction' }, 'hero').pages.map((p) => p.name),
    ).toEqual(['hero-s', 'hero-w']);
    const strips = layoutSheets(rows, sprites, frame, { ...grid, layout: 'strips' }, 'hero');
    expect(strips.pages.map((p) => [p.name, p.width, p.height])).toEqual([
      ['hero-idle-s', 16, 24],
      ['hero-idle-w', 16, 24],
      ['hero-walk-s', 48, 24],
      ['hero-walk-w', 48, 24],
    ]);
  });

  it('breaks a sheet over maxSize into numbered sheets between sequences, and refuses a sequence that cannot fit', () => {
    const layout = layoutSheets(rows, sprites, frame, { ...grid, maxSize: 64 }, 'hero');
    expect(layout.pages.map((p) => [p.name, p.width, p.height])).toEqual([
      ['hero-0', 48, 48],
      ['hero-1', 48, 48],
    ]);
    expect(layout.cells.filter((c) => c.page === 1).map((c) => c.key)).toEqual([
      'walk/s/000',
      'walk/s/001',
      'walk/s/002',
      'walk/w/000',
      'walk/w/001',
      'walk/w/002',
    ]);
    try {
      layoutSheets(rows, sprites, frame, { ...grid, maxSize: 40 }, 'hero');
      expect.unreachable();
    } catch (error) {
      expect((error as Td2dError).code).toBe('E_GENERATION_FAILED');
      expect((error as Td2dError).hint).toMatch(/packed/);
    }
  });
});

describe('packed layout', () => {
  const packed = { ...grid, layout: 'packed' as const, trim: true, padding: 1, extrude: 1 };

  it('trims to the opaque pixels and records offsets that rebuild every frame exactly', () => {
    const layout = layoutSheets(rows, sprites, frame, packed, 'hero');
    expect(layout.pages).toHaveLength(1);
    const sheet = compositePage(layout, 0, sprites, 1);
    for (const cell of layout.cells) {
      expect(cell.trimmed).toBe(true);
      expect([cell.w, cell.h]).toEqual([6, 8]);
      const rebuilt = cellToFrame(sheet, cell, frame);
      const original = sprites.get(cell.key) as RgbaImage;
      for (let i = 0; i < original.rgba.length; i += 4) {
        expect(rebuilt.rgba[i + 3]).toBe(original.rgba[i + 3]);
        if (original.rgba[i + 3] !== 0)
          expect(Array.from(rebuilt.rgba.subarray(i, i + 3))).toEqual(Array.from(original.rgba.subarray(i, i + 3)));
      }
    }
  });

  it('never overlaps cells, keeps them on the sheet, and is the same for the same input', () => {
    const a = layoutSheets(rows, sprites, frame, packed, 'hero');
    const b = layoutSheets([...rows].reverse(), sprites, frame, packed, 'hero');
    const place = (l: SheetLayout) => Object.fromEntries(l.cells.map((c) => [c.key, [c.x, c.y]]));
    expect(place(b)).toEqual(place(a));
    for (const c of a.cells) {
      expect(c.x - 1).toBeGreaterThanOrEqual(0);
      expect(c.y - 1).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w + 1).toBeLessThanOrEqual((a.pages[0] as { width: number }).width);
      for (const d of a.cells) {
        if (d === c) continue;
        const apart =
          c.x + c.w + 1 + 1 <= d.x - 1 ||
          d.x + d.w + 1 + 1 <= c.x - 1 ||
          c.y + c.h + 1 + 1 <= d.y - 1 ||
          d.y + d.h + 1 + 1 <= c.y - 1;
        expect(apart, `${c.key} and ${d.key}`).toBe(true);
      }
    }
    expect(a.cells.map((c) => c.key)).toEqual(rows.flatMap((r) => r.keys));
  });

  it('splits into numbered sheets and keeps each clip and direction on one sheet', () => {
    const many = Array.from({ length: 6 }, (_, d) => ({
      clip: 'walk',
      direction: `d${d}`,
      keys: Array.from({ length: 4 }, (_, i) => `walk/d${d}/00${i}`),
    }));
    const big = new Map(many.flatMap((r) => r.keys).map((k) => [k, sprite(k)]));
    const layout = layoutSheets(many, big, frame, { ...packed, trim: false, maxSize: 64 }, 'hero');
    expect(layout.pages.length).toBeGreaterThan(1);
    expect(layout.pages.map((p) => p.name)).toEqual(layout.pages.map((_, i) => `hero-${i}`));
    for (const r of many)
      expect(new Set(layout.cells.filter((c) => c.direction === r.direction).map((c) => c.page)).size).toBe(1);
  });

  it('pads untrimmed packed cells to the frame and extrudes the edge colour outwards', () => {
    const small = createImage(4, 4);
    for (let i = 0; i < 16; i++) small.rgba.set([i * 10, 100, 200, 255], i * 4);
    const one = new Map([['a/s/000', small]]);
    const sheetLayout = layoutSheets(
      [{ clip: 'a', direction: 's', keys: ['a/s/000'] }],
      one,
      { width: 4, height: 4 },
      { ...packed, trim: false, padding: 0, extrude: 2, powerOfTwo: false },
      'x',
    );
    expect(sheetLayout.pages[0]).toMatchObject({ width: 8, height: 8 });
    const image = compositePage(sheetLayout, 0, one, 2);
    const at = (x: number, y: number) => Array.from(image.rgba.subarray((y * 8 + x) * 4, (y * 8 + x) * 4 + 4));
    const src = one.get('a/s/000') as RgbaImage;
    expect(at(0, 0)).toEqual(Array.from(src.rgba.subarray(0, 4)));
    expect(at(7, 2)).toEqual(Array.from(src.rgba.subarray((0 * 4 + 3) * 4, (0 * 4 + 3) * 4 + 4)));
  });
});

function context(layout: SheetLayout, dir = tempDir()): ExportContext {
  return {
    asset: {
      id: 'characters/hero',
      frame,
      directions: [
        { name: 's', yaw: 0, mirrorOf: null },
        { name: 'w', yaw: 90, mirrorOf: null },
      ],
      animation: {
        fps: 10,
        clips: { idle: { fps: 10, loop: true, frames: 1 }, walk: { fps: 12, loop: true, frames: 3 } },
      },
      export: BASE_SETTINGS.export,
    } as never,
    name: 'hero',
    dir,
    layout,
    images: layout.pages.map((p) => `${p.name}.png`),
    pivot: { x: 8, y: 20 },
    sprites: async () => sprites,
    spriteFiles: new Map(),
    writeImage: async () => {},
  };
}

describe('exporters', () => {
  it('writes Aseprite hash data per sheet with index names, local tags, trim and a pivot slice', () => {
    const layout = layoutSheets(rows, sprites, frame, { ...grid, split: 'clip' }, 'hero');
    const walk = buildAsepriteSheet({
      assetId: 'characters/hero',
      image: 'hero-walk.png',
      layout,
      page: 1,
      fpsByClip: { idle: 10, walk: 12 },
      pivot: { x: 8, y: 20 },
      frameNames: 'index',
    });
    expect(AsepriteSheet.parse(walk)).toBeTruthy();
    expect(Object.keys(walk.frames)).toEqual(['0', '1', '2', '3', '4', '5']);
    expect(walk.meta.frameTags.map((t) => [t.name, t.from, t.to])).toEqual([
      ['walk_s', 0, 2],
      ['walk_w', 3, 5],
    ]);
    expect(walk.frames['0']?.duration).toBe(83);
    expect(walk.meta.slices[0]?.keys[0]?.pivot).toEqual({ x: 8, y: 20 });
    const trimmed = layoutSheets(rows, sprites, frame, { ...grid, layout: 'packed', trim: true }, 'hero');
    const data = buildAsepriteSheet({
      assetId: 'characters/hero',
      image: 'hero.png',
      layout: trimmed,
      page: 0,
      fpsByClip: {},
      pivot: { x: 8, y: 20 },
      frameNames: 'descriptive',
    });
    const first = data.frames['characters/hero (idle_s) 0.png'];
    expect(first).toMatchObject({ trimmed: true, sourceSize: { w: 16, h: 24 } });
    expect(first?.spriteSourceSize.w).toBe(6);
  });

  it('writes the array variant, PixiJS and Phaser data that match their schemas', async () => {
    const layout = layoutSheets(rows, sprites, frame, { ...grid, maxSize: 64 }, 'hero');
    const ctx = context(layout);
    const arrayCtx = {
      ...ctx,
      asset: { ...ctx.asset, export: { ...ctx.asset.export, aseprite: { variant: 'array', frameNames: 'index' } } },
    } as ExportContext;
    for (const file of await asepriteExporter.write(arrayCtx))
      expect(AsepriteSheetArray.safeParse(JSON.parse(readFileSync(join(ctx.dir, file), 'utf8'))).success).toBe(true);
    const pixi = await pixiExporter.write(ctx);
    expect(pixi).toEqual(['hero-0.pixi.json', 'hero-1.pixi.json']);
    const p0 = PixiSheet.parse(JSON.parse(readFileSync(join(ctx.dir, 'hero-0.pixi.json'), 'utf8')));
    expect(p0.meta.related_multi_packs).toEqual(['hero-1.pixi.json']);
    expect(p0.animations).toEqual({ idle_s: ['idle/s/000'], idle_w: ['idle/w/000'] });
    expect(p0.frames['idle/s/000']?.anchor).toEqual({ x: 0.5, y: Number((20 / 24).toFixed(6)) });
    const [phaserFile] = await phaserExporter.write(ctx);
    const atlas = PhaserAtlas.parse(JSON.parse(readFileSync(join(ctx.dir, phaserFile as string), 'utf8')));
    expect(atlas.textures.map((t) => t.image)).toEqual(['hero-0.png', 'hero-1.png']);
    expect(atlas.animations.find((a) => a.key === 'walk_w')).toEqual({
      key: 'walk_w',
      frameRate: 12,
      repeat: -1,
      frames: ['walk/w/000', 'walk/w/001', 'walk/w/002'],
    });
  });

  it('writes a Godot SpriteFrames resource that matches the committed golden', () => {
    const layout = layoutSheets(
      rows,
      sprites,
      frame,
      { ...grid, layout: 'packed', trim: true, padding: 1, maxSize: 64 },
      'hero',
    );
    const text = buildGodotSpriteFrames(context(layout));
    const golden = join(import.meta.dirname, 'fixtures', 'golden', 'godot', 'hero.tres');
    if (process.env.TD2D_UPDATE_GOLDENS === '1' || !existsSync(golden)) {
      mkdirSync(join(golden, '..'), { recursive: true });
      writeFileSync(golden, text);
    }
    expect(text).toBe(readFileSync(golden, 'utf8'));
    expect(text.startsWith('[gd_resource type="SpriteFrames" format=3]\n')).toBe(true);
    expect(text).toContain('margin = Rect2(');
    expect(text).toContain('"name": &"walk_w"');
    expect(text).toContain('"speed": 12.0');
  });
});

describe('GIF encoding', () => {
  it('round-trips frames through a standard decoder, transparency included', async () => {
    const frames = [0, 1, 2].map((i) => {
      const img = createImage(20, 10);
      for (let x = 0; x < 20; x++)
        for (let y = 0; y < 10; y++)
          if ((x + y + i) % 3 !== 0) img.rgba.set([x * 12, 0, i * 100, 255], (y * 20 + x) * 4);
      return { image: img, delay: 10 };
    });
    const gif = encodeGif(frames);
    expect(gif.subarray(0, 6).toString('ascii')).toBe('GIF89a');
    const meta = await sharp(gif, { animated: true }).metadata();
    expect([meta.pages, meta.loop, meta.delay]).toEqual([3, 0, [100, 100, 100]]);
    const { data } = await sharp(gif, { animated: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (const [i, f] of frames.entries()) {
      const page = data.subarray(i * 800, (i + 1) * 800);
      for (let p = 0; p < 800; p += 4) {
        expect(page[p + 3]).toBe(f.image.rgba[p + 3]);
        if (f.image.rgba[p + 3] !== 0)
          expect([page[p], page[p + 1], page[p + 2]]).toEqual(Array.from(f.image.rgba.subarray(p, p + 3)));
      }
    }
  });

  it('keeps compressing when the code table fills and resets', async () => {
    const noise = new Uint8Array(200 * 200);
    let seed = 7;
    for (let i = 0; i < noise.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      noise[i] = seed % 200;
    }
    expect(lzwEncode(noise, 8).length).toBeGreaterThan(0);
    const img = createImage(200, 200);
    for (let i = 0; i < noise.length; i++) img.rgba.set([noise[i] as number, 0, 0, 255], i * 4);
    const { data } = await sharp(encodeGif([{ image: img, delay: 5 }]))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (let i = 0; i < noise.length; i += 97) expect(data[i * 4]).toBe(noise[i]);
  });
});
