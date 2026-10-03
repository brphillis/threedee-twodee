/**
 * Phase 5 experiments Q3, Q6, Q7 and Q8. Run with `pnpm experiments`. Each experiment writes
 * comparison images to docs/roadmaps/assets/phase-5/ and its metrics to
 * docs/roadmaps/assets/phase-5/metrics.json, then asserts the conclusion recorded in
 * docs/roadmaps/phase-5.md so a change that overturns it fails loudly.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FrameSample, RenderSceneSettings } from '@td2d/schema';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BASE_SETTINGS,
  boxDownscale,
  centroid,
  encodeIndexedPng,
  oklabDistanceSq,
  opaqueColours,
  PlaywrightBackend,
  processFrames,
  type RgbaImage,
  rgbToOklab,
  thresholdAlpha,
} from '../../src/index.ts';
import { swordGlb, walkerGlb } from '../fixtures/models.ts';

const OUT = join(import.meta.dirname, '../../../../docs/roadmaps/assets/phase-5');
const METRICS = join(OUT, 'metrics.json');
const metrics: Record<string, unknown> = {};

const pad = (n: number) => String(n).padStart(3, '0');
const round = (n: number, digits = 3) => Number(n.toFixed(digits));

/** Lay frames out in rows on a grey background, scaled up with nearest neighbour, and write a PNG. */
async function writeRows(file: string, rows: readonly (readonly RgbaImage[])[], scale = 4) {
  const w = Math.max(...rows.flatMap((r) => r.map((i) => i.width)));
  const h = Math.max(...rows.flatMap((r) => r.map((i) => i.height)));
  const cols = Math.max(...rows.map((r) => r.length));
  const gap = 2;
  const width = cols * (w + gap) + gap;
  const height = rows.length * (h + gap) + gap;
  const canvas = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) canvas.set([0x56, 0x6c, 0x86, 255], p * 4);
  for (const [r, row] of rows.entries()) {
    for (const [c, img] of row.entries()) {
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const i = (y * img.width + x) * 4;
          if (img.rgba[i + 3] === 0) continue;
          canvas.set(img.rgba.subarray(i, i + 4), ((gap + r * (h + gap) + y) * width + gap + c * (w + gap) + x) * 4);
        }
      }
    }
  }
  await sharp(Buffer.from(canvas), { raw: { width, height, channels: 4 } })
    .resize(width * scale, height * scale, { kernel: 'nearest' })
    .png({ compressionLevel: 9 })
    .toFile(join(OUT, file));
}

/** Opaque pixels with a transparent (or out-of-image) 4-neighbour. */
function edgePixels(img: RgbaImage): number {
  let n = 0;
  const opaque = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < img.width && y < img.height && img.rgba[(y * img.width + x) * 4 + 3] !== 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (opaque(x, y) && (!opaque(x - 1, y) || !opaque(x + 1, y) || !opaque(x, y - 1) || !opaque(x, y + 1))) n++;
    }
  }
  return n;
}

/** Count 8-connected opaque regions. */
function components(img: RgbaImage): number {
  const seen = new Uint8Array(img.width * img.height);
  let count = 0;
  for (let p = 0; p < seen.length; p++) {
    if (seen[p] || img.rgba[p * 4 + 3] === 0) continue;
    count++;
    const stack = [p];
    seen[p] = 1;
    while (stack.length > 0) {
      const q = stack.pop() as number;
      const qx = q % img.width;
      const qy = Math.floor(q / img.width);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = qx + dx;
          const ny = qy + dy;
          if (nx < 0 || ny < 0 || nx >= img.width || ny >= img.height) continue;
          const n = ny * img.width + nx;
          if (!seen[n] && img.rgba[n * 4 + 3] !== 0) {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
    }
  }
  return count;
}

const variance = (values: readonly number[]) => {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
};

/** Pixels whose alpha differs between consecutive frames, averaged over a sequence. */
function alphaFlicker(frames: readonly RgbaImage[]): number {
  let total = 0;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1] as RgbaImage;
    const b = frames[i] as RgbaImage;
    for (let p = 3; p < a.rgba.length; p += 4) if ((a.rgba[p] === 0) !== (b.rgba[p] === 0)) total++;
  }
  return total / (frames.length - 1);
}

