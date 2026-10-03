import type { PixelSettingsT } from '@td2d/schema';
import type { RgbaImage } from '../pixel/image.ts';
import { processFrames } from '../pixel/pipeline.ts';
import { compositePage, type SheetLayout } from '../sheet/layout.ts';

export interface PixelTask {
  readonly kind: 'pixel';
  readonly frames: readonly { readonly key: string; readonly clip: string; readonly image: RgbaImage }[];
  readonly supersample: number;
  readonly settings: PixelSettingsT;
  readonly fixedPalette: readonly string[] | null;
  /** Process each frame on its own and report its cleanup counts (for per-cell caching). */
  readonly perFrame: boolean;
}

export interface PixelTaskResult {
  readonly sprites: readonly {
    readonly key: string;
    readonly image: RgbaImage;
    readonly removed: number;
    readonly recoloured: number;
  }[];
  readonly palettes: Readonly<Record<string, readonly string[]>>;
  readonly removed: number;
  readonly recoloured: number;
}

export interface CompositeTask {
  readonly kind: 'composite';
  readonly layout: SheetLayout;
  readonly page: number;
  readonly sprites: readonly (readonly [string, RgbaImage])[];
  readonly extrude: number;
}

export type Task = PixelTask | CompositeTask;

/** Run one task. The same code runs in a worker thread or, for small jobs, inline. */
export function runTask(task: PixelTask): PixelTaskResult;
export function runTask(task: CompositeTask): RgbaImage;
export function runTask(task: Task): PixelTaskResult | RgbaImage;
export function runTask(task: Task): PixelTaskResult | RgbaImage {
  if (task.kind === 'composite') return compositePage(task.layout, task.page, new Map(task.sprites), task.extrude);
  if (!task.perFrame) {
    const result = processFrames(task.frames, task.supersample, task.settings, task.fixedPalette);
    return {
      sprites: [...result.sprites].map(([key, image]) => ({ key, image, removed: 0, recoloured: 0 })),
      palettes: result.palettes,
      removed: result.removed,
      recoloured: result.recoloured,
    };
  }
  const sprites: { key: string; image: RgbaImage; removed: number; recoloured: number }[] = [];
  let palettes: Readonly<Record<string, readonly string[]>> = {};
  for (const frame of task.frames) {
    const result = processFrames([frame], task.supersample, task.settings, task.fixedPalette);
    sprites.push({
      key: frame.key,
      image: result.sprites.get(frame.key) as RgbaImage,
      removed: result.removed,
      recoloured: result.recoloured,
    });
    palettes = result.palettes;
  }
  return {
    sprites,
    palettes,
    removed: sprites.reduce((n, s) => n + s.removed, 0),
    recoloured: sprites.reduce((n, s) => n + s.recoloured, 0),
  };
}
