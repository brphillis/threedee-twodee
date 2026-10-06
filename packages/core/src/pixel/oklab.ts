/** Colour maths for palette matching. Distances are measured in Oklab, which tracks perceived difference far better than RGB. */

const toLinear = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  toLinear[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export type Oklab = readonly [number, number, number];

/** sRGB bytes to Oklab (Björn Ottosson's matrices). */
export function rgbToOklab(r: number, g: number, b: number): Oklab {
  const lr = toLinear[r] as number;
  const lg = toLinear[g] as number;
  const lb = toLinear[b] as number;
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabDistanceSq(a: Oklab, b: Oklab): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

export function packRgb(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(packed: number): string {
  return `#${packed.toString(16).padStart(6, '0')}`;
}

/** Oklab to sRGB bytes, clamped to the gamut. The inverse of rgbToOklab. */
export function oklabToRgb([L, a, b]: Oklab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const encode = (linear: number) => {
    const c = Math.min(1, Math.max(0, linear));
    return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
  };
  return [
    encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/**
 * Turn a colour's hue towards a target hue (Oklch degrees) by up to `degrees`, never past it,
 * keeping its lightness and chroma. Greys have no hue and come back unchanged.
 */
export function turnHueTowards(lab: Oklab, targetDeg: number, degrees: number): Oklab {
  const [L, a, b] = lab;
  const chroma = Math.hypot(a, b);
  if (chroma < 1e-6 || degrees <= 0) return lab;
  const hue = (Math.atan2(b, a) * 180) / Math.PI;
  let delta = ((((targetDeg - hue) % 360) + 540) % 360) - 180;
  if (Math.abs(delta) > degrees) delta = Math.sign(delta) * degrees;
  const turned = ((hue + delta) * Math.PI) / 180;
  return [L, chroma * Math.cos(turned), chroma * Math.sin(turned)];
}
