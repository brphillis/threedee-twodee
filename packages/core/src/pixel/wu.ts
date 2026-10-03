/**
 * Xiaolin Wu's colour quantiser ("Efficient Statistical Computations for Optimal Color
 * Quantization", Graphics Gems II, 1991) over opaque RGB pixels.
 *
 * It builds a 32 x 32 x 32 histogram of colour moments, then repeatedly splits the box with
 * the largest variance at the plane that minimises the summed variance of the two halves.
 * Every step is plain float64 arithmetic in a fixed order, so the result is the same on
 * every platform. Alpha is not part of the histogram: callers pass opaque pixels only.
 */

const SIDE = 33;
const AREA = SIDE * SIDE;
const at = (r: number, g: number, b: number) => r * AREA + g * SIDE + b;

interface Box {
  r0: number;
  r1: number;
  g0: number;
  g1: number;
  b0: number;
  b1: number;
}

type Axis = 0 | 1 | 2;

interface Moments {
  readonly w: Float64Array;
  readonly r: Float64Array;
  readonly g: Float64Array;
  readonly b: Float64Array;
  readonly q: Float64Array;
}

function volume(c: Box, m: Float64Array): number {
  return (
    (m[at(c.r1, c.g1, c.b1)] as number) -
    (m[at(c.r1, c.g1, c.b0)] as number) -
    (m[at(c.r1, c.g0, c.b1)] as number) +
    (m[at(c.r1, c.g0, c.b0)] as number) -
    (m[at(c.r0, c.g1, c.b1)] as number) +
    (m[at(c.r0, c.g1, c.b0)] as number) +
    (m[at(c.r0, c.g0, c.b1)] as number) -
    (m[at(c.r0, c.g0, c.b0)] as number)
  );
}

/** The part of `volume` that does not depend on the box's upper bound along `axis`. */
function bottom(c: Box, axis: Axis, m: Float64Array): number {
  const v = (r: number, g: number, b: number) => m[at(r, g, b)] as number;
  if (axis === 0) return -v(c.r0, c.g1, c.b1) + v(c.r0, c.g1, c.b0) + v(c.r0, c.g0, c.b1) - v(c.r0, c.g0, c.b0);
  if (axis === 1) return -v(c.r1, c.g0, c.b1) + v(c.r1, c.g0, c.b0) + v(c.r0, c.g0, c.b1) - v(c.r0, c.g0, c.b0);
  return -v(c.r1, c.g1, c.b0) + v(c.r1, c.g0, c.b0) + v(c.r0, c.g1, c.b0) - v(c.r0, c.g0, c.b0);
}

/** The part of `volume` with the upper bound along `axis` replaced by `pos`. */
function top(c: Box, axis: Axis, pos: number, m: Float64Array): number {
  const v = (r: number, g: number, b: number) => m[at(r, g, b)] as number;
  if (axis === 0) return v(pos, c.g1, c.b1) - v(pos, c.g1, c.b0) - v(pos, c.g0, c.b1) + v(pos, c.g0, c.b0);
  if (axis === 1) return v(c.r1, pos, c.b1) - v(c.r1, pos, c.b0) - v(c.r0, pos, c.b1) + v(c.r0, pos, c.b0);
  return v(c.r1, c.g1, pos) - v(c.r1, c.g0, pos) - v(c.r0, c.g1, pos) + v(c.r0, c.g0, pos);
}

function variance(c: Box, m: Moments): number {
  const dr = volume(c, m.r);
  const dg = volume(c, m.g);
  const db = volume(c, m.b);
  return volume(c, m.q) - (dr * dr + dg * dg + db * db) / volume(c, m.w);
}

function maximise(
  c: Box,
  axis: Axis,
  first: number,
  last: number,
  whole: readonly [number, number, number, number],
  m: Moments,
): { score: number; cut: number } {
  const baseR = bottom(c, axis, m.r);
  const baseG = bottom(c, axis, m.g);
  const baseB = bottom(c, axis, m.b);
  const baseW = bottom(c, axis, m.w);
  let score = 0;
  let cut = -1;
  for (let i = first; i < last; i++) {
    let hr = baseR + top(c, axis, i, m.r);
    let hg = baseG + top(c, axis, i, m.g);
    let hb = baseB + top(c, axis, i, m.b);
    let hw = baseW + top(c, axis, i, m.w);
    if (hw === 0) continue;
    let temp = (hr * hr + hg * hg + hb * hb) / hw;
    hr = whole[0] - hr;
    hg = whole[1] - hg;
    hb = whole[2] - hb;
    hw = whole[3] - hw;
    if (hw === 0) continue;
    temp += (hr * hr + hg * hg + hb * hb) / hw;
    if (temp > score) {
      score = temp;
      cut = i;
    }
  }
  return { score, cut };
}

