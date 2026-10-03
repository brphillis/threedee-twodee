import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';
import type { BuildInfo } from './build-info.ts';
import { Td2dError } from './errors.ts';

export interface PreviewOptions {
  readonly scale: number;
  /** "checker", "transparent" or #rrggbb. */
  readonly background: string;
  readonly grid: boolean;
  readonly out: string;
  /** sheet: the whole sheet. ring: the first frame of each direction around a circle, at the angle it faces. */
  readonly layout?: 'sheet' | 'ring';
  /** Show only this clip: its frames in a row per direction (or its first frames, with ring). */
  readonly clip?: string;
  /** With the sheet layout: which sheet to show, by index. Default 0. */
  readonly sheet?: number;
}

type Cell = BuildInfo['manifest']['cells'][number];

/** One cell back at full frame size (trimmed cells at their offset), enlarged by `scale`. */
async function cellSprite(build: BuildInfo, cell: Cell, scale: number): Promise<Buffer> {
  const { manifest } = build;
  const sheet = manifest.sheets.find((x) => x.name === cell.sheet) ?? manifest.sheets[0];
  const fw = manifest.frame.width;
  const fh = manifest.frame.height;
  return sharp(join(build.dir, 'sheets', sheet?.image ?? ''))
    .extract({ left: cell.x, top: cell.y, width: cell.w, height: cell.h })
    .extend({
      left: cell.offset.x,
      top: cell.offset.y,
      right: fw - cell.w - cell.offset.x,
      bottom: fh - cell.h - cell.offset.y,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer()
    .then((b) =>
      sharp(b)
        .resize(fw * scale, fh * scale, { kernel: 'nearest' })
        .png()
        .toBuffer(),
    );
}

export interface PreviewCell {
  readonly key: string;
  /** Where the cell is in the preview image, in its pixels. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface PreviewResult {
  readonly file: string;
  readonly width: number;
  readonly height: number;
  /** Every cell shown, so a reader of the image knows which sprite is where. */
  readonly cells: readonly PreviewCell[];
}

function backgroundPixels(
  width: number,
  height: number,
  options: Pick<PreviewOptions, 'background' | 'scale'>,
): Buffer {
  const pixels = Buffer.alloc(width * height * 4);
  if (options.background === 'checker') {
    const tile = Math.max(4, options.scale * 2);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = (Math.floor(x / tile) + Math.floor(y / tile)) % 2 === 0 ? 236 : 204;
        pixels.set([v, v, v, 255], (y * width + x) * 4);
      }
    }
  } else if (options.background !== 'transparent') {
    const n = Number.parseInt(options.background.slice(1), 16);
    for (let i = 0; i < pixels.length; i += 4) pixels.set([(n >> 16) & 255, (n >> 8) & 255, n & 255, 255], i);
  }
  return pixels;
}

function cellBorders(build: BuildInfo, sheetName: string, width: number, height: number, scale: number): Buffer {
  const lines = Buffer.alloc(width * height * 4);
  const mark = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < width && y < height) lines.set([255, 0, 160, 200], (y * width + x) * 4);
  };
  for (const cell of build.manifest.cells) {
    if (cell.sheet !== sheetName) continue;
    const x0 = cell.x * scale;
    const y0 = cell.y * scale;
    const x1 = (cell.x + cell.w) * scale - 1;
    const y1 = (cell.y + cell.h) * scale - 1;
    for (let x = x0; x <= x1; x++) {
      mark(x, y0);
      mark(x, y1);
    }
    for (let y = y0; y <= y1; y++) {
      mark(x0, y);
      mark(x1, y);
    }
  }
  return lines;
}

/** One clip: a row of frames per direction, in manifest direction order, with a pixel gap between cells. */
async function writeClip(build: BuildInfo, options: PreviewOptions, clip: string): Promise<PreviewResult> {
  const { manifest } = build;
  const s = options.scale;
  const cw = manifest.frame.width * s;
  const ch = manifest.frame.height * s;
  const gap = options.grid ? s : 0;
  const rows = manifest.directions
    .map((d) =>
      manifest.cells.filter((c) => c.clip === clip && c.direction === d.name).sort((a, b) => a.index - b.index),
    )
    .filter((r) => r.length > 0);
  const columns = Math.max(...rows.map((r) => r.length));
  const width = columns * cw + (columns + 1) * gap;
  const height = rows.length * ch + (rows.length + 1) * gap;
  const layers: OverlayOptions[] = [];
  const cells: PreviewCell[] = [];
  for (const [r, row] of rows.entries()) {
    for (const [c, cell] of row.entries()) {
      const sprite = await cellSprite(build, cell, s);
      const left = gap + c * (cw + gap);
      const top = gap + r * (ch + gap);
      layers.push({ input: sprite, left, top });
      cells.push({ key: cell.key, x: left, y: top, w: cw, h: ch });
    }
  }
  const base = backgroundPixels(width, height, options);
  if (gap > 0) {
    // Grid lines between cells, in the cell-border colour.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const inX = x % (cw + gap) < gap;
        const inY = y % (ch + gap) < gap;
        if (inX || inY) base.set([255, 0, 160, 255], (y * width + x) * 4);
      }
    }
  }
  mkdirSync(dirname(options.out), { recursive: true });
  await sharp(base, { raw: { width, height, channels: 4 } })
    .composite(layers)
    .png()
    .toFile(options.out);
  return { file: options.out, width, height, cells };
}

