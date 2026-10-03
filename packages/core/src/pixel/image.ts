/** An RGBA image with straight (not premultiplied) alpha, rows top-down. */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

export function createImage(width: number, height: number): RgbaImage {
  return { width, height, rgba: new Uint8Array(width * height * 4) };
}

export function cloneImage(img: RgbaImage): RgbaImage {
  return { width: img.width, height: img.height, rgba: img.rgba.slice() };
}

/** Distinct opaque colours as #rrggbb, sorted. */
export function opaqueColours(img: RgbaImage): string[] {
  const set = new Set<number>();
  const d = img.rgba;
  for (let i = 0; i < d.length; i += 4)
    if (d[i + 3] !== 0) set.add(((d[i] as number) << 16) | ((d[i + 1] as number) << 8) | (d[i + 2] as number));
  return [...set].sort((a, b) => a - b).map((c) => `#${c.toString(16).padStart(6, '0')}`);
}
