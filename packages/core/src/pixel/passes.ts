import { Td2dError } from '../errors.ts';
import { createImage, type RgbaImage } from './image.ts';
import { bayerMatrix, type Palette } from './palette.ts';

/**
 * Average each factor x factor block into one pixel, in premultiplied space so that
 * transparent pixels never darken edge colours. Integer arithmetic keeps it exact and
 * deterministic.
 *
 * A block whose mean alpha is exactly half way between two integers (a block half covered,
 * which happens on every edge that lands mid-block) is rounded with the GPU top-left fill
 * rule: up when its coverage sits towards the right or bottom of the block, which is a
 * shape's left or top edge, and down otherwise. Rounding every tie the same way would grow
 * or shrink shapes by a pixel whenever both edges land mid-block, so silhouettes would change
 * size as they move.
 */
export function boxDownscale(src: RgbaImage, factor: number): RgbaImage {
  if (!Number.isInteger(factor) || factor < 1)
    throw new Td2dError('E_INTERNAL', `Downscale factor must be a positive integer, got ${factor}.`);
  if (src.width % factor !== 0 || src.height % factor !== 0) {
    throw new Td2dError(
      'E_INTERNAL',
      `A ${src.width} x ${src.height} image cannot be divided into ${factor} x ${factor} blocks.`,
    );
  }
  if (factor === 1) return { width: src.width, height: src.height, rgba: src.rgba.slice() };
  const out = createImage(src.width / factor, src.height / factor);
  const n = factor * factor;
  const s = src.rgba;
  for (let oy = 0; oy < out.height; oy++) {
    for (let ox = 0; ox < out.width; ox++) {
      let a = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      // Alpha-weighted offset of the coverage from the block centre, in half-subsample units.
      let mx = 0;
      let my = 0;
      for (let dy = 0; dy < factor; dy++) {
        let i = ((oy * factor + dy) * src.width + ox * factor) * 4;
        for (let dx = 0; dx < factor; dx++, i += 4) {
          const alpha = s[i + 3] as number;
          a += alpha;
          r += (s[i] as number) * alpha;
          g += (s[i + 1] as number) * alpha;
          b += (s[i + 2] as number) * alpha;
          mx += alpha * (2 * dx - factor + 1);
          my += alpha * (2 * dy - factor + 1);
        }
      }
      const o = (oy * out.width + ox) * 4;
      if (a > 0) {
        out.rgba[o] = Math.round(r / a);
        out.rgba[o + 1] = Math.round(g / a);
        out.rgba[o + 2] = Math.round(b / a);
        const half = (2 * a) % n === 0 && ((2 * a) / n) % 2 === 1;
        out.rgba[o + 3] = half
          ? mx > 0 || (mx === 0 && my > 0)
            ? Math.ceil(a / n)
            : Math.floor(a / n)
          : Math.round(a / n);
      }
    }
  }
  return out;
}

/**
 * The alpha the renderer writes for lines drawn around parts (render.lines). Opaque surfaces
 * are written with 255, so this marks line samples without changing how anything looks.
 */
export const LINE_ALPHA = 254;

/**
 * Like boxDownscale for alpha, but each pixel takes the most common colour among the block's
 * opaque samples instead of their mean, so no in-between colours are made: toon bands and
 * material borders stay crisp, as in hand-drawn pixel art. Ties go to the colour of the
 * sample nearest the block centre (the first such sample in row order).
 *
 * Line samples (alpha LINE_ALPHA) vote apart: a block at least half covered by line becomes
 * a line pixel, and any other block leaves its line samples out. A line as wide as one block
 * then comes out one pixel wide wherever it falls, or two where it straddles two blocks equally.
 */
export function modeDownscale(src: RgbaImage, factor: number): RgbaImage {
  const out = boxDownscale(src, factor);
  if (factor === 1) return out;
  const s = src.rgba;
  const colours = new Int32Array(factor * factor);
  const counts = new Int32Array(factor * factor);
  const distance = new Int32Array(factor * factor);
  for (let oy = 0; oy < out.height; oy++) {
    for (let ox = 0; ox < out.width; ox++) {
      const o = (oy * out.width + ox) * 4;
      if (out.rgba[o + 3] === 0) continue;
      let lines = 0;
      let opaque = 0;
      for (let dy = 0; dy < factor; dy++) {
        let i = ((oy * factor + dy) * src.width + ox * factor) * 4 + 3;
        for (let dx = 0; dx < factor; dx++, i += 4) {
          if (s[i] === LINE_ALPHA) lines++;
          else if (s[i] !== 0) opaque++;
        }
      }
      // Vote among line samples if the block is mostly line (or has nothing else), else without them.
      const line = 2 * lines >= factor * factor || opaque === 0;
      let used = 0;
      for (let dy = 0; dy < factor; dy++) {
        let i = ((oy * factor + dy) * src.width + ox * factor) * 4;
        for (let dx = 0; dx < factor; dx++, i += 4) {
          if (s[i + 3] === 0 || (lines > 0 && (s[i + 3] === LINE_ALPHA) !== line)) continue;
          const c = ((s[i] as number) << 16) | ((s[i + 1] as number) << 8) | (s[i + 2] as number);
          const d = (2 * dx - factor + 1) ** 2 + (2 * dy - factor + 1) ** 2;
          let k = 0;
          while (k < used && colours[k] !== c) k++;
          if (k === used) {
            colours[k] = c;
            counts[k] = 0;
            distance[k] = d;
            used++;
          }
          counts[k] = (counts[k] as number) + 1;
          if (d < (distance[k] as number)) distance[k] = d;
        }
      }
      let best = 0;
      for (let k = 1; k < used; k++) {
        if (
          (counts[k] as number) > (counts[best] as number) ||
          (counts[k] === counts[best] && (distance[k] as number) < (distance[best] as number))
        )
          best = k;
      }
      const c = colours[best] as number;
      out.rgba[o] = (c >> 16) & 255;
      out.rgba[o + 1] = (c >> 8) & 255;
      out.rgba[o + 2] = c & 255;
    }
  }
  return out;
}

