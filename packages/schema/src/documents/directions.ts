import { z } from 'zod';

/** Compass direction names. s faces the camera, angles increase clockwise when viewed from above. */
export const COMPASS_ANGLES = {
  s: 0,
  ssw: 22.5,
  sw: 45,
  wsw: 67.5,
  w: 90,
  wnw: 112.5,
  nw: 135,
  nnw: 157.5,
  n: 180,
  nne: 202.5,
  ne: 225,
  ene: 247.5,
  e: 270,
  ese: 292.5,
  se: 315,
  sse: 337.5,
} as const;

export type CompassDirection = keyof typeof COMPASS_ANGLES;

export const DIRECTION_SETS = {
  d1: ['s'],
  'd1-side': ['e'],
  d4: ['s', 'w', 'n', 'e'],
  d8: ['s', 'sw', 'w', 'nw', 'n', 'ne', 'e', 'se'],
  d16: ['s', 'ssw', 'sw', 'wsw', 'w', 'wnw', 'nw', 'nnw', 'n', 'nne', 'ne', 'ene', 'e', 'ese', 'se', 'sse'],
} as const satisfies Record<string, readonly CompassDirection[]>;

export type DirectionSetName = keyof typeof DIRECTION_SETS;

export const Compass = z.enum(Object.keys(COMPASS_ANGLES) as [CompassDirection, ...CompassDirection[]]);

export const CustomDirection = z
  .strictObject({
    name: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/)
      .max(32),
    yaw: z.number().min(-360).max(360).meta({ description: 'Degrees, clockwise from facing the camera.' }),
  })
  .meta({ description: 'A named direction at an explicit yaw.' });

export const DirectionSpec = z
  .union([
    z
      .enum(Object.keys(DIRECTION_SETS) as [DirectionSetName, ...DirectionSetName[]], {
        error:
          'Expected a direction set ("d1", "d1-side", "d4", "d8" or "d16"), a list of compass names such as ["s", "w", "n", "e"], a list of { name, yaw }, or { "count": n }',
      })
      .meta({ description: 'Built-in direction set.' }),
    z.array(Compass).min(1).max(16).meta({ description: 'Compass directions in row order.' }),
    z.array(CustomDirection).min(1).max(64).meta({ description: 'Custom named yaw angles.' }),
    z
      .strictObject({
        count: z.number().int().min(1).max(64),
        start: z
          .number()
          .min(-360)
          .max(360)
          .optional()
          .meta({ description: 'Yaw of the first direction in degrees. Default 0 (facing the camera).' }),
      })
      .meta({ description: 'count directions evenly spaced around the model, named a<yaw> such as a0, a60, a120.' }),
  ])
  .meta({
    description: 'Directions to render: a set name such as "d8", compass names, or custom yaws.',
    examples: ['d8', ['s', 'w', 'n', 'e'], { count: 6 }],
  });

export const MirrorSpec = z
  .array(z.string().regex(/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/, 'Expected "target:source" such as "e:w"'))
  .meta({
    description: 'Directions produced by flipping another direction horizontally, as "target:source".',
    examples: [['e:w', 'ne:nw', 'se:sw']],
  });

export type DirectionSpecT = z.infer<typeof DirectionSpec>;
