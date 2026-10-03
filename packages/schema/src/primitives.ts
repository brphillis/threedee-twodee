import { z } from 'zod';

/** Major version accepted for every version 1 input document. */
export const INPUT_SCHEMA_MAJOR = 1;

/** Version written into newly created input documents. */
export const CURRENT_INPUT_SCHEMA_VERSION = '1.0.0';

export const SchemaVersion = z
  .string()
  .regex(/^1\.\d+\.\d+$/, 'Expected a version 1 schema version such as "1.0.0"')
  .meta({ description: 'Document schema version. Any 1.x.y version is accepted.', examples: ['1.0.0'] });

export const SchemaRef = z
  .string()
  .meta({ description: 'Optional JSON Schema reference for editors. Ignored by td2d.' });

export const Description = z.string().max(2000).meta({ description: 'Free-text note. Use this instead of comments.' });

/** Lowercase kebab-case name used for materials, palettes, presets and part ids. */
export const Name = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'Expected lowercase kebab-case such as "steel-plate"')
  .max(64)
  .meta({ description: 'Lowercase kebab-case name.', examples: ['steel', 'endesga-32'] });

/** Asset id: kebab-case segments separated by "/". It equals the directory path under assets/. */
export const AssetId = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/,
    'Expected kebab-case segments separated by "/", such as "props/crate"',
  )
  .max(128)
  .meta({ description: 'Asset id. Equals the directory path under assets/.', examples: ['props/crate'] });

/** Animation clip name: lowercase snake case. */
export const ClipName = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, 'Expected lowercase snake_case such as "attack_heavy"')
  .max(64)
  .meta({ description: 'Clip name in lowercase snake_case.', examples: ['idle', 'walk', 'attack_heavy'] });

export const HexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Expected a 6-digit hex colour such as "#a0693a"')
  .meta({ description: 'sRGB colour as #rrggbb.', examples: ['#a0693a'] });

export const Vec3 = z
  .tuple([z.number(), z.number(), z.number()])
  .meta({ description: 'Three numbers [x, y, z].', examples: [[0, 0.5, 0]] });

export const PositiveVec3 = z
  .tuple([z.number().positive(), z.number().positive(), z.number().positive()])
  .meta({ description: 'Three positive numbers [x, y, z].', examples: [[1, 1, 1]] });

export const PixelSize = z.number().int().min(1).max(4096);

export type SchemaVersionT = z.infer<typeof SchemaVersion>;
