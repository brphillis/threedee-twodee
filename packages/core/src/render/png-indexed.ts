import { crc32, deflateSync } from 'node:zlib';
import type { RgbaImage } from '../pixel/image.ts';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

export interface IndexedPng {
  readonly png: Buffer;
  /** Palette entries written, including transparent ones. */
  readonly entries: number;
  readonly bitDepth: 1 | 2 | 4 | 8;
}

/**
 * Encode an image as an indexed PNG (colour type 3) with a PLTE and tRNS chunk, or return
 * null if it needs more than 256 entries. Opaque colours come first in `order` (palette
 * order when given). When there is room, every colour also gets a transparent twin, so the
 * colours that edge bleeding gives transparent pixels survive; otherwise transparent pixels
 * share one entry. Output is deterministic.
 */
export function encodeIndexedPng(img: RgbaImage, order: readonly number[] = []): IndexedPng | null {
  const opaque = new Set<number>();
  const clear = new Set<number>();
  for (let i = 0; i < img.rgba.length; i += 4) {
    const c = ((img.rgba[i] as number) << 16) | ((img.rgba[i + 1] as number) << 8) | (img.rgba[i + 2] as number);
    (img.rgba[i + 3] === 0 ? clear : opaque).add(c);
    if (img.rgba[i + 3] !== 0 && img.rgba[i + 3] !== 255) return null;
  }
  const colours = [
    ...order.filter((c) => opaque.has(c)),
    ...[...opaque].filter((c) => !order.includes(c)).sort((a, b) => a - b),
  ];
  const keepClear = colours.length * 2 <= 256 && [...clear].every((c) => opaque.has(c));
  const transparent = keepClear ? colours.filter((c) => clear.has(c)) : clear.size > 0 ? [0] : [];
  const entries = colours.length + transparent.length;
  if (entries > 256 || entries === 0) return null;
  const opaqueIndex = new Map(colours.map((c, i) => [c, i]));
  const clearIndex = new Map(transparent.map((c, i) => [c, colours.length + i]));

  const bitDepth: IndexedPng['bitDepth'] = entries <= 2 ? 1 : entries <= 4 ? 2 : entries <= 16 ? 4 : 8;
  const perByte = 8 / bitDepth;
  const rowBytes = Math.ceil(img.width / perByte);
  const raw = Buffer.alloc((rowBytes + 1) * img.height);
  for (let y = 0; y < img.height; y++) {
    const row = y * (rowBytes + 1);
    raw[row] = 0;
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      const c = ((img.rgba[i] as number) << 16) | ((img.rgba[i + 1] as number) << 8) | (img.rgba[i + 2] as number);
      const index =
        img.rgba[i + 3] === 0 ? (clearIndex.get(keepClear ? c : 0) as number) : (opaqueIndex.get(c) as number);
      const byte = row + 1 + Math.floor(x / perByte);
      const shift = 8 - bitDepth * ((x % perByte) + 1);
      raw[byte] = (raw[byte] as number) | (index << shift);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = 3;
  const plte = Buffer.alloc(entries * 3);
  for (const [i, c] of [...colours, ...transparent].entries())
    plte.set([(c >> 16) & 255, (c >> 8) & 255, c & 255], i * 3);
  const parts = [SIGNATURE, chunk('IHDR', ihdr), chunk('PLTE', plte)];
  if (transparent.length > 0)
    parts.push(chunk('tRNS', Buffer.from([...colours.map(() => 255), ...transparent.map(() => 0)])));
  parts.push(chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)));
  return { png: Buffer.concat(parts), entries, bitDepth };
}
