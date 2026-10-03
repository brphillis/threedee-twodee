import type { z } from 'zod';
import { AsepriteSheet } from './documents/aseprite.ts';
import { AssetDefinition, ResolvedAsset } from './documents/asset.ts';
import { CameraPreset } from './documents/camera.ts';
import { CliEnvelope, ProgressEvent } from './documents/cli.ts';
import { AsepriteSheetArray, PhaserAtlas, PixiSheet } from './documents/engines.ts';
import { ExportPreset } from './documents/export.ts';
import { LightingPreset } from './documents/lighting.ts';
import { MaterialDefinition } from './documents/material.ts';
import { ComponentFile } from './documents/model.ts';
import { BatchManifest, BatchReport, GenerationRecord, Manifest, ValidationReport } from './documents/outputs.ts';
import { PaletteDefinition } from './documents/palette.ts';
import { PixelPreset } from './documents/pixel.ts';
import { ProjectConfig } from './documents/project.ts';
import { RigPreset } from './documents/rig.ts';
import { SheetPreset } from './documents/sheet.ts';

export interface DocumentInfo {
  readonly name: string;
  readonly kind: 'input' | 'output';
  readonly description: string;
  readonly location: string;
  readonly schema: z.ZodType;
}

/** Every document type td2d reads or writes. Names are used by `td2d schema <name>`. */
export const DOCUMENTS: readonly DocumentInfo[] = [
  {
    name: 'project',
    kind: 'input',
    description: 'Project configuration.',
    location: 'td2d.project.json',
    schema: ProjectConfig,
  },
  {
    name: 'asset',
    kind: 'input',
    description: 'Asset definition.',
    location: 'assets/<id>/asset.json',
    schema: AssetDefinition,
  },
  {
    name: 'material',
    kind: 'input',
    description: 'Material, used inside asset materials maps.',
    location: 'asset.json materials.<name>',
    schema: MaterialDefinition,
  },
  {
    name: 'component',
    kind: 'input',
    description: 'Reusable, parameterised group of parts.',
    location: 'components/<name>.json',
    schema: ComponentFile,
  },
  {
    name: 'batch-manifest',
    kind: 'input',
    description: 'Assets for td2d batch, with per-asset overrides.',
    location: 'any file, passed to td2d batch --manifest',
    schema: BatchManifest,
  },
  {
    name: 'palette',
    kind: 'input',
    description: 'Named colour palette.',
    location: 'palettes/<name>.json',
    schema: PaletteDefinition,
  },
  {
    name: 'camera-preset',
    kind: 'input',
    description: 'Camera preset.',
    location: 'presets/camera/<name>.json',
    schema: CameraPreset,
  },
  {
    name: 'rig-preset',
    kind: 'input',
    description: 'Rig preset: a named bone hierarchy.',
    location: 'presets/rig/<name>.json',
    schema: RigPreset,
  },
  {
    name: 'lighting-preset',
    kind: 'input',
    description: 'Lighting preset.',
    location: 'presets/lighting/<name>.json',
    schema: LightingPreset,
  },
  {
    name: 'pixel-preset',
    kind: 'input',
    description: 'Pixel processing preset.',
    location: 'presets/pixel/<name>.json',
    schema: PixelPreset,
  },
  {
    name: 'sheet-preset',
    kind: 'input',
    description: 'Sprite sheet layout preset.',
    location: 'presets/sheet/<name>.json',
    schema: SheetPreset,
  },
  {
    name: 'export-preset',
    kind: 'input',
    description: 'Export preset.',
    location: 'presets/export/<name>.json',
    schema: ExportPreset,
  },
  {
    name: 'resolved-asset',
    kind: 'output',
    description: 'Asset after defaults and presets are applied.',
    location: 'td2d asset show <id>',
    schema: ResolvedAsset,
  },
  {
    name: 'manifest',
    kind: 'output',
    description: 'Generated asset manifest.',
    location: 'build/<id>/sheets/manifest.json',
    schema: Manifest,
  },
  {
    name: 'aseprite-sheet',
    kind: 'output',
    description: 'Aseprite JSON Hash sprite sheet data.',
    location: 'build/<id>/sheets/<name>.json',
    schema: AsepriteSheet,
  },
  {
    name: 'aseprite-sheet-array',
    kind: 'output',
    description: 'Aseprite JSON Array sprite sheet data (export.aseprite.variant "array").',
    location: 'build/<id>/sheets/<name>.json',
    schema: AsepriteSheetArray,
  },
  {
    name: 'pixi-sheet',
    kind: 'output',
    description: 'PixiJS spritesheet data.',
    location: 'build/<id>/sheets/<sheet>.pixi.json',
    schema: PixiSheet,
  },
  {
    name: 'phaser-atlas',
    kind: 'output',
    description: 'Phaser multi-atlas data with animation configs.',
    location: 'build/<id>/sheets/<name>.phaser.json',
    schema: PhaserAtlas,
  },
  {
    name: 'validation-report',
    kind: 'output',
    description: 'Output validation results.',
    location: 'build/<id>/validation.json',
    schema: ValidationReport,
  },
  {
    name: 'generation-record',
    kind: 'output',
    description: 'Record of one generation.',
    location: 'build/<id>/generation.json',
    schema: GenerationRecord,
  },
  {
    name: 'batch-report',
    kind: 'output',
    description: 'Batch run summary.',
    location: 'build/batch-report.json',
    schema: BatchReport,
  },
  {
    name: 'cli-envelope',
    kind: 'output',
    description: 'JSON document printed to stdout with --json.',
    location: 'stdout',
    schema: CliEnvelope,
  },
  {
    name: 'progress-event',
    kind: 'output',
    description: 'NDJSON progress line printed to stderr with --json.',
    location: 'stderr',
    schema: ProgressEvent,
  },
];

export const PRESET_KINDS = ['camera', 'lighting', 'pixel', 'sheet', 'export'] as const;
export type PresetKind = (typeof PRESET_KINDS)[number];

export function findDocument(name: string): DocumentInfo | undefined {
  return DOCUMENTS.find((d) => d.name === name);
}