/** Make alpha binary: at or above `threshold` becomes 255, everything else 0 with black RGB. */
export function thresholdAlpha(img: RgbaImage, threshold: number): RgbaImage {
  const out = img.rgba.slice();
  for (let i = 3; i < out.length; i += 4) {
    if ((out[i] as number) >= threshold) {
      out[i] = 255;
    } else {
      out[i - 3] = 0;
      out[i - 2] = 0;
      out[i - 1] = 0;
      out[i] = 0;
    }
  }
  return { width: img.width, height: img.height, rgba: out };
}

/**
 * Give every fully transparent pixel the colour of its nearest opaque pixel
 * (4-connected breadth-first order, ties broken by scan order). Alpha is unchanged, so
 * the sprite looks identical, but engines that filter textures no longer pull black into
 * the edges.
 */
export function bleedEdges(img: RgbaImage): RgbaImage {
  const { width, height } = img;
  const out = img.rgba.slice();
  const filled = new Uint8Array(width * height);
  let queue: number[] = [];
  for (let p = 0; p < width * height; p++) {
    if (out[p * 4 + 3] !== 0) {
      filled[p] = 1;
      queue.push(p);
    }
  }
  if (queue.length === 0) return { width, height, rgba: out };
  while (queue.length > 0) {
    const next: number[] = [];
    for (const p of queue) {
      const x = p % width;
      const y = (p - x) / width;
      const neighbours = [
        y > 0 ? p - width : -1,
        x > 0 ? p - 1 : -1,
        x < width - 1 ? p + 1 : -1,
        y < height - 1 ? p + width : -1,
      ];
      for (const q of neighbours) {
        if (q < 0 || filled[q]) continue;
        filled[q] = 1;
        out[q * 4] = out[p * 4] as number;
        out[q * 4 + 1] = out[p * 4 + 1] as number;
        out[q * 4 + 2] = out[p * 4 + 2] as number;
        next.push(q);
      }
    }
    queue = next;
  }
  return { width, height, rgba: out };
}

/** Mirror an image left to right. */
export function flipHorizontal(img: RgbaImage): RgbaImage {
  const out = new Uint8Array(img.rgba.length);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const from = (y * img.width + x) * 4;
      out.set(img.rgba.subarray(from, from + 4), (y * img.width + (img.width - 1 - x)) * 4);
    }
  }
  return { width: img.width, height: img.height, rgba: out };
}

/** Quantise each colour channel to `levels` evenly spaced values. Alpha is unchanged. */
export function posterize(img: RgbaImage, levels: number): RgbaImage {
  const out = img.rgba.slice();
  const step = 255 / (levels - 1);
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue;
    for (let c = 0; c < 3; c++) out[i + c] = Math.round(Math.round((out[i + c] as number) / step) * step);
  }
  return { width: img.width, height: img.height, rgba: out };
}

/**
 * Snap every opaque pixel to its nearest palette colour. With dithering, each pixel's
 * colour is nudged by an ordered Bayer threshold first, which depends only on the pixel's
 * position, so the pattern is the same in every frame and does not crawl.
 */
export function mapToPalette(
  img: RgbaImage,
  palette: Palette,
  dither: 'none' | 'bayer-2' | 'bayer-4' | 'bayer-8',
  strength: number,
): RgbaImage {
  const out = img.rgba.slice();
  const matrix = dither === 'none' ? null : bayerMatrix(Number(dither.slice(6)) as 2 | 4 | 8);
  const spread = 64 * strength;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      if (out[i + 3] === 0) continue;
      const offset = matrix
        ? (((matrix[y % matrix.length] as number[])[x % matrix.length] as number) - 0.5) * spread
        : 0;
      const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v + offset)));
      const c = palette.nearest(clamp(out[i] as number), clamp(out[i + 1] as number), clamp(out[i + 2] as number));
      out[i] = (c >> 16) & 255;
      out[i + 1] = (c >> 8) & 255;
      out[i + 2] = c & 255;
    }
  }
  return { width: img.width, height: img.height, rgba: out };
}

