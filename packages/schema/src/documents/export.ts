import { z } from 'zod';
import { Description, HexColor, Name, SchemaRef, SchemaVersion } from '../primitives.ts';

export const ExportFormat = z
  .enum(['aseprite-json', 'manifest', 'frames', 'pixi', 'phaser-atlas', 'godot-spriteframes', 'gif-preview'])
  .meta({ description: 'Output format identifier.' });

const Png = z.strictObject({
  indexed: z
    .enum(['auto', 'always', 'never'])
    .meta({ description: 'auto writes indexed PNGs whenever a palette is set.' }),
  compressionLevel: z.number().int().min(0).max(9),
});

const Aseprite = z
  .strictObject({
    variant: z
      .enum(['hash', 'array'])
      .meta({ description: 'hash: frames keyed by name. array: frames in a list, each with a filename.' }),
    frameNames: z.enum(['index', 'descriptive']).meta({
      description:
        'index names frames 0, 1, 2 like Aseprite\'s "{frame}" item filename, which Phaser\'s createFromAseprite needs. descriptive names them "<asset> (<clip>_<direction>) <n>.png".',
    }),
  })
  .meta({ description: 'Options for aseprite-json.' });

const Godot = z
  .strictObject({
    directory: z
      .string()
      .regex(/^res:\/\/([A-Za-z0-9_.-]+\/)*$/, 'Expected a Godot path ending in "/", such as "res://sprites/"')
      .meta({ description: 'Where the sheet images will live in the Godot project. Default res://.' }),
  })
  .meta({ description: 'Options for godot-spriteframes.' });

const Gif = z
  .strictObject({
    scale: z.number().int().min(1).max(8).meta({ description: 'Enlargement factor. Default 2.' }),
    background: z
      .union([z.literal('transparent'), HexColor])
      .meta({ description: 'transparent, or a #rrggbb colour behind the sprites. Default transparent.' }),
  })
  .meta({ description: 'Options for gif-preview.' });

const ExportFields = {
  formats: z.array(ExportFormat).min(1).meta({ description: 'Formats to write. manifest is always written.' }),
  png: Png,
  aseprite: Aseprite,
  godot: Godot,
  gif: Gif,
};

export const ExportSettings = z.strictObject(ExportFields).meta({ description: 'Export settings.' });

const partials = {
  png: Png.partial().optional().meta({ description: 'How sheet PNGs are written: indexed or RGBA, and compression.' }),
  aseprite: Aseprite.partial().optional().meta({ description: 'Options for aseprite-json.' }),
  godot: Godot.partial().optional().meta({ description: 'Options for godot-spriteframes.' }),
  gif: Gif.partial().optional().meta({ description: 'Options for gif-preview.' }),
};

export const ExportOverrides = ExportSettings.partial()
  .extend({ preset: Name.optional().meta({ description: 'Export preset to start from.' }), ...partials })
  .meta({ description: 'An export preset name plus overrides.' });

export const ExportPreset = ExportSettings.partial()
  .extend({
    $schema: SchemaRef.optional(),
    schemaVersion: SchemaVersion,
    name: Name,
    description: Description.optional(),
    ...partials,
  })
  .meta({
    description: 'A named set of export settings.',
    examples: [
      {
        schemaVersion: '1.0.0',
        name: 'phaser',
        formats: ['aseprite-json', 'manifest'],
        aseprite: { frameNames: 'index' },
      },
    ],
  });

export type ExportFormatT = z.infer<typeof ExportFormat>;
export type ExportSettingsT = z.infer<typeof ExportSettings>;
export type ExportOverridesT = z.infer<typeof ExportOverrides>;
export type ExportPresetT = z.infer<typeof ExportPreset>;
