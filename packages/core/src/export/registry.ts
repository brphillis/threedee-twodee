import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExportFormatT, ResolvedAssetT } from '@td2d/schema';
import type { z } from 'zod';
import { Td2dError } from '../errors.ts';
import { formatJson } from '../fs/json.ts';
import type { RgbaImage } from '../pixel/image.ts';
import type { SheetLayout } from '../sheet/layout.ts';

export interface ExportContext {
  readonly asset: ResolvedAssetT;
  /** Asset name: the last segment of the id. */
  readonly name: string;
  readonly dir: string;
  readonly layout: SheetLayout;
  /** Image file of each sheet, in page order, already written to `dir`. */
  readonly images: readonly string[];
  /** Pivot in frame pixels. */
  readonly pivot: { readonly x: number; readonly y: number };
  /** Every untrimmed sprite, mirrored ones included, by key. Decoded on first use, since most formats need only the sheets. */
  sprites(): Promise<ReadonlyMap<string, RgbaImage>>;
  /** The sprite PNG files, by key. */
  readonly spriteFiles: ReadonlyMap<string, string>;
  /** Copy or re-encode an image into `dir` (indexed when the export settings ask for it). */
  writeImage(source: string, target: string): Promise<void>;
}

export interface Exporter {
  readonly id: Exclude<ExportFormatT, 'manifest'>;
  /** Bump when the output changes for the same input. */
  readonly version: number;
  readonly description: string;
  /** Write the format's files into ctx.dir and return their names. */
  write(ctx: ExportContext): Promise<string[]>;
}

/** Write a JSON file after checking it against the format's schema; a mismatch is a td2d bug. */
export function writeChecked(dir: string, file: string, value: unknown, schema: z.ZodType, format: string): string {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Td2dError('E_INTERNAL', `The ${format} data for ${file} does not match its schema.`, {
      details: { issues: result.error.issues.slice(0, 10) },
    });
  }
  writeFileSync(join(dir, file), formatJson(value));
  return file;
}

export const frameDurationMs = (fps: number) => Math.round(1000 / fps);
export const sequenceName = (clip: string, direction: string) => `${clip}_${direction}`;
