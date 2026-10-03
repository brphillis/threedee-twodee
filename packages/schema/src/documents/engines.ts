import { z } from 'zod';
import { AsepriteFrame, AsepriteSheet } from './aseprite.ts';

const Rect = z.strictObject({ x: z.number().int(), y: z.number().int(), w: z.number().int(), h: z.number().int() });
const Size = z.strictObject({ w: z.number().int(), h: z.number().int() });
const Anchor = z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });

/** Aseprite "JSON Array" data: the same as the hash variant, with frames in a list. */
export const AsepriteSheetArray = AsepriteSheet.extend({
  frames: z
    .array(AsepriteFrame.extend({ filename: z.string() }))
    .meta({ description: 'Frames in sheet order, each with its filename.' }),
}).meta({ description: 'Aseprite JSON Array sprite sheet data.' });

/** A PixiJS v8 spritesheet (`Assets.load` or `new Spritesheet`), one per sheet image. */
export const PixiSheet = z
  .strictObject({
    frames: z
      .record(
        z.string(),
        z.strictObject({
          frame: Rect,
          rotated: z.boolean(),
          trimmed: z.boolean(),
          spriteSourceSize: Rect,
          sourceSize: Size,
          anchor: Anchor.meta({ description: 'The pivot, as a fraction of the untrimmed frame.' }),
        }),
      )
      .meta({ description: 'Frames by sprite key, such as walk/s/000.' }),
    animations: z
      .record(z.string(), z.array(z.string()))
      .meta({ description: 'Frame names of each clip and direction, as <clip>_<direction>.' }),
    meta: z
      .strictObject({
        app: z.string(),
        version: z.string(),
        image: z.string(),
        format: z.literal('RGBA8888'),
        size: Size,
        scale: z.string(),
        related_multi_packs: z.array(z.string()).optional().meta({ description: 'The other sheets of a split atlas.' }),
      })
      .meta({ description: 'The sheet image, its size, and the other sheets of a split atlas.' }),
  })
  .meta({ description: 'PixiJS spritesheet data (TexturePacker JSON Hash with animations).' });

/** A Phaser 3 and 4 multi-atlas (`load.multiatlas`): one entry per sheet image. */
export const PhaserAtlas = z
  .strictObject({
    textures: z
      .array(
        z.strictObject({
          image: z.string(),
          format: z.literal('RGBA8888'),
          size: Size,
          scale: z.number(),
          frames: z.array(
            z.strictObject({
              filename: z.string(),
              rotated: z.boolean(),
              trimmed: z.boolean(),
              sourceSize: Size,
              spriteSourceSize: Rect,
              frame: Rect,
              anchor: Anchor,
            }),
          ),
        }),
      )
      .min(1)
      .meta({ description: 'One texture per sheet image, with its frames.' }),
    animations: z
      .array(
        z.strictObject({
          key: z.string(),
          frameRate: z.number(),
          repeat: z.number().int(),
          frames: z.array(z.string()),
        }),
      )
      .meta({ description: 'Animation configs for this.anims.create, one per clip and direction.' }),
    meta: z
      .strictObject({ app: z.string(), version: z.string() })
      .meta({ description: 'The program that wrote the atlas.' }),
  })
  .meta({ description: 'Phaser multi-atlas data with animation configs.' });

export type AsepriteSheetArrayT = z.infer<typeof AsepriteSheetArray>;
export type PixiSheetT = z.infer<typeof PixiSheet>;
export type PhaserAtlasT = z.infer<typeof PhaserAtlas>;
