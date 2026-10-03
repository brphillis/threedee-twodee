import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import sharp from 'sharp';
import type { RenderedFrame } from './backend.ts';

/** Reverse row order in place-free fashion. WebGL reads bottom-up; images are top-down. */
export function flipRows(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const row = width * 4;
  const out = new Uint8Array(rgba.length);
  for (let y = 0; y < height; y++) out.set(rgba.subarray((height - 1 - y) * row, (height - y) * row), y * row);
  return out;
}

// Pure pixel measurements live in pixel/bounds.ts so worker threads can use them without loading sharp.
export { alphaCoverage, opaqueBounds } from '../pixel/bounds.ts';

export async function encodePng(
  frame: Pick<RenderedFrame, 'width' | 'height' | 'rgba'>,
  compressionLevel = 6,
): Promise<Buffer> {
  return sharp(Buffer.from(frame.rgba.buffer, frame.rgba.byteOffset, frame.rgba.byteLength), {
    raw: { width: frame.width, height: frame.height, channels: 4 },
  })
    .png({ compressionLevel, adaptiveFiltering: false, palette: false })
    .toBuffer();
}

export async function writePng(
  file: string,
  frame: Pick<RenderedFrame, 'width' | 'height' | 'rgba'>,
  compressionLevel = 6,
): Promise<number> {
  mkdirSync(dirname(file), { recursive: true });
  const info = await sharp(Buffer.from(frame.rgba.buffer, frame.rgba.byteOffset, frame.rgba.byteLength), {
    raw: { width: frame.width, height: frame.height, channels: 4 },
  })
    .png({ compressionLevel, adaptiveFiltering: false, palette: false })
    .toFile(file);
  return info.size;
}

export async function readPng(file: string | Buffer): Promise<{ width: number; height: number; rgba: Uint8Array }> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    rgba: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
  };
}
