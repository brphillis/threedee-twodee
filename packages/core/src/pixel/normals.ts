import { createImage, type RgbaImage } from './image.ts';

/** The normal of a surface facing the viewer, as the normal map encodes it. */
const FLAT: readonly [number, number, number] = [128, 128, 255];

/**
 * A sprite's normal map from the supersampled normal render: every block's normals are added
 * up and the sum normalised, so a block takes the direction of the surface that fills it. The
 * result follows the sprite's own alpha: pixels the pixel stage made opaque that have no
 * geometry under them, such as an outline ring, take the nearest normal, or face the viewer when
 * none is near; pixels the sprite left transparent stay transparent.
 */
export function downscaleNormals(render: RgbaImage, sprite: RgbaImage, factor: number): RgbaImage {
  const out = createImage(sprite.width, sprite.height);
  const covered = new Uint8Array(sprite.width * sprite.height);
  const s = render.rgba;
  for (let oy = 0; oy < sprite.height; oy++) {
    for (let ox = 0; ox < sprite.width; ox++) {
      let x = 0;
      let y = 0;
      let z = 0;
      let n = 0;
      for (let dy = 0; dy < factor; dy++) {
        let i = ((oy * factor + dy) * render.width + ox * factor) * 4;
        for (let dx = 0; dx < factor; dx++, i += 4) {
          if ((s[i + 3] as number) === 0) continue;
          x += (s[i] as number) / 127.5 - 1;
          y += (s[i + 1] as number) / 127.5 - 1;
          z += (s[i + 2] as number) / 127.5 - 1;
          n++;
        }
      }
      const o = (oy * sprite.width + ox) * 4;
      if (n === 0) continue;
      const length = Math.hypot(x, y, z) || 1;
      out.rgba[o] = encode(x / length);
      out.rgba[o + 1] = encode(y / length);
      out.rgba[o + 2] = encode(z / length);
      out.rgba[o + 3] = 255;
      covered[oy * sprite.width + ox] = 1;
    }
  }
  for (let p = 0; p < covered.length; p++) {
    const o = p * 4;
    if ((sprite.rgba[o + 3] as number) === 0) {
      out.rgba[o] = 0;
      out.rgba[o + 1] = 0;
      out.rgba[o + 2] = 0;
      out.rgba[o + 3] = 0;
    } else if (covered[p] === 0) {
      const near = nearestCovered(
        covered,
        out,
        sprite.width,
        sprite.height,
        p % sprite.width,
        Math.floor(p / sprite.width),
      );
      out.rgba[o] = near[0];
      out.rgba[o + 1] = near[1];
      out.rgba[o + 2] = near[2];
      out.rgba[o + 3] = 255;
    }
  }
  return out;
}

function encode(component: number): number {
  return Math.max(0, Math.min(255, Math.round((component + 1) * 127.5)));
}

/** The normal of the nearest pixel with geometry within a few pixels, or the flat normal. */
function nearestCovered(
  covered: Uint8Array,
  normals: RgbaImage,
  width: number,
  height: number,
  x: number,
  y: number,
): readonly [number, number, number] {
  for (let r = 1; r <= 4; r++) {
    let best: readonly [number, number, number] | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || covered[ny * width + nx] === 0) continue;
        const d = dx * dx + dy * dy;
        if (d < bestDistance) {
          bestDistance = d;
          const o = (ny * width + nx) * 4;
          best = [normals.rgba[o] as number, normals.rgba[o + 1] as number, normals.rgba[o + 2] as number];
        }
      }
    }
    if (best) return best;
  }
  return FLAT;
}

/** The normal map of a horizontally mirrored sprite: flipped, with every normal's x turned around. */
export function mirrorNormals(normals: RgbaImage): RgbaImage {
  const out = createImage(normals.width, normals.height);
  for (let y = 0; y < normals.height; y++) {
    for (let x = 0; x < normals.width; x++) {
      const from = (y * normals.width + x) * 4;
      const to = (y * normals.width + (normals.width - 1 - x)) * 4;
      out.rgba[to] = (normals.rgba[from + 3] as number) === 0 ? 0 : 255 - (normals.rgba[from] as number);
      out.rgba[to + 1] = normals.rgba[from + 1] as number;
      out.rgba[to + 2] = normals.rgba[from + 2] as number;
      out.rgba[to + 3] = normals.rgba[from + 3] as number;
    }
  }
  return out;
}
