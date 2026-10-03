/// <reference lib="dom" />
import type { FrameSample, RenderSceneSettings } from '@td2d/schema';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BASE_SETTINGS,
  encodeIndexedPng,
  opaqueColours,
  PlaywrightBackend,
  processFrames,
  type RgbaImage,
  SWIFTSHADER_ARGS,
  validateSprites,
} from '../../src/index.ts';
import { walkerGlb } from '../fixtures/models.ts';

const FRAME = { width: 32, height: 48 };
const PPU = 16;
const SCENE: RenderSceneSettings = {
  frame: FRAME,
  supersample: 4,
  pixelsPerUnit: PPU,
  camera: { pitch: 30, yawOffset: 0, groundMargin: 4 },
  lighting: BASE_SETTINGS.lighting,
};
const YAWS = { s: 0, w: 90 } as const;

async function renderClip(backend: PlaywrightBackend, glb: Uint8Array, clip: string) {
  const samples: FrameSample[] = [];
  for (const [dir, yaw] of Object.entries(YAWS))
    for (let k = 0; k < 8; k++)
      samples.push({ key: `${clip}/${dir}/${String(k).padStart(3, '0')}`, clip, time: k / 8, yaw });
  const frames: { key: string; clip: string; image: RgbaImage }[] = [];
  await backend.render({ model: { glb }, scene: SCENE, samples }, (f) => {
    frames.push({ key: f.key, clip, image: { width: f.width, height: f.height, rgba: f.rgba } });
  });
  return frames;
}

function validate(
  sprites: ReadonlyMap<string, RgbaImage>,
  clip: string,
  acceptance: Parameters<typeof validateSprites>[0]['acceptance'] = {},
) {
  return validateSprites({
    assetId: 'characters/walker',
    type: 'character',
    frame: FRAME,
    groundMargin: 4,
    sprites: [...sprites].map(([key, image]) => ({ key, image })),
    sheets: [{ name: 'walker', width: 256, height: 96, expectedWidth: 256, expectedHeight: 96 }],
    acceptance,
    sequences: Object.keys(YAWS).map((direction) => ({
      clip,
      direction,
      keys: [...sprites.keys()].filter((k) => k.startsWith(`${clip}/${direction}/`)),
      motion: false,
    })),
  });
}

describe('pixel processing of rendered frames', () => {
  const backend = new PlaywrightBackend();
  let glb: Uint8Array;
  beforeAll(async () => {
    glb = await walkerGlb({ jitterShift: 3 / PPU });
    await backend.start();
  });
  afterAll(() => backend.stop());

  it('passes the jitter check on the walking fixture and flags injected 3 px jumps', async () => {
    const walk = processFrames(await renderClip(backend, glb, 'walk'), 4, BASE_SETTINGS.pixel, null).sprites;
    const steady = validate(walk, 'walk', { maxJitter: 2 }).checks.find((c) => c.id === 'jitter');
    expect(steady?.status).toBe('pass');

    const jumpy = processFrames(await renderClip(backend, glb, 'jitter'), 4, BASE_SETTINGS.pixel, null).sprites;
    const warned = validate(jumpy, 'jitter').checks.find((c) => c.id === 'jitter');
    expect(warned?.status).toBe('warn');
    const failed = validate(jumpy, 'jitter', { maxJitter: 2 }).checks.find((c) => c.id === 'jitter');
    expect(failed?.status).toBe('fail');
    // Every step into or out of a shifted frame jumps, in the south view where +x is sideways on screen.
    expect(failed?.frames?.filter((k) => k.startsWith('jitter/s/'))).toEqual(
      Array.from({ length: 7 }, (_, i) => `jitter/s/${String(i + 1).padStart(3, '0')}`),
    );
    const jumps = Object.values((failed?.details as { jumps: Record<string, number> } | undefined)?.jumps ?? {});
    expect(jumps.length).toBeGreaterThan(0);
    for (const d of jumps) expect(d).toBeGreaterThan(2);
  });

  it('keeps a fixed-palette walk inside the palette, and the indexed PNG decodes identically in sharp and Chromium', async () => {
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
    const settings = {
      ...BASE_SETTINGS.pixel,
      palette: 'fixed:pico-8',
      dither: 'bayer-4' as const,
      ditherStrength: 0.35,
      outline: { color: '#000000', side: 'outside' as const, width: 1, snapToPalette: true },
    };
    const result = processFrames(await renderClip(backend, glb, 'walk'), 4, settings, pico);
    const report = validate(result.sprites, 'walk');
    expect(report.checks.find((c) => c.id === 'binary-alpha')?.status).toBe('pass');
    const sprite = result.sprites.get('walk/w/002') as RgbaImage;
    expect(opaqueColours(sprite).every((c) => pico.includes(c))).toBe(true);

    const encoded = encodeIndexedPng(sprite);
    expect(encoded).not.toBeNull();
    const png = (encoded as NonNullable<typeof encoded>).png;
    const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(new Uint8Array(data)).toEqual(sprite.rgba);

    const browser = await chromium.launch({ args: [...SWIFTSHADER_ARGS] });
    try {
      const page = await browser.newPage();
      const decoded = await page.evaluate(async (b64: string) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), {
          premultiplyAlpha: 'none',
          colorSpaceConversion: 'none',
        });
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
        ctx.drawImage(bitmap, 0, 0);
        return {
          width: bitmap.width,
          height: bitmap.height,
          rgba: Array.from(ctx.getImageData(0, 0, bitmap.width, bitmap.height).data),
        };
      }, png.toString('base64'));
      expect([decoded.width, decoded.height]).toEqual([FRAME.width, FRAME.height]);
      // A canvas stores premultiplied colour, so fully transparent pixels read back as transparent black.
      const expected = Array.from(sprite.rgba);
      for (let i = 0; i < expected.length; i += 4) if (expected[i + 3] === 0) expected.splice(i, 4, 0, 0, 0, 0);
      expect(decoded.rgba).toEqual(expected);
    } finally {
      await browser.close();
    }
  });
});
