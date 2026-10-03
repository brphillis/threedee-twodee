import { PIXEL_PASSES, type PixelPassT, type PixelSettingsT } from '@td2d/schema';
import { Td2dError } from '../errors.ts';
import type { RgbaImage } from './image.ts';
import { hexToRgb, packRgb } from './oklab.ts';
import { Palette } from './palette.ts';
import {
  bleedEdges,
  boxDownscale,
  cleanupOrphans,
  mapToPalette,
  modeDownscale,
  outline,
  posterize,
  thresholdAlpha,
} from './passes.ts';

export function orphanMode(settings: PixelSettingsT): 'off' | 'remove' | 'recolour' {
  const value = settings.cleanup.orphans;
  return value === true ? 'remove' : value === false ? 'off' : value;
}

/** The passes to run, in order, checked so the mandatory ones are present. */
export function passOrder(settings: PixelSettingsT): readonly PixelPassT[] {
  const order = settings.passes ?? PIXEL_PASSES;
  if (order[0] !== 'downscale' || !order.includes('alphaThreshold')) {
    throw new Td2dError('E_ASSET_INVALID', 'pixel.passes must start with "downscale" and include "alphaThreshold".', {
      issues: [
        {
          path: 'pixel.passes',
          message: 'Start with "downscale" and include "alphaThreshold"',
          code: 'invalid_passes',
        },
      ],
    });
  }
  if (new Set(order).size !== order.length) {
    throw new Td2dError('E_ASSET_INVALID', 'pixel.passes lists a pass twice.', {
      issues: [{ path: 'pixel.passes', message: 'Each pass may appear once', code: 'invalid_passes' }],
    });
  }
  return order;
}

export interface FrameInput {
  readonly key: string;
  readonly clip: string;
  readonly image: RgbaImage;
}

export interface ProcessResult {
  readonly sprites: ReadonlyMap<string, RgbaImage>;
  /** Palette colours as #rrggbb, by clip for clip-scoped palettes and under "*" otherwise. Empty without a palette. */
  readonly palettes: Readonly<Record<string, readonly string[]>>;
  readonly removed: number;
  readonly recoloured: number;
}

/** State shared by the passes of one run. */
export interface PixelPassContext {
  readonly supersample: number;
  readonly settings: PixelSettingsT;
  /** Colours of the fixed palette named by settings.palette, resolved from the library. */
  readonly fixedPalette: readonly string[] | null;
  readonly clipOf: ReadonlyMap<string, string>;
  /** Palettes made by the palette pass: under "*", or by clip for clip-scoped automatic palettes. */
  readonly palettes: Map<string, Palette>;
  readonly counts: { removed: number; recoloured: number };
}

/**
 * One step of pixel processing. A pass sees every frame at once, so the palette pass can
 * build one automatic palette from all of them. Bump `version` whenever a pass's output
 * changes for the same input: versions are part of the pixel stage's cache key.
 */
export interface PixelPass {
  readonly id: PixelPassT;
  readonly version: number;
  readonly description: string;
  /** Whether these settings make the pass do anything. Disabled passes are skipped. */
  enabled(settings: PixelSettingsT): boolean;
  run(images: ReadonlyMap<string, RgbaImage>, ctx: PixelPassContext): Map<string, RgbaImage>;
}

const each = (images: ReadonlyMap<string, RgbaImage>, fn: (img: RgbaImage, key: string) => RgbaImage) =>
  new Map([...images].map(([key, img]) => [key, fn(img, key)]));

/** The palette a frame was mapped to, if any. */
function paletteFor(ctx: PixelPassContext, key: string): Palette | undefined {
  return (
    ctx.palettes.get(ctx.settings.paletteScope === 'clip' ? (ctx.clipOf.get(key) as string) : '*') ??
    ctx.palettes.get('*')
  );
}

