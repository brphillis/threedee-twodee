// Pixel measurements with no native dependencies: safe to load in worker threads.

/** Fraction of pixels with any opacity. */
export function alphaCoverage(rgba: Uint8Array): number {
  let opaque = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 0) opaque++;
  return rgba.length === 0 ? 0 : opaque / (rgba.length / 4);
}

/** Tight bounds of non-transparent pixels, or null for an empty frame. */
export function opaqueBounds(frame: {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}): { x: number; y: number; w: number; h: number } | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      if (frame.rgba[(y * frame.width + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
