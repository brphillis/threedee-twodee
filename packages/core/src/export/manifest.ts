import { type ManifestT, OUTPUT_SCHEMA_VERSION, type ResolvedAssetT, type ValidationReportT } from '@td2d/schema';
import type { SheetLayout } from '../sheet/layout.ts';
import { CORE_VERSION } from '../version.ts';

export interface ManifestInput {
  readonly asset: ResolvedAssetT;
  readonly assetHash: string;
  readonly groundMargin: number;
  readonly pixelsPerUnit: number;
  readonly palette: {
    readonly colors: readonly string[];
    readonly byClip?: Readonly<Record<string, readonly string[]>>;
  };
  /** Sprite keys produced by mirroring. */
  readonly mirrored: ReadonlySet<string>;
  readonly layout: SheetLayout;
  /** Image file of each page. */
  readonly images: readonly string[];
  /** Aseprite data file of each page, or null when aseprite-json is not written. */
  readonly dataFiles: readonly (string | null)[];
  /** Files written per export format. */
  readonly files: Readonly<Record<string, readonly string[]>>;
  readonly stages: Readonly<Record<string, string>>;
  readonly validation: Pick<ValidationReportT, 'status' | 'checks'>;
}

export function pivotFor(frame: { width: number; height: number }, groundMargin: number) {
  const x = frame.width / 2;
  const y = frame.height - groundMargin;
  return { x, y, normalized: { x: x / frame.width, y: Number((y / frame.height).toFixed(6)) } };
}

/** The tool-native description of a generated asset. */
export function buildManifest(input: ManifestInput): ManifestT {
  const { asset, layout } = input;
  return {
    schemaVersion: OUTPUT_SCHEMA_VERSION,
    generator: { name: 'td2d', version: CORE_VERSION },
    assetId: asset.id,
    assetHash: input.assetHash,
    generatedAt: new Date().toISOString(),
    frame: asset.frame,
    pivot: pivotFor(asset.frame, input.groundMargin),
    pixelsPerUnit: input.pixelsPerUnit,
    camera: {
      preset: asset.camera.preset,
      pitch: asset.camera.pitch,
      yawOffset: asset.camera.yawOffset,
      groundMargin: input.groundMargin,
    },
    directions: asset.directions,
    palette: {
      mode: asset.pixel.palette,
      name: asset.pixel.palette.startsWith('fixed:') ? asset.pixel.palette.slice(6) : null,
      colors: [...input.palette.colors],
      ...(input.palette.byClip
        ? { byClip: Object.fromEntries(Object.entries(input.palette.byClip).map(([k, v]) => [k, [...v]])) }
        : {}),
    },
    clips: Object.entries(asset.animation.clips).map(([name, c]) => ({
      name,
      fps: c.fps,
      frames: c.frames,
      loop: c.loop,
      motion: c.motion,
      durationMs: Math.round((c.frames * 1000) / c.fps),
    })),
    sheets: layout.pages.map((page, i) => ({
      name: page.name,
      image: input.images[i] as string,
      data: input.dataFiles[i] ?? null,
      width: page.width,
      height: page.height,
      layout: asset.sheet.layout,
    })),
    cells: layout.cells.map((c) => ({
      key: c.key,
      clip: c.clip,
      direction: c.direction,
      index: c.index,
      sheet: (layout.pages[c.page] as { name: string }).name,
      x: c.x,
      y: c.y,
      w: c.w,
      h: c.h,
      trimmed: c.trimmed,
      offset: { x: c.offset.x, y: c.offset.y },
      mirrored: input.mirrored.has(c.key),
    })),
    files: Object.fromEntries(Object.entries(input.files).map(([k, v]) => [k, [...v]])),
    stages: { ...input.stages },
    validation: {
      status: input.validation.status,
      warnings: input.validation.checks.filter((c) => c.status === 'warn').length,
      errors: input.validation.checks.filter((c) => c.status === 'fail').length,
      report: '../validation.json',
    },
  };
}
