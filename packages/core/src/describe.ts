import { createHash } from 'node:crypto';
import {
  ClipGenerator,
  type ClipGeneratorT,
  COMPASS_ANGLES,
  codeDocsPath,
  DIRECTION_SETS,
  DOCUMENTS,
  documentJsonSchema,
  Easing,
  ERROR_CATALOG,
  ERROR_CODES,
  ExitCode,
  type ExportFormatT,
  ExportOverrides,
  type ExportOverridesT,
  findDocument,
  PART_SCHEMAS,
  PART_TYPES,
  PaletteDefinition,
  type PartType,
  PixelOverrides,
  type PixelOverridesT,
  type PixelPassT,
  PRESET_KINDS,
  type PresetKind,
  RenderOverrides,
  RigPreset,
  topicDocsPath,
  WARNING_CATALOG,
} from '@td2d/schema';
import { z } from 'zod';
import { listAssetTemplates } from './assets-create.ts';
import { errorDocsPath } from './errors.ts';
import { listProjectTemplates } from './init.ts';
import { PART_VERSIONS } from './model/parts.ts';
import { EXPORTERS, STAGE_NAMES } from './pipeline/stages.ts';
import { PIXEL_PASS_REGISTRY } from './pixel/pipeline.ts';
import type { Library } from './project/library.ts';
import { PRESET_SCHEMAS } from './project/library.ts';
import { DEFAULT_BACKEND_ID, listBackends } from './render/registry.ts';
import { GENERATOR_VERSIONS } from './rig/generators.ts';
import { CORE_VERSION } from './version.ts';

export interface PresetSummary {
  readonly name: string;
  readonly source: 'builtin' | 'project';
  readonly file: string;
  readonly description: string;
  /** First 12 hex digits of the SHA-256 of the preset's content. */
  readonly version: string;
  readonly example: Record<string, unknown>;
  readonly docs: string;
  readonly schema?: unknown;
}

export interface DescribeOptions {
  /** Include full JSON Schemas for every entry. Off by default to keep output short. */
  readonly schemas?: boolean;
}

/** Where each kind of registry entry is documented, relative to the repository root. */
export const DOCS = {
  part: (type: PartType) =>
    `docs/guide/models.md#${({ group: 'groups', csg: 'csg', component: 'components', import: 'imports' } as Partial<Record<PartType, string>>)[type] ?? 'shapes'}`,
  pass: (id: PixelPassT) =>
    `docs/guide/pixel-art.md#${{ downscale: 'downscale-and-alpha', alphaThreshold: 'downscale-and-alpha', posterize: 'palettes', palette: 'palettes', outline: 'outlines', cleanup: 'cleanup-and-bleed', bleed: 'cleanup-and-bleed' }[id]}`,
  preset: (kind: PresetKind) =>
    ({
      camera: 'docs/guide/camera-and-lighting.md#camera-presets',
      lighting: 'docs/guide/camera-and-lighting.md#lighting-presets',
      pixel: 'docs/guide/pixel-art.md#presets',
      sheet: 'docs/guide/sprite-sheets.md#layouts',
      export: 'docs/reference/export-formats.md#export-formats',
    })[kind],
  palette: 'docs/guide/materials-and-palettes.md#palettes',
  rig: 'docs/guide/rigging-and-animation.md#rigs',
  generator: (type: string) =>
    `docs/guide/rigging-and-animation.md#${type === 'walk-cycle' ? 'walk-cycle' : 'idle-breathe-bob-and-spin'}`,
  easing: 'docs/guide/rigging-and-animation.md#clips',
  exporter: (id: string) => `docs/reference/export-formats.md#${id}`,
  backend: 'docs/guide/rendering.md#reproducibility',
  projectTemplate: 'docs/guide/getting-started.md#create-a-project',
  assetTemplate: 'docs/guide/getting-started.md#create-and-edit-an-asset',
  document: (name: string) => `docs/reference/schemas.md#${name}`,
  directions: 'docs/guide/camera-and-lighting.md#directions',
} as const;

