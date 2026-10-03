import { z } from 'zod';
import { Description, HexColor, Name, SchemaRef, SchemaVersion } from '../primitives.ts';
import { PaletteMode } from './palette.ts';

/** Pixel passes in their default order. `downscale` and `alphaThreshold` always run. */
export const PIXEL_PASSES = [
  'downscale',
  'alphaThreshold',
  'posterize',
  'palette',
  'outline',
  'cleanup',
  'bleed',
] as const;
export const PixelPass = z.enum(PIXEL_PASSES);

export const OutlineSettings = z
  .strictObject({
    color: HexColor,
    side: z
      .enum(['outside', 'inside'])
      .meta({ description: 'outside grows the silhouette by the outline; inside recolours its edge pixels.' }),
    width: z.number().int().min(1).max(4),
    connectivity: z
      .union([z.literal(4), z.literal(8)])
      .optional()
      .meta({ description: '8 (default) outlines diagonal corners too; 4 leaves them open for a softer look.' }),
    snapToPalette: z
      .boolean()
      .optional()
      .meta({ description: 'Replace the outline colour with the nearest palette colour. Default false.' }),
  })
  .meta({
    description: 'One-colour outline drawn from the alpha mask.',
    examples: [{ color: '#1a1c2c', side: 'outside', width: 1 }],
  });

export const CleanupSettings = z
  .strictObject({
    orphans: z.union([z.enum(['off', 'remove', 'recolour']), z.boolean()]).meta({
      description:
        'off: keep everything. remove: delete opaque pixels with fewer than minNeighbours opaque neighbours. recolour: give single pixels whose colour matches none of their neighbours the most common neighbouring colour. true means remove.',
    }),
    minNeighbours: z
      .number()
      .int()
      .min(1)
      .max(4)
      .meta({ description: 'For remove: fewest opaque 4-neighbours a pixel needs to stay. Default 1.' }),
  })
  .meta({ description: 'Stray-pixel cleanup.' });

export const PixelSettings = z
  .strictObject({
    downscale: z.enum(['box', 'mode']).meta({
      description:
        'Downscale filter from the supersampled render. Both use the share of the block that is covered for alpha. box averages the colours, which smooths shading but makes in-between colours; mode takes the most common colour, which keeps only rendered colours.',
    }),
    alphaThreshold: z
      .number()
      .int()
      .min(1)
      .max(255)
      .meta({ description: 'Pixels with alpha at or above this value become opaque; all others become transparent.' }),
    bleed: z.boolean().meta({
      description:
        'Give transparent pixels the nearest opaque colour so engines that filter textures do not show dark halos.',
    }),
    posterize: z
      .union([z.literal('none'), z.number().int().min(2).max(32)])
      .meta({ description: 'Quantise each colour channel to this many levels before palette mapping.' }),
    palette: PaletteMode,
    paletteScope: z
      .enum(['asset', 'clip'])
      .meta({ description: 'For auto palettes: one palette for the whole asset (stable), or one per clip.' }),
    dither: z.enum(['none', 'bayer-2', 'bayer-4', 'bayer-8']).meta({
      description:
        'Ordered dither used while mapping to a palette. Position-based, so it does not crawl between frames.',
    }),
    ditherStrength: z.number().min(0).max(1).meta({ description: 'How far dithering may push a colour, from 0 to 1.' }),
    outline: z
      .union([z.literal('none'), OutlineSettings])
      .meta({ description: 'none, or a one-colour outline drawn from the alpha mask.' }),
    cleanup: CleanupSettings.meta({ description: 'What to do with stray single pixels.' }),
    passes: z.array(PixelPass).min(2).optional().meta({
      description:
        'Run these passes in this order instead of the default. It must start with downscale and include alphaThreshold.',
    }),
  })
  .meta({ description: 'Pixel-art processing settings.' });

export const PixelOverrides = PixelSettings.partial()
  .extend({
    preset: Name.optional().meta({ description: 'Pixel preset to start from.' }),
    cleanup: CleanupSettings.partial().optional().meta({ description: 'What to do with stray single pixels.' }),
  })
  .meta({ description: 'A pixel preset name plus overrides.' });

export const PixelPreset = PixelSettings.partial()
  .extend({
    $schema: SchemaRef.optional(),
    schemaVersion: SchemaVersion,
    name: Name,
    description: Description.optional(),
    cleanup: CleanupSettings.partial().optional().meta({ description: 'What to do with stray single pixels.' }),
  })
  .meta({
    description: 'A named set of pixel settings. Unset fields keep their defaults.',
    examples: [
      {
        schemaVersion: '1.0.0',
        name: 'crisp-12',
        palette: 'auto:12',
        outline: { color: '#1a1c2c', side: 'outside', width: 1, snapToPalette: true },
        cleanup: { orphans: 'remove' },
      },
    ],
  });

export type PixelPassT = z.infer<typeof PixelPass>;
export type OutlineSettingsT = z.infer<typeof OutlineSettings>;
export type PixelSettingsT = z.infer<typeof PixelSettings>;
export type PixelOverridesT = z.infer<typeof PixelOverrides>;
export type PixelPresetT = z.infer<typeof PixelPreset>;
