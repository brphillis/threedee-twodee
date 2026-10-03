import { z } from 'zod';

const Rect = z.strictObject({ x: z.number().int(), y: z.number().int(), w: z.number().int(), h: z.number().int() });
const Size = z.strictObject({ w: z.number().int(), h: z.number().int() });
const Point = z.strictObject({ x: z.number(), y: z.number() });

export const AsepriteFrame = z.strictObject({
  frame: Rect,
  rotated: z.boolean(),
  trimmed: z.boolean(),
  spriteSourceSize: Rect,
  sourceSize: Size,
  duration: z.number().int().positive().meta({ description: 'Milliseconds.' }),
});

export const AsepriteFrameTag = z.strictObject({
  name: z.string(),
  from: z.number().int().min(0),
  to: z.number().int().min(0),
  direction: z.enum(['forward', 'reverse', 'pingpong', 'pingpong_reverse']),
  color: z.string().optional(),
  data: z.string().optional(),
});

export const AsepriteSlice = z.strictObject({
  name: z.string(),
  color: z.string(),
  data: z.string().optional(),
  keys: z.array(z.strictObject({ frame: z.number().int(), bounds: Rect, pivot: Point.optional() })),
});

/**
 * The Aseprite "JSON Hash" sprite sheet format, as written by Aseprite's doc_exporter.cpp.
 * Phaser's `load.aseprite`, PixiJS spritesheets and Godot importers read it.
 */
export const AsepriteSheet = z
  .strictObject({
    frames: z.record(z.string(), AsepriteFrame).meta({ description: 'Frames by name, in sheet order.' }),
    meta: z
      .strictObject({
        app: z.string(),
        version: z.string(),
        image: z.string(),
        format: z.literal('RGBA8888'),
        size: Size,
        scale: z.string(),
        frameTags: z.array(AsepriteFrameTag),
        layers: z.array(z.unknown()),
        slices: z.array(AsepriteSlice),
      })
      .meta({ description: 'The sheet image and size, one frame tag per clip and direction, and a pivot slice.' }),
  })
  .meta({ description: 'Aseprite JSON Hash sprite sheet data.' });

export type AsepriteSheetT = z.infer<typeof AsepriteSheet>;
