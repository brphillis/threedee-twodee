// Image differences for the compare view. No DOM: pixelmatch runs on plain arrays.
import pixelmatch from 'pixelmatch';

export interface Pixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

export interface Difference {
  readonly width: number;
  readonly height: number;
  /** Pixels whose RGBA differs at all. Transparent pixels match whatever their colour channels. */
  readonly changed: number;
  /**
   * Pixels pixelmatch counts as different at `threshold` (0 by default, which is what
   * `td2d compare` reports). Equal to `changed` for sprites with fully opaque or clear pixels.
   */
  readonly perceptible: number;
  readonly total: number;
  /** A red-on-faded image of the changes, from pixelmatch. */
  readonly heat: Uint8ClampedArray;
}

/** `image` on a canvas of `width` x `height`, transparent where it does not reach. */
export function pad(image: Pixels, width: number, height: number): Uint8ClampedArray {
  if (image.width === width && image.height === height) return new Uint8ClampedArray(image.data);
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < Math.min(height, image.height); y++) {
    const row = image.data.subarray(y * image.width * 4, (y * image.width + Math.min(width, image.width)) * 4);
    out.set(row, y * width * 4);
  }
  return out;
}

/** Exact count of differing pixels, treating every fully transparent pixel as equal. */
export function changedPixels(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    const aa = a[i + 3] as number;
    const ba = b[i + 3] as number;
    if (aa === 0 && ba === 0) continue;
    if (aa !== ba || a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) changed++;
  }
  return changed;
}

/** Compare two images, padding the smaller so differently sized frames still compare. */
export function diffImages(a: Pixels, b: Pixels, threshold = 0): Difference {
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const pa = pad(a, width, height);
  const pb = pad(b, width, height);
  const heat = new Uint8ClampedArray(width * height * 4);
  const perceptible = pixelmatch(pa, pb, heat, width, height, { threshold, includeAA: true, alpha: 0.2 });
  return { width, height, changed: changedPixels(pa, pb), perceptible, total: width * height, heat };
}
