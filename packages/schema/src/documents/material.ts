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

export const MaterialDefinition = z
  .strictObject({
    description: Description.optional(),
    color: ColorValue,
    shading: Shading.optional(),
    bands: z
      .number()
      .int()
      .min(2)
      .max(8)
      .optional()
      .meta({ description: 'Number of light bands for toon shading. Default 3.' }),
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
    examples: [{ color: '#a0693a', shading: 'toon', bands: 3, outline: true }],
  });

export type PaletteColorRefT = z.infer<typeof PaletteColorRef>;
export type ColorValueT = z.infer<typeof ColorValue>;
export type MaterialDefinitionT = z.infer<typeof MaterialDefinition>;
