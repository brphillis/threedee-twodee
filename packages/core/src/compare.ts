import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Manifest, type ManifestT } from '@td2d/schema';
import pixelmatch from 'pixelmatch';
import { Td2dError } from './errors.ts';
import { createImage, type RgbaImage } from './pixel/image.ts';
import { readPng, writePng } from './render/frames.ts';

export interface BuildSnapshot {
  /** Directory holding manifest.json and the sheet images. */
  readonly sheetsDir: string;
  readonly manifest: ManifestT;
  readonly label: string;
}

export interface CompareResult {
  readonly current: string;
  readonly against: string;
  readonly frame: {
    readonly current: { width: number; height: number };
    readonly against: { width: number; height: number };
  };
  /** Pixels per metre of each build. A change (often a refitted "auto" scale) changes every sprite. */
  readonly pixelsPerUnit: { readonly current: number; readonly against: number };
  readonly cells: number;
  readonly changedCells: number;
  readonly changedPixels: number;
  readonly added: readonly string[];
  readonly removed: readonly string[];
  /** Changed cells, most changed first. */
  readonly changes: readonly { readonly key: string; readonly pixels: number; readonly ratio: number }[];
  readonly diffImage: string | null;
  /** The keys of the diff image's rows, top to bottom. Its columns are before, after and difference. */
  readonly diffRows: readonly string[];
}

/** Read a build or history entry: a directory with sheets/manifest.json, or a sheets directory itself. */
export function readSnapshot(dir: string, label: string): BuildSnapshot {
  const sheetsDir = existsSync(join(dir, 'sheets', 'manifest.json')) ? join(dir, 'sheets') : dir;
  const file = join(sheetsDir, 'manifest.json');
  if (!existsSync(file))
    throw new Td2dError('E_USAGE', `${label} has no manifest.json.`, {
      hint: 'Point --against at a history entry or a build directory.',
    });
  return { sheetsDir, manifest: Manifest.parse(JSON.parse(readFileSync(file, 'utf8'))), label };
}

/** Every cell of a snapshot back at full frame size, by key. */
async function frames(snapshot: BuildSnapshot): Promise<Map<string, RgbaImage>> {
  const { manifest } = snapshot;
  const sheets = new Map<string, RgbaImage>();
  for (const s of manifest.sheets) sheets.set(s.name, await readPng(join(snapshot.sheetsDir, s.image)));
  const out = new Map<string, RgbaImage>();
  for (const c of manifest.cells) {
    const sheet = sheets.get(c.sheet) as RgbaImage;
    const img = createImage(manifest.frame.width, manifest.frame.height);
    for (let y = 0; y < c.h; y++) {
      const from = ((c.y + y) * sheet.width + c.x) * 4;
      img.rgba.set(sheet.rgba.subarray(from, from + c.w * 4), ((c.offset.y + y) * img.width + c.offset.x) * 4);
    }
    out.set(c.key, img);
  }
  return out;
}

/**
 * Compare two generations of an asset cell by cell, whatever their layouts: each cell is
 * rebuilt at frame size and compared with pixelmatch. With `out`, writes an image with a row
 * per changed cell: before, after and the difference.
 */
export async function compareBuilds(
  current: BuildSnapshot,
  against: BuildSnapshot,
  options: {
    readonly threshold?: number;
    readonly out?: string;
    readonly scale?: number;
    readonly limit?: number;
  } = {},
): Promise<CompareResult> {
  const a = await frames(against);
  const b = await frames(current);
  const added = [...b.keys()].filter((k) => !a.has(k));
  const removed = [...a.keys()].filter((k) => !b.has(k));
  const sameSize =
    current.manifest.frame.width === against.manifest.frame.width &&
    current.manifest.frame.height === against.manifest.frame.height;
  const changes: { key: string; pixels: number; ratio: number; diff: RgbaImage | null }[] = [];
  let changedPixels = 0;
  for (const [key, after] of b) {
    const before = a.get(key);
    if (!before) continue;
    if (!sameSize) {
      changes.push({ key, pixels: after.width * after.height, ratio: 1, diff: null });
      changedPixels += after.width * after.height;
      continue;
    }
    const diff = createImage(after.width, after.height);
    const pixels = pixelmatch(before.rgba, after.rgba, diff.rgba, after.width, after.height, {
      threshold: options.threshold ?? 0,
      includeAA: true,
      alpha: 0.2,
    });
    if (pixels > 0) {
      changes.push({ key, pixels, ratio: Number((pixels / (after.width * after.height)).toFixed(4)), diff });
      changedPixels += pixels;
    }
  }
  changes.sort((x, y) => y.pixels - x.pixels || (x.key < y.key ? -1 : 1));
  let diffImage: string | null = null;
  let diffRows: string[] = [];
  if (options.out && changes.length > 0 && sameSize) {
    const scale = options.scale ?? 4;
    const rows = changes.slice(0, options.limit ?? 32);
    const { width: fw, height: fh } = current.manifest.frame;
    const gap = 2;
    const canvas = createImage((fw * 3 + gap * 4) * scale, (rows.length * (fh + gap) + gap) * scale);
    for (let p = 0; p < canvas.width * canvas.height; p++) canvas.rgba.set([0x33, 0x3c, 0x57, 255], p * 4);
    const blit = (img: RgbaImage, col: number, row: number) => {
      for (let y = 0; y < fh * scale; y++) {
        for (let x = 0; x < fw * scale; x++) {
          const i = (Math.floor(y / scale) * fw + Math.floor(x / scale)) * 4;
          if (img.rgba[i + 3] === 0) continue;
          const ox = (gap + col * (fw + gap)) * scale + x;
          const oy = (gap + row * (fh + gap)) * scale + y;
          canvas.rgba.set(img.rgba.subarray(i, i + 4), (oy * canvas.width + ox) * 4);
        }
      }
    };
    rows.forEach((c, r) => {
      blit(a.get(c.key) as RgbaImage, 0, r);
      blit(b.get(c.key) as RgbaImage, 1, r);
      if (c.diff) blit(c.diff, 2, r);
    });
    mkdirSync(dirname(options.out), { recursive: true });
    await writePng(options.out, canvas, 9);
    diffImage = options.out;
    diffRows = rows.map((r) => r.key);
  }
  return {
    current: current.label,
    against: against.label,
    frame: { current: current.manifest.frame, against: against.manifest.frame },
    pixelsPerUnit: { current: current.manifest.pixelsPerUnit, against: against.manifest.pixelsPerUnit },
    cells: b.size,
    changedCells: changes.length,
    changedPixels,
    added,
    removed,
    changes: changes.map(({ key, pixels, ratio }) => ({ key, pixels, ratio })),
    diffImage,
    diffRows,
  };
}
