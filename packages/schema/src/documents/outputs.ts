import { z } from 'zod';
import { AssetId, HexColor, Name } from '../primitives.ts';
import { ResolvedDirection } from './asset.ts';
import { ErrorDetail, Warning } from './cli.ts';

export const OUTPUT_SCHEMA_VERSION = '1.0.0';

const OutputVersion = z
  .string()
  .regex(/^1\.\d+\.\d+$/)
  .meta({ description: 'Version of this output format, 1.x.y. Readers accept any 1.x.' });
const Generator = z
  .strictObject({ name: z.literal('td2d'), version: z.string() })
  .meta({ description: 'The program that wrote the file, and its version.' });
const Sha256 = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const AssetHash = Sha256.meta({
  description: 'Hash of the resolved asset: equal hashes mean identical settings and inputs.',
});
const WrittenAt = z.iso.datetime().meta({ description: 'When the file was written, in ISO 8601 UTC.' });

export const ValidationStatus = z.enum(['pass', 'warn', 'fail']);

export const Manifest = z
  .strictObject({
    schemaVersion: OutputVersion,
    generator: Generator,
    assetId: AssetId,
    assetHash: AssetHash,
    generatedAt: WrittenAt,
    frame: z
      .strictObject({ width: z.number().int(), height: z.number().int() })
      .meta({ description: 'Size of every sprite, in pixels.' }),
    pivot: z
      .strictObject({
        x: z.number(),
        y: z.number(),
        normalized: z.strictObject({ x: z.number(), y: z.number() }),
      })
      .meta({
        description:
          'Where the model stands in each frame: x and y in pixels, and normalized from 0 to 1. Set sprite origins or anchors to it.',
      }),
    pixelsPerUnit: z.number().meta({ description: 'Scale the sprites were drawn at: pixels per metre.' }),
    camera: z
      .strictObject({
        preset: Name.nullable(),
        pitch: z.number(),
        yawOffset: z.number(),
        groundMargin: z
          .number()
          .int()
          .meta({ description: 'Ground margin used, in pixels. Equals frame.height minus pivot.y.' }),
      })
      .meta({ description: 'The camera the sprites were rendered with.' }),
    directions: z
      .array(ResolvedDirection)
      .meta({ description: 'Each direction: its name, yaw, and the direction it was mirrored from, if any.' }),
    palette: z
      .strictObject({
        mode: z.string(),
        name: Name.nullable(),
        colors: z
          .array(HexColor)
          .meta({ description: 'Every palette colour the sprites may use. Empty when no palette is set.' }),
        byClip: z
          .record(z.string(), z.array(HexColor))
          .optional()
          .meta({ description: "With paletteScope clip: each clip's own palette." }),
      })
      .meta({ description: 'The palette mode and every colour the sprites may use.' }),
    clips: z
      .array(
        z.strictObject({
          name: z.string(),
          fps: z.number().int(),
          frames: z.number().int(),
          loop: z.boolean(),
          motion: z.boolean().meta({ description: 'The clip moves the model across the frame on purpose.' }),
          durationMs: z.number(),
        }),
      )
      .meta({ description: 'Each clip: frames, frame rate, duration, and whether it loops or moves on purpose.' }),
    sheets: z
      .array(
        z.strictObject({
          name: z.string(),
          image: z.string().meta({ description: 'Sheet image file, relative to the manifest.' }),
          data: z
            .string()
            .nullable()
            .meta({ description: 'Aseprite JSON for this sheet, or null when aseprite-json is not written.' }),
          width: z.number().int(),
          height: z.number().int(),
          layout: z.enum(['grid', 'strips', 'packed']),
        }),
      )
      .min(1)
      .meta({ description: 'Each sheet image with its size and layout. Packed sheets may have several pages.' }),
    cells: z
      .array(
        z.strictObject({
          key: z.string().meta({ description: 'Sprite key: clip/direction/nnn.' }),
          clip: z.string(),
          direction: z.string(),
          index: z.number().int(),
          sheet: z.string().meta({ description: 'Name of the sheet the cell is on.' }),
          x: z.number().int(),
          y: z.number().int(),
          w: z.number().int(),
          h: z.number().int(),
          trimmed: z.boolean(),
          offset: z.strictObject({ x: z.number().int(), y: z.number().int() }).meta({
            description: 'Where the top-left of the cell goes inside the frame: 0, 0 unless trimmed.',
          }),
          mirrored: z.boolean(),
        }),
      )
      .meta({
        description:
          'Every sprite: its key, the sheet it is on, its rectangle and trim offset. Read positions from here, never by guessing.',
      }),
    files: z
      .record(z.string(), z.array(z.string()))
      .meta({ description: 'Files written for each export format, relative to the manifest.' }),
    stages: z
      .record(z.string(), Sha256)
      .meta({ description: 'Hash of each stage up to the sheet: equal hashes mean equal outputs.' }),
    validation: z
      .strictObject({
        status: ValidationStatus,
        warnings: z.number().int(),
        errors: z.number().int(),
        report: z.string(),
      })
      .meta({ description: 'Validation status and counts; the checks are in the report file it names.' }),
  })
  .meta({ description: 'Tool-native description of a generated asset, written beside its sprite sheets.' });

