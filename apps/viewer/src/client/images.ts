// Image loading and pixel access in the browser.
import type { ManifestT } from '@td2d/schema';
import type { Cell } from './lib/cells.ts';
import type { Pixels } from './lib/diff.ts';

const images = new Map<string, Promise<HTMLImageElement>>();

/** Load an image once per URL. */
export function loadImage(url: string): Promise<HTMLImageElement> {
  const cached = images.get(url);
  if (cached) return cached;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => {
      images.delete(url);
      reject(new Error(`Could not load ${url}`));
    };
    img.src = url;
  });
  images.set(url, promise);
  return promise;
}

/** The URL of a sheet image, with the generation time so a regeneration is not served from cache. */
export function sheetUrl(files: string, manifest: ManifestT, sheet: string): string {
  const entry = manifest.sheets.find((s) => s.name === sheet) ?? manifest.sheets[0];
  return `${files}/sheets/${entry?.image ?? ''}?t=${encodeURIComponent(manifest.generatedAt)}`;
}

export function canvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, width);
  c.height = Math.max(1, height);
  return c;
}

export function context(c: HTMLCanvasElement, readback = false): CanvasRenderingContext2D {
  const ctx = c.getContext('2d', readback ? { willReadFrequently: true } : undefined);
  if (!ctx) throw new Error('2D canvas is not available');
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

/** The RGBA pixels of a drawable. */
export function pixelsOf(source: CanvasImageSource, width: number, height: number): Pixels {
  const c = canvas(width, height);
  const ctx = context(c, true);
  ctx.drawImage(source, 0, 0);
  return ctx.getImageData(0, 0, width, height);
}

/** One sprite as a frame-sized canvas: the cell drawn at its trim offset. */
export function frameCanvas(sheet: CanvasImageSource, cell: Cell, frame: ManifestT['frame']): HTMLCanvasElement {
  const c = canvas(frame.width, frame.height);
  context(c).drawImage(sheet, cell.x, cell.y, cell.w, cell.h, cell.offset.x, cell.offset.y, cell.w, cell.h);
  return c;
}

/** Every sheet image of a build, by sheet name. */
export async function loadSheets(files: string, manifest: ManifestT): Promise<Map<string, HTMLImageElement>> {
  const loaded = await Promise.all(
    manifest.sheets.map(async (s) => [s.name, await loadImage(sheetUrl(files, manifest, s.name))] as const),
  );
  return new Map(loaded);
}

/** Every sprite of a build as frame-sized pixels, by key. */
export async function loadFrames(files: string, manifest: ManifestT): Promise<Map<string, HTMLCanvasElement>> {
  const sheets = await loadSheets(files, manifest);
  const frames = new Map<string, HTMLCanvasElement>();
  for (const cell of manifest.cells) {
    const sheet = sheets.get(cell.sheet);
    if (sheet) frames.set(cell.key, frameCanvas(sheet, cell, manifest.frame));
  }
  return frames;
}
