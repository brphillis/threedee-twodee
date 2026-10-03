import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Td2dError } from '../errors.ts';
import { createImage, type RgbaImage } from '../pixel/image.ts';
import { hexToRgb, packRgb } from '../pixel/oklab.ts';
import { Palette } from '../pixel/palette.ts';
import type { Exporter } from './registry.ts';

/** LZW-compress colour indices the way GIF wants: variable-width codes, packed least significant bit first. */
export function lzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  const out: number[] = [];
  let bits = 0;
  let bitCount = 0;
  let codeSize = minCodeSize + 1;
  let next = end + 1;
  let table = new Map<number, number>();
  const emit = (code: number) => {
    bits |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      out.push(bits & 0xff);
      bits >>>= 8;
      bitCount -= 8;
    }
  };
  emit(clear);
  if (indices.length === 0) {
    emit(end);
    if (bitCount > 0) out.push(bits & 0xff);
    return Uint8Array.from(out);
  }
  let prefix = indices[0] as number;
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i] as number;
    const key = (prefix << 8) | k;
    const found = table.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      table = new Map();
      next = end + 1;
      codeSize = minCodeSize + 1;
    } else {
      if (next >= 1 << codeSize) codeSize++;
      table.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(end);
  if (bitCount > 0) out.push(bits & 0xff);
  return Uint8Array.from(out);
}

export interface GifFrame {
  readonly image: RgbaImage;
  /** Delay before the next frame, in hundredths of a second. */
  readonly delay: number;
}

/**
 * Encode an animated GIF89a that loops forever. All frames share one colour table of at most
 * 255 colours plus one transparent entry: the exact colours when there are few enough, or a
 * Wu-quantised palette otherwise. Every frame replaces the whole canvas (disposal 2), so
 * transparent pixels never show the previous frame.
 */
export function encodeGif(frames: readonly GifFrame[]): Buffer {
  if (frames.length === 0) throw new Td2dError('E_INTERNAL', 'A GIF needs at least one frame.');
  const { width, height } = (frames[0] as GifFrame).image;
  const exact = new Set<number>();
  for (const f of frames) {
    for (let i = 0; i < f.image.rgba.length; i += 4) {
      if (f.image.rgba[i + 3] !== 0)
        exact.add(packRgb(f.image.rgba[i] as number, f.image.rgba[i + 1] as number, f.image.rgba[i + 2] as number));
    }
  }
  const palette =
    exact.size <= 255
      ? [...exact].sort((a, b) => a - b)
      : Palette.fromImages(
          frames.map((f) => f.image),
          255,
        ).colors;
  const lookup = new Palette(palette.length > 0 ? palette : [0]);
  const exactIndex = new Map(palette.map((c, i) => [c, i]));
  const transparent = palette.length;
  let tableBits = 1;
  while (1 << tableBits < palette.length + 1) tableBits++;
  const tableSize = 1 << tableBits;
  const bytes: number[] = [];
  const word = (n: number) => bytes.push(n & 0xff, (n >> 8) & 0xff);
  bytes.push(...Buffer.from('GIF89a', 'ascii'));
  word(width);
  word(height);
  bytes.push(0x80 | ((tableBits - 1) << 4) | (tableBits - 1), transparent, 0);
  for (let i = 0; i < tableSize; i++) {
    const c = palette[i] ?? 0;
    bytes.push((c >> 16) & 255, (c >> 8) & 255, c & 255);
  }
  // NETSCAPE2.0 application extension: loop forever.
  bytes.push(0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0', 'ascii'), 3, 1, 0, 0, 0);
  const minCodeSize = Math.max(2, tableBits);
  for (const f of frames) {
    bytes.push(0x21, 0xf9, 4, (2 << 2) | 1);
    word(f.delay);
    bytes.push(transparent, 0);
    bytes.push(0x2c);
    word(0);
    word(0);
    word(width);
    word(height);
    bytes.push(0);
    const indices = new Uint8Array(width * height);
    for (let p = 0; p < indices.length; p++) {
      const i = p * 4;
      if (f.image.rgba[i + 3] === 0) {
        indices[p] = transparent;
        continue;
      }
      const r = f.image.rgba[i] as number;
      const g = f.image.rgba[i + 1] as number;
      const b = f.image.rgba[i + 2] as number;
      indices[p] = exactIndex.get(packRgb(r, g, b)) ?? lookup.nearestIndex(r, g, b);
    }
    bytes.push(minCodeSize);
    const data = lzwEncode(indices, minCodeSize);
    for (let o = 0; o < data.length; o += 255) {
      const block = data.subarray(o, o + 255);
      bytes.push(block.length, ...block);
    }
    bytes.push(0);
  }
  bytes.push(0x3b);
  return Buffer.from(bytes);
}

/** Nearest-neighbour enlargement onto a background (null keeps transparency). */
function blit(target: RgbaImage, src: RgbaImage, left: number, scale: number, background: number | null): void {
  for (let y = 0; y < src.height * scale; y++) {
    for (let x = 0; x < src.width * scale; x++) {
      const i = (Math.floor(y / scale) * src.width + Math.floor(x / scale)) * 4;
      const o = (y * target.width + left + x) * 4;
      if (src.rgba[i + 3] !== 0)
        target.rgba.set([src.rgba[i] as number, src.rgba[i + 1] as number, src.rgba[i + 2] as number, 255], o);
      else if (background !== null)
        target.rgba.set([(background >> 16) & 255, (background >> 8) & 255, background & 255, 255], o);
    }
  }
}

export const gifExporter: Exporter = {
  id: 'gif-preview',
  version: 1,
  description: 'One looping GIF per clip with every direction side by side, for a quick look outside a game.',
  async write(ctx) {
    const { scale, background } = ctx.asset.export.gif;
    const bg = background === 'transparent' ? null : packRgb(...hexToRgb(background));
    const directions = ctx.asset.directions.map((d) => d.name);
    const sprites = await ctx.sprites();
    const files: string[] = [];
    for (const [clip, def] of Object.entries(ctx.asset.animation.clips)) {
      const frames: GifFrame[] = [];
      const { width, height } = ctx.layout.frame;
      for (let i = 0; i < def.frames; i++) {
        const canvas = createImage(width * scale * directions.length, height * scale);
        directions.forEach((dir, d) => {
          const sprite = sprites.get(`${clip}/${dir}/${String(i).padStart(3, '0')}`);
          if (sprite) blit(canvas, sprite, d * width * scale, scale, bg);
        });
        frames.push({ image: canvas, delay: Math.max(2, Math.round(100 / def.fps)) });
      }
      const file = `${ctx.name}-${clip}.gif`;
      writeFileSync(join(ctx.dir, file), encodeGif(frames));
      files.push(file);
    }
    return files;
  },
};