export const ValidationCheck = z.strictObject({
  id: z.string(),
  status: ValidationStatus,
  message: z.string(),
  frames: z.array(z.string()).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const ValidationReport = z
  .strictObject({
    schemaVersion: OutputVersion,
    generator: Generator,
    assetId: AssetId,
    generatedAt: WrittenAt,
    status: ValidationStatus.meta({ description: 'fail if any check failed, warn if any warned, else pass.' }),
    checks: z.array(ValidationCheck).meta({ description: 'Every check, with the frames it is about.' }),
  })
  .meta({ description: 'Results of output validation for one asset.' });

export const GenerationRecord = z
  .strictObject({
    schemaVersion: OutputVersion,
    generator: Generator,
    assetId: AssetId,
    assetHash: AssetHash,
    startedAt: z.iso.datetime().meta({ description: 'When the generation started, in ISO 8601 UTC.' }),
    finishedAt: z.iso.datetime().meta({ description: 'When it finished, in ISO 8601 UTC.' }),
    durationMs: z.number().meta({ description: 'Wall time in milliseconds.' }),
    status: z.enum(['ok', 'warn', 'failed']).meta({ description: 'ok, warn (finished with warnings) or failed.' }),
    backend: z
      .strictObject({ id: z.string(), version: z.string(), renderer: z.string() })
      .nullable()
      .meta({ description: 'The render backend and the exact renderer it used, or null when nothing rendered.' }),
    stages: z
      .array(z.strictObject({ name: z.string(), hash: Sha256, cached: z.boolean(), durationMs: z.number() }))
      .meta({ description: 'Every stage in order: its hash, whether it came from the cache, and its time.' }),
    outputs: z
      .array(z.strictObject({ path: z.string(), sha256: Sha256, bytes: z.number().int() }))
      .meta({ description: 'Every file written, with its SHA-256 and size.' }),
    warnings: z.array(Warning).meta({ description: 'Warnings raised while generating.' }),
    error: ErrorDetail.optional(),
  })
  .meta({ description: 'Everything needed to understand and reproduce one generation.' });

const ItemCounts = z.strictObject({
  render: z.strictObject({ rendered: z.number().int(), reused: z.number().int() }).nullable(),
  pixel: z.strictObject({ processed: z.number().int(), reused: z.number().int() }).nullable(),
});

export const BatchReport = z
  .strictObject({
    schemaVersion: OutputVersion,
    generator: Generator,
    startedAt: z.iso.datetime().meta({ description: 'When the batch started, in ISO 8601 UTC.' }),
    finishedAt: z.iso.datetime().meta({ description: 'When it finished, in ISO 8601 UTC.' }),
    durationMs: z.number().meta({ description: 'Wall time in milliseconds.' }),
    status: z.enum(['ok', 'warn', 'partial', 'failed', 'cancelled']).meta({
      description:
        'ok and warn: every asset succeeded. partial: some failed and the rest ran. failed: the batch stopped at a failure. cancelled: interrupted.',
    }),
    options: z
      .strictObject({
        filter: z.string().nullable(),
        manifest: z.string().nullable(),
        concurrency: z.number().int(),
        continueOnError: z.boolean(),
        failFast: z.boolean(),
        resumedFrom: z.string().nullable(),
      })
      .meta({ description: 'The options the batch ran with.' }),
    totals: z
      .strictObject({
        ok: z.number().int(),
        warn: z.number().int(),
        failed: z.number().int(),
        skipped: z.number().int(),
      })
      .meta({ description: 'How many assets ended in each status.' }),
    cache: z
      .strictObject({ hits: z.number().int(), misses: z.number().int() })
      .meta({ description: 'Stage cache hits and misses over the batch.' }),
    items: z
      .strictObject({ rendered: z.number().int(), reused: z.number().int() })
      .meta({ description: 'Samples rendered and restored from the render cache over the batch.' }),
    assets: z
      .array(
        z.strictObject({
          assetId: AssetId,
          status: z.enum(['ok', 'warn', 'failed', 'skipped']),
          skipped: z.enum(['resumed', 'stopped', 'cancelled']).optional().meta({
            description:
              'Why a skipped asset did not run: it succeeded in the report being resumed, the batch stopped at a failure, or the batch was cancelled.',
          }),
          durationMs: z.number(),
          error: ErrorDetail.optional(),
          warnings: z.array(Warning),
          outputs: z.record(z.string(), z.string()).optional(),
          cache: z.strictObject({ hits: z.number().int(), misses: z.number().int() }).optional(),
          items: ItemCounts.optional(),
        }),
      )
      .meta({ description: 'Each asset: status, time, error, warnings, outputs and cache use.' }),
  })
  .meta({ description: 'Summary of a batch run, written to build/batch-report.json.' });

export const BatchManifest = z
  .strictObject({
    $schema: z.string().optional(),
    schemaVersion: z
      .string()
      .regex(/^1\.\d+\.\d+$/, 'Expected a version 1 schema version such as "1.0.0"')
      .meta({ description: 'Document schema version. Any 1.x.y version is accepted.' }),
    description: z.string().max(2000).optional().meta({ description: 'Free-text note. Use this instead of comments.' }),
    assets: z
      .array(
        z.strictObject({
          id: AssetId,
          overrides: z.record(z.string(), z.unknown()).optional().meta({
            description:
              'Asset settings to change for this run only, merged over the asset definition (for example { "pixel": "pico-8" }).',
          }),
        }),
      )
      .min(1)
      .meta({ description: 'Assets to generate, in order, each with optional overrides.' }),
    options: z
      .strictObject({
        concurrency: z.number().int().min(1).max(64).optional(),
        continueOnError: z.boolean().optional(),
        failFast: z.boolean().optional(),
        strict: z.boolean().optional(),
      })
      .optional()
      .meta({ description: 'Batch options; command-line flags take precedence.' }),
  })
  .meta({
    description:
      'A list of assets to generate together, with optional per-asset overrides. Passed to td2d batch --manifest.',
    examples: [
      {
        schemaVersion: '1.0.0',
        assets: [{ id: 'props/crate' }, { id: 'props/barrel', overrides: { pixel: 'pico-8' } }],
        options: { concurrency: 2 },
      },
    ],
  });

export type ManifestT = z.infer<typeof Manifest>;
export type ValidationCheckT = z.infer<typeof ValidationCheck>;
export type ValidationReportT = z.infer<typeof ValidationReport>;
export type GenerationRecordT = z.infer<typeof GenerationRecord>;
export type BatchReportT = z.infer<typeof BatchReport>;
export type BatchManifestT = z.infer<typeof BatchManifest>;
