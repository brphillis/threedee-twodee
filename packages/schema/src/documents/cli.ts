import { z } from 'zod';
import { ERROR_CODES, type ErrorCode, WARNING_CATALOG, type WarningCode } from '../errors.ts';

export const Issue = z
  .strictObject({
    file: z.string().optional().meta({ description: 'File the issue is in, relative to the project root.' }),
    path: z.string().meta({
      description: 'Dotted path inside the document, such as "model.parts[2].size". Empty for the whole document.',
    }),
    message: z.string(),
    code: z.string().optional().meta({ description: 'Issue kind, such as invalid_type or unknown_material.' }),
  })
  .meta({ description: 'One problem found in an input document.' });

export const ErrorDetail = z
  .strictObject({
    code: z.enum(ERROR_CODES as [ErrorCode, ...ErrorCode[]]),
    message: z.string(),
    file: z.string().optional(),
    issues: z.array(Issue).optional(),
    hint: z.string().optional(),
    docs: z.string().optional().meta({ description: 'Documentation path for this error.' }),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .meta({ description: 'A structured error.' });

const warningCodes = Object.keys(WARNING_CATALOG) as [WarningCode, ...WarningCode[]];

export const Warning = z
  .strictObject({
    code: z.enum(warningCodes),
    message: z.string(),
    file: z.string().optional(),
    path: z.string().optional(),
    assetId: z.string().optional(),
    hint: z.string().optional(),
  })
  .meta({ description: 'A non-fatal problem.' });

export const CliEnvelope = z
  .strictObject({
    ok: z.boolean().meta({ description: 'true on success; false when error is present.' }),
    command: z.string().meta({ description: 'Command path such as "validate" or "asset show".' }),
    version: z.string().meta({ description: 'td2d version.' }),
    durationMs: z.number().meta({ description: 'How long the command took, in milliseconds.' }),
    data: z
      .unknown()
      .optional()
      .meta({ description: 'Command-specific result. Present on success and, where useful, on failure.' }),
    warnings: z
      .array(Warning)
      .meta({ description: 'Warnings, also on success. Each has a code, a message and often a hint.' }),
    error: ErrorDetail.optional(),
  })
  .meta({ description: 'The single JSON document every command prints to stdout with --json.' });

export const ProgressEvent = z
  .discriminatedUnion('event', [
    z.strictObject({
      t: z.string(),
      event: z.literal('stage:start'),
      stage: z.string(),
      assetId: z.string().optional(),
      total: z.number().optional(),
    }),
    z.strictObject({
      t: z.string(),
      event: z.literal('item:done'),
      stage: z.string(),
      assetId: z.string().optional(),
      key: z.string(),
      n: z.number(),
      total: z.number(),
    }),
    z.strictObject({
      t: z.string(),
      event: z.literal('stage:done'),
      stage: z.string(),
      assetId: z.string().optional(),
      durationMs: z.number(),
      cached: z.boolean(),
    }),
  ])
  .meta({ description: 'One NDJSON line written to stderr with --json.' });

export type IssueT = z.infer<typeof Issue>;
export type ErrorDetailT = z.infer<typeof ErrorDetail>;
export type WarningT = z.infer<typeof Warning>;
export type CliEnvelopeT = z.infer<typeof CliEnvelope>;
export type ProgressEventT = z.infer<typeof ProgressEvent>;