/** Every pixel pass by id. */
export const PIXEL_PASS_REGISTRY: Readonly<Record<PixelPassT, PixelPass>> = {
  downscale: {
    id: 'downscale',
    version: 2,
    description:
      'Reduce each supersample x supersample block to one pixel: alpha from coverage, colour from the mean (box) or the most common colour (mode).',
    enabled: () => true,
    run: (images, ctx) =>
      each(images, (img) =>
        ctx.settings.downscale === 'mode' ? modeDownscale(img, ctx.supersample) : boxDownscale(img, ctx.supersample),
      ),
  },
  alphaThreshold: {
    id: 'alphaThreshold',
    version: 1,
    description: 'Make alpha binary at alphaThreshold.',
    enabled: () => true,
    run: (images, ctx) => each(images, (img) => thresholdAlpha(img, ctx.settings.alphaThreshold)),
  },
  posterize: {
    id: 'posterize',
    version: 1,
    description: 'Quantise each colour channel to evenly spaced levels.',
    enabled: (settings) => settings.posterize !== 'none',
    run: (images, ctx) => each(images, (img) => posterize(img, ctx.settings.posterize as number)),
  },
  palette: {
    id: 'palette',
    version: 1,
    description: 'Snap colours to a fixed or automatic palette in Oklab space, with optional ordered dithering.',
    enabled: (settings) => settings.palette !== 'none',
    run: (images, ctx) => {
      const mode = ctx.settings.palette;
      if (mode.startsWith('fixed:')) {
        if (!ctx.fixedPalette) throw new Td2dError('E_INTERNAL', `Palette ${mode} was not resolved.`);
        ctx.palettes.set('*', Palette.fromHex(ctx.fixedPalette));
      } else {
        const count = Number(mode.slice('auto:'.length));
        if (ctx.settings.paletteScope === 'clip') {
          for (const clip of new Set(ctx.clipOf.values())) {
            ctx.palettes.set(
              clip,
              Palette.fromImages(
                [...images].filter(([k]) => ctx.clipOf.get(k) === clip).map(([, img]) => img),
                count,
              ),
            );
          }
        } else {
          ctx.palettes.set('*', Palette.fromImages([...images.values()], count));
        }
      }
      return each(images, (img, key) =>
        mapToPalette(img, paletteFor(ctx, key) as Palette, ctx.settings.dither, ctx.settings.ditherStrength),
      );
    },
  },
  outline: {
    id: 'outline',
    version: 1,
    description: 'Draw a one-colour ring outside the silhouette, or recolour its edge pixels.',
    enabled: (settings) => settings.outline !== 'none',
    run: (images, ctx) => {
      const o = ctx.settings.outline as Exclude<PixelSettingsT['outline'], 'none'>;
      const base = packRgb(...hexToRgb(o.color));
      return each(images, (img, key) => {
        const palette = paletteFor(ctx, key);
        const colour =
          o.snapToPalette && palette ? palette.nearest((base >> 16) & 255, (base >> 8) & 255, base & 255) : base;
        return outline(img, o, colour);
      });
    },
  },
  cleanup: {
    id: 'cleanup',
    version: 1,
    description: 'Remove or recolour stray pixels.',
    enabled: (settings) => orphanMode(settings) !== 'off',
    run: (images, ctx) =>
      each(images, (img) => {
        const result = cleanupOrphans(img, orphanMode(ctx.settings), ctx.settings.cleanup.minNeighbours);
        ctx.counts.removed += result.removed;
        ctx.counts.recoloured += result.recoloured;
        return result.image;
      }),
  },
  bleed: {
    id: 'bleed',
    version: 1,
    description: 'Give transparent pixels the colour of the nearest opaque pixel.',
    enabled: (settings) => settings.bleed,
    run: (images) => each(images, (img) => bleedEdges(img)),
  },
};

/** The passes these settings run, in order, as "id@version". Part of the pixel stage's cache key. */
export function passSignature(settings: PixelSettingsT): string[] {
  return passOrder(settings)
    .map((id) => PIXEL_PASS_REGISTRY[id])
    .filter((p) => p.enabled(settings))
    .map((p) => `${p.id}@${p.version}`);
}

/**
 * Turn supersampled renders into sprites. Passes run over all frames together, in order,
 * so an automatic palette is built from every frame it applies to and stays the same for
 * all of them. A palette pass placed before an outline or cleanup can leave colours outside
 * the palette; validation reports them.
 */
export function processFrames(
  frames: readonly FrameInput[],
  supersample: number,
  settings: PixelSettingsT,
  fixedPalette: readonly string[] | null,
): ProcessResult {
  const ctx: PixelPassContext = {
    supersample,
    settings,
    fixedPalette,
    clipOf: new Map(frames.map((f) => [f.key, f.clip])),
    palettes: new Map(),
    counts: { removed: 0, recoloured: 0 },
  };
  let images: ReadonlyMap<string, RgbaImage> = new Map(frames.map((f) => [f.key, f.image]));
  for (const id of passOrder(settings)) {
    const pass = PIXEL_PASS_REGISTRY[id];
    if (pass.enabled(settings)) images = pass.run(images, ctx);
  }
  return {
    sprites: images,
    palettes: Object.fromEntries([...ctx.palettes].map(([k, p]) => [k, p.toHex()])),
    removed: ctx.counts.removed,
    recoloured: ctx.counts.recoloured,
  };
}

/** One sprite from one render, for callers outside the pipeline. */
export function processFrame(
  render: RgbaImage,
  supersample: number,
  settings: PixelSettingsT,
  fixedPalette: readonly string[] | null = null,
): RgbaImage {
  return processFrames(
    [{ key: 'frame', clip: 'clip', image: render }],
    supersample,
    settings,
    fixedPalette,
  ).sprites.get('frame') as RgbaImage;
}