/** The settings each pixel pass reads, and an asset fragment that turns it on. */
const PASS_SETTINGS: Record<PixelPassT, { keys: (keyof PixelOverridesT)[]; example: PixelOverridesT }> = {
  downscale: { keys: ['downscale'], example: { downscale: 'mode' } },
  alphaThreshold: { keys: ['alphaThreshold'], example: { alphaThreshold: 128 } },
  posterize: { keys: ['posterize'], example: { posterize: 4 } },
  palette: {
    keys: ['palette', 'paletteScope', 'dither', 'ditherStrength'],
    example: { palette: 'auto:16', dither: 'bayer-4' },
  },
  outline: { keys: ['outline'], example: { outline: { color: '#1a1c2c', side: 'outside', width: 1 } } },
  cleanup: { keys: ['cleanup'], example: { cleanup: { orphans: 'remove' } } },
  bleed: { keys: ['bleed'], example: { bleed: true } },
};

/** The export options each format reads, and an asset fragment that writes it. */
const EXPORT_OPTIONS: Record<
  Exclude<ExportFormatT, 'manifest'>,
  { keys: (keyof ExportOverridesT)[]; example: ExportOverridesT }
> = {
  'aseprite-json': {
    keys: ['formats', 'aseprite'],
    example: { formats: ['aseprite-json'], aseprite: { variant: 'array' } },
  },
  frames: { keys: ['formats'], example: { formats: ['frames'] } },
  pixi: { keys: ['formats'], example: { formats: ['pixi'] } },
  'phaser-atlas': { keys: ['formats'], example: { formats: ['phaser-atlas'] } },
  'godot-spriteframes': {
    keys: ['formats', 'godot'],
    example: { formats: ['godot-spriteframes'], godot: { directory: 'res://sprites/' } },
  },
  'gif-preview': { keys: ['formats', 'gif'], example: { formats: ['gif-preview'], gif: { scale: 3 } } },
};

const jsonSchema = (schema: z.ZodType) => z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' });
const contentVersion = (data: unknown) => createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 12);
const pick = <T extends z.ZodObject>(schema: T, keys: readonly string[]) =>
  schema.pick(Object.fromEntries(keys.map((k) => [k, true])) as never);

function partTypes(includeSchemas: boolean) {
  return PART_TYPES.map((type) => {
    const option = PART_SCHEMAS[type];
    const meta = option.meta() ?? {};
    return {
      type,
      version: PART_VERSIONS[type],
      description: String(meta.description ?? ''),
      example: (meta.examples as unknown[] | undefined)?.[0] ?? null,
      docs: DOCS.part(type),
      ...(includeSchemas && option ? { schema: jsonSchema(option) } : {}),
    };
  });
}

