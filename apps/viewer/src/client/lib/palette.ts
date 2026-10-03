// Colour counting for the metadata panel and the hover readout. No DOM.

export interface Swatch {
  readonly hex: string;
  readonly count: number;
  /** Position in the asset's palette, or null when it has none or the colour is not in it. */
  readonly paletteIndex: number | null;
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

export function hexOf(r: number, g: number, b: number): string {
  return `#${HEX[r & 255]}${HEX[g & 255]}${HEX[b & 255]}`;
}

export function paletteIndexOf(hex: string, palette: readonly string[]): number | null {
  const i = palette.findIndex((p) => p.toLowerCase() === hex.toLowerCase());
  return i < 0 ? null : i;
}

export interface PixelRegion {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Count the opaque colours of an RGBA image, optionally only inside `regions` (cells of a sheet,
 * so padding and extrusion are not counted twice). Most used first, then by hex.
 */
export function countColours(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  palette: readonly string[] = [],
  regions?: readonly PixelRegion[],
): Swatch[] {
  const counts = new Map<number, number>();
  const height = Math.floor(rgba.length / 4 / width);
  const add = (x0: number, y0: number, w: number, h: number) => {
    const x1 = Math.min(width, x0 + w);
    const y1 = Math.min(height, y0 + h);
    for (let y = Math.max(0, y0); y < y1; y++) {
      for (let x = Math.max(0, x0); x < x1; x++) {
        const i = (y * width + x) * 4;
        if ((rgba[i + 3] as number) === 0) continue;
        const key = ((rgba[i] as number) << 16) | ((rgba[i + 1] as number) << 8) | (rgba[i + 2] as number);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  };
  if (regions) for (const r of regions) add(r.x, r.y, r.w, r.h);
  else add(0, 0, width, height);
  return [...counts]
    .map(([key, count]) => {
      const hex = hexOf(key >> 16, (key >> 8) & 255, key & 255);
      return { hex, count, paletteIndex: paletteIndexOf(hex, palette) };
    })
    .sort((a, b) => b.count - a.count || (a.hex < b.hex ? -1 : a.hex > b.hex ? 1 : 0));
}

/** Merge swatch lists (one per sheet) into one. */
export function mergeSwatches(lists: readonly (readonly Swatch[])[]): Swatch[] {
  const merged = new Map<string, Swatch>();
  for (const list of lists) {
    for (const s of list) {
      const seen = merged.get(s.hex);
      merged.set(s.hex, seen ? { ...seen, count: seen.count + s.count } : s);
    }
  }
  return [...merged.values()].sort((a, b) => b.count - a.count || (a.hex < b.hex ? -1 : a.hex > b.hex ? 1 : 0));
}
