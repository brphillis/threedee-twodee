import { z } from 'zod';
import { Description, Name, SchemaRef, SchemaVersion } from '../primitives.ts';

const SheetFields = {
  layout: z.enum(['grid', 'strips', 'packed']).meta({
    description:
      'grid: one row per clip and direction, one column per frame. strips: a separate sheet for each clip and direction. packed: sprites packed tightly with the maxrects algorithm.',
  }),
  order: z.enum(['clip-direction', 'direction-clip']).meta({
    description:
      'Sequence order. clip-direction groups the sequences of a clip together; direction-clip groups by direction.',
  }),
  flow: z.enum(['rows', 'columns']).meta({
    description: 'grid and strips: each clip and direction runs along a row (left to right) or down a column.',
  }),
  split: z.enum(['none', 'clip', 'direction']).meta({
    description:
      'Make a separate sheet for each clip or each direction. Sheets also split when they would exceed maxSize.',
  }),
  trim: z.boolean().meta({
    description: 'packed: cut each sprite to its opaque pixels. The offset is recorded so pivots stay correct.',
  }),
  padding: z.number().int().min(0).max(64).meta({ description: 'Transparent pixels between cells.' }),
  extrude: z
    .number()
    .int()
    .min(0)
    .max(8)
    .meta({ description: 'Pixels of edge duplication around each cell, for engines that filter textures.' }),
  powerOfTwo: z.boolean().meta({ description: 'Round sheet sizes up to powers of two.' }),
  maxSize: z
    .number()
    .int()
    .min(64)
    .max(16384)
    .meta({ description: 'Largest sheet edge in pixels. Larger layouts split into numbered sheets.' }),
};

export const SheetSettings = z
  .strictObject(SheetFields)
  .refine((s) => !s.trim || s.layout === 'packed', { message: 'trim needs layout "packed"', path: ['trim'] })
  .meta({ description: 'Sprite sheet layout settings.' });

export const SheetOverrides = z
  .strictObject(SheetFields)
  .partial()
  .extend({ preset: Name.optional().meta({ description: 'Sheet preset to start from.' }) })
  .meta({ description: 'A sheet preset name plus overrides.' });

export const SheetPreset = z
  .strictObject(SheetFields)
  .partial()
  .extend({
    $schema: SchemaRef.optional(),
    schemaVersion: SchemaVersion,
    name: Name,
    description: Description.optional(),
  })
  .meta({
    description: 'A named set of sheet settings.',
    examples: [{ schemaVersion: '1.0.0', name: 'atlas-1024', layout: 'packed', trim: true, maxSize: 1024 }],
  });

export type SheetSettingsT = z.infer<typeof SheetSettings>;
export type SheetOverridesT = z.infer<typeof SheetOverrides>;
export type SheetPresetT = z.infer<typeof SheetPreset>;