async function render(backend: PlaywrightBackend, glb: Uint8Array, scene: RenderSceneSettings, samples: FrameSample[]) {
  const frames = new Map<string, RgbaImage>();
  await backend.render({ model: { glb }, scene, samples }, (f) => {
    frames.set(f.key, { width: f.width, height: f.height, rgba: f.rgba });
  });
  return frames;
}

const scene = (
  frame: { width: number; height: number },
  supersample: number,
  pixelsPerUnit: number,
  groundMargin: number,
): RenderSceneSettings => ({
  frame,
  supersample,
  pixelsPerUnit,
  camera: { pitch: 30, yawOffset: 0, groundMargin },
  lighting: BASE_SETTINGS.lighting,
});

describe('phase 5 experiments', () => {
  const backend = new PlaywrightBackend();
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    await backend.start();
  });
  afterAll(async () => {
    await backend.stop();
    let previous: Record<string, unknown> = {};
    try {
      previous = JSON.parse(readFileSync(METRICS, 'utf8')) as Record<string, unknown>;
    } catch {
      previous = {};
    }
    writeFileSync(METRICS, `${JSON.stringify({ ...previous, ...metrics }, null, 2)}\n`);
  });

  it('Q3: supersampling against 1x rendering, with box and mode downscale', async () => {
    const glb = await walkerGlb();
    const slideAligned = await walkerGlb({ slide: 2 / 16 });
    const slideUnaligned = await walkerGlb({ slide: 0.13 });
    const frame = { width: 32, height: 48 };
    const views = [0, 45, 90, 135, 180, 225, 270, 315].map((yaw) => [`y${yaw}`, yaw] as const);
    const rows: RgbaImage[][] = [];
    const result: Record<string, unknown> = {};
    // Warm the browser up so the first variant's timing is not inflated.
    await render(backend, glb, scene(frame, 4, 16, 4), [{ key: 'warm', clip: 'walk', time: 0, yaw: 0 }]);
    for (const [variant, supersample, downscale] of [
      ['x1', 1, 'box'],
      ['x2', 2, 'box'],
      ['x4', 4, 'box'],
      ['x8', 8, 'box'],
      ['x4-mode', 4, 'mode'],
      ['x8-mode', 8, 'mode'],
    ] as const) {
      const pixel = { ...BASE_SETTINGS.pixel, downscale };
      const samples: FrameSample[] = [];
      for (const [dir, yaw] of views)
        for (let k = 0; k < 8; k++) samples.push({ key: `walk/${dir}/${pad(k)}`, clip: 'walk', time: k / 8, yaw });
      const started = performance.now();
      const renders = await render(backend, glb, scene(frame, supersample, 16, 4), samples);
      const renderMs = performance.now() - started;
      const sprites = processFrames(
        [...renders].map(([key, image]) => ({ key, clip: 'walk', image })),
        supersample,
        pixel,
        null,
      ).sprites;
      const perDirection = views.map(([dir]) => {
        const seq = Array.from({ length: 8 }, (_, k) => sprites.get(`walk/${dir}/${pad(k)}`) as RgbaImage);
        return { dir, edgeVariance: round(variance(seq.map(edgePixels))), flicker: round(alphaFlicker(seq), 2) };
      });
      result[variant] = {
        edgeVariance: round(perDirection.reduce((a, d) => a + d.edgeVariance, 0) / perDirection.length),
        alphaFlicker: round(perDirection.reduce((a, d) => a + d.flicker, 0) / perDirection.length, 2),
        perDirection,
        renderMsPerFrame: round(renderMs / samples.length, 1),
      };
      rows.push(Array.from({ length: 8 }, (_, k) => sprites.get(`walk/y90/${pad(k)}`) as RgbaImage));

      // Sub-pixel slide: the standing figure moves about two pixels in 16 frames. The silhouette
      // should keep its size and the centre should advance by the same amount every frame.
      // "aligned" steps by exactly 1/8 px, which lines edges up with the 2x and 4x subsample
      // grids; "unaligned" steps by 0.13 px, as real motion does.
      const slideResult: Record<string, unknown> = {};
      for (const [name, model, distance] of [
        ['aligned', slideAligned, 2 / 16],
        ['unaligned', slideUnaligned, 0.13],
      ] as const) {
        const slideSamples: FrameSample[] = [];
        for (const [dir, yaw] of views)
          for (let k = 0; k < 16; k++)
            slideSamples.push({ key: `slide/${dir}/${pad(k)}`, clip: 'slide', time: k / 16, yaw });
        const slid = processFrames(
          [...(await render(backend, model, scene(frame, supersample, 16, 4), slideSamples))].map(([key, image]) => ({
            key,
            clip: 'slide',
            image,
          })),
          supersample,
          pixel,
          null,
        ).sprites;
        const perView = views.map(([dir, yaw]) => {
          const seq = Array.from({ length: 16 }, (_, k) => slid.get(`slide/${dir}/${pad(k)}`) as RgbaImage);
          const xs = seq.map((img) => (centroid(img) as { x: number }).x);
          const steps = xs.slice(1).map((x, i) => x - (xs[i] as number));
          // World +x moves right on screen by cos(yaw) pixels per pixel of travel.
          const expected = Math.cos((yaw * Math.PI) / 180) * distance;
          // Pixels opaque in two consecutive frames that changed colour, as a fraction of those pixels.
          let both = 0;
          let recoloured = 0;
          for (let k = 1; k < seq.length; k++) {
            const a = (seq[k - 1] as RgbaImage).rgba;
            const b = (seq[k] as RgbaImage).rgba;
            for (let i = 0; i < a.length; i += 4) {
              if (a[i + 3] === 0 || b[i + 3] === 0) continue;
              both++;
              if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) recoloured++;
            }
          }
          return {
            areaVariance: variance(
              seq.map((img) => img.rgba.filter((_, i) => i % 4 === 3 && img.rgba[i] !== 0).length),
            ),
            stepError: Math.sqrt(steps.reduce((a, d) => a + (d - expected) ** 2, 0) / steps.length),
            colourChange: recoloured / both,
            colours: seq.reduce((n, img) => n + opaqueColours(img).length, 0) / seq.length,
          };
        });
        slideResult[name] = {
          areaVariance: round(perView.reduce((a, d) => a + d.areaVariance, 0) / perView.length),
          centroidStepRmsError: round(perView.reduce((a, d) => a + d.stepError, 0) / perView.length),
          colourChangeRate: round(perView.reduce((a, d) => a + d.colourChange, 0) / perView.length),
          coloursPerSprite: round(perView.reduce((a, d) => a + d.colours, 0) / perView.length, 1),
        };
      }
      (result[variant] as Record<string, unknown>).slide = slideResult;
    }
    await writeRows('q3-supersample.png', rows);
    metrics.q3 = {
      fixture: 'walker, walk (8 frames) and slide (16 frames over 2 px) clips, 8 views, 32 x 48, 16 px/m',
      metric:
        'walk: variance of edge pixel count across frames (lower is steadier) and mean alpha changes between frames. slide (16 frames, 1/8 px steps aligned with the subsample grid or 0.13 px steps that are not): variance of opaque area (ideal 0) and RMS error of centroid steps against the projected step (ideal 0); fraction of pixels opaque in consecutive frames that change colour; distinct colours per sprite',
      rows: 'q3-supersample.png rows: supersample 1, 2, 4, 8 with box, then 4 and 8 with mode (side view, yaw 90)',
      ...result,
    };
    type Slide = {
      areaVariance: number;
      centroidStepRmsError: number;
      colourChangeRate: number;
      coloursPerSprite: number;
    };
    const slideOf = (k: string) => (result[k] as { slide: { unaligned: Slide } }).slide.unaligned;
    // Silhouettes: 4x with either filter is about as steady as 1x.
    expect(slideOf('x4-mode').areaVariance).toBeLessThan(slideOf('x1').areaVariance * 1.5);
    expect(slideOf('x4-mode').centroidStepRmsError).toBeLessThan(slideOf('x1').centroidStepRmsError * 1.1);
    // Colour: box averaging makes many in-between colours that change from frame to frame;
    // mode keeps the rendered colours and changes them less often than 1x.
    expect(slideOf('x4').colourChangeRate).toBeGreaterThan(slideOf('x1').colourChangeRate * 3);
    expect(slideOf('x4-mode').colourChangeRate).toBeLessThan(slideOf('x1').colourChangeRate);
    expect(slideOf('x4-mode').coloursPerSprite).toBeLessThan(slideOf('x1').coloursPerSprite * 1.2);
  });

  it('Q6: alpha threshold on a thin sword blade', async () => {
    const glb = await swordGlb();
    const frame = { width: 32, height: 48 };
    const yaws = [0, 45, 90, 135, 180, 225, 270, 315];
    const renders = await render(
      backend,
      glb,
      scene(frame, 4, 32, 4),
      yaws.map((yaw) => ({ key: `static/${yaw}`, clip: null, time: 0, yaw })),
    );
    const rows: RgbaImage[][] = [];
    const result: Record<string, unknown> = {};
    for (const threshold of [64, 100, 128, 160, 192]) {
      const sprites = yaws.map((yaw) =>
        thresholdAlpha(boxDownscale(renders.get(`static/${yaw}`) as RgbaImage, 4), threshold),
      );
      // Rows that should hold blade: the blade runs from 0.29 m to 1.29 m above the pivot at 32 px/m.
      const gaps = sprites.map((s) => {
        let missing = 0;
        let rows = 0;
        for (let y = 0; y < s.height; y++) {
          let any = false;
          for (let x = 0; x < s.width; x++) if (s.rgba[(y * s.width + x) * 4 + 3] !== 0) any = true;
          if (
            y >= s.height - 4 - Math.round(1.29 * 32 * Math.cos((30 * Math.PI) / 180)) &&
            y <= s.height - 4 - Math.round(0.35 * 32 * Math.cos((30 * Math.PI) / 180))
          ) {
            rows++;
            if (!any) missing++;
          }
        }
        return missing / rows;
      });
      const pieces = sprites.map(components);
      result[`t${threshold}`] = {
        brokenViews: pieces.filter((p) => p > 1).length,
        meanComponents: round(pieces.reduce((a, b) => a + b, 0) / pieces.length, 2),
        missingBladeRows: round(gaps.reduce((a, b) => a + b, 0) / gaps.length),
        opaquePixels: round(
          sprites.reduce((a, s) => a + s.rgba.filter((_, i) => i % 4 === 3 && s.rgba[i] !== 0).length, 0) /
            sprites.length,
          1,
        ),
      };
      rows.push(sprites);
    }
    await writeRows('q6-threshold.png', rows);
    metrics.q6 = {
      fixture: 'sword, 5 cm x 2 cm blade, 8 views, 32 x 48 at 32 px/m (blade 1.6 px wide face on, 0.6 px edge on)',
      rows: 'q6-threshold.png rows: threshold 64, 100, 128, 160, 192',
      ...result,
    };
    const t = (k: string) => result[k] as { brokenViews: number; missingBladeRows: number };
    // 128 keeps the blade at least as whole as 160, and lower thresholds only thicken it.
    expect(t('t128').brokenViews).toBeLessThanOrEqual(t('t160').brokenViews);
    expect(t('t128').missingBladeRows).toBeLessThanOrEqual(t('t160').missingBladeRows);
  });

  it('Q7: per-asset against per-clip automatic palettes', async () => {
    const glb = await walkerGlb();
    const frame = { width: 32, height: 48 };
    const samples: FrameSample[] = [];
    for (const clip of ['walk', 'turn'])
      for (let k = 0; k < 8; k++) samples.push({ key: `${clip}/s/${pad(k)}`, clip, time: k / 8, yaw: 0 });
    const renders = await render(backend, glb, scene(frame, 4, 16, 4), samples);
    const inputs = [...renders].map(([key, image]) => ({ key, clip: key.split('/')[0] as string, image }));
    // Box downscale, so the sprites have many colours and the palette has real work to do.
    const box = { ...BASE_SETTINGS.pixel, downscale: 'box' as const };
    const reference = processFrames(inputs, 4, box, null).sprites;
    const error = (sprites: ReadonlyMap<string, RgbaImage>, clip: string) => {
      let sum = 0;
      let n = 0;
      for (const [key, img] of sprites) {
        if (!key.startsWith(`${clip}/`)) continue;
        const ref = reference.get(key) as RgbaImage;
        for (let i = 0; i < img.rgba.length; i += 4) {
          if (img.rgba[i + 3] === 0) continue;
          const a = rgbToOklab(img.rgba[i] as number, img.rgba[i + 1] as number, img.rgba[i + 2] as number);
          const b = rgbToOklab(ref.rgba[i] as number, ref.rgba[i + 1] as number, ref.rgba[i + 2] as number);
          sum += Math.sqrt(oklabDistanceSq(a, b));
          n++;
        }
      }
      return sum / n;
    };
    const rows: RgbaImage[][] = [];
    const result: Record<string, unknown> = {};
    for (const count of [6, 12]) {
      for (const scope of ['asset', 'clip'] as const) {
        const out = processFrames(inputs, 4, { ...box, palette: `auto:${count}`, paletteScope: scope }, null);
        // The first frames of both clips show the same pose, so any colour change between them is flicker at the clip boundary.
        const a = out.sprites.get('walk/s/000') as RgbaImage;
        const b = out.sprites.get('turn/s/000') as RgbaImage;
        let changed = 0;
        for (let i = 0; i < a.rgba.length; i += 4)
          if (
            a.rgba[i + 3] !== 0 &&
            b.rgba[i + 3] !== 0 &&
            (a.rgba[i] !== b.rgba[i] || a.rgba[i + 1] !== b.rgba[i + 1] || a.rgba[i + 2] !== b.rgba[i + 2])
          )
            changed++;
        const palettes = Object.values(out.palettes);
        result[`auto${count}-${scope}`] = {
          errorWalk: round(error(out.sprites, 'walk'), 4),
          errorTurn: round(error(out.sprites, 'turn'), 4),
          boundaryChangedPixels: changed,
          distinctColours: new Set(palettes.flat()).size,
        };
        rows.push([
          ...['walk', 'turn'].flatMap((clip) =>
            [0, 2, 4, 6].map((k) => out.sprites.get(`${clip}/s/${pad(k)}`) as RgbaImage),
          ),
        ]);
      }
    }
    await writeRows('q7-palette-scope.png', rows);
    metrics.q7 = {
      fixture:
        'walker, walk and turn clips, south view, 8 frames each, box downscale (about 50 colours per sprite before the palette)',
      metric:
        'mean Oklab error against unquantised sprites; pixels that change colour between the identical first frames of the two clips',
      rows: 'q7-palette-scope.png rows: auto:6 asset, auto:6 clip, auto:12 asset, auto:12 clip (walk 0, 2, 4, 6 then turn 0, 2, 4, 6)',
      ...result,
    };
    const r = (k: string) => result[k] as { boundaryChangedPixels: number; errorTurn: number; errorWalk: number };
    expect(r('auto6-asset').boundaryChangedPixels).toBe(0);
    expect(r('auto6-clip').boundaryChangedPixels).toBeGreaterThan(0);
    expect(r('auto6-clip').errorWalk + r('auto6-clip').errorTurn).toBeLessThan(
      r('auto6-asset').errorWalk + r('auto6-asset').errorTurn,
    );
  });

  it('Q8: in-house indexed PNG writer against sharp palette output', async () => {
    const glb = await walkerGlb();
    const pico = (
      JSON.parse(readFileSync(join(import.meta.dirname, '../../palettes/pico-8.json'), 'utf8')) as { colors: string[] }
    ).colors;
    const samples: FrameSample[] = Array.from({ length: 8 }, (_, k) => ({
      key: `walk/w/${pad(k)}`,
      clip: 'walk',
      time: k / 8,
      yaw: 90,
    }));
    const renders = await render(backend, glb, scene({ width: 32, height: 48 }, 4, 16, 4), samples);
    const settings = {
      ...BASE_SETTINGS.pixel,
      palette: 'fixed:pico-8',
      dither: 'bayer-4' as const,
      ditherStrength: 0.35,
    };
    const sprites = [
      ...processFrames(
        [...renders].map(([key, image]) => ({ key, clip: 'walk', image })),
        4,
        settings,
        pico,
      ).sprites.values(),
    ];
    const strip = { width: 32 * 8, height: 48, rgba: new Uint8Array(32 * 8 * 48 * 4) };
    sprites.forEach((s, i) => {
      for (let y = 0; y < 48; y++)
        strip.rgba.set(s.rgba.subarray(y * 32 * 4, (y + 1) * 32 * 4), (y * strip.width + i * 32) * 4);
    });
    const decode = async (png: Buffer) => new Uint8Array((await sharp(png).ensureAlpha().raw().toBuffer()).buffer);
    const exact = (a: Uint8Array) => {
      let diff = 0;
      for (let i = 0; i < a.length; i += 4) {
        const alpha = strip.rgba[i + 3] as number;
        if (
          a[i + 3] !== alpha ||
          (alpha !== 0 && (a[i] !== strip.rgba[i] || a[i + 1] !== strip.rgba[i + 1] || a[i + 2] !== strip.rgba[i + 2]))
        )
          diff++;
      }
      return diff;
    };
    const time = async (fn: () => Promise<Buffer> | Buffer) => {
      await fn();
      const start = performance.now();
      let out = await fn();
      for (let i = 0; i < 9; i++) out = await fn();
      return { out, ms: round((performance.now() - start) / 10, 2) };
    };
    const raw = () =>
      sharp(Buffer.from(strip.rgba), { raw: { width: strip.width, height: strip.height, channels: 4 } });
    const inHouse = await time(() => (encodeIndexedPng(strip) as NonNullable<ReturnType<typeof encodeIndexedPng>>).png);
    // The same image with the edge-bleed colours of transparent pixels dropped, which is what sharp's palette output does.
    const unbled = { ...strip, rgba: strip.rgba.map((v, i) => (strip.rgba[i - (i % 4) + 3] === 0 ? 0 : v)) };
    const inHouseNoBleed = (encodeIndexedPng(unbled) as NonNullable<ReturnType<typeof encodeIndexedPng>>).png;
    const bleedKept = async (png: Buffer) => {
      const back = await decode(png);
      let kept = 0;
      let total = 0;
      for (let i = 0; i < back.length; i += 4) {
        if (strip.rgba[i + 3] !== 0 || (strip.rgba[i] === 0 && strip.rgba[i + 1] === 0 && strip.rgba[i + 2] === 0))
          continue;
        total++;
        if (back[i] === strip.rgba[i] && back[i + 1] === strip.rgba[i + 1] && back[i + 2] === strip.rgba[i + 2]) kept++;
      }
      return round(kept / total, 3);
    };
    const sharpPalette = await time(() =>
      raw().png({ palette: true, colours: 16, dither: 0, compressionLevel: 9 }).toBuffer(),
    );
    const sharpRgba = await time(() => raw().png({ compressionLevel: 9 }).toBuffer());
    const again = await raw().png({ palette: true, colours: 16, dither: 0, compressionLevel: 9 }).toBuffer();
    const sharpColours = opaqueColours({
      width: strip.width,
      height: strip.height,
      rgba: await decode(sharpPalette.out),
    });
    metrics.q8 = {
      fixture:
        'walker walk, west view, 8 frames of 32 x 48 snapped to PICO-8 with bayer-4 dither, as one 256 x 48 strip',
      sourceColours: opaqueColours(strip).length,
      inHouse: {
        bytes: inHouse.out.length,
        ms: inHouse.ms,
        pixelsChanged: exact(await decode(inHouse.out)),
        bleedColoursKept: await bleedKept(inHouse.out),
        deterministic:
          Buffer.compare(
            inHouse.out,
            (encodeIndexedPng(strip) as NonNullable<ReturnType<typeof encodeIndexedPng>>).png,
          ) === 0,
      },
      inHouseWithoutBleed: { bytes: inHouseNoBleed.length },
      sharpPalette: {
        bytes: sharpPalette.out.length,
        ms: sharpPalette.ms,
        pixelsChanged: exact(await decode(sharpPalette.out)),
        bleedColoursKept: await bleedKept(sharpPalette.out),
        coloursOutsidePalette: sharpColours.filter((c) => !pico.includes(c)).length,
        deterministic: Buffer.compare(sharpPalette.out, again) === 0,
      },
      sharpRgba: { bytes: sharpRgba.out.length, ms: sharpRgba.ms },
      licence:
        'sharp 0.35.5 bundles libvips 8.18.7 with libimagequant 2.4.1 from lovell/libimagequant under BSD 2-Clause (sharp-libvips README); libvips itself is LGPL-3.0-or-later, dynamically linked.',
    };
    const m = metrics.q8 as {
      inHouse: { bytes: number; pixelsChanged: number; deterministic: boolean; bleedColoursKept: number };
      inHouseWithoutBleed: { bytes: number };
      sharpPalette: { bytes: number };
      sharpRgba: { bytes: number };
    };
    expect(m.inHouse.bleedColoursKept).toBe(1);
    // Like for like, the two encoders are within a few percent of each other.
    expect(Math.abs(m.inHouseWithoutBleed.bytes - m.sharpPalette.bytes) / m.sharpPalette.bytes).toBeLessThan(0.1);
    expect(m.inHouse.pixelsChanged).toBe(0);
    expect(m.inHouse.deterministic).toBe(true);
    expect(m.inHouse.bytes).toBeLessThan(m.sharpRgba.bytes);
  });
});