function neighbours(connectivity: 4 | 8): readonly [number, number][] {
  return connectivity === 4
    ? [
        [0, -1],
        [-1, 0],
        [1, 0],
        [0, 1],
      ]
    : [
        [-1, -1],
        [0, -1],
        [1, -1],
        [-1, 0],
        [1, 0],
        [-1, 1],
        [0, 1],
        [1, 1],
      ];
}

/** Opaque mask grown (or, with `shrink`, eroded) by one step. */
function step(mask: Uint8Array, width: number, height: number, connectivity: 4 | 8, shrink: boolean): Uint8Array {
  const out = new Uint8Array(mask.length);
  const offsets = neighbours(connectivity);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      let hit = shrink;
      for (const [dx, dy] of offsets) {
        const nx = x + dx;
        const ny = y + dy;
        const value = nx >= 0 && ny >= 0 && nx < width && ny < height ? mask[ny * width + nx] : 0;
        if (shrink ? value === 0 : value === 1) {
          hit = !shrink;
          break;
        }
      }
      out[p] = shrink ? (mask[p] && hit ? 1 : 0) : mask[p] || hit ? 1 : 0;
    }
  }
  return out;
}

/**
 * Draw an outline in one colour. outside: paint the ring of transparent pixels around the
 * silhouette, `width` pixels thick. inside: recolour the silhouette's outer edge pixels.
 */
export function outline(
  img: RgbaImage,
  settings: { readonly side: 'outside' | 'inside'; readonly width: number; readonly connectivity?: 4 | 8 },
  color: number,
): RgbaImage {
  const { width, height } = img;
  const mask = new Uint8Array(width * height);
  for (let p = 0; p < mask.length; p++) mask[p] = img.rgba[p * 4 + 3] === 0 ? 0 : 1;
  let other: Uint8Array = mask;
  for (let i = 0; i < settings.width; i++)
    other = step(other, width, height, settings.connectivity ?? 8, settings.side === 'inside');
  const out = img.rgba.slice();
  const rgb = [(color >> 16) & 255, (color >> 8) & 255, color & 255];
  for (let p = 0; p < mask.length; p++) {
    const ring = settings.side === 'outside' ? other[p] === 1 && mask[p] === 0 : mask[p] === 1 && other[p] === 0;
    if (ring) out.set([...rgb, 255] as number[], p * 4);
  }
  return { width, height, rgba: out };
}

export interface CleanupResult {
  readonly image: RgbaImage;
  readonly removed: number;
  readonly recoloured: number;
}

/**
 * Remove stray pixels. remove: opaque pixels with fewer than `minNeighbours` opaque
 * 4-neighbours become transparent. recolour: a pixel whose colour matches none of its
 * opaque 4-neighbours (with at least three of them) takes their most common colour.
 */
export function cleanupOrphans(img: RgbaImage, mode: 'off' | 'remove' | 'recolour', minNeighbours = 1): CleanupResult {
  if (mode === 'off') return { image: img, removed: 0, recoloured: 0 };
  const { width, height } = img;
  const src = img.rgba;
  const out = src.slice();
  let removed = 0;
  let recoloured = 0;
  const colourAt = (x: number, y: number): number | null => {
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    const i = (y * width + x) * 4;
    return src[i + 3] === 0
      ? null
      : ((src[i] as number) << 16) | ((src[i + 1] as number) << 8) | (src[i + 2] as number);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const self = colourAt(x, y);
      if (self === null) continue;
      const around = [colourAt(x, y - 1), colourAt(x - 1, y), colourAt(x + 1, y), colourAt(x, y + 1)].filter(
        (c): c is number => c !== null,
      );
      const i = (y * width + x) * 4;
      if (mode === 'remove' && around.length < minNeighbours) {
        out.set([0, 0, 0, 0], i);
        removed++;
      } else if (mode === 'recolour' && around.length >= 3 && !around.includes(self)) {
        const counts = new Map<number, number>();
        for (const c of around) counts.set(c, (counts.get(c) ?? 0) + 1);
        const [best] = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0] as [number, number];
        out.set([(best >> 16) & 255, (best >> 8) & 255, best & 255], i);
        recoloured++;
      }
    }
  }
  return { image: { width, height, rgba: out }, removed, recoloured };
}

/** Opaque pixels with no opaque neighbour in any of the eight directions. */
export function isolatedPixels(img: RgbaImage): number {
  let count = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.rgba[(y * img.width + x) * 4 + 3] === 0) continue;
      let alone = true;
      for (const [dx, dy] of neighbours(8)) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < img.width && ny < img.height && img.rgba[(ny * img.width + nx) * 4 + 3] !== 0) {
          alone = false;
          break;
        }
      }
      if (alone) count++;
    }
  }
  return count;
}
