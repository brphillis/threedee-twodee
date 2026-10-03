import { Td2dError } from '../errors.ts';
import type { RgbaImage } from './image.ts';
import { hexToRgb, type Oklab, oklabDistanceSq, packRgb, rgbToHex, rgbToOklab } from './oklab.ts';
import { wuQuantise } from './wu.ts';

/** An ordered list of opaque colours with cached nearest-colour lookup in Oklab space. */
export class Palette {
  readonly colors: readonly number[];
  private readonly lab: readonly Oklab[];
  private readonly cache = new Map<number, number>();

  constructor(colors: readonly number[]) {
    if (colors.length === 0) throw new Td2dError('E_INTERNAL', 'A palette needs at least one colour.');
    this.colors = colors;
    this.lab = colors.map((c) => rgbToOklab((c >> 16) & 255, (c >> 8) & 255, c & 255));
  }

  static fromHex(hex: readonly string[]): Palette {
    return new Palette([...new Set(hex.map((h) => packRgb(...hexToRgb(h))))]);
  }

  /**
   * Build an n-colour palette from the opaque pixels of some images with Wu's quantiser (see wu.ts).
   * The result is deterministic for the same input, and colours are sorted dark to light.
   */
  static fromImages(images: readonly RgbaImage[], count: number): Palette {
    const unique = new Set<number>();
    for (const img of images) {
      for (let i = 0; i < img.rgba.length; i += 4)
        if (img.rgba[i + 3] !== 0)
          unique.add(packRgb(img.rgba[i] as number, img.rgba[i + 1] as number, img.rgba[i + 2] as number));
    }
    if (unique.size === 0) return new Palette([0]);
    if (unique.size <= count) return new Palette(sortByLightness([...unique]));
    return new Palette(
      sortByLightness([
        ...new Set(
          wuQuantise(
            images.map((img) => img.rgba),
            count,
          ),
        ),
      ]),
    );
  }

  /** Index of the closest palette colour. */
  nearestIndex(r: number, g: number, b: number): number {
    const key = packRgb(r, g, b);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const lab = rgbToOklab(r, g, b);
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.lab.length; i++) {
      const d = oklabDistanceSq(lab, this.lab[i] as Oklab);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    this.cache.set(key, best);
    return best;
  }

  nearest(r: number, g: number, b: number): number {
    return this.colors[this.nearestIndex(r, g, b)] as number;
  }

  has(packed: number): boolean {
    return this.colors.includes(packed);
  }

  toHex(): string[] {
    return this.colors.map(rgbToHex);
  }
}

function sortByLightness(colors: number[]): number[] {
  return colors
    .map((c) => ({ c, l: rgbToOklab((c >> 16) & 255, (c >> 8) & 255, c & 255)[0] }))
    .sort((a, b) => a.l - b.l || a.c - b.c)
    .map((e) => e.c);
}

/** Normalised ordered-dither threshold matrix of size n (2, 4 or 8), values in [0, 1). */
export function bayerMatrix(n: 2 | 4 | 8): number[][] {
  let m = [
    [0, 2],
    [3, 1],
  ];
  while (m.length < n) {
    const size = m.length;
    const next = Array.from({ length: size * 2 }, () => new Array<number>(size * 2).fill(0));
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = (m[y] as number[])[x] as number;
        (next[y] as number[])[x] = 4 * v;
        (next[y] as number[])[x + size] = 4 * v + 2;
        (next[y + size] as number[])[x] = 4 * v + 3;
        (next[y + size] as number[])[x + size] = 4 * v + 1;
      }
    }
    m = next;
  }
  return m.map((row) => row.map((v) => (v + 0.5) / (n * n)));
}