/** Direction ring: s at the bottom, w on the left, n at the top, e on the right. */
async function writeRing(build: BuildInfo, options: PreviewOptions): Promise<PreviewResult> {
  const { manifest } = build;
  const clip = options.clip ?? manifest.clips[0]?.name;
  const s = options.scale;
  const cw = manifest.frame.width * s;
  const ch = manifest.frame.height * s;
  const entries = manifest.directions.flatMap((direction) => {
    const cell = manifest.cells.find((c) => c.clip === clip && c.direction === direction.name && c.index === 0);
    return cell ? [{ direction, cell }] : [];
  });
  const radius = entries.length <= 1 ? 0 : Math.ceil((Math.max(cw, ch) * Math.max(1.2, entries.length / 3.2)) / 2);
  const width = radius * 2 + cw + 2 * s;
  const height = radius * 2 + ch + 2 * s;
  const layers: OverlayOptions[] = [];
  const cells: PreviewCell[] = [];
  for (const { direction, cell } of entries) {
    const angle = (direction.yaw * Math.PI) / 180;
    const left = Math.round(width / 2 - cw / 2 - radius * Math.sin(angle));
    const top = Math.round(height / 2 - ch / 2 + radius * Math.cos(angle));
    const sprite = await cellSprite(build, cell, s);
    layers.push({ input: sprite, left, top });
    cells.push({ key: cell.key, x: left, y: top, w: cw, h: ch });
  }
  mkdirSync(dirname(options.out), { recursive: true });
  await sharp(backgroundPixels(width, height, options), { raw: { width, height, channels: 4 } })
    .composite(layers)
    .png()
    .toFile(options.out);
  return { file: options.out, width, height, cells };
}

/**
 * An enlarged copy of the sheet on a visible background with cell borders, sized for
 * looking at with an image viewer, or a ring of directions. Pixels are scaled with
 * nearest-neighbour sampling.
 */
export async function writePreview(build: BuildInfo, options: PreviewOptions): Promise<PreviewResult> {
  const sheet = build.manifest.sheets[options.sheet ?? 0];
  if (!sheet) {
    throw new Td2dError('E_USAGE', `"${build.assetId}" has no sheet ${options.sheet ?? 0}.`, {
      hint: `It has ${build.manifest.sheets.length} sheet(s), numbered from 0.`,
    });
  }
  if (options.clip !== undefined && !build.manifest.clips.some((c) => c.name === options.clip)) {
    throw new Td2dError('E_USAGE', `"${build.assetId}" has no clip "${options.clip}".`, {
      hint: `Clips: ${build.manifest.clips.map((c) => c.name).join(', ')}.`,
    });
  }
  if (options.layout === 'ring') return writeRing(build, options);
  if (options.clip !== undefined) return writeClip(build, options, options.clip);
  const { scale } = options;
  const width = sheet.width * scale;
  const height = sheet.height * scale;
  const enlarged = await sharp(join(build.dir, 'sheets', sheet.image))
    .resize(width, height, { kernel: 'nearest' })
    .png()
    .toBuffer();
  const layers: OverlayOptions[] = [{ input: enlarged, left: 0, top: 0 }];
  if (options.grid)
    layers.push({
      input: cellBorders(build, sheet.name, width, height, scale),
      raw: { width, height, channels: 4 },
      left: 0,
      top: 0,
    });
  mkdirSync(dirname(options.out), { recursive: true });
  await sharp(backgroundPixels(width, height, options), { raw: { width, height, channels: 4 } })
    .composite(layers)
    .png()
    .toFile(options.out);
  const cells = build.manifest.cells
    .filter((c) => c.sheet === sheet.name)
    .map((c) => ({ key: c.key, x: c.x * scale, y: c.y * scale, w: c.w * scale, h: c.h * scale }));
  return { file: options.out, width, height, cells };
}