/** Everything a caller needs to discover what this version of td2d supports. */
export function describeCapabilities(library: Library, options: DescribeOptions = {}) {
  const schemas = options.schemas ?? false;
  const presets = Object.fromEntries(
    PRESET_KINDS.map((kind) => [
      kind,
      [...library.presets[kind].values()].map((e) => ({
        name: e.name,
        source: e.source,
        file: e.file,
        description: e.data.description ?? '',
        version: contentVersion(e.data),
        example: { [kind]: e.name },
        docs: DOCS.preset(kind),
        ...(schemas ? { schema: jsonSchema(PRESET_SCHEMAS[kind]) } : {}),
      })),
    ]),
  ) as Record<PresetKind, PresetSummary[]>;
  return {
    version: CORE_VERSION,
    documents: DOCUMENTS.map((d) => ({
      name: d.name,
      kind: d.kind,
      description: d.description,
      location: d.location,
      example: ((d.schema.meta()?.examples as unknown[] | undefined) ?? [])[0] ?? null,
      docs: DOCS.document(d.name),
      ...(schemas ? { schema: documentJsonSchema(d) } : {}),
    })),
    partTypes: partTypes(schemas),
    directions: { compass: COMPASS_ANGLES, sets: DIRECTION_SETS, docs: DOCS.directions },
    presets,
    palettes: [...library.palettes.values()].map((e) => ({
      name: e.name,
      source: e.source,
      file: e.file,
      colors: e.data.colors.length,
      description: e.data.description ?? '',
      version: contentVersion(e.data),
      example: { pixel: { palette: `fixed:${e.name}` } },
      docs: DOCS.palette,
      ...(schemas ? { schema: jsonSchema(PaletteDefinition) } : {}),
    })),
    templates: {
      projects: listProjectTemplates(),
      assets: listAssetTemplates(),
      entries: [
        ...listProjectTemplates().map((name) => ({
          kind: 'project' as const,
          name,
          example: `td2d init my-sprites --template ${name}`,
          docs: DOCS.projectTemplate,
        })),
        ...listAssetTemplates().map((t) => ({
          kind: 'asset' as const,
          name: t.name,
          description: t.description,
          example: `td2d asset create props/thing --template ${t.name}`,
          docs: DOCS.assetTemplate,
        })),
      ],
    },
    backends: listBackends().map((b) => ({
      id: b.id,
      description: b.description,
      default: b.id === DEFAULT_BACKEND_ID,
      version: Object.entries(b.fingerprint())
        .map(([k, v]) => `${k} ${v}`)
        .join(', '),
      example: { render: { backend: b.id } },
      docs: DOCS.backend,
      ...(schemas ? { schema: jsonSchema(RenderOverrides) } : {}),
    })),
    rigs: [...library.rigs.values()].map((e) => ({
      name: e.name,
      source: e.source,
      file: e.file,
      bones: e.data.bones.map((b) => b.name),
      description: e.data.description ?? '',
      version: contentVersion(e.data),
      example: { rig: e.name },
      docs: DOCS.rig,
      ...(schemas ? { schema: jsonSchema(RigPreset) } : {}),
    })),
    generators: ClipGenerator.options.map((option) => {
      const type = (option.shape.type as { value: ClipGeneratorT['type'] }).value;
      return {
        type,
        version: GENERATOR_VERSIONS[type],
        description: String(option.meta()?.description ?? ''),
        example: ((option.meta()?.examples as unknown[] | undefined) ?? [])[0] ?? null,
        docs: DOCS.generator(type),
        ...(schemas ? { schema: jsonSchema(option) } : {}),
      };
    }),
    easings: [...Easing.options],
    easingDocs: DOCS.easing,
    pixelPasses: Object.values(PIXEL_PASS_REGISTRY).map((p) => ({
      id: p.id,
      version: p.version,
      description: p.description,
      example: { pixel: PASS_SETTINGS[p.id].example },
      docs: DOCS.pass(p.id),
      ...(schemas ? { schema: jsonSchema(pick(PixelOverrides, PASS_SETTINGS[p.id].keys)) } : {}),
    })),
    exporters: Object.values(EXPORTERS).map((e) => ({
      id: e.id,
      version: e.version,
      description: e.description,
      example: { export: EXPORT_OPTIONS[e.id].example },
      docs: DOCS.exporter(e.id),
      ...(schemas ? { schema: jsonSchema(pick(ExportOverrides, EXPORT_OPTIONS[e.id].keys)) } : {}),
    })),
    stages: { pipeline: [...STAGE_NAMES], planned: [] as string[] },
    exitCodes: ExitCode,
    errors: ERROR_CODES.map((code) => ({
      code,
      exit: ERROR_CATALOG[code].exit,
      summary: ERROR_CATALOG[code].summary,
      detail: ERROR_CATALOG[code].detail,
      hint: ERROR_CATALOG[code].hint,
      docs: errorDocsPath(code),
      troubleshooting: topicDocsPath(ERROR_CATALOG[code].topic),
    })),
    warnings: Object.entries(WARNING_CATALOG).map(([code, w]) => ({
      code,
      summary: w.summary,
      hint: w.hint,
      docs: codeDocsPath(code),
      troubleshooting: topicDocsPath(w.topic),
    })),
  };
}

export type Capabilities = ReturnType<typeof describeCapabilities>;

/** JSON Schema for a named document, or undefined. */
export function schemaFor(name: string) {
  const doc = findDocument(name);
  return doc ? documentJsonSchema(doc) : undefined;
}