/** Split `a` in place and return the other half, or null when it cannot be split. */
function split(a: Box, m: Moments): Box | null {
  const whole = [volume(a, m.r), volume(a, m.g), volume(a, m.b), volume(a, m.w)] as const;
  const red = maximise(a, 0, a.r0 + 1, a.r1, whole, m);
  const green = maximise(a, 1, a.g0 + 1, a.g1, whole, m);
  const blue = maximise(a, 2, a.b0 + 1, a.b1, whole, m);
  let axis: Axis;
  if (red.score >= green.score && red.score >= blue.score) {
    if (red.cut < 0) return null;
    axis = 0;
  } else {
    axis = green.score >= blue.score ? 1 : 2;
  }
  const b: Box = { ...a };
  if (axis === 0) {
    b.r0 = red.cut;
    a.r1 = red.cut;
  } else if (axis === 1) {
    b.g0 = green.cut;
    a.g1 = green.cut;
  } else {
    b.b0 = blue.cut;
    a.b1 = blue.cut;
  }
  return b;
}

const cells = (c: Box) => (c.r1 - c.r0) * (c.g1 - c.g0) * (c.b1 - c.b0);

/**
 * Pick up to `count` colours for the pixels in `rgba` whose alpha is not 0. Returns packed
 * 0xrrggbb values, each the mean of the pixels in one box, in the order the boxes were made.
 */
export function wuQuantise(images: readonly Uint8Array[], count: number): number[] {
  const m: Moments = {
    w: new Float64Array(SIDE * AREA),
    r: new Float64Array(SIDE * AREA),
    g: new Float64Array(SIDE * AREA),
    b: new Float64Array(SIDE * AREA),
    q: new Float64Array(SIDE * AREA),
  };
  for (const rgba of images) {
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i + 3] === 0) continue;
      const r = rgba[i] as number;
      const g = rgba[i + 1] as number;
      const b = rgba[i + 2] as number;
      const p = at((r >> 3) + 1, (g >> 3) + 1, (b >> 3) + 1);
      m.w[p] = (m.w[p] as number) + 1;
      m.r[p] = (m.r[p] as number) + r;
      m.g[p] = (m.g[p] as number) + g;
      m.b[p] = (m.b[p] as number) + b;
      m.q[p] = (m.q[p] as number) + r * r + g * g + b * b;
    }
  }
  // Turn the histogram into cumulative moments, so any box's sums take eight lookups.
  const areas = [m.w, m.r, m.g, m.b, m.q].map(() => new Float64Array(SIDE));
  const arrays = [m.w, m.r, m.g, m.b, m.q];
  for (let r = 1; r < SIDE; r++) {
    for (const a of areas) a.fill(0);
    for (let g = 1; g < SIDE; g++) {
      const line = [0, 0, 0, 0, 0];
      for (let b = 1; b < SIDE; b++) {
        const p = at(r, g, b);
        for (let k = 0; k < 5; k++) {
          const arr = arrays[k] as Float64Array;
          const area = areas[k] as Float64Array;
          line[k] = (line[k] as number) + (arr[p] as number);
          area[b] = (area[b] as number) + (line[k] as number);
          arr[p] = (arr[p - AREA] as number) + (area[b] as number);
        }
      }
    }
  }
  const boxes: Box[] = [{ r0: 0, r1: 32, g0: 0, g1: 32, b0: 0, b1: 32 }];
  if (volume(boxes[0] as Box, m.w) === 0) return [];
  const scores = [0];
  let next = 0;
  while (boxes.length < count) {
    const box = boxes[next] as Box;
    const other = split(box, m);
    if (other) {
      boxes.push(other);
      scores[next] = cells(box) > 1 ? variance(box, m) : 0;
      scores.push(cells(other) > 1 ? variance(other, m) : 0);
    } else {
      scores[next] = 0;
    }
    next = 0;
    let best = scores[0] as number;
    for (let k = 1; k < scores.length; k++) {
      if ((scores[k] as number) > best) {
        best = scores[k] as number;
        next = k;
      }
    }
    if (best <= 0) break;
  }
  return boxes.map((box) => {
    const w = volume(box, m.w);
    const r = Math.round(volume(box, m.r) / w);
    const g = Math.round(volume(box, m.g) / w);
    const b = Math.round(volume(box, m.b) / w);
    return (r << 16) | (g << 8) | b;
  });
}
