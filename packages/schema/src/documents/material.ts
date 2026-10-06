import { z } from 'zod';
import { Description, HexColor, Name } from '../primitives.ts';

export const PaletteColorRef = z
  .strictObject({
    palette: Name.meta({ description: 'Palette name.' }),
    index: z.number().int().min(0).max(255).meta({ description: 'Zero-based colour index within the palette.' }),
  })
  .meta({ description: 'A colour taken from a named palette by index.' });

export const ColorValue = z
  .union([HexColor, PaletteColorRef])
  .meta({ description: 'Either a #rrggbb colour or a palette reference.' });

export const Shading = z
  .enum(['toon', 'flat', 'lambert'])
  .meta({ description: 'toon: banded lighting. flat: unlit base colour. lambert: smooth diffuse lighting.' });

export const ColorRamp = z
  .array(ColorValue)
  .min(2)
  .max(8)
  .meta({
    description:
      'Colours from shadow to full light, each a #rrggbb or a palette reference. Toon shading paints each light level with one of them, darkest first, in place of color and bands, so shadows and highlights can change hue as in hand-painted pixel art.',
    examples: [['#5d275d', '#b13e53', '#ef7d57', '#ffcd75']],
  });

export const MaterialDefinition = z
  .strictObject({
    description: Description.optional(),
    color: ColorValue.optional().meta({
      description: 'Either a #rrggbb colour or a palette reference. Required unless ramp is set.',
    }),
    shading: Shading.optional(),
    bands: z
      .number()
      .int()
      .min(2)
      .max(8)
      .optional()
      .meta({ description: 'Number of light bands for toon shading. Default 3. A ramp sets it to its length.' }),
    ramp: ColorRamp.optional(),
    hueShift: z.number().min(-180).max(180).optional().meta({
      description:
        'Degrees to turn the hue of darker toon bands, making a ramp from color: positive turns shadows towards blue-violet, negative towards yellow. The full-light band keeps color; the shadow band turns by the whole amount and the bands between by their share. Default 0.',
    }),
    emissive: HexColor.optional().meta({ description: 'Emissive colour added regardless of lighting.' }),
    outline: z.boolean().optional().meta({
      description:
        'Whether render.lines may line this material. Default true. Turn it off for fine detail such as grain, stitching or strands, and for dark gaps.',
    }),
    opacity: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .meta({ description: 'Render opacity. The pixel stage thresholds alpha, so values below 1 produce a warning.' }),
  })
  .meta({
    description: 'Renderer-agnostic material.',
    examples: [
      { color: '#a0693a', shading: 'toon', bands: 3, outline: true },
      { color: '#a0693a', hueShift: 30 },
      { ramp: ['#5d275d', '#b13e53', '#ef7d57', '#ffcd75'] },
    ],
  });

export type ColorRampT = z.infer<typeof ColorRamp>;
export type PaletteColorRefT = z.infer<typeof PaletteColorRef>;
export type ColorValueT = z.infer<typeof ColorValue>;
export type MaterialDefinitionT = z.infer<typeof MaterialDefinition>;
