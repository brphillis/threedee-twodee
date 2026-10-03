import { z } from 'zod';
import { Description, SchemaRef, SchemaVersion } from '../primitives.ts';
import { AssetDefaults, AssetType } from './asset.ts';

const RelativePath = z
  .string()
  .min(1)
  .max(256)
  .refine((p) => !p.startsWith('/') && !/^[a-zA-Z]:[\\/]/.test(p), 'Expected a path relative to the project root')
  .refine((p) => !p.split(/[\\/]/).includes('..'), 'Paths may not contain ".." segments');

export const ProjectPaths = z
  .strictObject({
    assets: RelativePath.optional().meta({ description: 'Asset definitions directory. Default "assets".' }),
    build: RelativePath.optional().meta({ description: 'Generated output directory. Default "build".' }),
    history: RelativePath.optional().meta({ description: 'Generation history directory. Default "history".' }),
    cache: RelativePath.optional().meta({ description: 'Stage cache directory. Default ".td2d/cache".' }),
    presets: z
      .array(RelativePath)
      .optional()
      .meta({ description: 'Preset directories, searched in order. Default ["presets"].' }),
    palettes: z
      .array(RelativePath)
      .optional()
      .meta({ description: 'Palette directories, searched in order. Default ["palettes"].' }),
    components: z
      .array(RelativePath)
      .optional()
      .meta({ description: 'Component directories. Default ["components"].' }),
  })
  .meta({ description: 'Project directories, relative to the project root.' });

export const ProjectConfig = z
  .strictObject({
    $schema: SchemaRef.optional(),
    schemaVersion: SchemaVersion,
    name: z.string().min(1).max(100).meta({ description: 'Project name, shown in the viewer and in reports.' }),
    description: Description.optional(),
    paths: ProjectPaths.optional(),
    defaults: AssetDefaults.optional(),
    typeDefaults: z
      .partialRecord(AssetType, AssetDefaults)
      .optional()
      .meta({ description: 'Defaults per asset type, applied after defaults.' }),
    cache: z
      .strictObject({
        maxSize: z
          .union([
            z.number().int().positive(),
            z.string().regex(/^\d+(\.\d+)?\s*(B|KB|MB|GB|TB)$/i, 'Expected a size such as "5GB" or "500MB"'),
          ])
          .optional()
          .meta({
            description:
              'Largest the cache may grow; after a run the least recently used entries are removed. Default "5GB".',
          }),
      })
      .optional()
      .meta({ description: 'Cache settings.' }),
  })
  .meta({
    description: 'Project configuration, stored as td2d.project.json at the project root.',
    examples: [{ schemaVersion: '1.0.0', name: 'my-game', defaults: { pixelsPerUnit: 16, camera: 'dimetric' } }],
  });

export const ResolvedProjectPaths = z.strictObject({
  assets: z.string(),
  build: z.string(),
  history: z.string(),
  cache: z.string(),
  presets: z.array(z.string()),
  palettes: z.array(z.string()),
  components: z.array(z.string()),
});

export type ProjectConfigT = z.infer<typeof ProjectConfig>;
export type ProjectPathsT = z.infer<typeof ProjectPaths>;
export type ResolvedProjectPathsT = z.infer<typeof ResolvedProjectPaths>;
