import { z } from 'zod';
import { Description, HexColor, Name, SchemaRef, SchemaVersion } from '../primitives.ts';

export const PaletteDefinition = z
  .strictObject({
    $schema: SchemaRef.optional(),
    schemaVersion: SchemaVersion,
    name: Name,
    description: Description.optional(),
    source: z.url().optional().meta({ description: 'Where the palette comes from.' }),
    author: z.string().max(200).optional().meta({ description: 'Who made the palette.' }),
    colors: z.array(HexColor).min(1).max(256).meta({ description: 'Palette colours in index order.' }),
  })
  .meta({
    description: 'A named list of colours.',
    examples: [{ schemaVersion: '1.0.0', name: 'tiny', colors: ['#000000', '#ffffff'] }],
  });

/**
 * Palette mode for the pixel stage.
 * "none" keeps rendered colours, "fixed:<name>" snaps to a palette, "auto:<n>" builds an n-colour palette.
 */
export const PaletteMode = z
  .string()
  .regex(/^(none|fixed:[a-z0-9][a-z0-9-]*|auto:([2-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-6]))$/, {
    message: 'Expected "none", "fixed:<palette-name>" or "auto:<2-256>"',
  })
  .meta({
    description: 'none, fixed:<palette-name> or auto:<colour count>.',
    examples: ['none', 'fixed:endesga-32', 'auto:16'],
  });

export type PaletteDefinitionT = z.infer<typeof PaletteDefinition>;
export type PaletteModeT = z.infer<typeof PaletteMode>;
